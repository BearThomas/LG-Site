import { requireAuth } from '../_lib/auth.js';
import { requireDb, hasPermission, isSuperAdmin, PERMISSIONS, SUPER_ADMIN_ID } from '../_lib/db.js';
import { errorResponse, HttpError, json, methodNotAllowed, readJsonBody } from '../_lib/http.js';

const ALLOWED_TABLES = ['users', 'posts', 'comments', 'confessions', 'events', 'notifications', 'mod_log', 'migration_orphans', 'push_subscriptions'];

export async function onRequestGet({ request, env }) {
  try {
    const { profile } = await requireAuth(request, env);
    if (!hasPermission(profile, PERMISSIONS.DATABASE_STUDIO)) {
      throw new HttpError(403, '权限不足，无法访问数据库控制台');
    }

    const db = requireDb(env);
    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    if (action === 'tables') {
      return json({ tables: ALLOWED_TABLES });
    }

    const table = String(url.searchParams.get('table') || '').trim();
    if (!table || !ALLOWED_TABLES.includes(table)) {
      throw new HttpError(400, '必须指定合法的表名');
    }

    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 20), 1), 100);
    const offset = Math.max(Number(url.searchParams.get('offset') || 0), 0);

    const [rows, countRes] = await Promise.all([
      db.prepare(`SELECT * FROM ${table} LIMIT ? OFFSET ?`).bind(limit, offset).all(),
      db.prepare(`SELECT COUNT(*) as total FROM ${table}`).first()
    ]);

    return json({
      table,
      rows: rows.results || [],
      total: Number(countRes?.total || 0),
      limit,
      offset
    });
  } catch (err) {
    return errorResponse(err, '读取数据表失败');
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await readJsonBody(request);
    const { profile } = await requireAuth(request, env, body);

    if (!hasPermission(profile, PERMISSIONS.DATABASE_STUDIO)) {
      throw new HttpError(403, '权限不足，无法执行数据库控制操作');
    }

    const db = requireDb(env);
    const action = String(body.action || '').trim();
    const now = new Date().toISOString();

    if (action === 'exec_sql') {
      const sql = String(body.sql || '').trim();
      if (!sql) throw new HttpError(400, '请输入要执行的 SQL 语句');

      // 高危关键字判断
      const isDangerous = /\b(UPDATE|DELETE|DROP|ALTER|TRUNCATE|INSERT|REPLACE)\b/i.test(sql);
      if (isDangerous) {
        const expectedConfirm = String(body.expectedConfirm || '').trim();
        const userConfirm = String(body.confirmCode || '').trim();
        if (!expectedConfirm || userConfirm !== expectedConfirm) {
          throw new HttpError(403, `高危操作二次确认校验失败！需要准确输入确认码: "${expectedConfirm}"`);
        }
      }

      // 执行 SQL
      let queryResult;
      if (sql.toUpperCase().startsWith('SELECT') || sql.toUpperCase().startsWith('PRAGMA')) {
        const res = await db.prepare(sql).all();
        queryResult = { rows: res.results || [], count: (res.results || []).length };
      } else {
        const res = await db.prepare(sql).run();
        queryResult = { success: res.success, changes: res.meta?.changes ?? 0 };
      }

      // 记录审计日志
      await db.prepare(`
        INSERT INTO mod_log (id, operator_id, action, target_type, target_id, details, created_at)
        VALUES (?, ?, 'exec_sql', 'database', 'sql_terminal', ?, ?)
      `).bind(
        crypto.randomUUID(),
        profile.id,
        `执行 SQL (${isDangerous ? '高危' : '普通'}): ${sql.slice(0, 500)}`,
        now
      ).run().catch(() => {});

      return json({
        success: true,
        isDangerous,
        result: queryResult
      });
    }

    if (action === 'delete_row') {
      const table = String(body.table || '').trim();
      const primaryKey = String(body.primaryKey || 'id').trim();
      const idVal = body.idValue;

      if (!ALLOWED_TABLES.includes(table)) throw new HttpError(400, '不可操作的受保护数据表');
      if (!idVal) throw new HttpError(400, '缺失删除行主键值');

      const expectedConfirm = String(body.expectedConfirm || '').trim();
      const userConfirm = String(body.confirmCode || '').trim();
      if (!expectedConfirm || userConfirm !== expectedConfirm) {
        throw new HttpError(403, `删除高危确认码不匹配！需要准确输入: "${expectedConfirm}"`);
      }

      const res = await db.prepare(`DELETE FROM ${table} WHERE ${primaryKey} = ?`).bind(idVal).run();

      await db.prepare(`
        INSERT INTO mod_log (id, operator_id, action, target_type, target_id, details, created_at)
        VALUES (?, ?, 'delete_row', table, String(idVal), ?, ?)
      `).bind(
        crypto.randomUUID(),
        profile.id,
        `从 ${table} 删除主键 ${primaryKey}=${idVal} 的行`,
        now
      ).run().catch(() => {});

      return json({ success: true, changes: res.meta?.changes ?? 0 });
    }

    throw new HttpError(400, '未知的操作类型');

  } catch (err) {
    return errorResponse(err, '数据库控制台操作失败');
  }
}

export function onRequestPatch() { return methodNotAllowed(['GET', 'POST']); }
export function onRequestDelete() { return methodNotAllowed(['GET', 'POST']); }
