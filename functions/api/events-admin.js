import { requireAuth } from '../_lib/auth.js';
import { requireDb, isAdmin } from '../_lib/db.js';
import { errorResponse, json, methodNotAllowed, readJsonBody } from '../_lib/http.js';

export async function onRequest({ request, env }) {
  try {
    const { profile } = await requireAuth(request, env);
    if (!isAdmin(profile)) {
      return errorResponse(403, '需要管理员权限');
    }

    const db = requireDb(env);
    
    // POST: 审核通过/拒绝/列表获取
    if (request.method === 'POST') {
      const body = await readJsonBody(request);
      const { id, action, title, desc, tag, date, link } = body;
      
      if (action === 'list') {
        const stmt = db.prepare(`SELECT * FROM events WHERE status = 'pending_admin' ORDER BY created_at DESC`);
        const result = await stmt.all();
        return json(result.results || []);
      }

      if (!id) return errorResponse(400, '缺少事件 ID');

      if (action === 'reject') {
        const stmt = db.prepare(`DELETE FROM events WHERE id = ?`);
        await stmt.bind(id).run();
        return json({ success: true, message: '已拒绝并删除' });
      }

      if (action === 'approve') {
        const stmt = db.prepare(`
          UPDATE events 
          SET title = ?, desc = ?, tag = ?, date = ?, link = ?, status = 'published'
          WHERE id = ?
        `);
        await stmt.bind(title || '', desc || '', tag || '', date || '', link || '', id).run();
        return json({ success: true, message: '已审核并发布' });
      }

      return errorResponse(400, '无效的操作 action');
    }

    return methodNotAllowed();
  } catch (err) {
    const status = err.status || 500;
    return errorResponse(status, err.message);
  }
}
