import { requireAuth } from '../_lib/auth.js';
import { requireDb, normalizeUserId } from '../_lib/db.js';
import { errorResponse, HttpError, json, methodNotAllowed, readJsonBody } from '../_lib/http.js';

async function ensureTable(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `).run();
  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_push_sub_user ON push_subscriptions(user_id)
  `).run();
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await readJsonBody(request);
    const { profile } = await requireAuth(request, env, body);
    const userId = normalizeUserId(profile.id);
    const db = requireDb(env);

    await ensureTable(db);

    const subscription = body.subscription || {};
    const endpoint = String(subscription.endpoint || '').trim();
    const keys = subscription.keys || {};
    const p256dh = String(keys.p256dh || '').trim();
    const auth = String(keys.auth || '').trim();

    if (!endpoint || !p256dh || !auth) {
      throw new HttpError(400, '缺少有效的 Web Push 订阅参数 (endpoint / p256dh / auth)');
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await db.prepare(`
      INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET
        user_id = excluded.user_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        created_at = excluded.created_at
    `).bind(id, userId, endpoint, p256dh, auth, now).run();

    return json({ success: true, message: 'Web Push 订阅成功' });
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', route: '/api/subscribe-push', message: error.message, status: error.status }));
    return errorResponse(error, '保存 Web Push 订阅失败');
  }
}

export function onRequestGet() {
  return methodNotAllowed(['POST']);
}
