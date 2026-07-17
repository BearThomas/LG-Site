import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

const BACKUP_ROOT = path.resolve('public', 'data-backups');
const CHUNK_SIZE = 50; // 50 items per chunk

function computeHash(jsonStr) {
  return crypto.createHash('sha256').update(jsonStr).digest('hex');
}

function runD1Query(query) {
  console.log(`Running D1 query: ${query}`);
  const out = execSync(`npx wrangler d1 execute lg --remote --command "${query}" --json`, {
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024
  });
  
  // wrangler might output some non-json logs before the JSON array, so we extract the JSON part.
  const match = out.match(/\[\s*\{.*\}\s*\]/s);
  if (!match) return [];
  const parsed = JSON.parse(match[0]);
  return parsed[0].results || [];
}

async function processCollection(collection) {
  console.log(`\n--- Processing collection: ${collection} ---`);
  const folder = path.join(BACKUP_ROOT, collection);
  
  // 1. Fetch archived data from D1 (older than 1 month)
  // 'now', '-1 month' gives exactly one month ago
  const oldData = runD1Query(`SELECT * FROM ${collection} WHERE created_at < datetime('now', '-1 month')`);
  console.log(`Found ${oldData.length} records in D1 older than 1 month to archive.`);

  // 2. Delete them from D1 to keep it hot
  if (oldData.length > 0) {
    const ids = oldData.map(d => `'${d.id}'`).join(',');
    runD1Query(`DELETE FROM ${collection} WHERE id IN (${ids})`);
    console.log(`Deleted ${oldData.length} archived records from D1.`);
  }

  // 3. Load all existing cold data
  let allColdData = [];
  
  // Check if legacy unchunked file exists
  const legacyFile = path.join(BACKUP_ROOT, `${collection}.json`);
  if (fs.existsSync(legacyFile)) {
    console.log(`Found legacy ${legacyFile}. Converting to chunks...`);
    const data = JSON.parse(fs.readFileSync(legacyFile, 'utf8'));
    allColdData.push(...(data.documents || data));
    fs.rmSync(legacyFile);
  }

  // Load existing chunks if any
  if (fs.existsSync(folder)) {
    const files = fs.readdirSync(folder).filter(f => f.startsWith('chunk-') && f.endsWith('.json'));
    for (const file of files) {
      const data = JSON.parse(fs.readFileSync(path.join(folder, file), 'utf8'));
      allColdData.push(...data);
    }
  } else {
    fs.mkdirSync(folder, { recursive: true });
  }

  // 4. Merge and deduplicate by id
  const map = new Map();
  for (const item of allColdData) {
    map.set(item.id || item.$id, item);
  }
  for (const item of oldData) {
    map.set(item.id, item);
  }
  
  let merged = Array.from(map.values());
  // Sort DESC by created_at (newest first)
  merged.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  // 5. Chunk and save
  const chunks = [];
  let chunkIndex = 1;
  
  // Clear existing chunks
  if (fs.existsSync(folder)) {
    const files = fs.readdirSync(folder).filter(f => f.startsWith('chunk-') && f.endsWith('.json') || f === 'search-index.json');
    for (const file of files) fs.rmSync(path.join(folder, file));
  }

  let searchIndex = [];

  for (let i = 0; i < merged.length; i += CHUNK_SIZE) {
    const chunkData = merged.slice(i, i + CHUNK_SIZE);
    const fileName = `chunk-${chunkIndex}.json`;
    const filePath = path.join(folder, fileName);
    
    const jsonStr = JSON.stringify(chunkData, null, 2);
    fs.writeFileSync(filePath, jsonStr, 'utf8');
    
    chunks.push({
      file: fileName,
      hash: computeHash(jsonStr),
      count: chunkData.length,
      startDate: chunkData[chunkData.length - 1].created_at,
      endDate: chunkData[0].created_at
    });
    
    if (collection === 'posts') {
        chunkData.forEach(p => {
            searchIndex.push({
                id: p.id || p.$id,
                title: p.title,
                authorId: p.author_id || p.authorId,
                authorName: p.author_name || p.authorName,
                tags: typeof p.targetGroups === 'string' ? p.targetGroups : JSON.stringify(p.targetGroups || []),
                boardId: p.board_id || p.boardId || 'main',
                c: chunkIndex,
                t: p.created_at
            });
        });
    } else if (collection === 'comments') {
        chunkData.forEach(c => {
            searchIndex.push({
                id: c.id || c.$id,
                postId: c.post_id || c.postId,
                authorId: c.author_id || c.authorId,
                c: chunkIndex,
                t: c.created_at
            });
        });
    }
    
    chunkIndex++;
  }
  
  const indexData = {
    collection,
    totalChunks: chunks.length,
    totalRecords: merged.length,
    updatedAt: new Date().toISOString(),
    chunks
  };
  
  const indexStr = JSON.stringify(indexData, null, 2);
  fs.writeFileSync(path.join(folder, 'index.json'), indexStr, 'utf8');
  
  if (searchIndex.length > 0) {
      const searchIndexStr = JSON.stringify(searchIndex);
      fs.writeFileSync(path.join(folder, 'search-index.json'), searchIndexStr, 'utf8');
      const searchHash = computeHash(searchIndexStr);
      runD1Query(`INSERT OR REPLACE INTO data_meta (key, value) VALUES ('hash_${collection}_search', '${searchHash}')`);
  }
  
  // 6. Update hash in data_meta
  const indexHash = computeHash(indexStr);
  runD1Query(`INSERT OR REPLACE INTO data_meta (key, value) VALUES ('hash_${collection}', '${indexHash}')`);
  console.log(`Saved ${chunks.length} chunks for ${collection}. Index hash: ${indexHash}`);
}

async function main() {
  await processCollection('posts');
  await processCollection('comments');
  await processCollection('confessions');
  
  // Clear mod_log of entries that have been archived.
  // We can just clear all mod_log entries older than 1 month because they are now baked into the chunks.
  runD1Query(`DELETE FROM mod_log WHERE created_at < datetime('now', '-1 month')`);
  
  const newVersion = new Date().toISOString();
  runD1Query(`INSERT OR REPLACE INTO data_meta (key, value) VALUES ('cold_data_version', '${newVersion}')`);
  
  console.log('Archive and chunk process completed successfully.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
