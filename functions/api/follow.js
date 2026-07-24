import { requireAuth } from '../_lib/auth.js';
import { normalizeUserId, requireDb } from '../_lib/db.js';
import { errorResponse, HttpError, json, methodNotAllowed, readJsonBody } from '../_lib/http.js';

export async function onRequestPost({ request, env }) {
  try {
    const body = await readJsonBody(request);
    const { profile } = await requireAuth(request, env, body);
    const db = requireDb(env);

    const followerId = normalizeUserId(profile.id);
    const followedId = normalizeUserId(body.targetUserId);
    const action = body.action; // 'follow' or 'unfollow'

    if (!followedId) {
      throw new HttpError(400, '目标用户 ID 不能为空');
    }
    if (followerId === followedId) {
      throw new HttpError(400, '不能关注自己');
    }
    if (action !== 'follow' && action !== 'unfollow') {
      throw new HttpError(400, '无效的操作');
    }

    const now = new Date().toISOString();

    if (action === 'follow') {
      // Check if already following
      const existing = await db.prepare('SELECT 1 FROM user_follows WHERE follower_id = ? AND followed_id = ?').bind(followerId, followedId).first();
      if (!existing) {
        await db.batch([
          db.prepare('INSERT INTO user_follows (follower_id, followed_id, created_at) VALUES (?, ?, ?)').bind(followerId, followedId, now),
          db.prepare('UPDATE users SET following_count = following_count + 1 WHERE id = ?').bind(followerId),
          db.prepare('UPDATE users SET followers_count = followers_count + 1 WHERE id = ?').bind(followedId)
        ]);
      }
    } else {
      // Unfollow
      const existing = await db.prepare('SELECT 1 FROM user_follows WHERE follower_id = ? AND followed_id = ?').bind(followerId, followedId).first();
      if (existing) {
        await db.batch([
          db.prepare('DELETE FROM user_follows WHERE follower_id = ? AND followed_id = ?').bind(followerId, followedId),
          db.prepare('UPDATE users SET following_count = MAX(0, following_count - 1) WHERE id = ?').bind(followerId),
          db.prepare('UPDATE users SET followers_count = MAX(0, followers_count - 1) WHERE id = ?').bind(followedId)
        ]);
      }
    }

    return json({ success: true, action, targetUserId: followedId });
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', route: '/api/follow', message: error.message, status: error.status }));
    return errorResponse(error, '操作失败');
  }
}

export function onRequestGet() {
  return methodNotAllowed(['POST']);
}
