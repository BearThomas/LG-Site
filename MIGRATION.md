# LG-Site 从本地备份迁移到 Cloudflare D1

这份手册针对当前情况：Appwrite Database 已经因为读取额度被锁住，无法再在线导出。

本方案不需要读取 Appwrite Database。数据来源是：

1. 主项目内原样保留的 `public/data-backups`。
2. 独立备份项目内的 `backups/last`。
3. 独立备份项目内各历史周目录。

Appwrite Auth 不迁移，原账号和密码继续保留。

## 0. 先备份交付文件

解压并保留两个项目：

```text
LG-Site-D1-ready/
LG-Site-Backup-D1-ready/
```

不要删除：

```text
LG-Site-D1-ready/public/data-backups/
LG-Site-Backup-D1-ready/backups/
```

不要把我单独交付的 `LG-Site-D1-private-import.sql` 提交到 Git。它含有已解密的数据。

## 1. 安装依赖并登录 Cloudflare

进入主项目：

```bash
cd LG-Site-D1-ready
npm install
npx wrangler login
npx wrangler whoami
```

## 2. 创建 D1

建议数据库名称保持为 `lg-site-db`：

```bash
npx wrangler d1 create lg-site-db --location=apac
```

记录命令输出中的：

```text
database_name
database_id
```

数据库名称可以改，但后续 `.dev.vars` 中的 `D1_DATABASE_NAME` 必须与之相同。

## 3. 准备本地变量

macOS / Linux：

```bash
cp .dev.vars.example .dev.vars
```

Windows PowerShell：

```powershell
Copy-Item .dev.vars.example .dev.vars
```

编辑 `.dev.vars`：

```dotenv
APPWRITE_ENDPOINT=https://你的区域.cloud.appwrite.io/v1
APPWRITE_PROJECT_ID=你的项目ID
APPWRITE_API_KEY=你的服务端APIKey
AUTH_TOKEN_SECRET=至少32字符的随机密钥
CAMPUS_VERIFY_QUESTIONS=[{"id":"q1","question":"题目一","hint":"","answers":["答案"]},{"id":"q2","question":"题目二","hint":"","answers":["答案"]}]

D1_DATABASE_NAME=lg-site-db
D1_DATABASE_ID=刚才创建D1时返回的UUID

BACKUP_ENCRYPT_KEY=原备份使用的64位十六进制密钥
AUTH_SESSION_TTL_SECONDS=3600
AUTH_REFRESH_TTL_SECONDS=2592000
APP_TIMEZONE_OFFSET_MINUTES=480
POST_DAILY_LIMIT=5
COMMENT_DAILY_LIMIT=100
CONFESSION_DAILY_LIMIT=20
```

`.dev.vars` 不会进入 Git。

### 找不到原备份密钥怎么办

项目原来的本地 `.env` 中如果存在 `ENCRYPT_KEY`，把它的值复制为：

```dotenv
BACKUP_ENCRYPT_KEY=原ENCRYPT_KEY的值
```

不要把旧 `.env` 上传到仓库，也不要把密钥发给其他人。

如果历史备份里存在加密字段但密钥丢失，对应内容无法可靠恢复；迁移脚本会明确报错，不会把密文误当正文导入。

## 4. 检查 Appwrite API Key

在 Appwrite 控制台创建一个只供本项目后端使用的 API Key，并只授予：

```text
sessions.write
users.write
```

原因：

- `sessions.write` 用于服务端登录并获得 `session.secret`。
- `users.write` 用于新用户注册以及注册失败时回滚。

不需要授予 Appwrite Database、Tables、Rows 或 Storage 权限。把 Key 只填进 `.dev.vars` 和 Cloudflare Pages Secret。

## 5. 从本地 JSON 生成导入 SQL

在两个项目位于同一父目录时运行：

```bash
npm run d1:prepare -- --backup-root ../LG-Site-Backup-D1-ready/backups
```

脚本不会调用 Appwrite API。成功后会显示类似：

```text
Users: 11
Posts: 21
Comments: 12
Confessions: 9
Orphan comments: 1
```

输出：

```text
generated/d1-import.sql
generated/migration-report.json
public/data-fallback/users.json
public/data-fallback/posts.json
public/data-fallback/comments.json
public/data-fallback/confessions.json
```

合并规则：

1. `public/data-backups` 优先级最高。
2. `backups/last` 次之。
3. 历史周目录用于补缺。
4. 同一个文档 ID 选择更新时间较新的版本。
5. 支持旧文件的 UTF-8 BOM。
6. 支持历史拼写错误 `conmmets.json`。
7. 缺少用户资料但仍有内容作者 ID 时，自动建立占位资料。
8. 找不到原帖的评论写入 `migration_orphans`。

## 6. 应用数据库结构

```bash
npm run d1:migrate:remote
```

