import { issueAppToken, requireAuth } from '../_lib/auth.js';
import { toUserDocument, requireDb } from '../_lib/db.js';
import { errorResponse, json, methodNotAllowed } from '../_lib/http.js';
import { createSessionCookie } from '../_lib/session-cookie.js';

export async function onRequestGet({ request, env }) {
  try {
    const { profile, credentials } = await requireAuth(request, env);
    const db = requireDb(env);
    
    // Fetch who the current user is following
    const result = await db.prepare('SELECT followed_id FROM user_follows WHERE follower_id = ?').bind(profile.id).all();
    const following = result.results.map(r => r.followed_id);

    return json({
      success: true,
      profile: toUserDocument(profile, { includePrivate: true }),
      following: following,
      appToken: await issueAppToken(env, profile)
    }, 200, credentials.sessionSecret ? {
      'Set-Cookie': createSessionCookie(request, env, credentials.sessionSecret)
    } : {});
  } catch (error) {
    return errorResponse(error, '读取登录状态失败');
  }
}

export function onRequestPost() {
  return methodNotAllowed(['GET']);
}
