import { requireAuth } from '../_lib/auth.js';
import { requireDb, hasPermission, isSuperAdmin, PERMISSIONS, normalizeUserId, SUPER_ADMIN_ID } from '../_lib/db.js';
import { errorResponse, HttpError, json, methodNotAllowed, readJsonBody } from '../_lib/http.js';

export async function onRequestGet({ request, env }) {
  try {
    const { profile } = await requireAuth(request, env);
    if (!hasPermission(profile, PERMISSIONS.MANAGE_PERMISSIONS)) {
      throw new HttpError(403, '权限不足，无法管理权限开关');
    }

    const url = new URL(request.url);
    const search = String(url.searchParams.get('q') || '').trim();
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 20), 1), 100);
    const offset = Math.max(Number(url.searchParams.get('offset') || 0), 0);

    const db = requireDb(env);
    let sql = 'SELECT id, name, avatar, email, role, permissions, banned, updated_at FROM users';
    const params = [];

    if (search) {
      sql += ' WHERE id LIKE ? OR name LIKE ? OR email LIKE ?';
      const term = `%${search}%`;
      params.push(term, term, term);
    }
    sql += ' ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, updated_at DESC LIMIT ? OFFSET ?';
    params.push(SUPER_ADMIN_ID, limit, offset);

    const result = await db.prepare(sql).bind(...params).all();

    return json({
      users: result.results || [],
      superAdminId: SUPER_ADMIN_ID,
      permissionsMap: PERMISSIONS
    });
  } catch (err) {
    return errorResponse(err, '获取用户权限列表失败');
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await readJsonBody(request);
    const { profile } = await requireAuth(request, env, body);

    if (!hasPermission(profile, PERMISSIONS.MANAGE_PERMISSIONS)) {
      throw new HttpError(403, '权限不足，无法修改他人权限开关');
    }

    const targetUserId = normalizeUserId(body.targetUserId);
    if (!targetUserId) throw new HttpError(400, '目标用户 ID 无效');
    if (targetUserId === SUPER_ADMIN_ID) {
      throw new HttpError(403, '超级管理员 bearThomas 的全特权位不可修改');
    }

    const newPermissions = Number(body.permissions);
    if (Number.isNaN(newPermissions) || newPermissions < 0) {
      throw new HttpError(400, '权限掩码数值无效');
    }

    // 若要赋予 16(MANAGE_PERMISSIONS) 或 32(DATABASE_STUDIO) 权限，操作者必须是真正的超级管理员 20240338
    const grantsHighPerm = (newPermissions & PERMISSIONS.MANAGE_PERMISSIONS) || (newPermissions & PERMISSIONS.DATABASE_STUDIO);
    if (grantsHighPerm && !isSuperAdmin(profile)) {
      throw new HttpError(403, '只有最高超级管理员才可分配二次权限管理或 SQL 数据库控制台开关');
    }

    const db = requireDb(env);
    const now = new Date().toISOString();
    const newRole = newPermissions > 1 ? 'admin' : 'normal';

    await db.prepare(`
      UPDATE users SET permissions = ?, role = ?, updated_at = ? WHERE id = ?
    `).bind(newPermissions, newRole, now, targetUserId).run();

    // 记录审计日志
    await db.prepare(`
      INSERT INTO mod_log (id, operator_id, action, target_type, target_id, details, created_at)
      VALUES (?, ?, 'update_permissions', 'user', ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      profile.id,
      targetUserId,
      `修改权限为 ${newPermissions} (0b${newPermissions.toString(2)})`,
      now
    ).run().catch(() => {});

    return json({
      success: true,
      message: `已成功设置用户 ${targetUserId} 的二进制权限开关`,
      targetUserId,
      permissions: newPermissions
    });

  } catch (err) {
    return errorResponse(err, '更新权限开关失败');
  }
}

export function onRequestPatch() { return methodNotAllowed(['GET', 'POST']); }
export function onRequestDelete() { return methodNotAllowed(['GET', 'POST']); }
