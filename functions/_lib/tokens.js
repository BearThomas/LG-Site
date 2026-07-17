import { HttpError } from './http.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  } catch {
    throw new HttpError(401, '登录凭证格式无效');
  }
}

async function importHmacKey(secret, usages) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usages
  );
}

export async function signToken(secret, claims, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    ...claims,
    iat: now,
    exp: now + ttlSeconds
  };
  const payloadPart = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  const key = await importHmacKey(secret, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadPart));
  return `${payloadPart}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

export async function verifyToken(secret, token, { purpose } = {}) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new HttpError(401, '登录凭证格式无效');
  }

  const [payloadPart, signaturePart] = parts;
  const key = await importHmacKey(secret, ['verify']);
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    base64UrlToBytes(signaturePart),
    encoder.encode(payloadPart)
  );
  if (!valid) throw new HttpError(401, '登录凭证无效');

  let payload;
  try {
    payload = JSON.parse(decoder.decode(base64UrlToBytes(payloadPart)));
  } catch {
    throw new HttpError(401, '登录凭证内容无效');
  }

  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(Number(payload.exp)) || Number(payload.exp) < now) {
    throw new HttpError(401, '登录凭证已过期，请重新登录');
  }
  if (purpose && payload.purpose !== purpose) {
    throw new HttpError(401, '登录凭证用途不匹配');
  }
  return payload;
}

export function secureShuffle(items) {
  const result = [...items];
  const random = new Uint32Array(Math.max(1, result.length));
  crypto.getRandomValues(random);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = random[index] % (index + 1);
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}
