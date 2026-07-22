import { requireAuth } from '../_lib/auth.js';
import { sendWebPushToUser } from '../_lib/push.js';
import { errorResponse, HttpError, json, methodNotAllowed, readJsonBody } from '../_lib/http.js';

export async function onRequestPost({ request, env, waitUntil }) {
  try {
    const body = await readJsonBody(request);
    const { profile } = await requireAuth(request, env, body);

    const pushData = {
      title: '龙高北小站 - 推送测试',
      body: ' 🎉 恭喜！您已成功开启系统级 Web Push 消息推送。',
      url: '/settings.html',
      unreadCount: 1,
      tag: 'test-push'
    };

    if (waitUntil) {
      waitUntil(sendWebPushToUser(env, profile.id, pushData));
    } else {
      await sendWebPushToUser(env, profile.id, pushData);
    }

    return json({ success: true, message: '测试推送指令已下发' });
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', route: '/api/send-test-push', message: error.message, status: error.status }));
    return errorResponse(error, '发送测试推送失败');
  }
}

export function onRequestGet() {
  return methodNotAllowed(['POST']);
}
