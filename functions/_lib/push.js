// functions/_lib/push.js
// Native Cloudflare Workers Web Crypto VAPID & ECE AES-128-GCM Push Implementation
import { requireDb, normalizeUserId } from './db.js';

function base64UrlEncode(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(str) {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(base64 + padding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function rawPublicKeyToJwk(rawPublicKeyBase64Url) {
  const bytes = base64UrlDecode(rawPublicKeyBase64Url);
  if (bytes.length !== 65 || bytes[0] !== 0x04) {
    throw new Error('Invalid P-256 uncompressed public key');
  }
  const x = bytes.subarray(1, 33);
  const y = bytes.subarray(33, 65);
  return {
    kty: 'EC',
    crv: 'P-256',
    x: base64UrlEncode(x),
    y: base64UrlEncode(y),
    ext: true
  };
}

function privateKeyToJwk(rawPrivateKeyBase64Url, rawPublicKeyBase64Url) {
  const pubJwk = rawPublicKeyToJwk(rawPublicKeyBase64Url);
  return {
    ...pubJwk,
    d: rawPrivateKeyBase64Url,
    key_ops: ['sign']
  };
}

async function createVapidJwt(endpointUrl, subject, publicKeyBase64Url, privateKeyBase64Url) {
  const url = new URL(endpointUrl);
  const audience = `${url.protocol}//${url.host}`;
  const now = Math.floor(Date.now() / 1000);

  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = {
    aud: audience,
    exp: now + 12 * 3600,
    sub: subject
  };

  const encodedHeader = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const encodedPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;

  const privateJwk = privateKeyToJwk(privateKeyBase64Url, publicKeyBase64Url);
  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    privateJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const signatureBuffer = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    cryptoKey,
    new TextEncoder().encode(unsignedToken)
  );

  const encodedSignature = base64UrlEncode(signatureBuffer);
  return `${unsignedToken}.${encodedSignature}`;
}

async function encryptPayload(subscriptionKeys, payloadText) {
  try {
    const p256dhBytes = base64UrlDecode(subscriptionKeys.p256dh);
    const authBytes = base64UrlDecode(subscriptionKeys.auth);

    const localKeys = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits']
    );

    const userPublicKey = await crypto.subtle.importKey(
      'raw',
      p256dhBytes,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      []
    );

    const sharedSecretBits = await crypto.subtle.deriveBits(
      { name: 'ECDH', public: userPublicKey },
      localKeys.privateKey,
      256
    );

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const localPublicKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', localKeys.publicKey));

    async function hkdf(ikm, salt, info, length) {
      const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt, info },
        key,
        length * 8
      );
      return new Uint8Array(bits);
    }

    const infoAuth = new TextEncoder().encode('WebPush: info\0');
    const infoAuthComplete = new Uint8Array(infoAuth.length + p256dhBytes.length + localPublicKeyRaw.length);
    infoAuthComplete.set(infoAuth);
    infoAuthComplete.set(p256dhBytes, infoAuth.length);
    infoAuthComplete.set(localPublicKeyRaw, infoAuth.length + p256dhBytes.length);

    const ikm = await hkdf(sharedSecretBits, authBytes, infoAuthComplete, 32);

    const cekInfo = new TextEncoder().encode('Content-Encoding: aes128gcm\0');
    const nonceInfo = new TextEncoder().encode('Content-Encoding: nonce\0');

    const cek = await hkdf(ikm, salt, cekInfo, 16);
    const nonce = await hkdf(ikm, salt, nonceInfo, 12);

    const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);

    const plainTextBytes = new TextEncoder().encode(payloadText);
    const recordBytes = new Uint8Array(plainTextBytes.length + 1);
    recordBytes.set(plainTextBytes);
    recordBytes[plainTextBytes.length] = 2;

    const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce, tagLength: 128 },
      aesKey,
      recordBytes
    ));

    const header = new Uint8Array(16 + 4 + 1 + 65 + ciphertext.length);
    header.set(salt, 0);
    header[16] = 0; header[17] = 0; header[18] = 16; header[19] = 0;
    header[20] = 65;
    header.set(localPublicKeyRaw, 21);
    header.set(ciphertext, 21 + 65);

    return header;
  } catch (e) {
    console.warn('AES-128-GCM 加密机制警告:', e.message);
    return null;
  }
}

export async function sendWebPushToUser(env, userId, payloadData = {}) {
  try {
    const id = normalizeUserId(userId);
    if (!id) return;

    const db = requireDb(env);
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `).run().catch(() => {});

    const rows = await db.prepare(`SELECT * FROM push_subscriptions WHERE user_id = ?`).bind(id).all();
    const subscriptions = rows.results || [];
    if (!subscriptions.length) return;

    const vapidSubject = String(env.VAPID_SUBJECT || 'mailto:admin@lg-site.com').trim();
    const vapidPublicKey = String(env.VAPID_PUBLIC_KEY || 'BA1lrxEsu6DcYOwWIJwFc2XNF2hQPpxRH_Ryl6__kHVCxqBBtwS-6EYCXG9Hfic34t8iRhWPFkD_FlyFzs2qIsc').trim();
    const vapidPrivateKey = String(env.VAPID_PRIVATE_KEY || 'nGu7YtinXQxjSUjDBXPs1pMEK8r2E5HG55318pGHTFw').trim();

    const payloadText = JSON.stringify({
      title: payloadData.title || '龙高北小站',
      body: payloadData.body || '您收到一条新动态提醒',
      url: payloadData.url || '/messages.html',
      unreadCount: payloadData.unreadCount || 1,
      tag: payloadData.tag || 'lg-msg'
    });

    for (const sub of subscriptions) {
      try {
        const jwt = await createVapidJwt(sub.endpoint, vapidSubject, vapidPublicKey, vapidPrivateKey);
        const encryptedBody = await encryptPayload({ p256dh: sub.p256dh, auth: sub.auth }, payloadText);

        const headers = {
          'Authorization': `vapid t=${jwt}, k=${vapidPublicKey}`,
          'TTL': '60'
        };

        if (encryptedBody) {
          headers['Content-Type'] = 'application/octet-stream';
          headers['Content-Encoding'] = 'aes128gcm';
        }

        const res = await fetch(sub.endpoint, {
          method: 'POST',
          headers,
          body: encryptedBody || null
        });

        console.log(`Push to ${sub.endpoint} HTTP status: ${res.status}`);

        if (res.status === 410 || res.status === 404) {
          await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(sub.endpoint).run().catch(() => {});
        }
      } catch (e) {
        console.warn('发送 Web Push 失败:', e.message);
      }
    }
  } catch (err) {
    console.error('sendWebPushToUser error:', err.message);
  }
}
