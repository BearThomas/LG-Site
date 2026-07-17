#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const argv = process.argv.slice(2);
function option(name, fallback) { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : fallback; }
const source = path.resolve(option("--source", "../LG-Site-Backup"));
const output = path.resolve(option("--output", "migration/generated"));
const defaultDatabase = option("--database-id", process.env.D1_DEFAULT_DATABASE_ID || "legacy");
const maxChunkBytes = Number(option("--chunk-bytes", "700000"));
if (!fs.existsSync(source)) throw new Error(`找不到备份目录：${source}`);
fs.mkdirSync(output, { recursive: true });
for (const name of fs.readdirSync(output)) if (/^\d{3}-documents\.sql$|^manifest\.json$|^RECOVERY_STATUS\.md$/.test(name)) fs.rmSync(path.join(output, name));

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if ([".git","node_modules","dist","build"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full)); else out.push(full);
  }
  return out;
}
function isRecord(value) { return value && typeof value === "object" && !Array.isArray(value) && (value.$id || value.id) && Object.keys(value).length >= 2; }
function looksLikeRecords(value) { return Array.isArray(value) && value.length > 0 && value.filter(isRecord).length >= Math.max(1, Math.ceil(value.length * 0.5)); }
function normalizeCollection(text) {
  return String(text || "").replace(/\.(json|jsonl|ndjson)$/i, "").replace(/(?:[-_.](?:backup|snapshot|export|data|\d{4}[-_]\d{2}[-_]\d{2}.*))$/i, "") || "unknown";
}
function inferCollection(file, context, record) {
  return String(record.$collectionId || record.collectionId || context.collectionId || normalizeCollection(path.basename(file)));
}
function inferDatabase(context, record) { return String(record.$databaseId || record.databaseId || context.databaseId || defaultDatabase); }
function iso(value, fallback) { const date = new Date(value || fallback); return Number.isNaN(date.valueOf()) ? fallback : date.toISOString(); }
function snapshotFromPath(file) {
  const m = file.match(/(20\d{2})[-_](\d{2})[-_](\d{2})(?:[T _-](\d{2})[-_:]?(\d{2})[-_:]?(\d{2}))?/);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2])-1, Number(m[3]), Number(m[4]||0), Number(m[5]||0), Number(m[6]||0))).toISOString();
}
function stripMeta(record) { const out = {}; for (const [k,v] of Object.entries(record)) if (!k.startsWith("$") && !["databaseId","collectionId"].includes(k)) out[k] = v; return out; }
function ownerOf(record) {
  for (const key of ["userId","user_id","authorId","author_id","ownerId","owner_id","createdBy","created_by"]) if (typeof record[key] === "string" && record[key]) return record[key];
  const perms = Array.isArray(record.$permissions) ? record.$permissions : [];
  for (const p of perms) { const m = String(p).match(/user:([^\"')]+)/); if (m) return m[1]; }
  return null;
}

const docs = new Map();
const sources = [];
let parseErrors = [];
function addRecord(file, context, record) {
  const now = new Date().toISOString();
  const databaseId = inferDatabase(context, record);
  const collectionId = inferCollection(file, context, record);
  const id = String(record.$id || record.id);
  const createdAt = iso(record.$createdAt || record.createdAt || record.created_at, now);
  const updatedAt = iso(record.$updatedAt || record.updatedAt || record.updated_at, createdAt);
  const item = {
    databaseId, collectionId, id,
    data: stripMeta(record),
    permissions: Array.isArray(record.$permissions) ? record.$permissions : [],
    ownerId: ownerOf(record), createdAt, updatedAt,
    sourceFile: path.relative(source, file).replaceAll(path.sep, "/"),
    sourceSnapshotAt: snapshotFromPath(file),
  };
  const key = `${databaseId}\u0000${collectionId}\u0000${id}`;
  const current = docs.get(key);
  if (!current || item.updatedAt >= current.updatedAt) docs.set(key, item);
}
function visit(file, node, context = {}) {
  if (looksLikeRecords(node)) { for (const record of node) addRecord(file, context, record); return; }
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { for (const value of node) visit(file, value, context); return; }
  const next = {
    databaseId: node.databaseId || node.database_id || node.$databaseId || context.databaseId,
    collectionId: node.collectionId || node.collection_id || node.$collectionId || context.collectionId,
  };
  for (const [key, value] of Object.entries(node)) {
    if (looksLikeRecords(value)) {
      const generic = ["documents","rows","items","data","records","result","results"].includes(key);
      for (const record of value) addRecord(file, { ...next, collectionId: generic ? next.collectionId : (next.collectionId || key) }, record);
    } else if (value && typeof value === "object") visit(file, value, next);
  }
}

for (const file of walk(source)) {
  if (!/\.(json|jsonl|ndjson)$/i.test(file)) continue;
  try {
    const raw = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").trim();
    if (!raw) continue;
    if (/\.(jsonl|ndjson)$/i.test(file)) {
      const records = raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
      visit(file, records);
    } else visit(file, JSON.parse(raw));
    sources.push(path.relative(source, file).replaceAll(path.sep, "/"));
  } catch (error) { parseErrors.push({ file: path.relative(source, file), error: String(error.message || error) }); }
}

function q(value) { if (value === null || value === undefined) return "NULL"; return `'${String(value).replaceAll("'", "''")}'`; }
const rows = [...docs.values()].sort((a,b) => `${a.databaseId}/${a.collectionId}/${a.id}`.localeCompare(`${b.databaseId}/${b.collectionId}/${b.id}`));
const statements = rows.map((d) => `INSERT INTO appwrite_documents (database_id, collection_id, id, data_json, permissions_json, owner_id, created_at, updated_at, source_file, source_snapshot_at) VALUES (${q(d.databaseId)}, ${q(d.collectionId)}, ${q(d.id)}, ${q(JSON.stringify(d.data))}, ${q(JSON.stringify(d.permissions))}, ${q(d.ownerId)}, ${q(d.createdAt)}, ${q(d.updatedAt)}, ${q(d.sourceFile)}, ${q(d.sourceSnapshotAt)}) ON CONFLICT(database_id, collection_id, id) DO UPDATE SET data_json=excluded.data_json, permissions_json=excluded.permissions_json, owner_id=excluded.owner_id, created_at=excluded.created_at, updated_at=excluded.updated_at, source_file=excluded.source_file, source_snapshot_at=excluded.source_snapshot_at WHERE excluded.updated_at >= appwrite_documents.updated_at;`);
let chunks = [], current = "BEGIN TRANSACTION;\n";
for (const statement of statements) {
  if (Buffer.byteLength(current + statement + "\nCOMMIT;\n") > maxChunkBytes && current !== "BEGIN TRANSACTION;\n") { chunks.push(current + "COMMIT;\n"); current = "BEGIN TRANSACTION;\n"; }
  current += statement + "\n";
}
if (current !== "BEGIN TRANSACTION;\n") chunks.push(current + "COMMIT;\n");
chunks.forEach((content, i) => fs.writeFileSync(path.join(output, `${String(i+1).padStart(3,"0")}-documents.sql`), content));
const byCollection = {};
for (const d of rows) {
  const key = `${d.databaseId}/${d.collectionId}`;
  byCollection[key] ||= { count: 0, earliestCreatedAt: d.createdAt, latestUpdatedAt: d.updatedAt };
  byCollection[key].count++;
  if (d.createdAt < byCollection[key].earliestCreatedAt) byCollection[key].earliestCreatedAt = d.createdAt;
  if (d.updatedAt > byCollection[key].latestUpdatedAt) byCollection[key].latestUpdatedAt = d.updatedAt;
}
const manifest = {
  generatedAt: new Date().toISOString(), source, defaultDatabase,
  totalDocuments: rows.length, sqlChunks: chunks.length,
  collections: byCollection, sourceFilesParsed: sources.length, parseErrors,
  contentFingerprint: crypto.createHash("sha256").update(rows.map((d) => `${d.databaseId}/${d.collectionId}/${d.id}/${d.updatedAt}`).join("\n")).digest("hex"),
};
fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2));
const latest = Object.values(byCollection).map((v) => v.latestUpdatedAt).sort().at(-1) || "无可识别文档";
fs.writeFileSync(path.join(output, "RECOVERY_STATUS.md"), `# 本地备份恢复结果\n\n- 可识别文档：${rows.length}\n- 集合：${Object.keys(byCollection).length}\n- SQL 分片：${chunks.length}\n- 备份中最新更新时间：${latest}\n- 无法解析的 JSON：${parseErrors.length}\n\n详细数量见 \`manifest.json\`。导入是幂等的；以后获得更新备份后可再次生成并导入。\n`);
console.log(JSON.stringify(manifest, null, 2));
