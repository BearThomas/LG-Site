import { requireAuth } from '../_lib/auth.js';
import { requireDb, hasPermission, PERMISSIONS, localDayStartIso } from '../_lib/db.js';
import { errorResponse, HttpError, json, methodNotAllowed } from '../_lib/http.js';

export async function onRequestGet({ request, env }) {
  try {
    const { profile } = await requireAuth(request, env);
    if (!hasPermission(profile, PERMISSIONS.VIEW_DASHBOARD)) {
      throw new HttpError(403, '权限不足，无法访问管理数据面板');
    }

    const db = requireDb(env);
    const todayIso = localDayStartIso();

    const [
      userTotal,
      userToday,
      postTotal,
      postToday,
      commentTotal,
      confessionTotal,
      eventTotal,
      eventPending
    ] = await Promise.all([
      db.prepare('SELECT COUNT(*) as count FROM users').first(),
      db.prepare('SELECT COUNT(*) as count FROM users WHERE created_at >= ?').bind(todayIso).first(),
      db.prepare('SELECT COUNT(*) as count FROM posts').first(),
      db.prepare('SELECT COUNT(*) as count FROM posts WHERE created_at >= ?').bind(todayIso).first(),
      db.prepare('SELECT COUNT(*) as count FROM comments').first(),
      db.prepare('SELECT COUNT(*) as count FROM confessions').first(),
      db.prepare('SELECT COUNT(*) as count FROM events').first(),
      db.prepare("SELECT COUNT(*) as count FROM events WHERE status = 'pending_admin'").first()
    ]);

    return json({
      stats: {
        users: { total: Number(userTotal?.count || 0), today: Number(userToday?.count || 0) },
        posts: { total: Number(postTotal?.count || 0), today: Number(postToday?.count || 0) },
        comments: { total: Number(commentTotal?.count || 0) },
        confessions: { total: Number(confessionTotal?.count || 0) },
        events: { total: Number(eventTotal?.count || 0), pending: Number(eventPending?.count || 0) }
      }
    });
  } catch (err) {
    return errorResponse(err, '获取数据面板统计失败');
  }
}

export function onRequestPost() { return methodNotAllowed(['GET']); }
export function onRequestPatch() { return methodNotAllowed(['GET']); }
export function onRequestDelete() { return methodNotAllowed(['GET']); }
