import { createPasswordSession, deleteCurrentSession, getAuthUser } from '../_lib/appwrite.js';
import { issueAppToken } from '../_lib/auth.js';
import { getAppwriteConfig } from '../_lib/config.js';
import { ensureUserRow, toUserDocument } from '../_lib/db.js';
import { errorResponse, HttpError, json, methodNotAllowed, readJsonBody } from '../_lib/http.js';
import { createSessionCookie } from '../_lib/session-cookie.js';

function validStudentId(value) {
  return /^\d{6,12}$/.test(String(value || ''));
}

export async function onRequestPost({ request, env }) {
  let config = null;
  let sessionSecret = '';
  try {
    const body = await readJsonBody(request);
    const studentId = String(body.studentId || '').trim();
    const password = String(body.password || '');
    if (!validStudentId(studentId)) throw new HttpError(400, '学号格式不正确');
    if (!password) throw new HttpError(400, '请输入密码');

    config = getAppwriteConfig(env, { requireApiKey: true });

    // Step 1: Verify password via client-side endpoint (no API Key).
    // If wrong password, Appwrite returns 401 and we throw here.
    // session.secret may be empty in server-side context (no browser cookies).
    const session = await createPasswordSession(config, studentId, password);
    sessionSecret = String(session.secret || session.$id || session.token || '').trim();

    // Step 2: Fetch authoritative user info via Server API Key.
    // This is safe because password was already verified in step 1.
    const account = await getAuthUser(config, studentId);

    const profile = await ensureUserRow(env, account, { userId: studentId });
    if (Number(profile.banned || 0) === 1) throw new HttpError(403, '该账号已被封禁');

    // Step 3: Clean up the Appwrite session — we use our own JWT (appToken) for auth.
    // Only attempt cleanup if we actually got a secret back.
    if (sessionSecret) {
      deleteCurrentSession(config, sessionSecret).catch(() => {});
    }
    sessionSecret = ''; // prevent double-cleanup in catch block

    const publicProfile = toUserDocument(profile, { includePrivate: true });
    return json({
      success: true,
      userId: profile.id,
      studentId: profile.id,
      name: profile.name,
      avatar: profile.avatar || '',
      profile: publicProfile,
      appToken: await issueAppToken(env, profile)
    });
  } catch (error) {
    if (config && sessionSecret) {
      try {
        await deleteCurrentSession(config, sessionSecret);
      } catch (cleanupError) {
        console.warn(JSON.stringify({ level: 'warn', route: '/api/auth-jwt', event: 'failed_session_cleanup', status: cleanupError.status }));
      }
    }
    console.error(JSON.stringify({ level: 'error', route: '/api/auth-jwt', message: error.message, status: error.status }));
    if (error.status === 401) error.message = '学号或密码不正确';
    return errorResponse(error, '登录失败，请稍后重试');
  }
}

export function onRequestGet() {
  return methodNotAllowed(['POST']);
}
