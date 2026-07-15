import { getAccountWithSession } from './appwrite.js';
import { getAppwriteConfig, getAuthTokenSecret, getRuntimeConfig } from './config.js';
import { ensureUserRow, getUserRow, normalizeUserId } from './db.js';
import { HttpError } from './http.js';
import { readSessionCookie } from './session-cookie.js';
import { signToken, verifyToken } from './tokens.js';

function readBearer(request) {
  const authorization = request.headers.get('authorization') || '';
  return authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : '';
}

export function readCredentials(request, body = {}) {
  return {
    appToken: String(
      request.headers.get('x-lg-token') ||
      readBearer(request) ||
      body.appToken ||
      ''
    ).trim(),
    sessionSecret: String(
      readSessionCookie(request) ||
      request.headers.get('x-appwrite-session') ||
      body.sessionSecret ||
      body.token ||
      ''
    ).trim(),
    claimedUserId: normalizeUserId(body.userId || body.studentId || '')
  };
}

export async function issueAppToken(env, profile) {
  const secret = getAuthTokenSecret(env);
  const runtime = getRuntimeConfig(env);
  return signToken(
    secret,
    {
      purpose: 'lg-session',
      sub: profile.id,
      ver: Number(profile.token_version || 0)
    },
    runtime.tokenTtlSeconds
  );
}

export async function requireAuth(request, env, body = {}) {
  const credentials = readCredentials(request, body);
  let profile;
  let account = null;

  if (credentials.appToken) {
    try {
      const payload = await verifyToken(
        getAuthTokenSecret(env),
        credentials.appToken,
        { purpose: 'lg-session' }
      );
      profile = await getUserRow(env, payload.sub);
      if (!profile) throw new HttpError(401, '账号资料不存在，请重新登录');
      if (Number(profile.token_version || 0) !== Number(payload.ver || 0)) {
        throw new HttpError(401, '登录凭证已被注销，请重新登录');
      }
    } catch (error) {
      // The short-lived LG token may expire while the underlying Appwrite
      // session remains valid. Fall back to that session and let /auth-me
      // issue a fresh LG token instead of forcing an unnecessary login.
      if (!(error instanceof HttpError) || error.status !== 401 || !credentials.sessionSecret) {
        throw error;
      }
    }
  }

  if (!profile && credentials.sessionSecret) {
    const config = getAppwriteConfig(env);
    account = await getAccountWithSession(config, credentials.sessionSecret);
    profile = await ensureUserRow(env, account);
  }

  if (!profile) {
    throw new HttpError(401, '请先登录');
  }

  if (credentials.claimedUserId && credentials.claimedUserId !== normalizeUserId(profile.id)) {
    throw new HttpError(403, '登录身份与请求用户不匹配');
  }
  if (Number(profile.banned || 0) === 1) {
    throw new HttpError(403, '该账号已被封禁');
  }

  return { profile, account, credentials };
}

export async function optionalAuth(request, env) {
  const credentials = readCredentials(request);
  if (!credentials.appToken && !credentials.sessionSecret) return null;
  try {
    return await requireAuth(request, env);
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) return null;
    throw error;
  }
}

export function assertNotMuted(profile) {
  if (!profile?.muted_until) return;
  const muteEnd = new Date(profile.muted_until);
  if (!Number.isNaN(muteEnd.getTime()) && muteEnd.getTime() > Date.now()) {
    throw new HttpError(403, `账号已被禁言至 ${muteEnd.toISOString()}`);
  }
}
