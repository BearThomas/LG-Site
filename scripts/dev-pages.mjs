import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(path.join(root, '.dev.vars'));
const databaseId = String(process.env.D1_DATABASE_ID || '').trim();
if (!databaseId) {
  console.error('D1_DATABASE_ID is missing. Copy .dev.vars.example to .dev.vars and fill it first.');
  process.exit(1);
}

const child = spawn(npx, ['wrangler', 'pages', 'dev', 'dist', '--d1', `DB=${databaseId}`], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
  shell: true
});
child.on('exit', code => process.exit(code ?? 1));
child.on('error', error => {
  console.error(error.message);
  process.exit(1);
});
