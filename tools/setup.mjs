#!/usr/bin/env node

/**
 * 龙高北小站 (LG-Site) —— 全自动化交互式环境配置向导
 * 一键创建 D1 数据库、自动写入 wrangler.json、自动生成强随机安全秘钥并生成 .dev.vars 凭单。
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(promptText, defaultValue = '') {
  return new Promise((resolve) => {
    rl.question(`\x1b[36m? ${promptText}\x1b[0m`, (answer) => {
      const val = answer.trim() || defaultValue;
      resolve(val);
    });
  });
}

function printHeader() {
  console.log('\n=============================================================');
  console.log('   🚀  龙高北小站 (LG-Site) - 专属交互式一键部署与配置向导');
  console.log('=============================================================\n');
  console.log('本向导将带你一步步配置所需的环境变量，并自动创建/关联你的数据存储。\n');
}

function generateRandomHex(byteLength = 32) {
  return crypto.randomBytes(byteLength).toString('hex');
}

async function setup() {
  printHeader();

  // 0. Cloudflare account & login confirmation
  console.log('--- 0. Cloudflare 账号注册与授权登录 ---');
  console.log('说明: Cloudflare 为本社区提供静态网页托管 (Pages)、无服务器后端函数及 D1 SQLite 数据库。');
  console.log(' 1) 如果你还没有 Cloudflare 账号，请打开官网免费注册: https://dash.cloudflare.com/sign-up');
  console.log(' 2) 为让终端能为你自动生成 D1 数据库并绑定，需通过 Wrangler 授权登录你的账号。\n');
  const doLogin = await question('是否现在在命令行调用「npx wrangler login」打开浏览器授权登录？(Y/n，默认 Y): ', 'y');
  if (doLogin.toLowerCase() === 'y' || doLogin.toLowerCase() === 'yes') {
    console.log('\n正在为您调用 Wrangler 授权登录... (请在弹出的浏览器页面中点击 Authorize)\n');
    try {
      execSync('npx wrangler login', { stdio: 'inherit', cwd: rootDir });
      console.log(`\x1b[32m✔ Cloudflare 授权成功！\x1b[0m\n`);
    } catch (e) {
      console.log(`\x1b[33m⚠ 授权可能被中断或您已处于登录状态，咱们继续下一步...\x1b[0m\n`);
    }
  } else {
    await question('👉 请按 [回车键 / Enter] 确认您已登录 Cloudflare 账号并继续...');
  }

  // 1. D1 Database setup
  console.log('\n--- 1. 论坛 D1 数据库配置与一键创建 ---');
  const defaultDbName = 'lg-site-db';
  const dbName = await question(`请为你专属的 Cloudflare D1 数据库命名 (默认: ${defaultDbName}): `, defaultDbName);

  let databaseId = '';
  const shouldCreateD1 = await question(`是否立即通过 Wrangler 一键创建 D1 数据库「${dbName}」? (Y/n，默认 Y): `, 'y');

  if (shouldCreateD1.toLowerCase() === 'y' || shouldCreateD1.toLowerCase() === 'yes') {
    console.log(`\n正在调用 Cloudflare API 创建 D1 数据库... (请确保已通过 npx wrangler login 登录)`);
    try {
      const output = execSync(`npx wrangler d1 create ${dbName}`, { encoding: 'utf8', cwd: rootDir });
      console.log(output);

      // Extract UUID database_id from output
      const idMatch = output.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
      if (idMatch && idMatch[1]) {
        databaseId = idMatch[1];
        console.log(`\x1b[32m✔ 成功捕获 D1 Database ID: ${databaseId}\x1b[0m\n`);
      } else {
        console.log(`\x1b[33m⚠ 未能从命令输出自动匹配到 ID，请在上方日志中找出 database_id 粘贴\x1b[0m`);
      }
    } catch (e) {
      console.log(`\x1b[31m✖ 数据库创建尝试未能完成。若已存在该同名数据库，可直接在下面手动填写 ID。\x1b[0m`);
    }
  }

  if (!databaseId) {
    databaseId = await question(`请粘入你的 D1 Database ID (UUID 格式，无需新建则按回车跳过): `, '');
  }

  // Rewrite wrangler.json if database_id is available
  if (databaseId) {
    const wranglerPath = path.join(rootDir, 'wrangler.json');
    if (fs.existsSync(wranglerPath)) {
      try {
        const wranglerContent = JSON.parse(fs.readFileSync(wranglerPath, 'utf8'));
        if (Array.isArray(wranglerContent.d1_databases) && wranglerContent.d1_databases[0]) {
          wranglerContent.d1_databases[0].database_name = dbName;
          wranglerContent.d1_databases[0].database_id = databaseId;
          fs.writeFileSync(wranglerPath, JSON.stringify(wranglerContent, null, 2) + '\n', 'utf8');
          console.log(`\x1b[32m✔ 已自动将数据库名称 ${dbName} 及 ID 更新至 wrangler.json\x1b[0m\n`);
        }
      } catch (err) {
        console.warn(`\x1b[33m⚠ 更新 wrangler.json 出现异常: ${err.message}\x1b[0m`);
      }
    }
  }

  // 2. Appwrite Auth setup
  console.log('\n--- 2. 用户账号与认证中台 (Appwrite) 创建与接入 ---');
  console.log('说明: Appwrite 为您终身免费托管全论坛的用户登录注册、会话 Token 以及图片/头像文件上传。');
  console.log(' 1) 登录或免费注册 Appwrite Cloud 平台: https://cloud.appwrite.io/');
  console.log(' 2) 登录后点击右上角 [Create project] 创建一个新的社区项目');
  console.log(' 3) 进入项目的 [Overview] 面板，可查看到默认的 API Endpoint 和 Project ID');
  console.log(' 4) 点击左侧栏 [Overview] -> [API Keys] -> [Create API Key]:');
  console.log('    ※ 权限勾选说明: 在 Scopes 权限表中务必勾选 [sessions.write] 与 [users.write] 两项');
  console.log('    ※ 创建成功后请复制保存返回的具体 API Key 秘钥。\n');
  await question('👉 确认已完成 Appwrite 项目创建与 API Key 生成？请按 [回车键 / Enter] 开始录入凭据...');

  const appwriteEndpoint = await question('请输入 Appwrite Endpoint 地址 (默认: https://cloud.appwrite.io/v1): ', 'https://cloud.appwrite.io/v1');
  const appwriteProjectId = await question('请输入你的 Appwrite Project ID (项目唯一 ID): ');
  const appwriteApiKey = await question('请输入你的 Appwrite Server API Key (需包含 sessions.write / users.write 权限): ');

  // 3. Auto generate security secrets
  console.log('\n--- 3. 自动生成会话安全强加密秘钥 ---');
  const authTokenSecret = generateRandomHex(32);
  const backupEncryptKey = generateRandomHex(32);
  console.log(`\x1b[32m✔ 自动生成 64 位 AUTH_TOKEN_SECRET: ${authTokenSecret.slice(0, 10)}...\x1b[0m`);
  console.log(`\x1b[32m✔ 自动生成 64 位 BACKUP_ENCRYPT_KEY: ${backupEncryptKey.slice(0, 10)}...\x1b[0m\n`);

  // 4. Optional Campus Verification Question
  const questionsExample = `[{"id":"q1","question":"校园论坛邀请暗号是什么？","hint":"示例：龙高北","answers":["龙高北"]}]`;

  // 5. Build and write .dev.vars
  const devVarsContent = `# Auto-generated by tools/setup.mjs on ${new Date().toISOString()}
# This file is loaded automatically by Wrangler during local development (npm run dev).
# NEVER commit .dev.vars to Git!

APPWRITE_ENDPOINT=${appwriteEndpoint}
APPWRITE_PROJECT_ID=${appwriteProjectId}
APPWRITE_API_KEY=${appwriteApiKey}

AUTH_TOKEN_SECRET=${authTokenSecret}
BACKUP_ENCRYPT_KEY=${backupEncryptKey}

D1_DATABASE_NAME=${dbName}
D1_DATABASE_ID=${databaseId}

CAMPUS_VERIFY_QUESTIONS=${questionsExample}

# Push Notification VAPID Keys (Optional)
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:admin@example.com

# Auto-Moderation AI Key (Optional)
ZHIPU_API_KEY=

AUTH_SESSION_TTL_SECONDS=3600
AUTH_REFRESH_TTL_SECONDS=2592000
APP_TIMEZONE_OFFSET_MINUTES=480
POST_DAILY_LIMIT=5
COMMENT_DAILY_LIMIT=100
CONFESSION_DAILY_LIMIT=20
`;

  const devVarsPath = path.join(rootDir, '.dev.vars');
  fs.writeFileSync(devVarsPath, devVarsContent, 'utf8');
  console.log(`\x1b[32m✔ 已自动将全部配置安全保存至本地根目录 .dev.vars\x1b[0m\n`);

  // 6. Optional Table Migration
  const migrateChoice = await question('是否立即自动创建/更新数据表? (1: 线上生产 D1 / 2: 本地 SQLite / 0: 暂不, 默认: 0): ', '0');
  if (migrateChoice === '1') {
    console.log('\n正在为您初始化线上 Cloudflare D1 生产环境数据库表...');
    try {
      execSync('npm run d1:migrate:remote', { stdio: 'inherit', cwd: rootDir });
      console.log(`\x1b[32m✔ 线上数据库表结构建立成功！\x1b[0m\n`);
    } catch (e) {
      console.log(`\x1b[31m✖ 迁移出现错误，你可以稍后手动执行: npm run d1:migrate:remote\x1b[0m\n`);
    }
  } else if (migrateChoice === '2') {
    console.log('\n正在为您初始化本地 SQLite 数据库表...');
    try {
      execSync('npm run d1:migrate:local', { stdio: 'inherit', cwd: rootDir });
      console.log(`\x1b[32m✔ 本地数据库表结构建立成功！\x1b[0m\n`);
    } catch (e) {
      console.log(`\x1b[31m✖ 迁移出现错误，你可以稍后手动执行: npm run d1:migrate:local\x1b[0m\n`);
    }
  }

  // 7. Final Instructions & Cloudflare Pages Secret table
  console.log('\n=============================================================');
  console.log('   🎉 恭喜！本地部署与环境向导配置全部完成！');
  console.log('=============================================================');
  console.log('\n【生产与预览环境指引】在 Cloudflare Pages 后台上线时，请进入对应项目:');
  console.log(' 👉 Settings -> Environment variables (Production 与 Preview 两个环境均需填入):');
  console.log('-------------------------------------------------------------');
  console.log(`  APPWRITE_ENDPOINT    =  ${appwriteEndpoint}`);
  console.log(`  APPWRITE_PROJECT_ID  =  ${appwriteProjectId}`);
  console.log(`  APPWRITE_API_KEY     =  (此处已隐藏，见你刚输入的值)`);
  console.log(`  AUTH_TOKEN_SECRET    =  ${authTokenSecret}`);
  console.log('-------------------------------------------------------------');
  console.log(' 👉 Settings -> Functions -> D1 Database bindings 中添加:');
  console.log(`  Variable name: DB   |   D1 database: ${dbName}`);
  console.log(' ⚠️  极重要提示: 填好环境变量与 D1 绑定后，务必重新执行一次 deploy 或点击 [Retry deployment]，新变量才能生效！');
  console.log(' 👉 (额外防护) 防止 Appwrite 云服务长期不使用被休眠 (Pause):');
  console.log(`  在 GitHub 仓库 -> Settings -> Secrets and variables -> Actions -> New repository secret 中:`);
  console.log(`  添加 APPWRITE_PROJECT_ID = ${appwriteProjectId}  (GitHub 将每日两次为您自动保活)`);
  console.log('-------------------------------------------------------------\n');
  console.log('现在你可以运行以下命令测试或部署 (注意将 <你的项目名称> 替换为你 Cloudflare Pages 中的实际英文项目名，如 longgaobei)：');
  console.log('  1. 本地联调预览:   npm run dev');
  console.log('  2. 构建并发布上线 (Mac/Linux/CMD):        npm run build && npx wrangler pages deploy dist --project-name=<你的项目名称>');
  console.log('     构建并发布上线 (Windows PowerShell 5.1):  npm run build; npx wrangler pages deploy dist --project-name=<你的项目名称>\n');

  rl.close();
}

setup().catch((e) => {
  console.error('\x1b[31m发生异常:\x1b[0m', e);
  rl.close();
  process.exit(1);
});
