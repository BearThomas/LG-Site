import { buildListQuery } from "./queries.js";
import { canRead, canWrite, defaultPermissions } from "./permissions.js";
import { collectionPolicy } from "./auth.js";

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

export function hydrate(row) {
  return {
    ...parseJson(row.data_json, {}),
    $id: row.id,
    $databaseId: row.database_id,
    $collectionId: row.collection_id,
    $createdAt: row.created_at,
    $updatedAt: row.updated_at,
    $permissions: parseJson(row.permissions_json, []),
  };
}

function normalizeData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw Object.assign(new Error("data 必须是对象"), { status: 400 });
  const clean = { ...data };
  for (const key of Object.keys(clean)) if (key.startsWith("$")) delete clean[key];
  return clean;
}

export async function listDocuments(env, { databaseId, collectionId, queries }, user) {
  const built = buildListQuery(queries);
  const whereSql = built.where.length ? ` AND ${built.where.join(" AND ")}` : "";
  const scanLimit = Math.min(Math.max(built.limit * 5, built.limit), 500);
  const sql = `SELECT * FROM appwrite_documents WHERE database_id = ? AND collection_id = ?${whereSql} ORDER BY ${built.order.join(", ")} LIMIT ? OFFSET ?`;
  const result = await env.DB.prepare(sql).bind(databaseId, collectionId, ...built.params, scanLimit, built.offset).all();
  const visible = (result.results || []).filter((row) => canRead(row, user, env)).slice(0, built.limit);
  return { total: visible.length, documents: visible.map(hydrate) };
}

export async function getDocument(env, { databaseId, collectionId, documentId }, user) {
  const row = await env.DB.prepare("SELECT * FROM appwrite_documents WHERE database_id = ? AND collection_id = ? AND id = ?")
    .bind(databaseId, collectionId, documentId).first();
  if (!row) throw Object.assign(new Error("文档不存在"), { status: 404, type: "document_not_found" });
  if (!canRead(row, user, env)) throw Object.assign(new Error("没有读取权限"), { status: 403, type: "user_unauthorized" });
  return hydrate(row);
}

export async function createDocument(env, { databaseId, collectionId, documentId, data, permissions }, user) {
  const anonymousAllowed = collectionPolicy(env, "D1_ANONYMOUS_WRITE_COLLECTIONS", collectionId);
  if (!user?.$id && !anonymousAllowed) throw Object.assign(new Error("请先登录"), { status: 401, type: "user_unauthorized" });
  const id = !documentId || documentId === "unique()" ? crypto.randomUUID() : String(documentId);
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(id)) throw Object.assign(new Error("文档 ID 无效"), { status: 400 });
  const clean = normalizeData(data);
  const now = new Date().toISOString();
  const perms = Array.isArray(permissions) && permissions.length ? permissions : defaultPermissions(collectionId, user, env);
  try {
    await env.DB.prepare(`INSERT INTO appwrite_documents (database_id, collection_id, id, data_json, permissions_json, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(databaseId, collectionId, id, JSON.stringify(clean), JSON.stringify(perms), user?.$id || null, now, now).run();
  } catch (error) {
    if (String(error?.message || error).includes("UNIQUE")) throw Object.assign(new Error("文档 ID 已存在"), { status: 409, type: "document_already_exists" });
    throw error;
  }
  return getDocument(env, { databaseId, collectionId, documentId: id }, user);
}

export async function updateDocument(env, { databaseId, collectionId, documentId, data, permissions }, user) {
  const row = await env.DB.prepare("SELECT * FROM appwrite_documents WHERE database_id = ? AND collection_id = ? AND id = ?")
    .bind(databaseId, collectionId, documentId).first();
  if (!row) throw Object.assign(new Error("文档不存在"), { status: 404, type: "document_not_found" });
  if (!canWrite(row, user, env, "update")) throw Object.assign(new Error("没有修改权限"), { status: 403, type: "user_unauthorized" });
  const nextData = { ...parseJson(row.data_json, {}), ...normalizeData(data || {}) };
  const nextPermissions = Array.isArray(permissions) ? permissions : parseJson(row.permissions_json, []);
  const now = new Date().toISOString();
  await env.DB.prepare("UPDATE appwrite_documents SET data_json = ?, permissions_json = ?, updated_at = ? WHERE database_id = ? AND collection_id = ? AND id = ?")
    .bind(JSON.stringify(nextData), JSON.stringify(nextPermissions), now, databaseId, collectionId, documentId).run();
  return getDocument(env, { databaseId, collectionId, documentId }, user);
}

export async function deleteDocument(env, { databaseId, collectionId, documentId }, user) {
  const row = await env.DB.prepare("SELECT * FROM appwrite_documents WHERE database_id = ? AND collection_id = ? AND id = ?")
    .bind(databaseId, collectionId, documentId).first();
  if (!row) throw Object.assign(new Error("文档不存在"), { status: 404, type: "document_not_found" });
  if (!canWrite(row, user, env, "delete")) throw Object.assign(new Error("没有删除权限"), { status: 403, type: "user_unauthorized" });
  await env.DB.prepare("DELETE FROM appwrite_documents WHERE database_id = ? AND collection_id = ? AND id = ?")
    .bind(databaseId, collectionId, documentId).run();
  return {};
}

export async function changeNumber(env, args, user, direction) {
  const row = await env.DB.prepare("SELECT * FROM appwrite_documents WHERE database_id = ? AND collection_id = ? AND id = ?")
    .bind(args.databaseId, args.collectionId, args.documentId).first();
  if (!row) throw Object.assign(new Error("文档不存在"), { status: 404 });
  if (!canWrite(row, user, env, "update")) throw Object.assign(new Error("没有修改权限"), { status: 403 });
  const data = parseJson(row.data_json, {});
  const current = Number(data[args.attribute] || 0);
  const value = Number(args.value ?? 1) * direction;
  let next = current + value;
  if (args.min !== undefined && args.min !== null) next = Math.max(next, Number(args.min));
  if (args.max !== undefined && args.max !== null) next = Math.min(next, Number(args.max));
  data[args.attribute] = next;
  await env.DB.prepare("UPDATE appwrite_documents SET data_json = ?, updated_at = ? WHERE database_id = ? AND collection_id = ? AND id = ?")
    .bind(JSON.stringify(data), new Date().toISOString(), args.databaseId, args.collectionId, args.documentId).run();
  return getDocument(env, args, user);
}
