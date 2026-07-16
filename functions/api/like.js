import { requireAuth } from '../_lib/auth.js';
import { getPostRow, normalizeUserId, requireDb } from '../_lib/db.js';
import { errorResponse, HttpError, json, methodNotAllowed, readJsonBody } from '../_lib/http.js';

export async function onRequestPost({ request, env }) {
  try {
    const body = await readJsonBody(request);
    const { profile } = await requireAuth(request, env, body);
    const postId = String(body.postId || '').trim();
    if (!postId) throw new HttpError(400, '缺少帖子 ID');

    const db = requireDb(env);
    const userId = normalizeUserId(profile.id);

    // Check if already liked
    const existing = await db.prepare('SELECT 1 FROM likes WHERE post_id = ? AND user_id = ? LIMIT 1')
      .bind(postId, userId)
      .first();

    const now = new Date().toISOString();
    let liked = false;
    if (existing) {
      // Unlike
      await db.prepare('DELETE FROM likes WHERE post_id = ? AND user_id = ?')
        .bind(postId, userId)
        .run();
    } else {
      // Like
      const likeId = crypto.randomUUID();
      await db.prepare('INSERT INTO likes (id, post_id, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .bind(likeId, postId, userId, now, now)
        .run();
      liked = true;
    }

    // Get updated like count
    const countRow = await db.prepare('SELECT COUNT(*) AS total FROM likes WHERE post_id = ?')
      .bind(postId)
      .first();
    const likesCount = Number(countRow?.total || 0);

    return json({ success: true, liked, likes: likesCount }, 200);
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', route: '/api/like', message: error.message, status: error.status }));
    return errorResponse(error, '点赞操作失败');
  }
}

export function onRequestGet() {
  return methodNotAllowed(['POST']);
}
