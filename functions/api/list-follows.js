import { normalizeUserId, requireDb } from '../_lib/db.js';
import { errorResponse, HttpError, json, methodNotAllowed } from '../_lib/http.js';

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const userId = url.searchParams.get('id');
    const type = url.searchParams.get('type');
    
    if (!userId) throw new HttpError(400, '用户 ID 不能为空');
    if (type !== 'followers' && type !== 'following') throw new HttpError(400, '无效的类型');

    const db = requireDb(env);
    const id = normalizeUserId(userId);
    
    let query = '';
    if (type === 'followers') {
      query = `SELECT u.id, u.name, u.avatar, u.role FROM users u INNER JOIN user_follows f ON u.id = f.follower_id WHERE f.followed_id = ? ORDER BY f.created_at DESC LIMIT 50`;
    } else {
      query = `SELECT u.id, u.name, u.avatar, u.role FROM users u INNER JOIN user_follows f ON u.id = f.followed_id WHERE f.follower_id = ? ORDER BY f.created_at DESC LIMIT 50`;
    }
    
    const result = await db.prepare(query).bind(id).all();
    const users = result.results.map(row => ({
      userId: row.id,
      name: row.name,
      avatar: row.avatar || '',
      role: row.role || 'normal'
    }));

    return json({ success: true, users });
  } catch (error) {
    return errorResponse(error, '获取列表失败');
  }
}

export function onRequestPost() {
  return methodNotAllowed(['GET']);
}
