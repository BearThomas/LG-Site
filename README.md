# LG-Site：Cloudflare D1 版

这是 LG-Site 从 Appwrite Database 迁移到 Cloudflare D1 后的项目版本。

迁移后的职责划分：

```text
浏览器
  │
  ├─ 静态页面：Cloudflare Pages
  │
  └─ /api/*：Cloudflare Pages Functions
          │
          ├─ 用户注册、登录、密码：Appwrite Auth
          └─ 用户公开资料、帖子、评论、表白墙：Cloudflare D1
```

Appwrite 只继续承担账号与会话，不再读取 Appwrite Database。因此，即使 Appwrite 当前提示 Database reads 超限，也不妨碍使用本地 JSON 备份生成 D1 导入文件。

## 已完成的改动

- 将用户资料、帖子、评论和表白墙迁移到 D1。
- 保留现有 Appwrite Auth 账号，用户不需要重新注册。
- 登录会话由 Pages Function 创建，并保存为同源 `HttpOnly` Cookie；会话密钥不再写入浏览器 `localStorage`。
- 前端原有 `Databases` / `Query` 调用方式通过 `js/d1-appwrite-compat.js` 兼容，实际请求进入 `/api/data`。
- 所有 Appwrite Endpoint、Project ID、API Key、令牌签名密钥和验证题答案都改为环境变量。
- 保留原项目的 `public/data-backups`，文件内容未改动。
- 增加 `public/data-fallback`，只包含适合公开展示的降级快照。
- 增加可重复运行的备份合并与 D1 SQL 生成脚本。
- 增加 D1 数据库迁移、验证 SQL 和独立备份仓库。

## 当前恢复结果

根据项目内现有的 `public/data-backups` 和独立备份仓库，迁移脚本恢复出：

| 数据 | 数量 |
|---|---:|
| D1 用户资料 | 11 |
| 帖子 | 21 |
| 有效评论 | 12 |
| 表白墙记录 | 9 |
| 无法匹配原帖的历史评论 | 1 |

其中 8 个用户资料是根据历史内容作者 ID 自动补建的占位资料。那条无法匹配原帖的评论不会被静默丢弃，而是写入 `migration_orphans` 表。

Appwrite Auth 中原有的其他账号仍然存在。某个老用户第一次登录新版本时，如果 D1 中还没有对应资料，后端会按其 Appwrite 账号自动创建 D1 用户行。没有出现在任何备份中的旧昵称、头像等资料无法凭空恢复，首次补建时会使用默认值，用户之后可以在个人中心修改。

## 备份目录规则

### `public/data-backups`

这是你特别要求保留的原始备份目录：

- 四个 JSON 文件与原项目逐字节一致。
- 迁移生成器将这里的数据设为最高优先级。
- 构建时会继续复制到部署产物中。
- 因为目录在 `public` 下，部署后任何访客都可能下载这些文件。不要把 `BACKUP_ENCRYPT_KEY` 放进前端，也不要在这里新增未加密的隐私数据。

### `public/data-fallback`

这是新增加的公开降级快照：

- 只保留公开帖子、对应评论、必要的公开用户资料和已公开的匿名表白。
- 不包含邮箱、权限、禁言状态、私密帖子作者等敏感字段。
- 页面在 D1 接口暂时不可用时可以读取它。

完整历史归档与公开降级快照由独立的备份项目管理。

## 环境要求

- Node.js 20 或更高版本
- npm
- Cloudflare 账号
- 已有的 Appwrite 项目

安装依赖：

```bash
npm install
```

## 本地环境变量

复制示例文件：

```bash
cp .dev.vars.example .dev.vars
```

Windows PowerShell：

```powershell
Copy-Item .dev.vars.example .dev.vars
```

`.dev.vars` 只用于本地开发，已经被 `.gitignore` 排除。

| 变量 | 是否敏感 | 用途 |
|---|---|---|
| `APPWRITE_ENDPOINT` | 否 | Appwrite API Endpoint，结尾包含 `/v1` |
| `APPWRITE_PROJECT_ID` | 否 | Appwrite 项目 ID |
| `APPWRITE_API_KEY` | 是 | 服务端创建账号和登录会话 |
| `AUTH_TOKEN_SECRET` | 是 | LG-Site 应用令牌的 HMAC 签名密钥，至少 32 字符 |
| `CAMPUS_VERIFY_QUESTIONS` | 是 | 注册验证题及答案的 JSON |
| `D1_DATABASE_NAME` | 否 | Wrangler 命令使用的 D1 数据库名称 |
| `D1_DATABASE_ID` | 否 | 本地 `wrangler pages dev` 的 D1 绑定 ID |
| `BACKUP_ENCRYPT_KEY` | 是 | 本地解密历史备份；Pages 运行时不需要 |
| `AUTH_SESSION_TTL_SECONDS` | 否 | 浏览器中短期 LG 应用令牌时长，默认 3600 秒 |
| `AUTH_REFRESH_TTL_SECONDS` | 否 | HttpOnly Appwrite 会话 Cookie 的最长保留时长 |

生成随机签名密钥和备份密钥：

```bash
node -e "const c=require('node:crypto'); console.log('AUTH_TOKEN_SECRET='+c.randomBytes(32).toString('hex')); console.log('BACKUP_ENCRYPT_KEY='+c.randomBytes(32).toString('hex'))"
```

### Appwrite API Key 权限

本项目运行时只需要：

- `sessions.write`：服务端创建登录会话并取得 `session.secret`。
- `users.write`：创建新账号；注册失败时回滚新建账号。

不需要给这个 Key 增加 Appwrite Database、Tables、Rows 或 Storage 权限。API Key 只能配置在 Cloudflare Pages 的 Secret 中，不能写入前端代码。

