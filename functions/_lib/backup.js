import { getBackupEncryptKey } from './config.js';

const ENCRYPTED_VALUE = /^[0-9a-fA-F]{32}:[0-9a-fA-F]+$/;

const COLLECTION_FIELD_ALLOWLIST = {
  posts: ['$id', 'title', 'content', 'createdAt', 'boardId', 'viewPermission', 'status', 'editedAt', 'commentCount', 'likes'],
  comments: ['$id', 'postId', 'content', 'createdAt'],
  confessions: ['$id', 'content', 'createdAt', 'likes', 'status']
};

const FIELD_VALUE_MAP = {
  posts: {
    $id: ['id', '$id'],
    title: ['title'],
    content: ['content'],
    createdAt: ['$createdAt', 'createdAt', 'created_at'],
    boardId: ['boardId', 'board_id'],
    viewPermission: ['viewPermission', 'view_permission'],
    status: ['status'],
    editedAt: ['editedAt', 'edited_at'],
    commentCount: ['commentCount', 'comment_count'],
    likes: ['likes']
  },
  comments: {
    $id: ['id', '$id'],
    postId: ['postId', 'post_id'],
    content: ['content'],
    createdAt: ['$createdAt', 'createdAt', 'created_at']
  },
  confessions: {
    $id: ['id', '$id'],
    content: ['content'],
    createdAt: ['$createdAt', 'createdAt', 'created_at'],
    likes: ['likes'],
    status: ['status']
  }
};

function hexToBytes(value) {
  if (!/^[0-9a-fA-F]+$/.test(value) || value.length % 2 !== 0) {
    throw new Error('归档数据格式不正确');
  }
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

export async function createArchiveDecryptor(env) {
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
      throw new Error('归档内容解密失败');
    }
  };
}

export async function fetchAssetJson(env, request, path) {
  if (!env?.ASSETS) return null;
  const response = await env.ASSETS.fetch(new Request(new URL(path, request.url)));
  if (!response.ok) return null;
  return response.json();
}

function normalizeRequestedFields(collection, fields) {
  const allowList = COLLECTION_FIELD_ALLOWLIST[collection] || [];
  if (!Array.isArray(fields) || !fields.length) return allowList;
  const requested = fields.filter(Boolean).map(String);
  return requested.filter(field => allowList.includes(field));
}

function pickValue(document, fieldName, fieldMap) {
  for (const candidate of fieldMap[fieldName] || []) {
    if (candidate in document && document[candidate] !== undefined) {
      return document[candidate];
    }
  }
  return undefined;
}

function normalizeDocumentId(document) {
  return String(document?.$id || document?.id || '').trim();
}

function normalizeCreatedAt(document) {
  return document?.$createdAt || document?.createdAt || document?.created_at || null;
}

async function projectArchivedDocument(collection, document, selectedFields, decrypt) {
  const projected = {};
  const fieldMap = FIELD_VALUE_MAP[collection] || {};
  for (const field of selectedFields) {
    if (field === '$id') {
      const value = normalizeDocumentId(document);
      if (value) projected.$id = value;
      continue;
    }
    if (field === 'createdAt') {
      const value = normalizeCreatedAt(document);
      if (value !== null && value !== undefined) projected.createdAt = value;
      continue;
    }
    const rawValue = pickValue(document, field, fieldMap);
    if (rawValue === undefined || rawValue === null) continue;
    let finalValue = rawValue;
    if (typeof finalValue === 'string' && ENCRYPTED_VALUE.test(finalValue)) {
      finalValue = await decrypt(finalValue);
    }
    if (field === 'likes' || field === 'commentCount' || field === 'viewPermission' || field === 'status') {
      projected[field] = Number(finalValue || 0);
    } else {
      projected[field] = finalValue;
    }
  }
  return projected;
}

export async function findArchivedDocuments(env, request, collection, ids, fields, filters = {}) {
  const selectedFields = normalizeRequestedFields(collection, fields);
  if (!selectedFields.length) return [];
  const decrypt = await createArchiveDecryptor(env);
  if (!decrypt) return [];

  const index = await fetchAssetJson(env, request, `/data-backups/${collection}/index.json`);
  if (!index?.chunks?.length) return [];

  const results = [];
  const wanted = new Set(ids.map(String).filter(Boolean));

  for (const chunk of index.chunks) {
    const rows = await fetchAssetJson(env, request, `/data-backups/${collection}/${chunk.file}`);
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const rowId = normalizeDocumentId(row);
      if (ids.length && (!rowId || !wanted.has(rowId))) continue;
      if (!matchesFilter(row, filters)) continue;
      const projected = await projectArchivedDocument(collection, row, selectedFields, decrypt);
      if (rowId) projected.$id = rowId;
      results.push(projected);
      if (ids.length) {
        wanted.delete(rowId);
        if (!wanted.size) break;
      }
    }
    if (ids.length && !wanted.size) break;
  }

  return results;
}
