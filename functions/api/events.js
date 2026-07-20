import { requireDb, HttpError } from './data.js';

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method;

  try {
    const db = requireDb(env);
    
    // GET: 获取所有已发布的大事记
    if (method === 'GET') {
      const stmt = db.prepare(`SELECT * FROM events WHERE status = 'published' ORDER BY date DESC, created_at DESC`);
      const result = await stmt.all();
      return new Response(JSON.stringify(result.results || []), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response('Method Not Allowed', { status: 405 });
  } catch (err) {
    const status = err.status || 500;
    return new Response(JSON.stringify({ error: err.message }), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
