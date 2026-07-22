import { buildPushPayload } from '@block65/webcrypto-web-push';
import { requireDb, normalizeUserId } from './db.js';

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

    const rows = await db.prepare(`
      SELECT * FROM push_subscriptions WHERE user_id = ?
    `).bind(id).all();

    const subscriptions = rows.results || [];
    if (!subscriptions.length) return;

    const vapid = {
      subject: String(env.VAPID_SUBJECT || 'mailto:admin@lg-site.com').trim(),
      publicKey: String(env.VAPID_PUBLIC_KEY || 'BA1lrxEsu6DcYOwWIJwFc2XNF2hQPpxRH_Ryl6__kHVCxqBBtwS-6EYCXG9Hfic34t8iRhWPFkD_FlyFzs2qIsc').trim(),
      privateKey: String(env.VAPID_PRIVATE_KEY || 'nGu7YtinXQxjSUjDBXPs1pMEK8r2E5HG55318pGHTFw').trim(),
    };

    const message = {
      data: JSON.stringify({
        title: payloadData.title || '龙高北小站',
        body: payloadData.body || '您收到一条新动态提醒',
        url: payloadData.url || '/messages.html',
        unreadCount: payloadData.unreadCount || 1,
        tag: payloadData.tag || 'lg-msg'
      })
    };

    for (const sub of subscriptions) {
      try {
        const targetSub = {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth
          }
        };

        const pushPayload = await buildPushPayload(message, targetSub, vapid);
        const res = await fetch(sub.endpoint, pushPayload);

        if (res.status === 410 || res.status === 404) {
          await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(sub.endpoint).run().catch(() => {});
        }
      } catch (e) {
        console.warn('发送单条 Web Push 失败:', e.message);
      }
    }
  } catch (err) {
    console.error('sendWebPushToUser error:', err.message);
  }
}
