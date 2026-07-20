import { HttpError } from './http.js';

export function requireDb(env) {
  if (!env?.DB) {
    const error = new HttpError(500, 'Cloudflare D1 绑定 DB 尚未配置');
    error.expose = true;
    throw error;
  }
  return env.DB;
}

export function normalizeUserId(value) {
  return String(value || '').trim().replace(/^student_/, '');
}

export function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function extractClass(studentId) {
  const id = normalizeUserId(studentId);
  if (!/^\d{6,12}$/.test(id)) return '';
  return `${id.slice(0, 4)}级${id.slice(4, 6)}班`;
}

export async function getUserRow(env, userId) {
  const id = normalizeUserId(userId);
  if (!id) return null;
  return requireDb(env)
    .prepare('SELECT * FROM users WHERE id = ? LIMIT 1')
    .bind(id)
    .first();
}

export async function ensureUserRow(env, identity, defaults = {}) {
  const db = requireDb(env);
  const appwriteId = String(identity?.$id || identity?.id || defaults.appwriteUserId || '').trim();
  const accountEmail = String(identity?.email || defaults.email || '').trim();
  const emailStudentId = accountEmail.toLowerCase().endsWith('@campus.local')
    ? accountEmail.slice(0, -'@campus.local'.length)
    : '';
  const id = normalizeUserId(defaults.userId || emailStudentId || appwriteId);
  if (!id) throw new HttpError(400, '用户 ID 无效');

  const now = new Date().toISOString();
  const parseDate = (val, fallback) => {
    if (!val || String(val).trim() === '') return fallback;
    const d = new Date(val);
    return Number.isNaN(d.getTime()) ? fallback : d.toISOString();
  };
  const rawCreatedAt = defaults.createdAt || identity?.$createdAt || identity?.registration || identity?.created_at;
  const rawUpdatedAt = defaults.updatedAt || identity?.$updatedAt || identity?.updated_at;
  const createdAt = parseDate(rawCreatedAt, now);
  const updatedAt = parseDate(rawUpdatedAt, now);

  const name = String(defaults.name || identity?.name || `同学${id.slice(-4)}`).trim().slice(0, 128) || `同学${id.slice(-4)}`;
  const email = String(defaults.email || identity?.email || `${id}@campus.local`).trim();
  const className = String(defaults.className || extractClass(id));
  const inferredClassBoard = /^\d{6,12}$/.test(id)
    ? `class_${id.slice(0, 4)}_${id.slice(4, 6)}`
    : '';
  const joinedBoards = JSON.stringify(
    defaults.joinedBoards || ['main', inferredClassBoard].filter(Boolean)
  );
  const ownedBoards = JSON.stringify(defaults.ownedBoards || []);

  await db.prepare(`
    INSERT INTO users (
      id, appwrite_user_id, name, avatar, email, role, permissions,
      joined_boards, owned_boards, class_name, muted_until, banned,
      token_version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      appwrite_user_id = excluded.appwrite_user_id,
      name = CASE
        WHEN users.name = '' OR users.name = ('同学' || substr(users.id, -4)) THEN excluded.name
        ELSE users.name
      END,
      email = CASE WHEN users.email = '' THEN excluded.email ELSE users.email END,
      class_name = CASE WHEN users.class_name = '' THEN excluded.class_name ELSE users.class_name END,
      joined_boards = CASE
        WHEN users.joined_boards IN ('[]', '["main"]') THEN excluded.joined_boards
        ELSE users.joined_boards
      END,
      updated_at = excluded.updated_at
  `).bind(
    id,
    appwriteId || id,
    name,
    defaults.avatar || null,
    email,
    defaults.role || 'normal',
    Number(defaults.permissions ?? 31),
    joinedBoards,
    ownedBoards,
    className,
    defaults.mutedUntil || null,
    defaults.banned ? 1 : 0,
    createdAt,
    updatedAt
  ).run();

  return getUserRow(env, id);
}

export function isAdmin(profile) {
  return profile?.role === 'admin';
}

export function toUserDocument(row, { includePrivate = false } = {}) {
  if (!row) return null;
  const document = {
    $id: row.id,
    $createdAt: row.created_at,
    $updatedAt: row.updated_at,
    userId: row.id,
    name: row.name,
    avatar: row.avatar || '',
    role: row.role || 'normal'
  };
  if (includePrivate) {
    Object.assign(document, {
      email: row.email || '',
      permissions: Number(row.permissions || 0),
      joinedBoards: parseJsonArray(row.joined_boards),
      ownedBoards: parseJsonArray(row.owned_boards),
      class: row.class_name || '',
      mutedUntil: row.muted_until || null,
      banned: Boolean(row.banned)
    });
  }
  return document;
}

export function toPostDocument(row) {
  if (!row) return null;
  return {
    $id: row.id,
    $createdAt: row.created_at,
    $updatedAt: row.updated_at,
    boardId: row.board_id || 'main',
    title: row.title,
    content: row.content,
    authorId: `student_${normalizeUserId(row.author_id)}`,
    authorName: row.author_name,
    viewPermission: Number(row.view_permission || 1),
    targetGroups: parseJsonArray(row.target_groups),
    status: Number(row.status || 0),
    editedAt: row.edited_at || null,
    commentCount: Number(row.comment_count || 0),
    likes: Number(row.likes || 0),
    liked: Boolean(row.liked)
  };
}

export function toCommentDocument(row) {
  if (!row) return null;
  return {
    $id: row.id,
    $createdAt: row.created_at,
    $updatedAt: row.updated_at,
    postId: row.post_id,
    content: row.content,
    authorId: normalizeUserId(row.author_id),
    authorName: row.author_name
  };
}

export function toConfessionDocument(row, viewer = null) {
  if (!row) return null;
  const maySeeAuthor = viewer && (isAdmin(viewer) || normalizeUserId(viewer.id) === normalizeUserId(row.author_id));
  return {
    $id: row.id,
    $createdAt: row.created_at,
    $updatedAt: row.updated_at,
    content: row.content,
    authorId: maySeeAuthor ? normalizeUserId(row.author_id) : '',
    authorName: maySeeAuthor ? row.author_name : '匿名',
    toName: row.to_name || null,
    status: Number(row.status || 0),
    likes: Number(row.likes || 0)
  };
}

export async function getPostRow(env, postId) {
  if (!postId) return null;
  return requireDb(env)
    .prepare('SELECT * FROM posts WHERE id = ? LIMIT 1')
    .bind(String(postId))
    .first();
}

export function canViewPost(post, viewer) {
  if (!post) return false;
  const permission = Number(post.view_permission || 1);
  if (permission === 1) return true;
  if (!viewer) return false;
  if (isAdmin(viewer)) return true;

  const viewerId = normalizeUserId(viewer.id);
  if (normalizeUserId(post.author_id) === viewerId) return true;
  if (permission === 8) return false;

  const joinedBoards = parseJsonArray(viewer.joined_boards);
  if (permission === 2) return joinedBoards.includes(post.board_id || 'main');
  if (permission === 4) {
    const targets = parseJsonArray(post.target_groups).map(String);
    return targets.includes(viewerId) || targets.some(target => joinedBoards.includes(target || 'main'));
  }
  return false;
}

export function localDayStartIso(offsetMinutes = 480, nowMs = Date.now()) {
  const shifted = new Date(nowMs + offsetMinutes * 60_000);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - offsetMinutes * 60_000).toISOString();
}
