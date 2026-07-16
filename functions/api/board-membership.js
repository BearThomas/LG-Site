// functions/api/board-membership.js
// Handles users joining or leaving a custom board.
import { requireAuth } from '../_lib/auth.js';
import {
  getUserRow,
  normalizeUserId,
  parseJsonArray,
  requireDb
} from '../_lib/db.js';
import { errorResponse, HttpError, json, methodNotAllowed, readJsonBody } from '../_lib/http.js';

export async function onRequestPost({ request, env }) {
  try {
    const body = await readJsonBody(request);
    const { profile } = await requireAuth(request, env, body);
    const userId = normalizeUserId(profile.id);
    const db = requireDb(env);

    const boardId = String(body.boardId || '').trim();
    const action = String(body.action || '').trim();

    if (!boardId) throw new HttpError(400, '未指定板块 ID');
    if (boardId === 'main' || boardId.startsWith('class_')) {
      throw new HttpError(400, '系统固有板块不允许手动加入或退出');
    }
    if (action !== 'join' && action !== 'leave') {
      throw new HttpError(400, '参数 action 必须为 join 或 leave');
    }

    // 1. Verify board exists and is active
    const board = await db.prepare(`SELECT * FROM boards WHERE id = ? AND status = 0 LIMIT 1`).bind(boardId).first();
    if (!board) throw new HttpError(404, '板块未找到或已被删除');

    // 2. Fetch fresh user joined_boards array
    const joinedBoards = parseJsonArray(profile.joined_boards);
    const hasJoined = joinedBoards.includes(boardId);

    if (action === 'join') {
      if (hasJoined) {
        return json({ success: true, message: '你已经加入了该板块', boardId });
      }
      joinedBoards.push(boardId);

      // Batch: Add to user joined_boards and increment board member_count
      const updateUserStmt = db.prepare(`UPDATE users SET joined_boards = ? WHERE id = ?`)
        .bind(JSON.stringify(joinedBoards), userId);
      const incBoardStmt = db.prepare(`UPDATE boards SET member_count = member_count + 1 WHERE id = ?`)
        .bind(boardId);

      await db.batch([updateUserStmt, incBoardStmt]);
      return json({ success: true, joined: true, boardId });
    } else {
      // action === 'leave'
      if (!hasJoined) {
        return json({ success: true, message: '你尚未加入该板块', boardId });
      }
      const newJoined = joinedBoards.filter(id => id !== boardId);

      // Batch: Remove from user joined_boards and decrement board member_count
      const updateUserStmt = db.prepare(`UPDATE users SET joined_boards = ? WHERE id = ?`)
        .bind(JSON.stringify(newJoined), userId);
      const decBoardStmt = db.prepare(`UPDATE boards SET member_count = MAX(0, member_count - 1) WHERE id = ?`)
        .bind(boardId);

      await db.batch([updateUserStmt, decBoardStmt]);
      return json({ success: true, left: true, boardId });
    }
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', route: '/api/board-membership', method: 'POST', message: error.message }));
    return errorResponse(error, '加入/退出板块失败');
  }
}

export function onRequestGet() { return methodNotAllowed(['POST']); }
export function onRequestPatch() { return methodNotAllowed(['POST']); }
export function onRequestDelete() { return methodNotAllowed(['POST']); }
