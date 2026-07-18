import { HttpError } from './http.js';

/**
 * 审核文本内容，如果包含违规信息则抛出 HttpError
 * @param {Object} env Cloudflare Worker 环境对象
 * @param {string} text 要审核的文本
 */
export async function assertContentSafe(env, text) {
  if (!text || typeof text !== 'string') return;
  const apiKey = env.SPARK_API_PASSWORD;
  if (!apiKey) {
    // 如果没有配置 API Key，则跳过审核
    return;
  }

  // 构建 Prompt
  const prompt = `你是一个严格的社区内容审核助手。请仔细审查用户提供的内容是否包含**政治敏感、严重违法乱纪、极端暴恐**的信息。
注意：像 "TMD"、"草"、"卧槽" 等口语化的轻微情绪发泄词汇是允许的，不需要拦截。
如果内容包含上述严重违规信息，请只回复 "REJECT"，否则请只回复 "PASS"。

待审核内容如下：
${text}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000); // 5秒超时

  try {
    const response = await fetch('https://spark-api-open.xf-yun.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'lite',
        messages: [{ role: 'user', content: prompt }],
        stream: false
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      // 接口调用失败，采用 Fail-open 策略，允许发布并记录日志
      console.error(`Moderation API error: ${response.status}`);
      return;
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content?.trim()?.toUpperCase() || 'PASS';

    if (reply.includes('REJECT')) {
      throw new HttpError(403, '内容包含违规或敏感信息，已被系统拦截');
    }
  } catch (error) {
    if (error instanceof HttpError) {
      throw error; // 继续向上抛出业务拦截错误
    }
    // 其他网络错误或超时，Fail-open
    console.error(`Moderation request failed: ${error.message}`);
  } finally {
    clearTimeout(timeout);
  }
}
