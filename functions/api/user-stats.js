import { normalizeUserId, requireDb } from '../_lib/db.js';
import { errorResponse, HttpError, json, methodNotAllowed } from '../_lib/http.js';

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const userId = url.searchParams.get('id');
    if (!userId) {
      throw new HttpError(400, '用户 ID 不能为空');
    }

    const db = requireDb(env);
    const id = normalizeUserId(userId);
    const result = await db.prepare('SELECT followers_count FROM users WHERE id = ?').bind(id).first();
    
    return json({
      success: true,
      followersCount: result ? Number(result.followers_count || 0) : 0
    });
  } catch (error) {
    return errorResponse(error, '获取用户统计失败');
  }
}

export function onRequestPost() {
  return methodNotAllowed(['GET']);
}