这会应用 `migrations/0001_initial.sql`，创建：

```text
users
posts
comments
confessions
migration_orphans
```

以及列表查询所需的索引。

## 7. 导入数据

使用项目内刚生成的文件：

```bash
npm run d1:import:remote
```

或者使用单独交付的私密 SQL：

```bash
npx wrangler d1 execute lg-site-db --remote --file=../LG-Site-D1-private-import.sql --yes
```

导入语句根据文档 ID 和更新时间执行 upsert，重复运行不会简单追加重复记录。但正式操作前仍建议先保留加密备份。

## 8. 验证数据

```bash
npm run d1:verify:remote
```

正常结果应满足：

- 返回各表数量。
- 评论计数不一致查询返回 0 行。
- `PRAGMA foreign_key_check` 返回 0 行。

还可以手动检查：

```bash
npx wrangler d1 execute lg-site-db --remote --command="SELECT COUNT(*) AS total FROM migration_orphans;"
```

当前本地备份应有 1 条 orphan 记录。

## 9. 绑定 D1 到 Cloudflare Pages

进入：

```text
Cloudflare Dashboard
→ Workers & Pages
→ 你的 LG-Site Pages 项目
→ Settings
→ Bindings
→ Add
→ D1 database
```

填写：

```text
Variable name: DB
D1 database: lg-site-db
```

生产环境必须配置。需要 Preview 测试时，也在 Preview 环境配置同名 `DB` Binding。配置后重新部署项目。

## 10. 配置 Pages 环境变量

普通变量：

```text
APPWRITE_ENDPOINT
APPWRITE_PROJECT_ID
AUTH_SESSION_TTL_SECONDS=3600
AUTH_REFRESH_TTL_SECONDS=2592000
APP_TIMEZONE_OFFSET_MINUTES=480
POST_DAILY_LIMIT=5
COMMENT_DAILY_LIMIT=100
CONFESSION_DAILY_LIMIT=20
```

Secret：

```text
APPWRITE_API_KEY
AUTH_TOKEN_SECRET
CAMPUS_VERIFY_QUESTIONS
```

不要在 Pages 中配置：

```text
BACKUP_ENCRYPT_KEY
D1_DATABASE_ID
```

`BACKUP_ENCRYPT_KEY` 只用于本地数据恢复和备份仓库；Pages 运行时不需要。D1 由 `DB` Binding 提供，不通过数据库 ID 的环境变量访问。

## 11. 部署项目

Pages 构建设置：

```text
Build command: npm run build
Build output directory: dist
```

部署前本地检查：

```bash
npm run check
```

## 12. 上线验证顺序

按下面顺序测试，每一步都成功后再继续：

1. 打开首页和帖子列表。
2. 使用一个已有 Appwrite 账号登录。
3. 刷新页面，确认仍保持登录。
4. 发布一篇测试帖。
5. 发表评论，再删除自己的评论。
6. 编辑和删除自己的测试帖。
7. 发布表白墙测试内容。
8. 修改昵称和头像。
9. 退出登录，确认受保护操作返回未登录。
10. 使用一个备份中没有 D1 资料的老账号登录，确认自动补建用户资料。

## 13. 为什么 221 个账号不需要全部导入

221 个账号仍保存在 Appwrite Auth，而不是 Appwrite Database。新系统登录时会：

```text
验证 Appwrite 账号密码
→ 读取 Appwrite Account 身份
→ 查询 D1 users
→ 缺少则自动 INSERT
→ 签发短期 LG appToken
→ 把 Appwrite session secret 写入 HttpOnly Cookie
```

因此不用先从 Appwrite Users 列表批量读取 221 人，也不会消耗 Appwrite Database Reads。

备份中仅恢复出 11 条业务资料。其余账号首次登录时会补建默认资料。旧昵称、头像若没有出现在 JSON 备份中，就只能由用户重新设置。

## 14. 私密文件处理

以下文件含有解密后的数据：

```text
generated/d1-import.sql
generated/migration-report.json
LG-Site-D1-private-import.sql
LG-Site-D1-migration-report.json
```

导入结束后：

```bash
rm -f generated/d1-import.sql generated/migration-report.json
```

Windows PowerShell：

```powershell
Remove-Item generated/d1-import.sql, generated/migration-report.json
```

如需留存，应放进加密磁盘或密码管理的私密存储，不能提交到公开仓库。

## 15. 回滚思路

上线前不要删除 Appwrite Auth，也不要删除原始 JSON 备份。

如果新版本出现问题：

1. 在 Pages 中回滚到上一个稳定部署。
2. 保留 D1，不要删除。
3. 修复代码后重新部署。
4. 数据层可以用独立备份仓库中的加密 SQL 或 JSON 恢复。

D1 版不再依赖 Appwrite Database，因此 Appwrite Database 额度恢复后也不需要切回去。
