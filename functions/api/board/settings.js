// functions/api/board/settings.js
// Updates board settings (description, join_type) for board owners.
import { requireAuth } from '../../_lib/auth.js';
import { isAdmin, normalizeUserId, requireDb } from '../../_lib/db.js';
import { errorResponse, HttpError, json, methodNotAllowed, readJsonBody } from '../../_lib/http.js';

export async function onRequestPatch({ request, env }) {
  try {
    const body = await readJsonBody(request);
    const { profile } = await requireAuth(request, env, body);
    const userId = normalizeUserId(profile.id);
    const db = requireDb(env);

    const boardId = String(body.boardId || '').trim();
    const description = String(body.description ?? '').trim();
    const joinType = body.joinType !== undefined ? Number(body.joinType) : null;

    if (!boardId) throw new HttpError(400, '未指定板块 ID');

    // 1. Fetch board metadata
    const board = await db.prepare(`SELECT * FROM boards WHERE id = ? AND status = 0 LIMIT 1`).bind(boardId).first();
    if (!board) throw new HttpError(404, '板块未找到或已被删除');

    // 2. Validate permissions: caller must be owner or admin
    if (normalizeUserId(board.owner_id) !== userId && !isAdmin(profile)) {
      throw new HttpError(403, '你不是板块主理人，无法修改设置');
    }

    // 3. Perform updates
    const updates = [];
    const params = [];
    
    if (body.description !== undefined) {
      if (description.length > 80) throw new HttpError(400, '板块描述最多 80 个字符');
      updates.push('description = ?');
      params.push(description);
    }
    
    if (joinType !== null) {
      if (joinType !== 0 && joinType !== 1) throw new HttpError(400, '无效的加入方式设置');
      updates.push('join_type = ?');
      params.push(joinType);
    }

    if (updates.length === 0) {
      return json({ success: true, message: '未检测到配置更改', boardId });
    }

    const now = new Date().toISOString();
    updates.push('updated_at = ?');
    params.push(now);
    params.push(boardId);

    await db.prepare(`
      UPDATE boards 
      SET ${updates.join(', ')} 
      WHERE id = ?
    `).bind(...params).run();

    return json({ success: true, message: '板块设置更新成功', boardId });
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', route: '/api/board/settings', method: 'PATCH', message: error.message }));
    return errorResponse(error, '更新板块设置失败');
  }
}

export function onRequestGet() { return methodNotAllowed(['PATCH']); }
export function onRequestPost() { return methodNotAllowed(['PATCH']); }
export function onRequestDelete() { return methodNotAllowed(['PATCH']); }
