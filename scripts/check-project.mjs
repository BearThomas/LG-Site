import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');
const failures = [];

const requiredFiles = [
  'wrangler.json',
  'migrations/0001_initial.sql',
  'functions/api/data.js',
  'functions/api/auth-jwt.js',
  'js/d1-appwrite-compat.js',
  'public/data-backups/posts.json',
  'public/data-backups/comments.json',
  'public/data-backups/confessions.json',
  'public/data-backups/users.json',
  'public/data-fallback/posts.json',
  'public/data-fallback/comments.json',
  'public/data-fallback/confessions.json',
  'public/data-fallback/users.json'
];
for (const relative of requiredFiles) {
  if (!fs.existsSync(path.join(root, relative))) failures.push(`Missing required file: ${relative}`);
}

for (const forbidden of ['netlify.toml', 'deno.lock']) {
  if (fs.existsSync(path.join(root, forbidden))) failures.push(`Forbidden local/stale file is present: ${forbidden}`);
}

function walk(directory) {
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git', 'generated'].includes(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...walk(fullPath));
    else if (entry.isFile()) output.push(fullPath);
  }
  return output;
}

const files = walk(root);
const textExtensions = new Set(['.js', '.mjs', '.json', '.jsonc', '.html', '.md', '.sql', '.txt', '.yml', '.yaml']);
const forbiddenPatterns = [
  [/https:\/\/sgp\.cloud\.appwrite\.io\/v1/i, 'hard-coded Appwrite endpoint'],
  [/cdn\.jsdelivr\.net\/npm\/appwrite/i, 'browser Appwrite SDK import'],
  [/\/databases\/[^\s'"`]+\/collections\//i, 'Appwrite Database REST path'],
  [/netlify\/functions|\.netlify|netlify\.toml/i, 'stale Netlify configuration'],
  [/X-Appwrite-Key\s*[:=]\s*['"][^'"]{20,}/i, 'hard-coded Appwrite key']
];

for (const filePath of files) {
  if (!textExtensions.has(path.extname(filePath).toLowerCase())) continue;
  const relative = path.relative(root, filePath).split(path.sep).join('/');
  if (relative.startsWith('public/data-backups/') || relative === 'scripts/check-project.mjs') continue;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const [pattern, label] of forbiddenPatterns) {
    if (pattern.test(content)) failures.push(`${relative}: ${label}`);
  }
}

for (const relative of ['public/data-backups', 'public/data-fallback']) {
  const directory = path.join(root, relative);
  if (!fs.existsSync(directory)) continue;
  for (const fileName of fs.readdirSync(directory).filter(name => name.endsWith('.json'))) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(directory, fileName), 'utf8'));
      if (!Array.isArray(data.documents)) throw new Error('documents is not an array');
    } catch (error) {
      failures.push(`${relative}/${fileName}: invalid backup JSON (${error.message})`);
    }
  }
}

for (const filePath of files.filter(file => /\.(?:js|mjs)$/.test(file))) {
  const result = spawnSync(process.execPath, ['--check', filePath], { encoding: 'utf8' });
  if (result.status !== 0) {
    failures.push(`${path.relative(root, filePath)}: JavaScript syntax error\n${result.stderr.trim()}`);
  }
}

if (failures.length) {
  console.error(`Project check failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Project check passed (${files.length} files inspected).`);
