import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const devVarsPath = path.join(rootDir, '.dev.vars');

function generateSecret(length = 32) {
  return crypto.randomBytes(length).toString('hex');
}

function parseEnvFile(filePath) {
  const vars = {};
  if (!fs.existsSync(filePath)) return vars;
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
    vars[key] = value;
  }
  return vars;
}

const isGenerateOnly = process.argv.includes('--generate') || process.argv.includes('-g');

if (isGenerateOnly) {
  console.log('\n=============================================================');
  console.log('   🔑 新生成的高强度 64 位十六进制签名安全秘钥');
  console.log('=============================================================');
  const newSecret = generateSecret(32);
  console.log(`\n  ${newSecret}\n`);
  console.log('你可以直接复制上述秘钥作为 AUTH_TOKEN_SECRET 或 BACKUP_ENCRYPT_KEY 使用！\n');
  process.exit(0);
}

const vars = parseEnvFile(devVarsPath);

const endpoint = vars.APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1';
const projectId = vars.APPWRITE_PROJECT_ID || '尚未填写 (请通过 npm run setup 配置)';
const apiKey = vars.APPWRITE_API_KEY || '尚未填写 (请通过 npm run setup 配置)';
const authTokenSecret = vars.AUTH_TOKEN_SECRET || generateSecret(32);
const dbName = vars.D1_DATABASE_NAME || 'lg-site-db';

console.log('\n=============================================================');
console.log('   🔑 LG-Site 环境变量与密钥查看提取程序 (show-secrets)');
console.log('=============================================================');
console.log('\n【方式 A：网页后台批量粘贴版 (一行一个 KEY=VALUE)】');
console.log('直接整块选中复制以下 4 行文本，去 Cloudflare 后台 -> 对应项目');
console.log('Settings -> Environment variables -> (Production 和 Preview 均点 Add variable) 整体粘贴:');
console.log('-------------------------------------------------------------');
console.log(`APPWRITE_ENDPOINT=${endpoint}`);
console.log(`APPWRITE_PROJECT_ID=${projectId}`);
console.log(`APPWRITE_API_KEY=${apiKey}`);
console.log(`AUTH_TOKEN_SECRET=${authTokenSecret}`);
console.log('-------------------------------------------------------------');
console.log('\n【方式 B：一行命令批量将 .dev.vars 上传至 Cloudflare Pages 云端】');
console.log('  npx wrangler pages secret bulk .dev.vars --project-name=<你的实际项目名称>');
console.log('\n【D1 数据库绑定要求 (Production 与 Preview 均需添加)】');
console.log(`  Variable name: DB   |   D1 database: ${dbName}`);
console.log('\n【GitHub Actions 保活需要用到的项目 ID 秘钥】');
console.log(`  APPWRITE_PROJECT_ID = ${projectId}`);
console.log('-------------------------------------------------------------');
console.log('💡 提示：如需随时生成一个全新的高强度 64 位秘钥，可运行: npm run secrets:generate\n');