## Cloudflare Pages 配置

### 构建配置

```text
Build command: npm run build
Build output directory: dist
Root directory: 仓库根目录
```

### D1 绑定

在 Pages 项目的生产环境中添加 D1 Binding：

```text
Variable name: DB
D1 database: 你创建的 lg-site-db
```

代码固定通过 `context.env.DB` 读取数据库，因此绑定名必须是大写 `DB`。添加或修改 Binding 后需要重新部署。若 Preview 部署也要联网测试，请在 Preview 环境中添加同名绑定。

### Pages 环境变量与 Secret

建议作为普通变量：

```text
APPWRITE_ENDPOINT
APPWRITE_PROJECT_ID
AUTH_SESSION_TTL_SECONDS
AUTH_REFRESH_TTL_SECONDS
APP_TIMEZONE_OFFSET_MINUTES
POST_DAILY_LIMIT
COMMENT_DAILY_LIMIT
CONFESSION_DAILY_LIMIT
```

建议加密保存：

```text
APPWRITE_API_KEY
AUTH_TOKEN_SECRET
CAMPUS_VERIFY_QUESTIONS
```

`BACKUP_ENCRYPT_KEY` 不需要配置到 Pages 运行时。它只应存在于你的本地迁移环境和私有备份仓库的 GitHub Secrets 中。

## 数据迁移

完整步骤见 [`MIGRATION.md`](MIGRATION.md)。核心流程是：

```bash
npm run d1:prepare -- --backup-root ../LG-Site-Backup-D1-ready/backups
npm run d1:migrate:remote
npm run d1:import:remote
npm run d1:verify:remote
```

`d1:prepare` 完全读取本地文件，不会调用 Appwrite Database。它会：

1. 读取 `public/data-backups`。
2. 读取独立备份仓库的 `backups/last` 与历史周目录。
3. 兼容 UTF-8 BOM 和旧文件名拼写错误 `conmmets.json`。
4. 按文档 ID 去重，优先采用更新时间较新的记录；时间相同时优先采用 `public/data-backups`。
5. 使用 `BACKUP_ENCRYPT_KEY` 解密历史字段。
6. 生成 `generated/d1-import.sql`、迁移报告与 `public/data-fallback`。

`generated/d1-import.sql` 含有解密后的真实内容，已经被 `.gitignore` 排除。导入完成后应删除，不要上传到 GitHub、网盘或聊天群。

## 常用命令

```bash
# 检查代码、备份格式并构建静态产物
npm run check

# 生成 D1 导入 SQL
npm run d1:prepare -- --backup-root ../LG-Site-Backup-D1-ready/backups

# 本地数据库
npm run d1:migrate:local
npm run d1:import:local
npm run d1:verify:local

# 远程数据库
npm run d1:migrate:remote
npm run d1:import:remote
npm run d1:verify:remote

# 本地启动 Pages + Functions
npm run dev
```

D1 命令会从 `.dev.vars` 或当前 Shell 环境读取 `D1_DATABASE_NAME` 和 `D1_DATABASE_ID`，临时生成 Wrangler 配置并在执行后删除，因此不需要把数据库 ID 写死进仓库。

## 目录结构

```text
functions/
  _lib/                   后端公共模块
  api/                    Pages Functions API
js/
  d1-appwrite-compat.js   前端 D1 兼容层
migrations/
  0001_initial.sql        D1 表与索引
scripts/
  build-d1-import.mjs     合并本地备份并生成导入 SQL
  d1-cli.mjs              D1 migrate/import/verify 命令包装
  build-static.mjs        生成 dist
verification/
  verify.sql              数量、评论计数与外键检查
public/
  data-backups/           原始备份，按要求原样保留
  data-fallback/          脱敏公开降级快照
generated/                私密临时产物，不提交
MIGRATION.md              上线迁移手册
```

## 安全说明

- Appwrite session secret 只保存在同源 `HttpOnly` Cookie 中，前端 JavaScript 无法读取。
- 旧版本曾保存在 `localStorage` 的会话值会在一次 `/api/auth-me` 校验后迁入 Cookie，并从本地资料中删除。
- 浏览器只保存短期的 `appToken` 和公开资料。即使 `appToken` 过期，只要 Appwrite 会话仍有效，后端可以重新签发。
- 所有写操作都在 Pages Function 中重新验证当前用户，不能依赖前端传来的用户 ID。
- SQL 使用 Prepared Statements 与 `.bind()`，用户输入不会直接拼接进 SQL。
- 私密帖、班级帖、定向帖和表白作者的可见性均由后端检查。
- `public/data-backups` 会被公开托管，这是保留该目录的直接结果；请把解密密钥严格放在服务端或本地。

## 部署前检查清单

- [ ] D1 数据库已经创建。
- [ ] `migrations/0001_initial.sql` 已应用到远程数据库。
- [ ] 私密导入 SQL 已导入并通过 `verification/verify.sql`。
- [ ] Pages 的 D1 Binding 名称为 `DB`。
- [ ] Appwrite API Key 包含 `sessions.write` 和 `users.write`。
- [ ] Pages Secrets 已配置，源码中没有真实密钥。
- [ ] `npm run check` 通过。
- [ ] 登录、发帖、评论、表白、资料修改和退出登录已在 Preview 环境测试。
- [ ] 导入后的 `generated/d1-import.sql` 已从电脑和临时传输位置安全删除或加密保存。

## 免责声明

这是学生独立维护的非官方校园项目。请勿在帖子、备份或环境变量中存放身份证号、教务系统密码等高敏感信息。站点管理者仍需根据实际情况配置内容审核、防刷策略、Cloudflare 安全规则和定期备份。
