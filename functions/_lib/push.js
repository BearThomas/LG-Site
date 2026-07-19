/**
 * 向极光推送 JPush 发送通知
 * @param {Object} env Cloudflare Worker 环境对象
 * @param {string[]} tokens 极光 Registration ID (device_token) 数组
 * @param {string} title 通知标题
 * @param {string} alert 通知正文
 * @param {Object} extras 附加参数，例如 { link: 'post.html?id=xxx' }
 */
export async function sendPushNotification(env, tokens, title, alert, extras = {}) {
  if (!tokens || tokens.length === 0) return;
  const appKey = env.JPUSH_APP_KEY;
  const masterSecret = env.JPUSH_MASTER_SECRET;
  
  if (!appKey || !masterSecret) {
    // 未配置极光环境，跳过推送
    return;
  }
  
  // 过滤空 token
  const targetTokens = tokens.map(t => String(t || '').trim()).filter(Boolean);
  if (targetTokens.length === 0) return;

  const authHeader = 'Basic ' + btoa(`${appKey}:${masterSecret}`);

  try {
    const response = await fetch('https://api.jpush.cn/v3/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader
      },
      body: JSON.stringify({
        platform: 'all',
        audience: {
          registration_id: targetTokens
        },
        notification: {
          android: {
            alert: alert,
            title: title,
            extras: extras
          }
        },
        options: {
          time_to_live: 86400 // 保持一天
        }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`JPush API error: ${response.status} - ${errText}`);
    } else {
      console.log(`JPush notification sent successfully to ${targetTokens.length} devices.`);
    }
  } catch (error) {
    console.error(`JPush push failed: ${error.message}`);
  }
}
