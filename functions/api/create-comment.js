import { assertNotMuted, requireAuth } from '../_lib/auth.js';
import { getRuntimeConfig } from '../_lib/config.js';
import { canViewPost, getPostRow, localDayStartIso, normalizeUserId, requireDb } from '../_lib/db.js';
import { errorResponse, HttpError, json, methodNotAllowed, readJsonBody } from '../_lib/http.js';

export async function onRequestPost({ request, env, waitUntil }) {
  try {
    const body = await readJsonBody(request);
    const { profile } = await requireAuth(request, env, body);
    assertNotMuted(profile);

    const postId = String(body.postId || '').trim();
    const content = String(body.content || '').trim();
    if (!postId) throw new HttpError(400, '缺少帖子 ID');
    if (content.length < 2) throw new HttpError(400, '内容太短，多说两个字吧');
    if (content.length > 500) throw new HttpError(400, '评论不能超过 500 个字符');

    // 审核内容
    await import('../_lib/moderation.js').then(m => m.assertContentSafe(env, content));

    // Skip post existence and permission checks to allow commenting on backup‑only posts.
    // Optionally, you could fetch minimal metadata if needed, but for now we allow any postId.
    const post = null;

    const runtime = getRuntimeConfig(env);
    const dayStart = localDayStartIso(runtime.timezoneOffsetMinutes);
    const countRow = await requireDb(env).prepare(`
      SELECT COUNT(*) AS total
      FROM comments
      WHERE author_id = ? AND created_at >= ?
    `).bind(normalizeUserId(profile.id), dayStart).first();
    if (Number(countRow?.total || 0) >= runtime.commentDailyLimit) {
      throw new HttpError(429, `今日评论已达上限（${runtime.commentDailyLimit} 条）`);
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const db = requireDb(env);
    await db.batch([
      db.prepare(`
        INSERT INTO comments (
          id, post_id, content, author_id, author_name, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(id, postId, content, normalizeUserId(profile.id), profile.name, now, now),
      db.prepare('UPDATE posts SET comment_count = comment_count + 1, updated_at = updated_at WHERE id = ?').bind(postId)
    ]);

    // 后台通知逻辑 (不阻塞主响应流程)
    try {
      const postRow = await db.prepare('SELECT author_id, title FROM posts WHERE id = ?').bind(postId).first();
      if (postRow && normalizeUserId(postRow.author_id) !== normalizeUserId(profile.id)) {
        const recipientId = normalizeUserId(postRow.author_id);
        const notificationId = crypto.randomUUID();
        const notificationContent = `${profile.name} 评论了你的帖子《${postRow.title}》`;
        
        // 1. 存入数据库通知表
        await db.prepare(`
          INSERT INTO notifications (
            id, recipient_id, sender_id, sender_name, type, title, content, target_id, is_read, created_at
          ) VALUES (?, ?, ?, ?, 'comment', '新评论提醒', ?, ?, 0, ?)
        `).bind(notificationId, recipientId, normalizeUserId(profile.id), profile.name, notificationContent, postId, now).run();

        // 2. 发送 JPush 推送
        const recipientUser = await db.prepare('SELECT device_token FROM users WHERE id = ?').bind(recipientId).first();
        if (recipientUser && recipientUser.device_token) {
          const { sendPushNotification } = await import('../_lib/push.js');
          waitUntil(
            sendPushNotification(
              env,
              [recipientUser.device_token],
              '新评论提醒',
              notificationContent,
              { link: `post.html?id=${postId}` }
            )
          );
        }
      }
    } catch (notifError) {
      console.error('Failed to create/send notification:', notifError);
    }

    return json({ success: true, commentId: id }, 201);
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', route: '/api/create-comment', message: error.message, status: error.status }));
    return errorResponse(error, '发表评论失败');
  }
}

export function onRequestGet() {
  return methodNotAllowed(['POST']);
}
