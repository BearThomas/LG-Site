// functions/api/board/requests.js
// Board managers approving or rejecting membership requests.
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

    // Validate board exists and user owns it or is admin
    const board = await db.prepare(`SELECT * FROM boards WHERE id = ? AND status = 0 LIMIT 1`).bind(boardId).first();
    if (!board) throw new HttpError(404, '板块未找到或已被删除');

    if (normalizeUserId(board.owner_id) !== userId && !isAdmin(auth.profile)) {
      throw new HttpError(403, '你不是板块主理人，无权管理加入申请');
    }

    // Query pending requests joined with user profile info
    const requestsResult = await db.prepare(`
      SELECT r.user_id, r.created_at, u.name, u.class_name
      FROM board_requests r
      LEFT JOIN users u ON r.user_id = u.id
      WHERE r.board_id = ? AND r.status = 0
      ORDER BY r.created_at ASC
    `).bind(boardId).all();

    const requests = (requestsResult.results || []).map(r => ({
      userId: r.user_id,
      name: r.name || `同学${r.user_id.slice(-4)}`,
      className: r.class_name || '',
      createdAt: r.created_at
    }));

    return json({ success: true, requests });
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', route: '/api/board/requests', method: 'GET', message: error.message }));
    return errorResponse(error, '获取申请列表失败');
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await readJsonBody(request);
    const { profile } = await requireAuth(request, env, body);
    const callerId = normalizeUserId(profile.id);
    const db = requireDb(env);

    const boardId = String(body.boardId || '').trim();
    const targetUserId = normalizeUserId(body.userId);
    const action = String(body.action || '').trim(); // 'approve' | 'reject'

    if (!boardId || !targetUserId) throw new HttpError(400, '板块 ID 或申请用户 ID 不能为空');
    if (action !== 'approve' && action !== 'reject') {
      throw new HttpError(400, '操作类型必须为 approve 或 reject');
    }

    // 1. Validate board exists and caller has permissions
    const board = await db.prepare(`SELECT * FROM boards WHERE id = ? AND status = 0 LIMIT 1`).bind(boardId).first();
    if (!board) throw new HttpError(404, '板块未找到或已被删除');

    if (normalizeUserId(board.owner_id) !== callerId && !isAdmin(profile)) {
      throw new HttpError(403, '你不是板块主理人，无权处理加入申请');
    }

    // 2. Fetch pending request
    const pendingReq = await db.prepare(`
      SELECT * FROM board_requests 
      WHERE board_id = ? AND user_id = ? AND status = 0 
      LIMIT 1
    `).bind(boardId, targetUserId).first();
    
    if (!pendingReq) {
      throw new HttpError(404, '未找到对应的待处理申请记录');
    }

    const now = new Date().toISOString();

    if (action === 'approve') {
      // Approve membership
      const targetUser = await getUserRow(env, targetUserId);
      if (!targetUser) throw new HttpError(404, '申请用户不存在');

      const joinedBoards = parseJsonArray(targetUser.joined_boards);
      if (!joinedBoards.includes(boardId)) {
        joinedBoards.push(boardId);
      }

      // Execute batch updates
      const updateRequestStmt = db.prepare(`
        UPDATE board_requests SET status = 1, updated_at = ? WHERE board_id = ? AND user_id = ?
      `).bind(now, boardId, targetUserId);

      const updateUserStmt = db.prepare(`
        UPDATE users SET joined_boards = ? WHERE id = ?
      `).bind(JSON.stringify(joinedBoards), targetUserId);

      const incBoardStmt = db.prepare(`
        UPDATE boards SET member_count = member_count + 1 WHERE id = ?
      `).bind(boardId);

      await db.batch([updateRequestStmt, updateUserStmt, incBoardStmt]);
      return json({ success: true, status: 'approved', boardId, userId: targetUserId });
    } else {
      // Reject membership
      await db.prepare(`
        UPDATE board_requests SET status = 2, updated_at = ? WHERE board_id = ? AND user_id = ?
      `).bind(now, boardId, targetUserId).run();

      return json({ success: true, status: 'rejected', boardId, userId: targetUserId });
    }
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', route: '/api/board/requests', method: 'POST', message: error.message }));
    return errorResponse(error, '处理申请失败');
  }
}

export function onRequestDelete() { return methodNotAllowed(['GET', 'POST']); }
export function onRequestPatch() { return methodNotAllowed(['GET', 'POST']); }
