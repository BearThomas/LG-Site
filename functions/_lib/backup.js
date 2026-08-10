import { getBackupEncryptKey } from './config.js';

const ENCRYPTED_VALUE = /^[0-9a-fA-F]{32}:[0-9a-fA-F]+$/;

const COLLECTION_FIELD_ALLOWLIST = {
  posts: ['$id', 'id', 'title', 'content', 'createdAt', '$createdAt', 'created_at', 'boardId', 'board_id', 'viewPermission', 'view_permission', 'status', 'editedAt', 'edited_at', 'commentCount', 'comment_count', 'likes', 'authorId', 'author_id', 'authorName', 'author_name', 'targetGroups', 'target_groups'],
  comments: ['$id', 'id', 'postId', 'post_id', 'content', 'createdAt', '$createdAt', 'created_at', 'authorId', 'author_id', 'authorName', 'author_name'],
  confessions: ['$id', 'id', 'content', 'createdAt', '$createdAt', 'created_at', 'likes', 'status']
};

const FIELD_VALUE_MAP = {
  posts: {
    $id: ['id', '$id'],
    id: ['id', '$id'],
    title: ['title'],
    content: ['content'],
    createdAt: ['$createdAt', 'createdAt', 'created_at'],
    $createdAt: ['$createdAt', 'createdAt', 'created_at'],
    boardId: ['boardId', 'board_id'],
    viewPermission: ['viewPermission', 'view_permission'],
    status: ['status'],
    editedAt: ['editedAt', 'edited_at'],
    commentCount: ['commentCount', 'comment_count'],
    likes: ['likes'],
    authorId: ['authorId', 'author_id', 'author'],
    authorName: ['authorName', 'author_name'],
    targetGroups: ['targetGroups', 'target_groups']
  },
  comments: {
    $id: ['id', '$id'],
    id: ['id', '$id'],
    postId: ['postId', 'post_id'],
    content: ['content'],
    createdAt: ['$createdAt', 'createdAt', 'created_at'],
    $createdAt: ['$createdAt', 'createdAt', 'created_at'],
    authorId: ['authorId', 'author_id', 'author'],
    authorName: ['authorName', 'author_name']
  },
  confessions: {
    $id: ['id', '$id'],
    id: ['id', '$id'],
    content: ['content'],
    createdAt: ['$createdAt', 'createdAt', 'created_at'],
    $createdAt: ['$createdAt', 'createdAt', 'created_at'],
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
  if (!/^[0-9a-fA-F]{64}$/.test(rawKey)) {
    return async value => value;
  }
  try {
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
        return value;
      }
    };
  } catch {
    return async value => value;
  }
}

export async function fetchAssetJson(env, request, path) {
  if (!env?.ASSETS) return null;
  let response = await env.ASSETS.fetch(new Request(new URL(path, request.url)));
  if (!response.ok) {
    const altPath = path.startsWith('/public/') ? path.replace('/public/', '/') : ('/public' + (path.startsWith('/') ? path : '/' + path));
    response = await env.ASSETS.fetch(new Request(new URL(altPath, request.url)));
  }
  if (!response.ok) return null;
  return response.json();
}

function normalizeRequestedFields(collection, fields) {
  const allowList = COLLECTION_FIELD_ALLOWLIST[collection] || [];
  if (!Array.isArray(fields) || !fields.length) return allowList;
  const requested = fields.filter(Boolean).map(String);
  const matched = requested.filter(field => allowList.includes(field));
  return matched.length ? matched : allowList;
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

function matchesFilter(row, filters = {}) {
  if (!filters || typeof filters !== 'object') return true;
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null) continue;
    const rowVal = row[key] ?? row[`$${key}`] ?? row[key.replace(/([A-Z])/g, '_$1').toLowerCase()];
    if (Array.isArray(value)) {
      if (!value.includes(rowVal)) return false;
    } else if (rowVal !== value) {
      return false;
    }
  }
  return true;
}

async function projectArchivedDocument(collection, document, selectedFields, decrypt) {
  const projected = {};
  const fieldMap = FIELD_VALUE_MAP[collection] || {};
  for (const field of selectedFields) {
    if (field === '$id' || field === 'id') {
      const value = normalizeDocumentId(document);
      if (value) projected.$id = value;
      continue;
    }
    if (field === 'createdAt' || field === '$createdAt') {
      const value = normalizeCreatedAt(document);
      if (value !== null && value !== undefined) {
        projected.createdAt = value;
        projected.$createdAt = value;
      }
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
  const decrypt = (await createArchiveDecryptor(env)) || (async value => value);

  const index = await fetchAssetJson(env, request, `/data-backups/${collection}/index.json`);
  if (!index?.chunks?.length) return [];

  const results = [];
  const wanted = new Set((ids || []).map(String).filter(Boolean));

  for (const chunk of index.chunks) {
    const rows = await fetchAssetJson(env, request, `/data-backups/${collection}/${chunk.file}`);
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const rowId = normalizeDocumentId(row);
      if (Array.isArray(ids) && ids.length && (!rowId || !wanted.has(rowId))) continue;
      if (!matchesFilter(row, filters)) continue;
      const projected = await projectArchivedDocument(collection, row, selectedFields, decrypt);
      if (rowId) projected.$id = rowId;
      results.push(projected);
      if (Array.isArray(ids) && ids.length) {
        wanted.delete(rowId);
        if (!wanted.size) break;
      }
    }
    if (Array.isArray(ids) && ids.length && !wanted.size) break;
  }

  return results;
}
