// functions/api/board/members.js
// Get members list or kick members from a custom board.
import { requireAuth } from '../../_lib/auth.js';
import {
  getUserRow,
  isAdmin,
  normalizeUserId,
  parseJsonArray,
  requireDb
} from '../../_lib/db.js';
import { errorResponse, HttpError, json, methodNotAllowed, readJsonBody } from '../../_lib/http.js';

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const boardId = String(url.searchParams.get('boardId') || '').trim();
    if (!boardId) throw new HttpError(400, '未指定板块 ID');

    const auth = await requireAuth(request, env, {});
    const userId = normalizeUserId(auth.profile.id);
    const db = requireDb(env);

    // Validate board exists and caller owns it or is admin
    const board = await db.prepare(`SELECT * FROM boards WHERE id = ? AND status = 0 LIMIT 1`).bind(boardId).first();
    if (!board) throw new HttpError(404, '板块未找到或已被删除');

    if (normalizeUserId(board.owner_id) !== userId && !isAdmin(auth.profile)) {
      throw new HttpError(403, '你不是板块主理人，无权管理板块成员');
    }

    // Query members list using SQLite JSON JSON_EACH function
    // This looks up all users who joined this board
    const membersResult = await db.prepare(`
      SELECT id, name, avatar, class_name, role 
      FROM users 
      WHERE EXISTS (
        SELECT 1 FROM json_each(users.joined_boards) 
        WHERE json_each.value = ?
      )
      ORDER BY id ASC
    `).bind(boardId).all();

    const members = (membersResult.results || []).map(m => ({
      userId: m.id,
      name: m.name || `同学${m.id.slice(-4)}`,
      className: m.class_name || '',
      avatar: m.avatar || '',
      role: m.role || 'normal',
      isOwner: normalizeUserId(board.owner_id) === normalizeUserId(m.id)
    }));

    return json({ success: true, members });
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', route: '/api/board/members', method: 'GET', message: error.message }));
    return errorResponse(error, '获取成员列表失败');
  }
}

export async function onRequestDelete({ request, env }) {
  try {
    const body = await readJsonBody(request);
    const { profile } = await requireAuth(request, env, body);
    const callerId = normalizeUserId(profile.id);
    const db = requireDb(env);

    const boardId = String(body.boardId || '').trim();
    const targetUserId = normalizeUserId(body.userId);

    if (!boardId || !targetUserId) throw new HttpError(400, '板块 ID 或目标用户 ID 不能为空');

    // 1. Validate board exists and caller has permissions
    const board = await db.prepare(`SELECT * FROM boards WHERE id = ? AND status = 0 LIMIT 1`).bind(boardId).first();
    if (!board) throw new HttpError(404, '板块未找到或已被删除');

    if (normalizeUserId(board.owner_id) !== callerId && !isAdmin(profile)) {
      throw new HttpError(403, '你不是板块主理人，无权移出成员');
    }

    // Board owners cannot kick themselves
    if (normalizeUserId(board.owner_id) === targetUserId) {
      throw new HttpError(400, '主理人无法移出自己，如需注销板块请直接删除板块');
    }

    // 2. Fetch target user
    const targetUser = await getUserRow(env, targetUserId);
    if (!targetUser) throw new HttpError(404, '该用户不存在');

    const joinedBoards = parseJsonArray(targetUser.joined_boards);
    const hasJoined = joinedBoards.includes(boardId);
    if (!hasJoined) {
      return json({ success: true, message: '用户已不在该板块中', boardId, userId: targetUserId });
    }

    const newJoined = joinedBoards.filter(id => id !== boardId);

    // Batch: Update user's joined_boards and decrement board's member_count
    const updateUserStmt = db.prepare(`UPDATE users SET joined_boards = ? WHERE id = ?`)
      .bind(JSON.stringify(newJoined), targetUserId);
    const decBoardStmt = db.prepare(`UPDATE boards SET member_count = MAX(0, member_count - 1) WHERE id = ?`)
      .bind(boardId);

    await db.batch([updateUserStmt, decBoardStmt]);

    return json({ success: true, kicked: true, boardId, userId: targetUserId });
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', route: '/api/board/members', method: 'DELETE', message: error.message }));
    return errorResponse(error, '移出成员失败');
  }
}

export function onRequestPost() { return methodNotAllowed(['GET', 'DELETE']); }
export function onRequestPatch() { return methodNotAllowed(['GET', 'DELETE']); }
