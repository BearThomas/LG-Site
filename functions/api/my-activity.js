import { requireAuth } from '../_lib/auth.js';
import { getBackupEncryptKey } from '../_lib/config.js';
import { normalizeUserId, requireDb, toPostDocument } from '../_lib/db.js';
import { errorResponse, HttpError, json, methodNotAllowed } from '../_lib/http.js';

const ENCRYPTED_VALUE = /^[0-9a-fA-F]{32}:[0-9a-fA-F]+$/;

function hexToBytes(value) {
  if (!/^[0-9a-fA-F]+$/.test(value) || value.length % 2 !== 0) {
    throw new HttpError(500, '归档数据格式不正确');
  }
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

async function createArchiveDecryptor(env) {
  const rawKey = getBackupEncryptKey(env);
  if (!/^[0-9a-fA-F]{64}$/.test(rawKey)) return null;
  const key = await crypto.subtle.importKey('raw', hexToBytes(rawKey), { name: 'AES-CBC' }, false, ['decrypt']);
  return async value => {
    if (value === undefined || value === null || !ENCRYPTED_VALUE.test(String(value))) return value;
    const [ivHex, cipherHex] = String(value).split(':');
    try {
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-CBC', iv: hexToBytes(ivHex) },
        key,
        hexToBytes(cipherHex)
      );
      return new TextDecoder().decode(decrypted);
    } catch {
      throw new HttpError(500, '归档内容解密失败');
    }
  };
}

async function fetchAssetJson(env, request, path) {
  if (!env.ASSETS) return null;
  const response = await env.ASSETS.fetch(new Request(new URL(path, request.url)));
  if (!response.ok) return null;
  return response.json();
}

function documentId(document) {
  return String(document.$id || document.id || '');
}

function documentDate(document) {
  return document.$createdAt || document.createdAt || document.created_at || '';
}

async function listArchivedActivity(env, request, collection, userId, decrypt, tombstones) {
  const index = await fetchAssetJson(env, request, `/data-backups/${collection}/index.json`);
  if (!index?.chunks?.length) return [];
  const documents = [];

  for (const chunk of index.chunks) {
    const rows = await fetchAssetJson(env, request, `/data-backups/${collection}/${chunk.file}`);
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const id = documentId(row);
      if (!id || tombstones.has(id)) continue;
      const authorId = normalizeUserId(await decrypt(row.authorId ?? row.author_id ?? ''));
      if (authorId !== userId) continue;

      if (collection === 'posts') {
        documents.push({
          $id: id,
          $createdAt: documentDate(row),
          title: await decrypt(row.title ?? ''),
          content: await decrypt(row.content ?? ''),
          authorId
        });
      } else {
        documents.push({
          $id: id,
          $createdAt: documentDate(row),
          postId: row.postId || row.post_id || '',
          content: await decrypt(row.content ?? ''),
          authorId
        });
      }
    }
  }
  return documents;
}

async function listHotActivity(env, collection, userId) {
  const db = requireDb(env);
  if (collection === 'posts') {
    const result = await db.prepare(`
      SELECT posts.*,
        (SELECT COUNT(*) FROM likes WHERE likes.post_id = posts.id) AS likes,
        0 AS liked
      FROM posts
      WHERE author_id = ?
      ORDER BY created_at DESC
      LIMIT 100
    `).bind(userId).all();
    return (result.results || []).map(toPostDocument);
  }

  const result = await db.prepare(`
    SELECT * FROM comments
    WHERE author_id = ?
    ORDER BY created_at DESC
    LIMIT 100
  `).bind(userId).all();
  return (result.results || []).map(row => ({
    $id: row.id,
    $createdAt: row.created_at,
    postId: row.post_id,
    content: row.content,
    authorId: row.author_id
  }));
}

export async function onRequestGet({ request, env }) {
  try {
    const { profile } = await requireAuth(request, env);
    const url = new URL(request.url);
    const type = url.searchParams.get('type') === 'comments' ? 'comments' : 'posts';
    const userId = normalizeUserId(profile.id);
    const db = requireDb(env);
    const tombstoneResult = await db.prepare('SELECT item_id FROM tombstones WHERE collection = ?').bind(type).all();
    const tombstones = new Set((tombstoneResult.results || []).map(row => String(row.item_id)));
    const hotDocuments = await listHotActivity(env, type, userId);
    const decrypt = await createArchiveDecryptor(env);
    const archivedDocuments = decrypt
      ? await listArchivedActivity(env, request, type, userId, decrypt, tombstones)
      : [];

    const byId = new Map();
    for (const document of [...archivedDocuments, ...hotDocuments]) byId.set(documentId(document), document);
    const documents = [...byId.values()]
      .sort((left, right) => new Date(documentDate(right)) - new Date(documentDate(left)))
      .slice(0, 100);

    return json({ documents, total: documents.length }, 200, { 'Cache-Control': 'private, no-store' });
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', route: '/api/my-activity', message: error.message, status: error.status }));
    return errorResponse(error, '加载个人足迹失败');
  }
}

export function onRequestPost() { return methodNotAllowed(['GET']); }
export function onRequestPatch() { return methodNotAllowed(['GET']); }
export function onRequestDelete() { return methodNotAllowed(['GET']); }
