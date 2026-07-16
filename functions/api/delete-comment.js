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
    let comment = await db.prepare('SELECT * FROM comments WHERE id = ? LIMIT 1').bind(commentId).first();
    let isCold = false;
    
    if (!comment) {
      if (isAdmin(profile)) {
        await db.prepare(`INSERT INTO mod_log (collection, item_id, action) VALUES (?, ?, 'delete')`)
          .bind('comments', commentId)
          .run();
        return json({ success: true, tombstoned: true });
      }
      
      const url = new URL('/data-backups/comments.json', request.url);
      const res = await env.ASSETS.fetch(new Request(url));
      if (res.ok) {
        const backup = await res.json();
        const rawComments = backup.documents || backup || [];
        comment = rawComments.find(c => c.id === commentId || c.$id === commentId);
        if (comment) isCold = true;
      }
    }
    
    if (!comment) {
      throw new HttpError(404, '评论不存在');
    }
    
    if (isCold) {
      comment.author_id = comment.authorId || comment.author_id;
    }
    
    if (!isAdmin(profile) && normalizeUserId(comment.author_id) !== normalizeUserId(profile.id)) {
      throw new HttpError(403, '只能删除自己的评论');
    }

    if (!isCold) {
      await db.batch([
        db.prepare('DELETE FROM comments WHERE id = ?').bind(commentId),
        db.prepare(`
          UPDATE posts
          SET comment_count = CASE WHEN comment_count > 0 THEN comment_count - 1 ELSE 0 END
          WHERE id = ?
        `).bind(comment.post_id)
      ]);
    }
    
    await db.prepare(`INSERT INTO mod_log (collection, item_id, action) VALUES (?, ?, 'delete')`)
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
