import { deleteCurrentSession, updatePasswordWithSession } from '../_lib/appwrite.js';
import { readCredentials, requireAuth } from '../_lib/auth.js';
import { getAppwriteConfig } from '../_lib/config.js';
import { requireDb } from '../_lib/db.js';
import { errorResponse, HttpError, json, methodNotAllowed, readJsonBody } from '../_lib/http.js';
import { clearSessionCookie } from '../_lib/session-cookie.js';

export async function onRequestPost({ request, env }) {
  try {
    const body = await readJsonBody(request);
    const { profile } = await requireAuth(request, env, body);
    const credentials = readCredentials(request, body);
    const oldPassword = String(body.oldPassword || '');
    const newPassword = String(body.newPassword || '');
    if (!credentials.sessionSecret) throw new HttpError(401, '修改密码前请重新登录，以获取有效会话');
    if (!oldPassword || !newPassword) throw new HttpError(400, '请完整填写当前密码和新密码');
    if (newPassword.length < 8 || newPassword.length > 256) {
      throw new HttpError(400, '新密码长度需要在 8 到 256 位之间');
    }

    await updatePasswordWithSession(
      getAppwriteConfig(env),
      credentials.sessionSecret,
      newPassword,
      oldPassword
    );
    await requireDb(env)
      .prepare('UPDATE users SET token_version = token_version + 1, updated_at = ? WHERE id = ?')
      .bind(new Date().toISOString(), profile.id)
      .run();
    try {
      await deleteCurrentSession(getAppwriteConfig(env), credentials.sessionSecret);
    } catch (error) {
      console.warn(JSON.stringify({ level: 'warn', route: '/api/update-password', event: 'session_delete_failed', status: error.status }));
    }
    return json({ success: true }, 200, { 'Set-Cookie': clearSessionCookie(request) });
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', route: '/api/update-password', message: error.message, status: error.status }));
    if (error.status === 401) error.message = '当前密码不正确，或登录会话已过期';
    return errorResponse(error, '修改密码失败');
  }
}

export function onRequestGet() {
  return methodNotAllowed(['POST']);
}
