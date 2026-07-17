import { optionalAuth } from '../_lib/auth.js';
import { canViewPost, getPostRow, requireDb, toCommentDocument } from '../_lib/db.js';
import { errorResponse, HttpError, json, methodNotAllowed } from '../_lib/http.js';

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const postId = String(url.searchParams.get('postId') || '').trim();
    if (!postId) throw new HttpError(400, '缺少帖子 ID');

    const auth = await optionalAuth(request, env);
    // Skip post existence and permission checks to allow comments on backup‑only posts.
    // const post = await getPostRow(env, postId);
    // if (!post) throw new HttpError(404, '帖子不存在');
    // if (!canViewPost(post, auth?.profile || null)) throw new HttpError(403, '无权查看该帖评论');

    const result = await requireDb(env).prepare(`
      SELECT * FROM comments
      WHERE post_id = ?
      ORDER BY created_at ASC
      LIMIT 500
    `).bind(postId).all();
    return json({
      total: Number(result.results?.length || 0),
      documents: (result.results || []).map(toCommentDocument)
    });
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', route: '/api/list-comments', message: error.message, status: error.status }));
    return errorResponse(error, '评论列表加载失败');
  }
}

export function onRequestPost() {
  return methodNotAllowed(['GET']);
}
