import { requireAuth } from '../_lib/auth.js';
import { requireDb, normalizeUserId } from '../_lib/db.js';
import { errorResponse, HttpError, json, methodNotAllowed, readJsonBody } from '../_lib/http.js';

export async function onRequestPost({ request, env }) {
    try {
        const body = await readJsonBody(request);
        const { profile } = await requireAuth(request, env, body);
        const userId = normalizeUserId(profile.id);
        const db = requireDb(env);

        if (body.all === true) {
            // Mark all as read
            await db.prepare(`
        UPDATE notifications
        SET is_read = 1
        WHERE recipient_id = ? AND is_read = 0
      `).bind(userId).run();
        } else if (body.targetId) {
            // 【新增】根据帖子 ID (targetId) 将该帖子的所有未读通知标记为已读
            await db.prepare(`
        UPDATE notifications
        SET is_read = 1
        WHERE recipient_id = ? AND target_id = ? AND is_read = 0
      `).bind(userId, String(body.targetId).trim()).run();
        } else {
            // Mark specific IDs as read
            const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean) : [];
            if (ids.length > 0) {
                // Construct query safely
                const placeholders = ids.map(() => '?').join(',');
                await db.prepare(`
          UPDATE notifications
          SET is_read = 1
          WHERE recipient_id = ? AND id IN (${placeholders})
        `).bind(userId, ...ids).run();
            }
        }

        return json({ success: true });
    } catch (error) {
        console.error(JSON.stringify({ level: 'error', route: '/api/read-notifications', message: error.message, status: error.status }));
        return errorResponse(error, '更新通知状态失败');
    }
}

export function onRequestGet() {
    return methodNotAllowed(['POST']);
}