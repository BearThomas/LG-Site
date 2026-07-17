import { optionalAuth, requireAuth } from '../_lib/auth.js';
import {
  canViewPost,
  getPostRow,
  getUserRow,
  isAdmin,
  normalizeUserId,
  parseJsonArray,
  requireDb,
  toConfessionDocument,
  toPostDocument,
  toUserDocument
} from '../_lib/db.js';
import { errorResponse, HttpError, json, methodNotAllowed, readJsonBody } from '../_lib/http.js';

const COLLECTIONS = new Set(['users', 'posts', 'confessions', 'comments']);

function parseQueries(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    throw new HttpError(400, '查询参数格式不正确');
  }
}

function queryState(queries) {
  const state = { equals: new Map(), limit: 25, offset: 0, order: null };
  for (const query of queries) {
    if (!query || typeof query !== 'object') continue;
    if (query.method === 'equal' && query.attribute) {
      state.equals.set(String(query.attribute), Array.isArray(query.values) ? query.values : []);
    } else if (query.method === 'limit') {
      state.limit = Math.min(100, Math.max(1, Number(query.values?.[0] || 25)));
    } else if (query.method === 'offset') {
      state.offset = Math.max(0, Number(query.values?.[0] || 0));
    } else if (query.method === 'orderDesc' || query.method === 'orderAsc') {
      state.order = { attribute: String(query.attribute || ''), direction: query.method === 'orderAsc' ? 'ASC' : 'DESC' };
    }
  }
  return state;
}

