import { optionalAuth } from '../_lib/auth.js';
import { errorResponse, HttpError, json, methodNotAllowed, readJsonBody } from '../_lib/http.js';
import { findArchivedDocuments } from '../_lib/backup.js';

export async function onRequestPost({ request, env }) {
  try {
    await optionalAuth(request, env);
    const body = await readJsonBody(request);
    const collection = String(body?.collection || '').trim();
    if (!['posts', 'comments', 'confessions'].includes(collection)) {
      throw new HttpError(400, '不支持的集合');
    }
    const ids = Array.isArray(body?.ids) ? body.ids.filter(Boolean).map(String) : [];
    const fields = Array.isArray(body?.fields) ? body.fields : [];
    const filters = body?.filter && typeof body.filter === 'object' ? body.filter : {};
    const documents = await findArchivedDocuments(env, request, collection, ids, fields, filters);
    return json({ documents, total: documents.length }, 200, { 'Cache-Control': 'private, no-store' });
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', route: '/api/backup-decrypt-batch', message: error.message, status: error.status }));
    return errorResponse(error, '批量解密备份失败');
  }
}

export function onRequestGet() {
  return methodNotAllowed(['POST']);
}

export function onRequestPatch() {
  return methodNotAllowed(['POST']);
}

export function onRequestDelete() {
  return methodNotAllowed(['POST']);
}
