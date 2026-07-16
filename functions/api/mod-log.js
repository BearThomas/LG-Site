import { optionalAuth } from '../_lib/auth.js';
import { requireDb } from '../_lib/db.js';
import { json, errorResponse, HttpError, methodNotAllowed } from '../_lib/http.js';

/**
 * GET /api/mod-log
 * Returns hashes for collections (from data_meta) and pending modification log entries.
 * The client can use the hashes to decide whether to refresh cached backup JSON data.
 */
export async function onRequestGet({ request, env }) {
  try {
    // Optional authentication; not required for hash retrieval.
    await optionalAuth(request, env);
    const db = requireDb(env);

    const metaRows = await db.prepare("SELECT key, value FROM data_meta WHERE key IN ('hash_posts', 'hash_comments', 'hash_confessions')").all();
    const hashes = { posts: null, comments: null, confessions: null };
    for (const row of metaRows.results || []) {
      if (row.key === 'hash_posts') hashes.posts = row.value;
      if (row.key === 'hash_comments') hashes.comments = row.value;
      if (row.key === 'hash_confessions') hashes.confessions = row.value;
    }

    const modLogRows = await db.prepare('SELECT * FROM mod_log ORDER BY created_at ASC').all();

    const result = {
      hashes,
      pendingModifications: (modLogRows.results || []).map(row => ({
        id: row.id,
        collection: row.collection,
        item_id: row.item_id,
        action: row.action,
        payload: row.payload ? JSON.parse(row.payload) : null,
        created_at: row.created_at,
      })),
    };
    return json(result);
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', route: '/api/mod-log', message: error.message, status: error.status }));
    return errorResponse(error, '获取 mod_log 信息失败');
  }
}

export function onRequestPost() {
  return methodNotAllowed(['GET']);
}
