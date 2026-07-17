// functions/api/board.js
// Handles custom board creation, listing, and deletion.
import { optionalAuth, requireAuth } from '../_lib/auth.js';
import {
  getUserRow,
  isAdmin,
  normalizeUserId,
  parseJsonArray,
  requireDb
} from '../_lib/db.js';
import { errorResponse, HttpError, json, methodNotAllowed, readJsonBody } from '../_lib/http.js';

const RESERVED_BOARD_IDS = new Set([
  'main', 'api', 'admin', 'class', 'confession', 'posts', 'comments', 'users', 'data', 'tombstone', 'like'
]);

export async function onRequestGet({ request, env }) {
  try {
    const db = requireDb(env);
    
    // Get list of active boards
    const result = await db.prepare(`
      SELECT * FROM boards 
      WHERE status = 0 
      ORDER BY member_count DESC, created_at DESC
    `).all();
    
    const boards = (result.results || []).map(b => ({
      id: b.id,
      name: b.name,
      description: b.description || '',
      ownerId: b.owner_id,
      postCount: Number(b.post_count || 0),
      memberCount: Number(b.member_count || 0),
      joinType: Number(b.join_type || 0),
      createdAt: b.created_at
    }));

    return json({ success: true, boards });
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', route: '/api/board', method: 'GET', message: error.message }));
    return errorResponse(error, '获取板块列表失败');
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await readJsonBody(request);
    const { profile } = await requireAuth(request, env, body);
    const userId = normalizeUserId(profile.id);
    const db = requireDb(env);

    const id = String(body.id || '').trim().toLowerCase();
    const name = String(body.name || '').trim();
    const description = String(body.description || '').trim();
    const joinType = body.joinType !== undefined ? Number(body.joinType) : 0;

    if (joinType !== 0 && joinType !== 1) {
      throw new HttpError(400, '无效的加入限制设置');
    }

    // 1. Validate ID format
    if (!/^[a-z0-9-]{3,20}$/.test(id)) {
      throw new HttpError(400, '板块标识格式不正确（必须为 3-20 位小写英文、数字或中划线）');
    }
    if (RESERVED_BOARD_IDS.has(id) || id.startsWith('class_')) {
      throw new HttpError(400, '该板块标识为系统保留字，请尝试其他名称');
    }

    // 2. Validate Name
    if (!name || name.length < 2 || name.length > 15) {
      throw new HttpError(400, '板块名称长度必须在 2 到 15 个字符之间');
    }
    if (description.length > 80) {
      throw new HttpError(400, '板块描述最多 80 个字符');
    }

    // 3. Check ownership limit (Max 3 active boards per user)
    const countRow = await db.prepare(`
      SELECT COUNT(*) AS total FROM boards 
      WHERE owner_id = ? AND status = 0
    `).bind(userId).first();
    
    if (Number(countRow?.total || 0) >= 3 && !isAdmin(profile)) {
      throw new HttpError(400, '你创建的板块已达上限（最多 3 个）');
    }

    // 4. Check if Board ID already exists
    const existing = await db.prepare(`SELECT 1 FROM boards WHERE id = ? LIMIT 1`).bind(id).first();
    if (existing) {
      throw new HttpError(400, '该板块标识已被占用，请换个名字');
    }

    // 5. Run Database inserts & updates
    const now = new Date().toISOString();
    const ownedBoards = parseJsonArray(profile.owned_boards);
    const joinedBoards = parseJsonArray(profile.joined_boards);

    if (!ownedBoards.includes(id)) ownedBoards.push(id);
    if (!joinedBoards.includes(id)) joinedBoards.push(id);

    // Prepare batch statements
    const createBoardStmt = db.prepare(`
      INSERT INTO boards (id, name, description, owner_id, member_count, join_type, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?, ?)
    `).bind(id, name, description, userId, joinType, now, now);

    const updateUserStmt = db.prepare(`
      UPDATE users 
      SET owned_boards = ?, joined_boards = ? 
      WHERE id = ?
    `).bind(JSON.stringify(ownedBoards), JSON.stringify(joinedBoards), userId);

    await db.batch([createBoardStmt, updateUserStmt]);

    return json({
      success: true,
      board: {
        id,
        name,
        description,
        ownerId: userId,
        postCount: 0,
        memberCount: 1,
        joinType,
        createdAt: now
      }
    }, 201);
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', route: '/api/board', method: 'POST', message: error.message }));
    return errorResponse(error, '创建板块失败');
  }
}

export async function onRequestDelete({ request, env }) {
  try {
    const body = await readJsonBody(request);
    const { profile } = await requireAuth(request, env, body);
    const userId = normalizeUserId(profile.id);
    const db = requireDb(env);

    const boardId = String(body.boardId || '').trim();
    if (!boardId) throw new HttpError(400, '未指定要删除的板块');

    // Fetch board information
    const board = await db.prepare(`SELECT * FROM boards WHERE id = ? LIMIT 1`).bind(boardId).first();
    if (!board) throw new HttpError(404, '板块不存在');

    // Permissions check
    if (normalizeUserId(board.owner_id) !== userId && !isAdmin(profile)) {
      throw new HttpError(403, '你不是板块主理人，无法删除该板块');
    }

    // Soft delete by setting status = 1 (or hard delete if preferred, we'll soft delete to preserve historical posts references in D1)
    await db.prepare(`UPDATE boards SET status = 1, updated_at = ? WHERE id = ?`)
      .bind(new Date().toISOString(), boardId)
      .run();

    return json({ success: true, deletedBoardId: boardId });
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', route: '/api/board', method: 'DELETE', message: error.message }));
    return errorResponse(error, '删除板块失败');
  }
}