async function listUsers(env, state, viewer) {
  const db = requireDb(env);
  const conditions = [];
  const values = [];
  const equalId = state.equals.get('userId') || state.equals.get('$id');
  if (equalId?.length) {
    const ids = equalId.map(normalizeUserId).filter(Boolean);
    if (!ids.length) return { total: 0, documents: [] };
    conditions.push(`id IN (${ids.map(() => '?').join(', ')})`);
    values.push(...ids);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const countStatement = db.prepare(`SELECT COUNT(*) AS total FROM users ${where}`).bind(...values);
  const rowsStatement = db.prepare(`
    SELECT * FROM users
    ${where}
    ORDER BY created_at ASC
    LIMIT ? OFFSET ?
  `).bind(...values, state.limit, state.offset);
  const [countResult, rowsResult] = await db.batch([countStatement, rowsStatement]);
  const total = Number(countResult.results?.[0]?.total || 0);
  const documents = (rowsResult.results || []).map(row => toUserDocument(row, {
    includePrivate: Boolean(viewer && (isAdmin(viewer) || normalizeUserId(viewer.id) === normalizeUserId(row.id)))
  }));
  return { total, documents };
}

function appendPostVisibility(conditions, values, viewer) {
  if (viewer && isAdmin(viewer)) return;
  if (!viewer) {
    conditions.push('view_permission = 1');
    return;
  }

  const visibility = ['view_permission = 1', 'author_id = ?'];
  values.push(normalizeUserId(viewer.id));
  const boards = parseJsonArray(viewer.joined_boards).map(String).filter(Boolean);
  if (boards.length) {
    visibility.push(`(view_permission = 2 AND board_id IN (${boards.map(() => '?').join(', ')}))`);
    values.push(...boards);
  }
  const targets = [normalizeUserId(viewer.id), ...boards];
  if (targets.length) {
    visibility.push(`(
      view_permission = 4 AND EXISTS (
        SELECT 1 FROM json_each(posts.target_groups)
        WHERE CAST(json_each.value AS TEXT) IN (${targets.map(() => '?').join(', ')})
      )
    )`);
    values.push(...targets);
  }
  conditions.push(`(${visibility.join(' OR ')})`);
}

async function listPosts(env, state, viewer) {
  const db = requireDb(env);
  const conditions = [];
  const values = [];
  const boardValues = state.equals.get('boardId');
  if (boardValues?.length) {
    // Validate board membership access
    for (const bId of boardValues) {
      const bIdStr = String(bId);
      if (bIdStr !== 'main') {
        if (!viewer) throw new HttpError(403, '请先登录以访问该板块');
        if (!isAdmin(viewer)) {
          if (bIdStr.startsWith('class_')) {
            const userClassBoard = viewer.id && /^\d{6,12}$/.test(viewer.id)
              ? `class_${viewer.id.slice(0, 4)}_${viewer.id.slice(4, 6)}`
              : null;
            if (bIdStr !== userClassBoard) throw new HttpError(403, '你不是该班级成员，无权查看');
          } else {
            const joined = parseJsonArray(viewer.joined_boards);
            if (!joined.includes(bIdStr)) throw new HttpError(403, '你尚未加入该板块，无权查看内容');
          }
        }
      }
    }

    const hasMain = boardValues.map(String).includes('main');
    if (hasMain) {
      conditions.push(`(board_id IN (${boardValues.map(() => '?').join(', ')}) OR board_id IS NULL OR board_id = '')`);
    } else {
      conditions.push(`board_id IN (${boardValues.map(() => '?').join(', ')})`);
    }
    values.push(...boardValues.map(String));
  }

  // Support authorId filter for "my footprint" feature
  const authorValues = state.equals.get('authorId');
  if (authorValues?.length) {
    // Normalize: strip 'student_' prefix to match DB storage format
    const normalizedAuthors = [...new Set(
      authorValues.map(v => String(v).replace(/^student_/, ''))
    )].filter(Boolean);
    if (!normalizedAuthors.length) return { total: 0, documents: [] };
    conditions.push(`author_id IN (${normalizedAuthors.map(() => '?').join(', ')})`);
    values.push(...normalizedAuthors);
  }

  appendPostVisibility(conditions, values, viewer);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const orderColumn = state.order?.attribute === 'title' ? 'title' : 'created_at';
  const orderDirection = state.order?.direction || 'DESC';

  const countStatement = db.prepare(`SELECT COUNT(*) AS total FROM posts ${where}`).bind(...values);
  const viewerId = viewer ? normalizeUserId(viewer.id) : '';
  const rowsStatement = db.prepare(`
    SELECT posts.*,
      (SELECT COUNT(*) FROM likes WHERE likes.post_id = posts.id) AS likes,
      (SELECT COUNT(*) FROM likes WHERE likes.post_id = posts.id AND likes.user_id = ?) AS liked
    FROM posts
    ${where}
    ORDER BY ${orderColumn} ${orderDirection}
    LIMIT ? OFFSET ?
  `).bind(viewerId, ...values, state.limit, state.offset);
  const [countResult, rowsResult] = await db.batch([countStatement, rowsStatement]);
  return {
    total: Number(countResult.results?.[0]?.total || 0),
    documents: (rowsResult.results || []).map(toPostDocument)
  };
}

async function listComments(env, state, viewer) {
  const db = requireDb(env);
  const conditions = [];
  const values = [];

  // Support authorId filter for "my footprint" feature
  const authorValues = state.equals.get('authorId');
  if (authorValues?.length) {
    const normalizedAuthors = [...new Set(
      authorValues.map(v => String(v).replace(/^student_/, ''))
    )].filter(Boolean);
    if (!normalizedAuthors.length) return { total: 0, documents: [] };
    conditions.push(`author_id IN (${normalizedAuthors.map(() => '?').join(', ')})`);
    values.push(...normalizedAuthors);
  }

  const postIdValues = state.equals.get('postId');
  if (postIdValues?.length) {
    conditions.push(`post_id IN (${postIdValues.map(() => '?').join(', ')})`);
    values.push(...postIdValues.map(String));
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const orderDirection = state.order?.direction || 'DESC';

  const countStatement = db.prepare(`SELECT COUNT(*) AS total FROM comments ${where}`).bind(...values);
  const rowsStatement = db.prepare(`
    SELECT * FROM comments
    ${where}
    ORDER BY created_at ${orderDirection}
    LIMIT ? OFFSET ?
  `).bind(...values, state.limit, state.offset);
  const [countResult, rowsResult] = await db.batch([countStatement, rowsStatement]);
  return {
    total: Number(countResult.results?.[0]?.total || 0),
    documents: (rowsResult.results || []).map(row => ({
      $id: row.id,
      $createdAt: row.created_at,
      postId: row.post_id,
      content: row.content,
      authorId: row.author_id,
      authorName: row.author_name || ('同学' + String(row.author_id || '').slice(-4))
    }))
  };
}

async function listConfessions(env, state, viewer) {
  const db = requireDb(env);
  const conditions = [];
  const values = [];
  const statuses = state.equals.get('status');
  if (!viewer || !isAdmin(viewer)) {
    // Hidden/rejected confessions are never exposed to ordinary visitors,
    // even if a client omits or tampers with the status query.
    conditions.push('status = 0');
  } else if (statuses?.length) {
    conditions.push(`status IN (${statuses.map(() => '?').join(', ')})`);
    values.push(...statuses.map(value => Number(value)));
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const orderColumn = state.order?.attribute === 'likes' ? 'likes' : 'created_at';
  const orderDirection = state.order?.direction || 'DESC';
  const countStatement = db.prepare(`SELECT COUNT(*) AS total FROM confessions ${where}`).bind(...values);
  const rowsStatement = db.prepare(`
    SELECT * FROM confessions
    ${where}
    ORDER BY ${orderColumn} ${orderDirection}
    LIMIT ? OFFSET ?
  `).bind(...values, state.limit, state.offset);
  const [countResult, rowsResult] = await db.batch([countStatement, rowsStatement]);
  return {
    total: Number(countResult.results?.[0]?.total || 0),
    documents: (rowsResult.results || []).map(row => toConfessionDocument(row, viewer))
  };
}

async function getDocument(env, collection, documentId, viewer) {
  if (collection === 'users') {
    const row = await getUserRow(env, documentId);
    if (!row) throw new HttpError(404, '用户不存在');
    return toUserDocument(row, {
      includePrivate: Boolean(viewer && (isAdmin(viewer) || normalizeUserId(viewer.id) === normalizeUserId(row.id)))
    });
  }
  if (collection === 'posts') {
    const db = requireDb(env);
    const viewerId = viewer ? normalizeUserId(viewer.id) : '';
    const row = await db.prepare(`
      SELECT posts.*,
        (SELECT COUNT(*) FROM likes WHERE likes.post_id = posts.id) AS likes,
        (SELECT COUNT(*) FROM likes WHERE likes.post_id = posts.id AND likes.user_id = ?) AS liked
      FROM posts
      WHERE id = ? LIMIT 1
    `).bind(viewerId, documentId).first();
    if (!row) throw new HttpError(404, '帖子不存在');
    if (!canViewPost(row, viewer)) throw new HttpError(403, '无权查看该帖子');
    return toPostDocument(row);
  }
  if (collection === 'confessions') {
    const row = await requireDb(env)
      .prepare('SELECT * FROM confessions WHERE id = ? LIMIT 1')
      .bind(documentId)
      .first();
    if (!row) throw new HttpError(404, '内容不存在');
    if (Number(row.status || 0) !== 0 && !(viewer && isAdmin(viewer))) {
      throw new HttpError(404, '内容不存在');
    }
    return toConfessionDocument(row, viewer);
  }
  throw new HttpError(400, '不支持的数据集合');
}

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const collection = String(url.searchParams.get('collection') || '');
    if (!COLLECTIONS.has(collection)) throw new HttpError(400, '不支持的数据集合');
    const auth = await optionalAuth(request, env);
    const viewer = auth?.profile || null;
    const documentId = url.searchParams.get('documentId');
    if (documentId) return json(await getDocument(env, collection, documentId, viewer));

    const state = queryState(parseQueries(url.searchParams.get('queries')));
    if (collection === 'users') return json(await listUsers(env, state, viewer));
    if (collection === 'posts') return json(await listPosts(env, state, viewer));
    if (collection === 'comments') return json(await listComments(env, state, viewer));
    return json(await listConfessions(env, state, viewer));
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', route: '/api/data', method: 'GET', message: error.message, status: error.status }));
    return errorResponse(error, '读取数据失败');
  }
}

export async function onRequestPatch({ request, env }) {
  try {
    const body = await readJsonBody(request);
    if (body.collection !== 'posts') throw new HttpError(400, '该集合不支持编辑');
    const { profile } = await requireAuth(request, env, body);
    let post = await getPostRow(env, body.documentId);
    let isCold = false;
    if (!post) {
      const url = new URL('/public/data-backups/posts.json', request.url);
      const res = await env.ASSETS.fetch(new Request(url));
      if (res.ok) {
        const backup = await res.json();
        const rawPosts = backup.documents || backup || [];
        post = rawPosts.find(p => p.id === body.documentId || p.$id === body.documentId);
        if (post) isCold = true;
      }
    }
    if (!post) throw new HttpError(404, '帖子不存在');
    if (isCold) {
      post.author_id = post.authorId || post.author_id;
      post.id = post.$id || post.id;
    }
    
    if (!isAdmin(profile) && normalizeUserId(post.author_id) !== normalizeUserId(profile.id)) {
      throw new HttpError(403, '只能编辑自己的帖子');
    }

    const title = String(body.data?.title ?? post.title).trim();
    const content = String(body.data?.content ?? post.content).trim();
    if (!title || !content) throw new HttpError(400, '标题和正文不能为空');
    if (title.length > 100) throw new HttpError(400, '标题不能超过 100 个字符');
    if (content.length > 20_000) throw new HttpError(400, '正文不能超过 20000 个字符');
    const now = new Date().toISOString();
    
    if (!isCold) {
      await requireDb(env).prepare(`
        UPDATE posts
        SET title = ?, content = ?, edited_at = ?, updated_at = ?
        WHERE id = ?
      `).bind(title, content, now, now, post.id).run();
    }
    
    // Record edit in mod_log for synchronization with backup JSONs
    await requireDb(env).prepare(`
      INSERT INTO mod_log (collection, item_id, action, payload)
      VALUES (?, ?, 'edit', ?)
    `).bind('posts', post.id, JSON.stringify({ title, content, edited_at: now })).run();
    
    return json({ 
      success: true, 
      id: post.id,
      title,
      content,
      edited_at: now
    });
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', route: '/api/data', method: 'PATCH', message: error.message, status: error.status }));
    return errorResponse(error, '编辑帖子失败');
  }
}

export async function onRequestDelete({ request, env }) {
  try {
    const body = await readJsonBody(request);
    const collection = body.collection || 'posts';
    if (collection !== 'posts' && collection !== 'confessions') {
      throw new HttpError(400, '该集合不支持删除');
    }
    const { profile } = await requireAuth(request, env, body);
    const db = requireDb(env);

    if (collection === 'confessions') {
      if (!isAdmin(profile)) throw new HttpError(403, '仅管理员可以删除表白');
      const confessionId = String(body.documentId || '').trim();
      if (!confessionId) throw new HttpError(400, '缺少表白 ID');
      
      await db.prepare('DELETE FROM confessions WHERE id = ?').bind(confessionId).run();
      await db.prepare(`INSERT INTO mod_log (collection, item_id, action) VALUES (?, ?, 'delete')`)
        .bind('confessions', confessionId)
        .run();
      return json({ success: true });
    }

    let post = await getPostRow(env, body.documentId);
    let isCold = false;
    if (!post) {
      if (isAdmin(profile)) {
        await db.prepare(`INSERT INTO mod_log (collection, item_id, action) VALUES (?, ?, 'delete')`)
          .bind('posts', String(body.documentId))
          .run();
        return json({ success: true, tombstoned: true });
      }
      
      const url = new URL('/public/data-backups/posts.json', request.url);
      const res = await env.ASSETS.fetch(new Request(url));
      if (res.ok) {
        const backup = await res.json();
        const rawPosts = backup.documents || backup || [];
        post = rawPosts.find(p => p.id === body.documentId || p.$id === body.documentId);
        if (post) isCold = true;
      }
    }
    
    if (!post) throw new HttpError(404, '帖子不存在');
    
    if (isCold) {
      post.author_id = post.authorId || post.author_id;
      post.id = post.$id || post.id;
    }
    
    if (!isAdmin(profile) && normalizeUserId(post.author_id) !== normalizeUserId(profile.id)) {
      throw new HttpError(403, '只能删除自己的帖子');
    }
    if (!isCold) {
      await db.prepare('DELETE FROM posts WHERE id = ?').bind(post.id).run();
    }
    
    await db.prepare(`INSERT INTO mod_log (collection, item_id, action) VALUES (?, ?, 'delete')`)
      .bind('posts', post.id)
      .run();
      
    return json({ success: true });
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', route: '/api/data', method: 'DELETE', message: error.message, status: error.status }));
    return errorResponse(error, '删除帖子失败');
  }
}

export function onRequestPost() {
  return methodNotAllowed(['GET', 'PATCH', 'DELETE']);
}
