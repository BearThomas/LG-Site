import { issueAppToken, requireAuth } from '../_lib/auth.js';
import { toUserDocument } from '../_lib/db.js';
import { errorResponse, json, methodNotAllowed } from '../_lib/http.js';
import { createSessionCookie } from '../_lib/session-cookie.js';

export async function onRequestGet({ request, env }) {
  try {
    const { profile, credentials } = await requireAuth(request, env);
    return json({
      success: true,
      profile: toUserDocument(profile, { includePrivate: true }),
      appToken: await issueAppToken(env, profile)
    }, 200, credentials.sessionSecret ? {
      // Also migrates legacy clients that supplied the Appwrite session in a header.
      'Set-Cookie': createSessionCookie(request, env, credentials.sessionSecret)
    } : {});
  } catch (error) {
    return errorResponse(error, '读取登录状态失败');
  }
}

export function onRequestPost() {
  return methodNotAllowed(['GET']);
}
