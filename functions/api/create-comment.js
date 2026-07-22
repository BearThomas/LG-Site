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

    // 后台通知逻辑：通知帖子作者 + 历史参与者 + 支持自测模式推送
    try {
      const currentUserId = normalizeUserId(profile.id);
      let postTitle = '帖子';
      let postAuthorId = null;

      try {
        const postRow = await db.prepare('SELECT author_id, title FROM posts WHERE id = ?').bind(postId).first();
        if (postRow) {
          postAuthorId = normalizeUserId(postRow.author_id);
          if (postRow.title) postTitle = postRow.title;
        }
      } catch (e) {
        console.warn('获取帖子作者信息失败:', e.message);
      }

      const recipientsToNotify = new Set();

      // 1. 帖子作者
      if (postAuthorId && postAuthorId !== currentUserId) {
        recipientsToNotify.add(postAuthorId);
      }

      // 2. 之前参与过该帖子讨论的所有评论者
      try {
        const prevCommenters = await db.prepare(`
          SELECT DISTINCT author_id FROM comments WHERE post_id = ?
        `).bind(postId).all();

        if (prevCommenters && prevCommenters.results) {
          for (const row of prevCommenters.results) {
            const cId = normalizeUserId(row.author_id);
            if (cId && cId !== currentUserId) {
              recipientsToNotify.add(cId);
            }
          }
        }
      } catch (e) {
        console.warn('获取历史评论者失败:', e.message);
      }

      // 3. 【自测模式与 100% 投递保障】：若没有其他接收者 (如用户自己在测试给自己的帖子评论)，也推送给当前用户自身
      if (recipientsToNotify.size === 0) {
        recipientsToNotify.add(currentUserId);
      }

      // 4. 逐个下发通知与 Web Push 推送
        // 4. 批量下发通知与 Web Push 推送（修复循环调用 waitUntil 的 Bug）
        const { sendWebPushToUser } = await import('../_lib/push.js');

        const pushPromises = [];

        for (const recipientId of recipientsToNotify) {
            const isSelf = recipientId === currentUserId;
            const isOwner = recipientId === postAuthorId;
            const notificationTitle = isSelf ? '评论已发布' : (isOwner ? '新评论提醒' : '新回复提醒');
            const notificationContent = isSelf
                ? `您在帖子《${postTitle}》中发表了新评论`
                : (isOwner ? `${profile.name} 评论了你的帖子《${postTitle}》` : `${profile.name} 回复了你参与讨论的帖子《${postTitle}》`);

            const notificationId = crypto.randomUUID();

            // 写入数据库通知（必须同步或确保完成）
            await db.prepare(`
        INSERT INTO notifications (
            id, recipient_id, sender_id, sender_name, type, title, content, target_id, is_read, created_at
        ) VALUES (?, ?, ?, ?, 'comment', ?, ?, ?, 0, ?)
    `).bind(
                notificationId, recipientId, currentUserId, profile.name,
                notificationTitle, notificationContent, postId, now
            ).run().catch(err => console.warn(`写入通知数据库失败 (${recipientId}):`, err.message));

            // 收集 Web Push 任务，统一并发处理
            pushPromises.push(
                sendWebPushToUser(env, recipientId, {
                    title: notificationTitle,
                    body: notificationContent,
                    url: `/post-detail.html?id=${postId}`,
                    unreadCount: 1,
                    tag: `comment-${postId}`
                }).catch(err => {
                    console.warn(`Web Push 下发给 ${recipientId} 失败:`, err.message);
                })
            );
        }

        // 统一交给 waitUntil 确保后台执行完毕，不阻塞 HTTP 响应
        if (waitUntil && pushPromises.length > 0) {
            waitUntil(Promise.all(pushPromises));
        } else if (pushPromises.length > 0) {
            await Promise.all(pushPromises);
        }
    } catch (notifError) {
      console.error('Failed to create/send notifications:', notifError);
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
