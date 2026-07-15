import { clean } from './config.js';

const COOKIE_NAME = 'lg_appwrite_session';

function cookieMap(request) {
  const result = new Map();
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const encoded = part.slice(separator + 1).trim();
    try {
      result.set(name, decodeURIComponent(encoded));
    } catch {
      result.set(name, encoded);
    }
  }
  return result;
}

function secureAttribute(request) {
  try {
    return new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  } catch {
    return '; Secure';
  }
}

function cookieTtl(env, expire = '') {
  const configured = Number(clean(env?.AUTH_REFRESH_TTL_SECONDS));
  const fallback = 30 * 24 * 60 * 60;
  const requested = Number.isFinite(configured)
    ? Math.min(365 * 24 * 60 * 60, Math.max(60 * 60, Math.trunc(configured)))
    : fallback;
  const expiresAt = Date.parse(String(expire || ''));
  if (!Number.isFinite(expiresAt)) return requested;
  const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  return Math.min(requested, remaining);
}

export function readSessionCookie(request) {
  return String(cookieMap(request).get(COOKIE_NAME) || '').trim();
}

export function createSessionCookie(request, env, sessionSecret, expire = '') {
  const value = encodeURIComponent(String(sessionSecret || '').trim());
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${cookieTtl(env, expire)}${secureAttribute(request)}`;
}

export function clearSessionCookie(request) {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureAttribute(request)}`;
}
