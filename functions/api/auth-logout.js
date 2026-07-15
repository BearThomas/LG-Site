import { deleteCurrentSession } from '../_lib/appwrite.js';
import { requireAuth } from '../_lib/auth.js';
import { getAppwriteConfig } from '../_lib/config.js';
import { requireDb } from '../_lib/db.js';
import { errorResponse, json, methodNotAllowed, readJsonBody } from '../_lib/http.js';
import { clearSessionCookie } from '../_lib/session-cookie.js';

export async function onRequestPost({ request, env }) {
  try {
    const body = await readJsonBody(request).catch(() => ({}));
    const { profile, credentials } = await requireAuth(request, env, body);
    await requireDb(env)
      .prepare('UPDATE users SET token_version = token_version + 1, updated_at = ? WHERE id = ?')
      .bind(new Date().toISOString(), profile.id)
      .run();

    if (credentials.sessionSecret) {
      try {
        await deleteCurrentSession(getAppwriteConfig(env), credentials.sessionSecret);
      } catch (error) {
        console.warn(JSON.stringify({ level: 'warn', route: '/api/auth-logout', event: 'appwrite_session_delete_failed', status: error.status }));
      }
    }
    return json({ success: true }, 200, { 'Set-Cookie': clearSessionCookie(request) });
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', route: '/api/auth-logout', message: error.message, status: error.status }));
    const response = errorResponse(error, '退出登录失败');
    response.headers.append('Set-Cookie', clearSessionCookie(request));
    return response;
  }
}

export function onRequestGet() {
  return methodNotAllowed(['POST']);
}
