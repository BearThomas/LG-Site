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

  const userPermissions = Number(defaults.permissions ?? 31);
  const userRole = defaults.role || (userPermissions > 1 ? 'admin' : 'normal');

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
    userRole,
    userPermissions,
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

export const SUPER_ADMIN_ID = '20240338';

export const PERMISSIONS = {
  BASIC_USER: 1,         // 0b000001
  VIEW_DASHBOARD: 2,     // 0b000010
  AUDIT_EVENTS: 4,       // 0b000100
  MANAGE_USERS: 8,       // 0b001000
  MANAGE_PERMISSIONS: 16,// 0b010000
  DATABASE_STUDIO: 32    // 0b100000
};

export function isSuperAdmin(profile) {
  if (!profile) return false;
  return normalizeUserId(profile.id) === SUPER_ADMIN_ID;
}

export function hasPermission(profile, permBit) {
  if (!profile) return false;
  if (isSuperAdmin(profile)) return true;
  const userPerms = Number(profile.permissions ?? 0);
  return (userPerms & permBit) === permBit;
}

export function isAdmin(profile) {
  if (!profile) return false;
  return isSuperAdmin(profile) || profile?.role === 'admin' || hasPermission(profile, PERMISSIONS.VIEW_DASHBOARD);
}


export function toUserDocument(row, { includePrivate = false, fields = null } = {}) {
  if (!row) return null;
  const allowedFields = Array.isArray(fields) ? fields : null;
  const pick = (fieldName) => allowedFields ? allowedFields.includes(fieldName) : true;
  const document = {};
  if (pick('$id')) document.$id = row.id;
  if (pick('$createdAt')) document.$createdAt = row.created_at;
  if (pick('$updatedAt')) document.$updatedAt = row.updated_at;
  if (pick('userId')) document.userId = row.id;
  if (pick('name')) document.name = row.name;
  if (pick('avatar')) document.avatar = row.avatar || '';
  if (pick('role')) document.role = row.role || 'normal';
  if (pick('followingCount')) document.followingCount = Number(row.following_count || 0);
  if (pick('followersCount')) document.followersCount = Number(row.followers_count || 0);
  if (includePrivate) {
    if (pick('email')) document.email = row.email || '';
    if (pick('permissions')) document.permissions = Number(row.permissions || 0);
    if (pick('joinedBoards')) document.joinedBoards = parseJsonArray(row.joined_boards);
    if (pick('ownedBoards')) document.ownedBoards = parseJsonArray(row.owned_boards);
    if (pick('class')) document.class = row.class_name || '';
    if (pick('mutedUntil')) document.mutedUntil = row.muted_until || null;
    if (pick('banned')) document.banned = Boolean(row.banned);
  }
  return Object.keys(document).length ? document : null;
}

export function toPostDocument(row, fields = null) {
  if (!row) return null;
  const allowedFields = Array.isArray(fields) ? fields : null;
  const pick = (fieldName) => allowedFields ? allowedFields.includes(fieldName) : true;
  const document = {};
  if (pick('$id')) document.$id = row.id;
  if (pick('$createdAt')) document.$createdAt = row.created_at;
  if (pick('$updatedAt')) document.$updatedAt = row.updated_at;
  if (pick('boardId')) document.boardId = row.board_id || 'main';
  if (pick('title')) document.title = row.title;
  if (pick('content')) document.content = row.content;
  if (pick('authorId')) document.authorId = `student_${normalizeUserId(row.author_id)}`;
  if (pick('authorName')) document.authorName = row.author_name;
  if (pick('viewPermission')) document.viewPermission = Number(row.view_permission || 1);
  if (pick('targetGroups')) document.targetGroups = parseJsonArray(row.target_groups);
  if (pick('status')) document.status = Number(row.status || 0);
  if (pick('editedAt')) document.editedAt = row.edited_at || null;
  if (pick('commentCount')) document.commentCount = Number(row.comment_count || 0);
  if (pick('likes')) document.likes = Number(row.likes || 0);
  if (pick('liked')) document.liked = Boolean(row.liked);
  return Object.keys(document).length ? document : null;
}

export function toCommentDocument(row, fields = null) {
  if (!row) return null;
  const allowedFields = Array.isArray(fields) ? fields : null;
  const pick = (fieldName) => allowedFields ? allowedFields.includes(fieldName) : true;
  const document = {};
  if (pick('$id')) document.$id = row.id;
  if (pick('$createdAt')) document.$createdAt = row.created_at;
  if (pick('$updatedAt')) document.$updatedAt = row.updated_at;
  if (pick('postId')) document.postId = row.post_id;
  if (pick('content')) document.content = row.content;
  if (pick('authorId')) document.authorId = normalizeUserId(row.author_id);
  if (pick('authorName')) document.authorName = row.author_name;
  return Object.keys(document).length ? document : null;
}

export function toConfessionDocument(row, viewer = null, fields = null) {
  if (!row) return null;
  const allowedFields = Array.isArray(fields) ? fields : null;
  const pick = (fieldName) => allowedFields ? allowedFields.includes(fieldName) : true;
  const maySeeAuthor = viewer && (isAdmin(viewer) || normalizeUserId(viewer.id) === normalizeUserId(row.author_id));
  const document = {};
  if (pick('$id')) document.$id = row.id;
  if (pick('$createdAt')) document.$createdAt = row.created_at;
  if (pick('$updatedAt')) document.$updatedAt = row.updated_at;
  if (pick('content')) document.content = row.content;
  if (pick('authorId')) document.authorId = maySeeAuthor ? normalizeUserId(row.author_id) : '';
  if (pick('authorName')) document.authorName = maySeeAuthor ? row.author_name : '匿名';
  if (pick('toName')) document.toName = row.to_name || null;
  if (pick('status')) document.status = Number(row.status || 0);
  if (pick('likes')) document.likes = Number(row.likes || 0);
  return Object.keys(document).length ? document : null;
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
  const permission = Number(post.view_permission ?? post.viewPermission ?? 1);
  if (permission === 1) return true;
  if (!viewer) return false;
  if (isAdmin(viewer)) return true;

  const viewerId = normalizeUserId(viewer.id);
  const authorId = normalizeUserId(post.author_id ?? post.authorId ?? '');
  if (authorId && authorId === viewerId) return true;
  if (permission === 8) return false;

  const boardId = String(post.board_id ?? post.boardId ?? 'main');
  const joinedBoards = parseJsonArray(viewer.joined_boards);
  if (permission === 2) return joinedBoards.includes(boardId);
  if (permission === 4) {
    const rawTargets = post.target_groups ?? post.targetGroups ?? [];
    const targets = (Array.isArray(rawTargets) ? rawTargets : parseJsonArray(rawTargets)).map(String);
    return targets.includes(viewerId) || targets.some(target => joinedBoards.includes(target || 'main'));
  }
  return false;
}

export function localDayStartIso(offsetMinutes = 480, nowMs = Date.now()) {
  const shifted = new Date(nowMs + offsetMinutes * 60_000);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - offsetMinutes * 60_000).toISOString();
}
