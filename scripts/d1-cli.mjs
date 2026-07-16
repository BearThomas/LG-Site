import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
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

function generatedConfig(databaseName, databaseId) {
  const configPath = path.join(root, 'wrangler.d1.generated.jsonc');
  const config = {
    $schema: './node_modules/wrangler/config-schema.json',
    name: 'lg-site-d1-cli',
    compatibility_date: '2026-07-15',
    d1_databases: [{
      binding: 'DB',
      database_name: databaseName,
      database_id: databaseId,
      migrations_dir: 'migrations'
    }]
  };
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return configPath;
}

loadEnvFile(path.join(root, '.dev.vars'));

const [action, target] = process.argv.slice(2);
const targets = new Set(['local', 'remote', 'preview']);
if (!['migrate', 'import', 'verify'].includes(action) || !targets.has(target)) {
  console.error('Usage: node scripts/d1-cli.mjs <migrate|import|verify> <local|remote|preview>');
  process.exit(2);
}

const databaseName = String(process.env.D1_DATABASE_NAME || '').trim();
const databaseId = String(process.env.D1_DATABASE_ID || '').trim();
if (!databaseName || !databaseId) {
  console.error('D1_DATABASE_NAME and D1_DATABASE_ID are required in .dev.vars or the current shell.');
  process.exit(1);
}

const targetFlag = `--${target}`;
const configPath = generatedConfig(databaseName, databaseId);
let args;
if (action === 'migrate') {
  args = ['wrangler', 'd1', 'migrations', 'apply', 'DB', targetFlag, '--config', configPath];
} else {
  const file = action === 'import'
    ? path.join(root, 'generated', 'd1-import.sql')
    : path.join(root, 'verification', 'verify.sql');
  if (!fs.existsSync(file)) {
    fs.rmSync(configPath, { force: true });
    console.error(`Required SQL file is missing: ${path.relative(root, file)}`);
    process.exit(1);
  }
  args = ['wrangler', 'd1', 'execute', 'DB', targetFlag, '--file', file, '--yes', '--config', configPath];
}

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(npx, args, {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
  shell: process.platform === 'win32'
});
fs.rmSync(configPath, { force: true });
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
