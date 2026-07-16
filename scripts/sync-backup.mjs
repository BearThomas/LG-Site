// scripts/sync-backup.mjs
// Monthly sync script for backup JSON files.
// Computes the target month (current month - 2), loads backup JSON files for that month,
// applies pending edits/deletes from the `mod_log` table, updates the JSON files on disk,
// computes SHA‑256 hashes for each collection, stores them in D1 `data_meta`,
// and records a new `cold_data_version`.

import { resolve } from 'path';
import { readFile, writeFile } from 'fs/promises';
import { createHash } from 'crypto';

function computeHash(collectionArray) {
  // Ensure deterministic order by sorting by id
  const sorted = [...collectionArray].sort((a, b) => {
    const idA = a.id || a.$id || '';
    const idB = b.id || b.$id || '';
    return idA > idB ? 1 : -1;
  });
  const json = JSON.stringify(sorted);
  return createHash('sha256').update(json).digest('hex');
}

async function getTargetMonth() {
  const now = new Date();
  // Subtract two months (handle year wrap)
  const month = now.getUTCMonth() + 1 - 2; // 1‑based month
  const year = now.getUTCFullYear() + (month <= 0 ? -1 : 0);
  const targetMonth = month <= 0 ? month + 12 : month;
  // Return as YYYY-MM string
  return `${year}-${String(targetMonth).padStart(2, '0')}`;
}

async function loadJson(filePath) {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function saveJson(filePath, data) {
  const text = JSON.stringify(data, null, 2);
  await writeFile(filePath, text, 'utf8');
}

async function main() {
  const target = await getTargetMonth();
  const backupRoot = resolve('public', 'data-backups');
  const files = {
    posts: resolve(backupRoot, `posts-${target}.json`),
    comments: resolve(backupRoot, `comments-${target}.json`),
    confessions: resolve(backupRoot, `confessions-${target}.json`)
  };

  // Load current backup data
  const [postsWrapper, commentsWrapper, confessionsWrapper] = await Promise.all([
    loadJson(files.posts),
    loadJson(files.comments),
    loadJson(files.confessions)
  ]);

  let posts = Array.isArray(postsWrapper) ? postsWrapper : (postsWrapper.documents || []);
  let comments = Array.isArray(commentsWrapper) ? commentsWrapper : (commentsWrapper.documents || []);
  let confessions = Array.isArray(confessionsWrapper) ? confessionsWrapper : (confessionsWrapper.documents || []);

  // Connect to D1 DB – the environment provides DB binding when run as a Worker.
  const db = (globalThis as any).DB;
  if (!db) throw new Error('D1 binding DB not found');

  // Fetch pending modifications from mod_log newer than the last backup version.
  const versionRow = await db.prepare(`SELECT value FROM data_meta WHERE key = 'cold_data_version'`).first();
  const lastVersion = versionRow?.value ?? '0';
  const logs = await db.prepare(`SELECT * FROM mod_log WHERE created_at > ? ORDER BY created_at ASC`).bind(lastVersion).all();

  for (const log of logs.results ?? []) {
    const { collection, item_id, action, payload } = log;
    let targetArray = null;
    if (collection === 'posts') targetArray = posts;
    else if (collection === 'comments') targetArray = comments;
    else if (collection === 'confessions') targetArray = confessions;
    
    if (!targetArray) continue;
    
    const idx = targetArray.findIndex(item => item.id === item_id || item.$id === item_id);
    if (idx !== -1) {
      if (action === 'delete') {
        targetArray.splice(idx, 1);
      } else if (action === 'edit' && payload) {
        try {
          const updates = JSON.parse(payload);
          targetArray[idx] = { ...targetArray[idx], ...updates };
        } catch(e) {
          console.warn('Failed to parse payload for item', item_id);
        }
      }
    }
  }

  // Restore wrapper structure if necessary, though raw array is preferred.
  // We'll write back raw arrays for simplicity and consistency.
  
  await Promise.all([
    saveJson(files.posts, posts),
    saveJson(files.comments, comments),
    saveJson(files.confessions, confessions)
  ]);

  // Compute SHA‑256 hashes for each collection and store in data_meta.
  const postsHash = computeHash(posts);
  const commentsHash = computeHash(comments);
  const confessionsHash = computeHash(confessions);

  await Promise.all([
    db.prepare(`INSERT OR REPLACE INTO data_meta (key, value) VALUES ('hash_posts', ?)`).bind(postsHash).run(),
    db.prepare(`INSERT OR REPLACE INTO data_meta (key, value) VALUES ('hash_comments', ?)`).bind(commentsHash).run(),
    db.prepare(`INSERT OR REPLACE INTO data_meta (key, value) VALUES ('hash_confessions', ?)`).bind(confessionsHash).run()
  ]);

  // Update cold_data_version to current timestamp.
  const newVersion = new Date().toISOString();
  await db.prepare(`INSERT OR REPLACE INTO data_meta (key, value) VALUES ('cold_data_version', ?)`).bind(newVersion).run();
  console.log('Backup sync completed for', target);
}

main().catch(err => {
  console.error('Sync backup failed:', err);
  process.exit(1);
});
