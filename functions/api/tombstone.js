// functions/api/tombstone.js
// POST /api/tombstone  — Admin-only: soft-delete an item from cold backup archives.
// DELETE /api/tombstone — Admin-only: remove a tombstone entry (un-delete).
// GET /api/tombstone   — Admin-only: list all tombstones.
//
// Use when a post/comment/confession has already been archived to JSON
// and needs to be hidden/removed. The frontend will filter these IDs out
// when loading cold backup data. The next backup run will permanently
// remove tombstoned items from the JSON files and clear the tombstones table.
import { requireAuth } from '../_lib/auth.js';
import { isAdmin } from '../_lib/db.js';
import { json, errorResponse, methodNotAllowed, readJsonBody, HttpError } from '../_lib/http.js';

const VALID_COLLECTIONS = new Set(['posts', 'comments', 'confessions']);

function requireDb(env) {
  const db = env.DB;
  if (!db) throw new Error('D1 binding DB not found');
  return db;
}

// POST — add a tombstone (soft-delete from cold backup)
export async function onRequestPost({ request, env }) {
  try {
    const body = await readJsonBody(request);
    const { profile } = await requireAuth(request, env, body);
    if (!isAdmin(profile)) throw new HttpError(403, '仅管理员可以操作归档软删除');

    const collection = String(body.collection || '');
    const itemId = String(body.itemId || '').trim();
    if (!VALID_COLLECTIONS.has(collection)) throw new HttpError(400, '不支持的集合');
    if (!itemId) throw new HttpError(400, 'itemId 不能为空');

    await requireDb(env)
      .prepare(`INSERT OR REPLACE INTO tombstones (collection, item_id, deleted_at) VALUES (?, ?, datetime('now'))`)
      .bind(collection, itemId)
      .run();

    return json({ success: true, collection, itemId });
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', route: '/api/tombstone', method: 'POST', message: error.message }));
    return errorResponse(error, '添加软删除标记失败');
  }
}

// DELETE — remove a tombstone (un-delete / restore visibility)
export async function onRequestDelete({ request, env }) {
  try {
    const body = await readJsonBody(request);
    const { profile } = await requireAuth(request, env, body);
    if (!isAdmin(profile)) throw new HttpError(403, '仅管理员可以操作归档软删除');

    const collection = String(body.collection || '');
    const itemId = String(body.itemId || '').trim();
    if (!VALID_COLLECTIONS.has(collection)) throw new HttpError(400, '不支持的集合');
    if (!itemId) throw new HttpError(400, 'itemId 不能为空');

    await requireDb(env)
      .prepare(`DELETE FROM tombstones WHERE collection = ? AND item_id = ?`)
      .bind(collection, itemId)
      .run();

    return json({ success: true, collection, itemId, restored: true });
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', route: '/api/tombstone', method: 'DELETE', message: error.message }));
    return errorResponse(error, '移除软删除标记失败');
  }
}

// GET — list all tombstones (admin only)
export async function onRequestGet({ request, env }) {
  try {
    const { profile } = await requireAuth(request, env, {});
    if (!isAdmin(profile)) throw new HttpError(403, '仅管理员可以查看软删除列表');

    const rows = await requireDb(env)
      .prepare(`SELECT collection, item_id, deleted_at FROM tombstones ORDER BY deleted_at DESC`)
      .all();

    return json({ tombstones: rows.results || [] });
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', route: '/api/tombstone', method: 'GET', message: error.message }));
    return errorResponse(error, '获取软删除列表失败');
  }
}

export function onRequestPatch() { return methodNotAllowed(['GET', 'POST', 'DELETE']); }
