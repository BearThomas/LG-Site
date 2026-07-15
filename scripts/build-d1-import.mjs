import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');
const COLLECTIONS = ['users', 'posts', 'comments', 'confessions'];
const ENCRYPTED_FIELDS = {
  users: ['email', 'role', 'permissions', 'joinedBoards', 'ownedBoards', 'class', 'mutedUntil', 'banned'],
  posts: ['content', 'context', 'title', 'authorName', 'authorId', 'targetGroups'],
  comments: ['content', 'context', 'authorName', 'authorId'],
  confessions: ['content', 'context', 'authorName', 'authorId', 'toName']
};
const CIPHER_PATTERN = /^[0-9a-fA-F]{32}:[0-9a-fA-F]+$/;

function parseArgs(argv) {
  const options = {
    backupRoots: [],
    output: path.join(PROJECT_ROOT, 'generated', 'd1-import.sql'),
    report: path.join(PROJECT_ROOT, 'generated', 'migration-report.json'),
    fallbackDir: path.join(PROJECT_ROOT, 'public', 'data-fallback')
  };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--backup-root') options.backupRoots.push(path.resolve(argv[++index]));
    else if (item === '--output') options.output = path.resolve(argv[++index]);
    else if (item === '--report') options.report = path.resolve(argv[++index]);
    else if (item === '--fallback-dir') options.fallbackDir = path.resolve(argv[++index]);
    else if (item === '--help') {
      console.log('Usage: node scripts/build-d1-import.mjs [--backup-root PATH] [--output FILE] [--report FILE] [--fallback-dir DIR]');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${item}`);
    }
  }
  return options;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    const name = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(name in process.env)) process.env[name] = value;
  }
}

function discoverBackupRoots(explicitRoots) {
  if (explicitRoots.length) {
    return [...new Set(explicitRoots.filter(candidate => fs.existsSync(candidate)))];
  }
  const candidates = [
    path.resolve(PROJECT_ROOT, '..', 'LG-Site-Backup-D1-Final', 'backups'),
    path.resolve(PROJECT_ROOT, '..', 'LG-Site-Backup-D1', 'backups'),
    path.resolve(PROJECT_ROOT, '..', 'LG-Site-Backup', 'backups'),
    path.resolve(PROJECT_ROOT, '..', 'backup', 'LG-Site-Backup', 'backups')
  ];
  return [...new Set(candidates.filter(candidate => fs.existsSync(candidate)))];
}

function walkJson(root) {
  if (!fs.existsSync(root)) return [];
  const found = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) found.push(...walkJson(fullPath));
    else if (entry.isFile() && entry.name.endsWith('.json')) found.push(fullPath);
  }
  return found;
}

function readBackupFile(filePath, collection, priority) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const data = JSON.parse(raw);
  const documents = Array.isArray(data) ? data : data.documents;
  if (!Array.isArray(documents)) return [];
  return documents.map(document => ({
    document,
    source: filePath,
    priority,
    fileEncrypted: Boolean(data.encrypted)
  }));
}

function sourcePriority(filePath, publicRoot) {
  if (filePath.startsWith(publicRoot)) return 100;
  if (filePath.includes(`${path.sep}last${path.sep}`)) return 80;
  return 50;
}

function timestampOf(document) {
  const value = document.$updatedAt || document.updatedAt || document.$createdAt || document.createdAt || '';
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mergeDocuments(entries) {
  const merged = new Map();
  for (const entry of entries) {
    const id = String(entry.document.$id || entry.document.id || '').trim();
    if (!id) continue;
    const current = merged.get(id);
    const candidateTime = timestampOf(entry.document);
    const currentTime = current ? timestampOf(current.document) : -1;
    if (!current || candidateTime > currentTime || (candidateTime === currentTime && entry.priority >= current.priority)) {
      merged.set(id, entry);
    }
  }
  return [...merged.values()];
}

function getEncryptKey() {
  const raw = String(process.env.BACKUP_ENCRYPT_KEY || process.env.ENCRYPT_KEY || '').trim();
  if (!raw) return null;
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error('BACKUP_ENCRYPT_KEY must be exactly 64 hexadecimal characters.');
  }
  return Buffer.from(raw, 'hex');
}

function decryptValue(value, key, context, stats) {
  if (value === undefined || value === null || value === '') return value;
  const text = String(value);
  if (!CIPHER_PATTERN.test(text)) return value;
  if (!key) {
    throw new Error(`Encrypted backup data found at ${context}, but BACKUP_ENCRYPT_KEY is not set.`);
  }
  try {
    const [ivHex, cipherHex] = text.split(':');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, Buffer.from(ivHex, 'hex'));
    const plain = Buffer.concat([decipher.update(Buffer.from(cipherHex, 'hex')), decipher.final()]).toString('utf8');
    stats.decryptedValues += 1;
    return plain;
  } catch {
    throw new Error(`Unable to decrypt ${context}. Check BACKUP_ENCRYPT_KEY.`);
  }
}

function decryptDocument(collection, entry, key, stats) {
  const document = { ...entry.document };
  for (const field of ENCRYPTED_FIELDS[collection] || []) {
    if (field in document) {
      document[field] = decryptValue(document[field], key, `${collection}/${document.$id || document.id}/${field}`, stats);
    }
  }
  return document;
}

function normalizeUserId(value) {
  return String(value || '').trim().replace(/^student_/, '');
}

function iso(value, fallback = new Date(0).toISOString()) {
  const parsed = new Date(value || fallback);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function jsonArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function booleanValue(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off', ''].includes(normalized)) return false;
  return false;
}

function fallbackName(id, proposed = '') {
  const clean = String(proposed || '').trim();
  if (clean && !/^\d{6,12}$/.test(clean) && !clean.includes(':')) return clean;
  return id ? `同学${id.slice(-4)}` : '未知同学';
}

function sql(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '0';
  if (typeof value === 'boolean') return value ? '1' : '0';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function upsert(table, columns, values, updatedColumn = 'updated_at', preserveColumns = []) {
  const preserve = new Set(preserveColumns);
  const updateColumns = columns.filter(column =>
    column !== 'id' && column !== 'created_at' && !preserve.has(column)
  );
  return `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.map(sql).join(', ')})\n` +
    `ON CONFLICT(id) DO UPDATE SET ${updateColumns.map(column => `${column} = excluded.${column}`).join(', ')}\n` +
    `WHERE excluded.${updatedColumn} >= ${table}.${updatedColumn};`;
}

function collectFiles(publicRoot, backupRoots) {
  const files = [];
  for (const collection of COLLECTIONS) {
    const publicFile = path.join(publicRoot, `${collection}.json`);
    if (fs.existsSync(publicFile)) files.push({ collection, filePath: publicFile });
  }
  for (const root of backupRoots) {
    for (const filePath of walkJson(root)) {
      const baseName = path.basename(filePath, '.json');
      // One historical backup folder contains the typo `conmmets.json`.
      // Treat it as comments so those records are not silently lost.
      const collection = baseName === 'conmmets' ? 'comments' : baseName;
      if (COLLECTIONS.includes(collection)) files.push({ collection, filePath });
    }
  }
  return files;
}

function main() {
  loadEnvFile(path.join(PROJECT_ROOT, '.dev.vars'));
  loadEnvFile(path.join(PROJECT_ROOT, '.env'));
  const options = parseArgs(process.argv.slice(2));
  const publicRoot = path.join(PROJECT_ROOT, 'public', 'data-backups');
  const backupRoots = discoverBackupRoots(options.backupRoots);
  const files = collectFiles(publicRoot, backupRoots);
  if (!files.length) throw new Error('No backup JSON files were found.');

  const stats = {
    generatedAt: new Date().toISOString(),
    publicBackupRoot: publicRoot,
    backupRoots,
    sourceFiles: [],
    decryptedValues: 0,
    inputDocuments: {},
    outputDocuments: {},
    stubUsers: 0,
    orphanComments: 0
  };
  const entriesByCollection = Object.fromEntries(COLLECTIONS.map(name => [name, []]));

  for (const { collection, filePath } of files) {
    const priority = sourcePriority(filePath, publicRoot);
    const entries = readBackupFile(filePath, collection, priority);
    entriesByCollection[collection].push(...entries);
    stats.sourceFiles.push({ collection, file: filePath, documents: entries.length, priority });
  }

  const key = getEncryptKey();
  const docs = {};
  for (const collection of COLLECTIONS) {
    stats.inputDocuments[collection] = entriesByCollection[collection].length;
    docs[collection] = mergeDocuments(entriesByCollection[collection]).map(entry => decryptDocument(collection, entry, key, stats));
    stats.outputDocuments[collection] = docs[collection].length;
  }

  const users = new Map();
  for (const document of docs.users) {
    const id = normalizeUserId(document.userId || document.$id || document.id);
    if (!id) continue;
    users.set(id, {
      id,
      appwriteUserId: String(document.$id || document.id || id),
      name: fallbackName(id, document.name),
      avatar: document.avatar || null,
      email: document.email || `${id}@campus.local`,
      role: document.role || 'normal',
      permissions: Number(document.permissions ?? 31),
      joinedBoards: jsonArray(document.joinedBoards).length ? jsonArray(document.joinedBoards) : ['main'],
      ownedBoards: jsonArray(document.ownedBoards),
      className: document.class || '',
      mutedUntil: document.mutedUntil || null,
      banned: booleanValue(document.banned),
      createdAt: iso(document.$createdAt || document.createdAt),
      updatedAt: iso(document.$updatedAt || document.updatedAt || document.$createdAt || document.createdAt)
    });
  }

  const authorNames = new Map();
  for (const collection of ['posts', 'comments', 'confessions']) {
    for (const document of docs[collection]) {
      const id = normalizeUserId(document.authorId);
      if (!id) continue;
      const proposed = fallbackName(id, document.authorName);
      if (!authorNames.has(id) || proposed !== `同学${id.slice(-4)}`) authorNames.set(id, proposed);
    }
  }
  for (const [id, name] of authorNames) {
    if (users.has(id)) continue;
    const dates = [...docs.posts, ...docs.comments, ...docs.confessions]
      .filter(document => normalizeUserId(document.authorId) === id)
      .map(document => iso(document.$createdAt || document.createdAt));
    const createdAt = dates.sort()[0] || new Date(0).toISOString();
    users.set(id, {
      id,
      appwriteUserId: id,
      name,
      avatar: null,
      email: `${id}@campus.local`,
      role: 'normal',
      permissions: 31,
      joinedBoards: ['main'],
      ownedBoards: [],
      className: /^\d{6,12}$/.test(id) ? `${id.slice(0, 4)}届${id.slice(4, 6)}班` : '',
      mutedUntil: null,
      banned: false,
      createdAt,
      updatedAt: createdAt
    });
    stats.stubUsers += 1;
  }

  const posts = docs.posts.map(document => {
    const id = String(document.$id || document.id || '').trim();
    const authorId = normalizeUserId(document.authorId);
    return {
      id,
      boardId: String(document.boardId || 'main'),
      title: String(document.title || ''),
      content: String(document.content || document.context || ''),
      authorId,
      authorName: users.get(authorId)?.name || fallbackName(authorId, document.authorName),
      viewPermission: Number(document.viewPermission || 1),
      targetGroups: jsonArray(document.targetGroups),
      status: Number(document.status || 0),
      editedAt: document.editedAt ? iso(document.editedAt) : null,
      createdAt: iso(document.$createdAt || document.createdAt),
      updatedAt: iso(document.$updatedAt || document.updatedAt || document.$createdAt || document.createdAt)
    };
  }).filter(document => document.id && document.authorId);
  const postIds = new Set(posts.map(post => post.id));

  const orphanComments = [];
  const comments = docs.comments.map(document => {
    const id = String(document.$id || document.id || '').trim();
    const authorId = normalizeUserId(document.authorId);
    return {
      id,
      postId: String(document.postId || '').trim(),
      content: String(document.content || document.context || ''),
      authorId,
      authorName: users.get(authorId)?.name || fallbackName(authorId, document.authorName),
      createdAt: iso(document.$createdAt || document.createdAt),
      updatedAt: iso(document.$updatedAt || document.updatedAt || document.$createdAt || document.createdAt),
      raw: document
    };
  }).filter(document => document.id && document.authorId).filter(document => {
    if (postIds.has(document.postId)) return true;
    orphanComments.push(document);
    return false;
  });
  stats.orphanComments = orphanComments.length;

  const confessions = docs.confessions.map(document => {
    const id = String(document.$id || document.id || '').trim();
    const authorId = normalizeUserId(document.authorId);
    return {
      id,
      content: String(document.content || document.context || ''),
      authorId,
      authorName: users.get(authorId)?.name || fallbackName(authorId, document.authorName),
      toName: document.toName || null,
      status: Number(document.status || 0),
      likes: Number(document.likes || 0),
      createdAt: iso(document.$createdAt || document.createdAt),
      updatedAt: iso(document.$updatedAt || document.updatedAt || document.$createdAt || document.createdAt)
    };
  }).filter(document => document.id && document.authorId);

  const commentCounts = new Map();
  for (const comment of comments) commentCounts.set(comment.postId, (commentCounts.get(comment.postId) || 0) + 1);

  const statements = [
    '-- Generated by scripts/build-d1-import.mjs. Do not commit this file.',
    'PRAGMA foreign_keys = ON;'
  ];
  for (const user of [...users.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    statements.push(upsert('users', [
      'id', 'appwrite_user_id', 'name', 'avatar', 'email', 'role', 'permissions',
      'joined_boards', 'owned_boards', 'class_name', 'muted_until', 'banned',
      'token_version', 'created_at', 'updated_at'
    ], [
      user.id, user.appwriteUserId, user.name, user.avatar, user.email, user.role, user.permissions,
      JSON.stringify(user.joinedBoards), JSON.stringify(user.ownedBoards), user.className, user.mutedUntil,
      user.banned ? 1 : 0, 0, user.createdAt, user.updatedAt
    ], 'updated_at', ['token_version']));
  }
  for (const post of posts.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    statements.push(upsert('posts', [
      'id', 'board_id', 'title', 'content', 'author_id', 'author_name', 'view_permission',
      'target_groups', 'status', 'edited_at', 'comment_count', 'created_at', 'updated_at'
    ], [
      post.id, post.boardId, post.title, post.content, post.authorId, post.authorName,
      post.viewPermission, JSON.stringify(post.targetGroups), post.status, post.editedAt,
      commentCounts.get(post.id) || 0, post.createdAt, post.updatedAt
    ]));
  }
  for (const comment of comments.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    statements.push(upsert('comments', [
      'id', 'post_id', 'content', 'author_id', 'author_name', 'created_at', 'updated_at'
    ], [
      comment.id, comment.postId, comment.content, comment.authorId, comment.authorName,
      comment.createdAt, comment.updatedAt
    ]));
  }
  for (const confession of confessions.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    statements.push(upsert('confessions', [
      'id', 'content', 'author_id', 'author_name', 'to_name', 'status', 'likes', 'created_at', 'updated_at'
    ], [
      confession.id, confession.content, confession.authorId, confession.authorName,
      confession.toName, confession.status, confession.likes, confession.createdAt, confession.updatedAt
    ]));
  }
  for (const orphan of orphanComments) {
    statements.push(`INSERT INTO migration_orphans (collection_name, record_id, payload, reason, captured_at) VALUES (${[
      'comments', orphan.id, JSON.stringify(orphan.raw), `Missing post ${orphan.postId}`, stats.generatedAt
    ].map(sql).join(', ')}) ON CONFLICT(collection_name, record_id) DO UPDATE SET payload = excluded.payload, reason = excluded.reason, captured_at = excluded.captured_at;`);
  }

  const publicPosts = posts.filter(post => Number(post.viewPermission || 1) === 1);
  const publicPostIds = new Set(publicPosts.map(post => post.id));
  const publicComments = comments.filter(comment => publicPostIds.has(comment.postId));
  const publicAuthorIds = new Set([
    ...publicPosts.map(post => post.authorId),
    ...publicComments.map(comment => comment.authorId)
  ]);
  const publicUsers = [...users.values()].filter(user => publicAuthorIds.has(user.id));
  const activeConfessions = confessions.filter(confession => Number(confession.status || 0) === 0);

  fs.mkdirSync(options.fallbackDir, { recursive: true });
  const fallbackFiles = {
    users: publicUsers.map(user => ({
      $id: user.id,
      $createdAt: user.createdAt,
      $updatedAt: user.updatedAt,
      userId: user.id,
      name: user.name,
      avatar: user.avatar || '',
      role: user.role || 'normal'
    })),
    posts: publicPosts.map(post => ({
      $id: post.id,
      $createdAt: post.createdAt,
      $updatedAt: post.updatedAt,
      boardId: post.boardId,
      title: post.title,
      content: post.content,
      authorId: `student_${post.authorId}`,
      authorName: post.authorName,
      viewPermission: 1,
      targetGroups: [],
      status: post.status,
      editedAt: post.editedAt,
      commentCount: commentCounts.get(post.id) || 0
    })),
    comments: publicComments.map(comment => ({
      $id: comment.id,
      $createdAt: comment.createdAt,
      $updatedAt: comment.updatedAt,
      postId: comment.postId,
      content: comment.content,
      authorId: comment.authorId,
      authorName: comment.authorName
    })),
    confessions: activeConfessions.map(confession => ({
      $id: confession.id,
      $createdAt: confession.createdAt,
      $updatedAt: confession.updatedAt,
      content: confession.content,
      authorId: '',
      authorName: '匿名',
      toName: confession.toName,
      status: confession.status,
      likes: confession.likes
    }))
  };
  for (const [name, documents] of Object.entries(fallbackFiles)) {
    fs.writeFileSync(
      path.join(options.fallbackDir, `${name}.json`),
      `${JSON.stringify({
        generatedAt: stats.generatedAt,
        source: 'sanitized-migration-fallback',
        total: documents.length,
        documents
      }, null, 2)}\n`,
      'utf8'
    );
  }
  stats.publicFallback = Object.fromEntries(
    Object.entries(fallbackFiles).map(([name, documents]) => [name, documents.length])
  );

  stats.outputDocuments = {
    users: users.size,
    posts: posts.length,
    comments: comments.length,
    confessions: confessions.length,
    migrationOrphans: orphanComments.length
  };

  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.mkdirSync(path.dirname(options.report), { recursive: true });
  fs.writeFileSync(options.output, `${statements.join('\n\n')}\n`, { mode: 0o600 });
  fs.writeFileSync(options.report, `${JSON.stringify(stats, null, 2)}\n`, { mode: 0o600 });

  console.log(`Generated ${path.relative(PROJECT_ROOT, options.output)}`);
  console.log(`Users: ${users.size} (${stats.stubUsers} restored as stubs)`);
  console.log(`Posts: ${posts.length}; comments: ${comments.length}; confessions: ${confessions.length}`);
  console.log(`Decrypted values: ${stats.decryptedValues}; orphan comments preserved: ${orphanComments.length}`);
  console.log(`Sanitized public fallback written to ${path.relative(PROJECT_ROOT, options.fallbackDir)}`);
  console.log('The generated SQL contains decrypted content. Keep it private and delete it after import.');
}

try {
  main();
} catch (error) {
  console.error(`Migration preparation failed: ${error.message}`);
  process.exitCode = 1;
}
