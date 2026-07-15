import { assertNotMuted, requireAuth } from '../_lib/auth.js';
import { getRuntimeConfig } from '../_lib/config.js';
import { canViewPost, getPostRow, localDayStartIso, normalizeUserId, requireDb } from '../_lib/db.js';
import { errorResponse, HttpError, json, methodNotAllowed, readJsonBody } from '../_lib/http.js';

export async function onRequestPost({ request, env }) {
  try {
    const body = await readJsonBody(request);
    const { profile } = await requireAuth(request, env, body);
    assertNotMuted(profile);

    const postId = String(body.postId || '').trim();
    const content = String(body.content || '').trim();
    if (!postId) throw new HttpError(400, '缺少帖子 ID');
    if (content.length < 2) throw new HttpError(400, '内容太短，多说两个字吧');
    if (content.length > 500) throw new HttpError(400, '评论不能超过 500 个字符');

    const post = await getPostRow(env, postId);
    if (!post) throw new HttpError(404, '帖子不存在');
    if (!canViewPost(post, profile)) throw new HttpError(403, '无权评论该帖子');
    if ((Number(post.status || 0) & 2) !== 0) throw new HttpError(403, '该帖子已锁定，不能继续评论');

    const runtime = getRuntimeConfig(env);
    const dayStart = localDayStartIso(runtime.timezoneOffsetMinutes);
    const countRow = await requireDb(env).prepare(`
      SELECT COUNT(*) AS total
      FROM comments
      WHERE author_id = ? AND created_at >= ?
    `).bind(normalizeUserId(profile.id), dayStart).first();
    if (Number(countRow?.total || 0) >= runtime.commentDailyLimit) {
      throw new HttpError(429, `今日评论已达上限（${runtime.commentDailyLimit} 条）`);
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const db = requireDb(env);
    await db.batch([
      db.prepare(`
        INSERT INTO comments (
          id, post_id, content, author_id, author_name, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(id, postId, content, normalizeUserId(profile.id), profile.name, now, now),
      db.prepare('UPDATE posts SET comment_count = comment_count + 1, updated_at = updated_at WHERE id = ?').bind(postId)
    ]);

    return json({ success: true, commentId: id }, 201);
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', route: '/api/create-comment', message: error.message, status: error.status }));
    return errorResponse(error, '发表评论失败');
  }
}

export function onRequestGet() {
  return methodNotAllowed(['POST']);
}
