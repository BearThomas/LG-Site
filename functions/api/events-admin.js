import { requireAuth } from '../_lib/auth.js';
import { requireDb, isAdmin } from '../_lib/db.js';
import { errorResponse, HttpError, json, methodNotAllowed, readJsonBody } from '../_lib/http.js';

export async function onRequestPost({ request, env }) {
  try {
    const body = await readJsonBody(request);
    const { profile } = await requireAuth(request, env, body);
    if (!isAdmin(profile)) {
      throw new HttpError(403, '需要管理员权限');
    }

    const db = requireDb(env);
    
    // POST: 审核通过/拒绝/列表获取
    if (request.method === 'POST') {
      const { id, action, title, desc, tag, date, link } = body;
      
      if (action === 'list') {
        const stmt = db.prepare(`SELECT * FROM events WHERE status = 'pending_admin' ORDER BY created_at DESC`);
        const result = await stmt.all();
        return json(result.results || []);
      }

      if (!id) throw new HttpError(400, '缺少事件 ID');

      if (action === 'reject') {
        const stmt = db.prepare(`UPDATE events SET status = 'rejected' WHERE id = ?`);
        await stmt.bind(id).run();
        return json({ success: true, message: '已拒绝投稿' });
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

      throw new HttpError(400, '无效的操作 action');
    }

    return methodNotAllowed();
  } catch (err) {
    return errorResponse(err, '大事记审核操作失败');
  }
}
