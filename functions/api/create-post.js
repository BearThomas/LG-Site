import { assertNotMuted, requireAuth } from '../_lib/auth.js';
import { getRuntimeConfig } from '../_lib/config.js';
import { isAdmin, localDayStartIso, normalizeUserId, parseJsonArray, requireDb } from '../_lib/db.js';
import { errorResponse, HttpError, json, methodNotAllowed, readJsonBody } from '../_lib/http.js';

export async function onRequestPost({ request, env }) {
  try {
    const body = await readJsonBody(request);
    const { profile } = await requireAuth(request, env, body);
    assertNotMuted(profile);

    // Support both boardId (compatibility) and boardIds (array for multi-board posting)
    let boardIds = [];
    if (Array.isArray(body.boardIds) && body.boardIds.length > 0) {
      boardIds = body.boardIds.map(id => String(id).trim()).filter(Boolean);
    } else {
      const singleBoardId = String(body.boardId || 'main').trim();
      if (singleBoardId) boardIds.push(singleBoardId);
    }

    const title = String(body.title || '').trim();
    const content = String(body.content || '').trim();
    const viewPermission = Number(body.viewPermission || 1);
    const targetGroups = Array.isArray(body.targetUsers) ? body.targetUsers.map(value => String(value).trim()).filter(Boolean).slice(0, 50) : [];

    if (boardIds.length === 0 || !title || !content) {
      throw new HttpError(400, '发布板块、标题和正文不能为空');
    }
    if (title.length > 100) throw new HttpError(400, '标题不能超过 100 个字符');
    if (content.length > 20_000) throw new HttpError(400, '正文不能超过 20000 个字符');
    if (![1, 2, 4, 8].includes(viewPermission)) throw new HttpError(400, '查看权限设置无效');
    if (viewPermission === 4 && !targetGroups.length) throw new HttpError(400, '请至少选择一个可见用户或群组');

    // 1. Verify user belongs to all targeted boards
    const joinedBoards = parseJsonArray(profile.joined_boards);
    for (const bId of boardIds) {
      if (!isAdmin(profile) && bId !== 'main' && !joinedBoards.includes(bId)) {
        throw new HttpError(403, `你尚未加入板块: ${bId}`);
      }
    }

    // 2. Validate daily limit check
    const runtime = getRuntimeConfig(env);
    const dayStart = localDayStartIso(runtime.timezoneOffsetMinutes);
    const countRow = await requireDb(env).prepare(`
      SELECT COUNT(*) AS total
      FROM posts
      WHERE author_id = ? AND created_at >= ?
    `).bind(normalizeUserId(profile.id), dayStart).first();
    
    if (Number(countRow?.total || 0) + boardIds.length > runtime.postDailyLimit) {
      throw new HttpError(429, `今日发帖已达上限（${runtime.postDailyLimit} 条），您还可以发 ${Math.max(0, runtime.postDailyLimit - Number(countRow?.total || 0))} 条`);
    }

    // 3. Batch insert posts
    const now = new Date().toISOString();
    const db = requireDb(env);
    const statements = [];
    const createdPostIds = [];

    for (const bId of boardIds) {
      const id = crypto.randomUUID();
      createdPostIds.push(id);
      
      // Insert post statement
      statements.push(db.prepare(`
        INSERT INTO posts (
          id, board_id, title, content, author_id, author_name,
          view_permission, target_groups, status, edited_at,
          comment_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, 0, ?, ?)
      `).bind(
        id,
        bId,
        title,
        content,
        normalizeUserId(profile.id),
        profile.name,
        viewPermission,
        JSON.stringify(targetGroups),
        now,
        now
      ));

      // Increment board post count if custom board
      const isCustomBoard = bId !== 'main' && !bId.startsWith('class_');
      if (isCustomBoard) {
        statements.push(db.prepare(`
          UPDATE boards SET post_count = post_count + 1 WHERE id = ?
        `).bind(bId));
      }
    }

    await db.batch(statements);

    return json({ success: true, postIds: createdPostIds, postId: createdPostIds[0] }, 201);
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', route: '/api/create-post', message: error.message, status: error.status }));
    return errorResponse(error, '发帖失败');
  }
}

export function onRequestGet() {
  return methodNotAllowed(['POST']);
}
