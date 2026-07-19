import { requireAuth } from '../_lib/auth.js';
import { requireDb, normalizeUserId } from '../_lib/db.js';
import { errorResponse, HttpError, json, methodNotAllowed } from '../_lib/http.js';

export async function onRequestGet({ request, env }) {
  try {
    const { profile } = await requireAuth(request, env);
    const userId = normalizeUserId(profile.id);
    
    const db = requireDb(env);
    
    // Get notifications
    const result = await db.prepare(`
      SELECT * FROM notifications
      WHERE recipient_id = ?
      ORDER BY created_at DESC
      LIMIT 100
    `).bind(userId).all();
    
    // Get unread count
    const countRow = await db.prepare(`
      SELECT COUNT(*) AS total FROM notifications
      WHERE recipient_id = ? AND is_read = 0
    `).bind(userId).first();
    
    const unreadCount = Number(countRow?.total || 0);
    
    return json({
      unreadCount,
      documents: result.results || []
    });
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', route: '/api/list-notifications', message: error.message, status: error.status }));
    return errorResponse(error, '加载通知失败');
  }
}

export function onRequestPost() {
  return methodNotAllowed(['GET']);
}
