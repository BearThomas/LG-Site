import { requireAuth } from '../_lib/auth.js';
import { requireDb, hasPermission, PERMISSIONS } from '../_lib/db.js';
import { errorResponse, HttpError, json, methodNotAllowed, readJsonBody } from '../_lib/http.js';

export async function onRequestGet({ request, env }) {
  try {
    const { profile } = await requireAuth(request, env);
    if (!hasPermission(profile, PERMISSIONS.AUDIT_EVENTS)) {
      throw new HttpError(403, '权限不足，无法访问大事记审核系统');
    }

    const url = new URL(request.url);
    const statusFilter = String(url.searchParams.get('status') || 'pending_admin').trim();
    const db = requireDb(env);

    let sql = 'SELECT * FROM events';
    const params = [];
    if (statusFilter && statusFilter !== 'all') {
      sql += ' WHERE status = ?';
      params.push(statusFilter);
    }
    sql += ' ORDER BY created_at DESC LIMIT 100';

    const result = await db.prepare(sql).bind(...params).all();
    const eventsList = result.results || [];

    return json({
      success: true,
      events: eventsList,
      submissions: eventsList
    });
  } catch (err) {
    return errorResponse(err, '获取大事记审核列表失败');
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await readJsonBody(request);
    const { profile } = await requireAuth(request, env, body);

    if (!hasPermission(profile, PERMISSIONS.AUDIT_EVENTS)) {
      throw new HttpError(403, '需要大事记审核权限');
    }

    const db = requireDb(env);
    const { id, action, status, title, desc, tag, date, link } = body;

    // 老版格式：action = 'list'
    if (action === 'list') {
      const stmt = db.prepare(`SELECT * FROM events WHERE status = 'pending_admin' ORDER BY created_at DESC`);
      const result = await stmt.all();
      return json({ success: true, events: result.results || [], submissions: result.results || [] });
    }

    if (!id) throw new HttpError(400, '缺少事件 ID');

    // 计算最终要设定的状态
    let nextStatus = 'published';
    if (action === 'reject' || status === 'rejected') {
      nextStatus = 'rejected';
    } else if (action === 'approve' || status === 'published') {
      nextStatus = 'published';
    } else if (status) {
      nextStatus = String(status).trim();
    }

    const now = new Date().toISOString();

    if (nextStatus === 'rejected') {
      const stmt = db.prepare(`UPDATE events SET status = 'rejected' WHERE id = ?`);
      await stmt.bind(id).run();
      return json({ success: true, message: '已拒绝该大事记投稿' });
    }

    // 更新或审批发布
    // 先获取原记录以便补充字段默认值
    const existing = await db.prepare('SELECT * FROM events WHERE id = ?').bind(id).first();
    if (!existing) throw new HttpError(404, '对应的大事记记录不存在');

    const finalTitle = title !== undefined ? String(title).trim() : existing.title;
    const finalDesc = desc !== undefined ? String(desc).trim() : existing.desc;
    const finalTag = tag !== undefined ? String(tag).trim() : existing.tag;
    const finalDate = date !== undefined ? String(date).trim() : existing.date;
    const finalLink = link !== undefined ? String(link).trim() : (existing.link || '');

    const stmt = db.prepare(`
      UPDATE events 
      SET title = ?, desc = ?, tag = ?, date = ?, link = ?, status = ?
      WHERE id = ?
    `);
    await stmt.bind(finalTitle, finalDesc, finalTag, finalDate, finalLink, nextStatus, id).run();

    // 记录审计日志
    await db.prepare(`
      INSERT INTO mod_log (id, operator_id, action, target_type, target_id, details, created_at)
      VALUES (?, ?, 'audit_event', 'event', ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      profile.id,
      id,
      `大事记《${finalTitle}》审核状态设为 ${nextStatus}`,
      now
    ).run().catch(() => {});

    return json({ success: true, message: `大事记审核操作成功 (${nextStatus})` });

  } catch (err) {
    return errorResponse(err, '大事记审核操作失败');
  }
}

export function onRequestPatch() { return methodNotAllowed(['GET', 'POST']); }
export function onRequestDelete() { return methodNotAllowed(['GET', 'POST']); }
