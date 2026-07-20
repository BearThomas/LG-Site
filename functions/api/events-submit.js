import { requireAuth } from '../_lib/auth.js';
import { requireDb, normalizeUserId } from '../_lib/db.js';
import { errorResponse, HttpError, json, methodNotAllowed, readJsonBody } from '../_lib/http.js';

export async function onRequestGet({ request, env }) {
  try {
    const { profile } = await requireAuth(request, env);
    const userId = normalizeUserId(profile.id);
    const url = new URL(request.url);
    const ids = [...new Set(String(url.searchParams.get('ids') || '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean))]
      .slice(0, 50);

    if (!ids.length) return json({ submissions: [] });

    const db = requireDb(env);
    const result = await db.prepare(`
      SELECT id, title, desc, tag, date, status, created_at
      FROM events
      WHERE submitter_id = ? AND id IN (${ids.map(() => '?').join(', ')})
      ORDER BY created_at DESC
    `).bind(userId, ...ids).all();

    return json({ submissions: result.results || [] });
  } catch (error) {
    return errorResponse(error, '查询投稿记录失败');
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await readJsonBody(request);
    const { profile } = await requireAuth(request, env, body);
    const userId = normalizeUserId(profile.id);

    const db = requireDb(env);
    
    // 防刷检测：每小时最多 1 次，24 小时内最多 3 次。
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    const oneDayAgo = now - 24 * 60 * 60 * 1000;

    const rateStmt = db.prepare(`SELECT 
      SUM(CASE WHEN created_at > ? THEN 1 ELSE 0 END) as count_1h,
      SUM(CASE WHEN created_at > ? THEN 1 ELSE 0 END) as count_1d
    FROM events WHERE submitter_id = ?`);
    
    const rateRes = await rateStmt.bind(oneHourAgo, oneDayAgo, userId).first();
    if (rateRes) {
      if (Number(rateRes.count_1h || 0) >= 1) throw new HttpError(429, '每小时最多投稿 1 次，请稍后再试');
      if (Number(rateRes.count_1d || 0) >= 3) throw new HttpError(429, '24 小时内最多投稿 3 条，请稍后再试');
    }

    const userInput = String(body.content || '').trim();
    if (userInput.length < 5 || userInput.length > 500) {
      throw new HttpError(400, '事件内容长度需在 5 到 500 字之间');
    }

    // 调用智谱 API
    const zhipuKey = env.ZHIPU_API_KEY;
    if (!zhipuKey) {
      throw new HttpError(500, '服务器未配置 AI 审核密钥');
    }

    const aiPrompt = `你是一个严谨的校园大事记审核员。用户提交了一段关于学校事件的描述。
请判断这是否是一个有价值的、真实的校园事件（如考试、活动、放假、比赛等）。
如果是无意义灌水、恶意言论或明显不属于校园事件，请将 approved 设为 false，并在 reason 中说明。
如果通过审核，请将 approved 设为 true，并严格提取并润色以下字段：
- title: 简短精炼的标题 (15字以内)
- desc: 事件的详细描述，语气客观
- tag: 一个简短的标签 (如：祝贺, 通知, 活动, 日常)
- date: 提取事件发生的日期，格式 YYYY-MM-DD。如果未提及具体年份，默认 ${new Date().getFullYear()}。如果完全未提及时间，使用今天 ${new Date().toISOString().split('T')[0]}

请仅返回 JSON，格式如下：
{
  "approved": true/false,
  "reason": "如果拒绝，填入原因",
  "title": "...",
  "desc": "...",
  "tag": "...",
  "date": "YYYY-MM-DD"
}

用户提交的内容：
${userInput}
`;

    const aiRes = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${zhipuKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'glm-4-flash',
        messages: [{ role: 'user', content: aiPrompt }],
        temperature: 0.1,
        response_format: { type: "json_object" }
      })
    });

    if (!aiRes.ok) {
      console.error('AI API Error:', await aiRes.text());
      throw new HttpError(502, 'AI 审核服务暂时不可用，请稍后再试');
    }

    const aiData = await aiRes.json();
    let aiResult;
    try {
      aiResult = JSON.parse(aiData.choices[0].message.content);
    } catch(e) {
      throw new HttpError(502, 'AI 审核返回格式错误');
    }

    if (!aiResult.approved) {
      throw new HttpError(400, `审核未通过：${String(aiResult.reason || '内容不符合校园大事记要求')}`);
    }

    const normalizedTitle = String(aiResult.title || '无标题').trim().slice(0, 30);
    const normalizedDesc = String(aiResult.desc || userInput).trim().slice(0, 1000);
    const normalizedTag = String(aiResult.tag || '校园').trim().slice(0, 20);
    const normalizedDate = /^\d{4}-\d{2}-\d{2}$/.test(String(aiResult.date || ''))
      ? String(aiResult.date)
      : new Date().toISOString().split('T')[0];

    const eventId = crypto.randomUUID();
    const insertStmt = db.prepare(`INSERT INTO events (id, title, desc, tag, date, link, status, submitter_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    await insertStmt.bind(
      eventId,
      normalizedTitle,
      normalizedDesc,
      normalizedTag,
      normalizedDate,
      '',
      'pending_admin',
      userId,
      now
    ).run();

    return json({
      success: true,
      eventId: eventId,
      message: '提交成功，已通过 AI 初审，等待管理员最终确认',
      data: {
        title: normalizedTitle,
        desc: normalizedDesc,
        tag: normalizedTag,
        date: normalizedDate,
        status: 'pending_admin'
      }
    });

  } catch (err) {
    return errorResponse(err, '提交大事记失败');
  }
}

export function onRequestPatch() { return methodNotAllowed(['GET', 'POST']); }
export function onRequestDelete() { return methodNotAllowed(['GET', 'POST']); }
