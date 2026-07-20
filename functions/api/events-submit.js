import { requireAuth } from '../_lib/auth.js';
import { requireDb, normalizeUserId } from '../_lib/db.js';
import { errorResponse, json, methodNotAllowed, readJsonBody } from '../_lib/http.js';

export async function onRequestPost({ request, env }) {
  try {
    const body = await readJsonBody(request);
    const { profile } = await requireAuth(request, env, body);
    const userId = normalizeUserId(profile.id);

    const db = requireDb(env);
    
    // 防刷检测：5分钟内最多1次，每天最多3次
    const now = Date.now();
    const fiveMinsAgo = now - 5 * 60 * 1000;
    const oneDayAgo = now - 24 * 60 * 60 * 1000;

    const rateStmt = db.prepare(`SELECT 
      SUM(CASE WHEN created_at > ? THEN 1 ELSE 0 END) as count_5m,
      SUM(CASE WHEN created_at > ? THEN 1 ELSE 0 END) as count_1d
    FROM events WHERE submitter_id = ?`);
    
    const rateRes = await rateStmt.bind(fiveMinsAgo, oneDayAgo, userId).first();
    if (rateRes) {
      if (rateRes.count_5m >= 1) return errorResponse(429, '提交过于频繁，请5分钟后再试');
      if (rateRes.count_1d >= 3) return errorResponse(429, '您今天提交的事件已达上限(3条)，请明天再来');
    }

    const userInput = String(body.content || '').trim();
    if (userInput.length < 5 || userInput.length > 500) {
      return errorResponse(400, '事件内容长度需在 5 到 500 字之间');
    }

    // 调用智谱 API
    const zhipuKey = env.ZHIPU_API_KEY;
    if (!zhipuKey) {
      return errorResponse(500, '服务器未配置 AI 审核密钥');
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
      return errorResponse(500, 'AI 审核服务暂时不可用，请稍后再试');
    }

    const aiData = await aiRes.json();
    let aiResult;
    try {
      aiResult = JSON.parse(aiData.choices[0].message.content);
    } catch(e) {
      return errorResponse(500, 'AI 审核返回格式错误');
    }

    if (!aiResult.approved) {
      return errorResponse(400, `审核未通过: ${aiResult.reason}`);
    }

    const eventId = crypto.randomUUID();
    const insertStmt = db.prepare(`INSERT INTO events (id, title, desc, tag, date, link, status, submitter_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    await insertStmt.bind(
      eventId,
      aiResult.title || '无标题',
      aiResult.desc || userInput,
      aiResult.tag || '校园',
      aiResult.date || new Date().toISOString().split('T')[0],
      '',
      'pending_admin',
      userId,
      now
    ).run();

    return json({
      success: true,
      eventId: eventId,
      message: '提交成功，已通过 AI 初审，等待管理员最终确认',
      data: aiResult
    });

  } catch (err) {
    const status = err.status || 500;
    return errorResponse(status, err.message);
  }
}

export function onRequest(context) {
  return methodNotAllowed();
}
