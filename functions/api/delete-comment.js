import { requireAuth } from '../_lib/auth.js';
import { isAdmin, normalizeUserId, requireDb } from '../_lib/db.js';
import { errorResponse, HttpError, json, methodNotAllowed, readJsonBody } from '../_lib/http.js';

export async function onRequestPost({ request, env }) {
  try {
    const body = await readJsonBody(request);
    const { profile } = await requireAuth(request, env, body);
    const commentId = String(body.commentId || '').trim();
    if (!commentId) throw new HttpError(400, '缺少评论 ID');

    const db = requireDb(env);
    const comment = await db.prepare('SELECT * FROM comments WHERE id = ? LIMIT 1').bind(commentId).first();
    if (!comment) {
      if (isAdmin(profile)) {
        await db.prepare(`INSERT OR REPLACE INTO tombstones (collection, item_id, deleted_at) VALUES (?, ?, datetime('now'))`)
          .bind('comments', commentId)
          .run();
        return json({ success: true, tombstoned: true });
      }
      throw new HttpError(404, '评论不存在');
    }
    if (!isAdmin(profile) && normalizeUserId(comment.author_id) !== normalizeUserId(profile.id)) {
      throw new HttpError(403, '只能删除自己的评论');
    }

    await db.batch([
      db.prepare('DELETE FROM comments WHERE id = ?').bind(commentId),
      db.prepare(`
        UPDATE posts
        SET comment_count = CASE WHEN comment_count > 0 THEN comment_count - 1 ELSE 0 END
        WHERE id = ?
      `).bind(comment.post_id)
    ]);
    await db.prepare(`INSERT OR REPLACE INTO tombstones (collection, item_id, deleted_at) VALUES (?, ?, datetime('now'))`)
      .bind('comments', commentId)
      .run();
    return json({ success: true });
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', route: '/api/delete-comment', message: error.message, status: error.status }));
    return errorResponse(error, '删除评论失败');
  }
}

export function onRequestGet() {
  return methodNotAllowed(['POST']);
}
