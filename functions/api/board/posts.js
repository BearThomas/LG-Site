// functions/api/board/posts.js
// Manage posts inside a board (list, delete, migrate).
import { requireAuth } from '../../_lib/auth.js';
import {
  getPostRow,
  isAdmin,
  normalizeUserId,
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

    // 1. Validate board exists and caller owns it or is admin
    const board = await db.prepare(`SELECT * FROM boards WHERE id = ? AND status = 0 LIMIT 1`).bind(boardId).first();
    if (!board) throw new HttpError(404, '板块未找到或已被删除');

    if (normalizeUserId(board.owner_id) !== userId && !isAdmin(auth.profile)) {
      throw new HttpError(403, '你不是板块主理人，无权管理该板块内的帖子');
    }

    // 2. Query posts in this board
    const postsResult = await db.prepare(`
      SELECT id, title, author_name, created_at, comment_count
      FROM posts
      WHERE board_id = ?
      ORDER BY created_at DESC
    `).bind(boardId).all();

    const posts = (postsResult.results || []).map(p => ({
      id: p.id,
      title: p.title,
      authorName: p.author_name,
      commentCount: Number(p.comment_count || 0),
      createdAt: p.created_at
    }));

    return json({ success: true, posts });
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', route: '/api/board/posts', method: 'GET', message: error.message }));
    return errorResponse(error, '获取板块帖子列表失败');
  }
}

export async function onRequestDelete({ request, env }) {
  try {
    const body = await readJsonBody(request);
    const { profile } = await requireAuth(request, env, body);
    const userId = normalizeUserId(profile.id);
    const db = requireDb(env);

    const postId = String(body.postId || '').trim();
    if (!postId) throw new HttpError(400, '未指定要删除的帖子 ID');

    // 1. Fetch post metadata
    const post = await getPostRow(env, postId);
    if (!post) throw new HttpError(404, '该帖子不存在');

    // 2. Fetch board metadata to verify if caller is board owner
    const board = await db.prepare(`SELECT * FROM boards WHERE id = ? LIMIT 1`).bind(post.board_id).first();

    const isBoardOwner = board && normalizeUserId(board.owner_id) === userId;
    const isPostAuthor = normalizeUserId(post.author_id) === userId;

    if (!isBoardOwner && !isPostAuthor && !isAdmin(profile)) {
      throw new HttpError(403, '无权删除此贴（仅限作者、版主或管理员）');
    }

    // 3. Batch delete post and decrement board post_count (if custom board)
    const statements = [
      db.prepare('DELETE FROM posts WHERE id = ?').bind(postId),
      db.prepare('DELETE FROM likes WHERE post_id = ?').bind(postId),
      db.prepare('DELETE FROM comments WHERE post_id = ?').bind(postId)
    ];

    const isCustomBoard = board && post.board_id !== 'main' && !post.board_id.startsWith('class_');
    if (isCustomBoard) {
      statements.push(
        db.prepare('UPDATE boards SET post_count = MAX(0, post_count - 1) WHERE id = ?').bind(post.board_id)
      );
    }

    await db.batch(statements);

    return json({ success: true, deletedPostId: postId });
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', route: '/api/board/posts', method: 'DELETE', message: error.message }));
    return errorResponse(error, '删除帖子失败');
  }
}

export async function onRequestPatch({ request, env }) {
  try {
    const body = await readJsonBody(request);
    const { profile } = await requireAuth(request, env, body);
    const userId = normalizeUserId(profile.id);
    const db = requireDb(env);

    const postId = String(body.postId || '').trim();
    const targetBoardId = String(body.targetBoardId || '').trim();

    if (!postId || !targetBoardId) throw new HttpError(400, '帖子 ID 或目标板块 ID 不能为空');

    // 1. Fetch post metadata
    const post = await getPostRow(env, postId);
    if (!post) throw new HttpError(404, '帖子不存在');

    const sourceBoardId = post.board_id;
    if (sourceBoardId === targetBoardId) {
      return json({ success: true, message: '帖子已经在该板块中', postId });
    }

    // 2. Fetch source board and target board metadata
    const [sourceBoard, targetBoard] = await Promise.all([
      db.prepare(`SELECT * FROM boards WHERE id = ? LIMIT 1`).bind(sourceBoardId).first(),
      db.prepare(`SELECT * FROM boards WHERE id = ? AND status = 0 LIMIT 1`).bind(targetBoardId).first()
    ]);

    // Validation: caller must own source board or be admin
    const isSourceBoardOwner = sourceBoard && normalizeUserId(sourceBoard.owner_id) === userId;
    if (!isSourceBoardOwner && !isAdmin(profile)) {
      throw new HttpError(403, '你不是原板块主理人，无法迁移此贴');
    }

    // Validation: target board must exist if custom (or be main/class board)
    const isTargetCustom = targetBoardId !== 'main' && !targetBoardId.startsWith('class_');
    if (isTargetCustom && !targetBoard) {
      throw new HttpError(404, '目标板块不存在或已被禁用');
    }

    // 3. Batch migration updates
    const statements = [
      db.prepare(`UPDATE posts SET board_id = ?, updated_at = ? WHERE id = ?`).bind(targetBoardId, new Date().toISOString(), postId)
    ];

    // Decrement source if it was custom
    const isSourceCustom = sourceBoardId !== 'main' && !sourceBoardId.startsWith('class_');
    if (isSourceCustom && sourceBoard) {
      statements.push(
        db.prepare('UPDATE boards SET post_count = MAX(0, post_count - 1) WHERE id = ?').bind(sourceBoardId)
      );
    }

    // Increment target if it is custom
    if (isTargetCustom && targetBoard) {
      statements.push(
        db.prepare('UPDATE boards SET post_count = post_count + 1 WHERE id = ?').bind(targetBoardId)
      );
    }

    await db.batch(statements);

    return json({ success: true, migrated: true, postId, sourceBoardId, targetBoardId });
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', route: '/api/board/posts', method: 'PATCH', message: error.message }));
    return errorResponse(error, '迁移帖子失败');
  }
}

export function onRequestPost() { return methodNotAllowed(['GET', 'DELETE', 'PATCH']); }
