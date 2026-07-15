import { requireAuth } from '../_lib/auth.js';
import { normalizeUserId, requireDb } from '../_lib/db.js';
import { errorResponse, HttpError, json, methodNotAllowed, readJsonBody } from '../_lib/http.js';

function allowedAvatar(value) {
  if (!value) return true;
  if (value.startsWith('/')) return !value.startsWith('//');
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await readJsonBody(request);
    const { profile } = await requireAuth(request, env, body);
    const name = String(body.name || '').trim();
    const avatar = String(body.avatar || '').trim();
    if (!name) throw new HttpError(400, '名字或昵称不能为空');
    if (name.length > 12) throw new HttpError(400, '名字或昵称不能超过 12 个字符');
    if (avatar.length > 2048 || !allowedAvatar(avatar)) {
      throw new HttpError(400, '头像链接必须是 http(s) 地址或站内相对路径');
    }

    const id = normalizeUserId(profile.id);
    const now = new Date().toISOString();
    const db = requireDb(env);
    await db.batch([
      db.prepare('UPDATE users SET name = ?, avatar = ?, updated_at = ? WHERE id = ?').bind(name, avatar || null, now, id),
      db.prepare('UPDATE posts SET author_name = ? WHERE author_id = ?').bind(name, id),
      db.prepare('UPDATE comments SET author_name = ? WHERE author_id = ?').bind(name, id),
      db.prepare('UPDATE confessions SET author_name = ? WHERE author_id = ?').bind(name, id)
    ]);
    return json({ success: true, name, avatar });
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', route: '/api/update-profile', message: error.message, status: error.status }));
    return errorResponse(error, '保存个人资料失败');
  }
}

export function onRequestGet() {
  return methodNotAllowed(['POST']);
}
