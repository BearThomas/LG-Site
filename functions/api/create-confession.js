import { assertNotMuted, requireAuth } from '../_lib/auth.js';
import { getRuntimeConfig } from '../_lib/config.js';
import { localDayStartIso, normalizeUserId, requireDb } from '../_lib/db.js';
import { errorResponse, HttpError, json, methodNotAllowed, readJsonBody } from '../_lib/http.js';

export async function onRequestPost({ request, env }) {
  try {
    const body = await readJsonBody(request);
    const { profile } = await requireAuth(request, env, body);
    assertNotMuted(profile);
    const content = String(body.content || '').trim();
    const toName = String(body.toName || '').trim().slice(0, 50) || null;
    if (content.length < 5) throw new HttpError(400, '表白内容至少需要 5 个字符');
    if (content.length > 2000) throw new HttpError(400, '表白内容不能超过 2000 个字符');

    // 审核内容
    await import('../_lib/moderation.js').then(m => m.assertContentSafe(env, (toName || '') + '\n' + content));

    const runtime = getRuntimeConfig(env);
    const dayStart = localDayStartIso(runtime.timezoneOffsetMinutes);
    const countRow = await requireDb(env).prepare(`
      SELECT COUNT(*) AS total
      FROM confessions
      WHERE author_id = ? AND created_at >= ?
    `).bind(normalizeUserId(profile.id), dayStart).first();
    if (Number(countRow?.total || 0) >= runtime.confessionDailyLimit) {
      throw new HttpError(429, `今日匿名发布已达上限（${runtime.confessionDailyLimit} 条）`);
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await requireDb(env).prepare(`
      INSERT INTO confessions (
        id, content, author_id, author_name, to_name,
        status, likes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)
    `).bind(id, content, normalizeUserId(profile.id), profile.name, toName, now, now).run();
    return json({ success: true, confessionId: id }, 201);
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', route: '/api/create-confession', message: error.message, status: error.status }));
    return errorResponse(error, '发布失败');
  }
}

export function onRequestGet() {
  return methodNotAllowed(['POST']);
}
