# LG-Site：Appwrite Database → Cloudflare D1 迁移说明

## 已完成的改造

- Appwrite **Account/Auth 和 Storage 保留**；原 `Databases` 客户端已尽量自动替换为 `D1Databases` 兼容层。
- 新增 Pages Function：`/api/d1`，数据库通过 `context.env.DB` D1 Binding 访问。
- 新增 `/api/runtime-config.js`，浏览器只拿到 Appwrite Endpoint、Project ID 等公开配置。
- 新增幂等迁移脚本和已经从你上传的备份生成好的 SQL。
- 所有真正的密钥都改为环境变量；示例文件不包含真实值。

## 这次本地备份能恢复多少

- 可识别文档：**36**
- 识别出的数据库/集合组合：**4**
- 备份中最新 `$updatedAt`：**2026-06-26T12:15:17.948Z**
- 详细分集合数量：`migration/generated/manifest.json`
- 自动生成 SQL：`migration/generated/001-documents.sql` 等

当前 Appwrite Database 因读取额度被锁，**本方案导入本地备份时完全不访问 Appwrite Database**。因此现在就能恢复备份里已有的数据。

备份时间点之后的新数据如果既不在本地备份、也不在其他日志/缓存中，当前无法凭空重建。不要删除 Appwrite 项目；额度重置后再做一次新导出，然后重新运行生成器和导入命令。SQL 使用 upsert，重复执行不会重复插入，并会用较新的 `updated_at` 覆盖旧快照。

## 1. 创建并绑定 D1

在 Cloudflare 创建 D1 数据库，例如 `lg-site-db`。然后在 **Workers & Pages → 你的 Pages 项目 → Settings → Bindings** 添加：

- 类型：D1 database
- 变量名：`DB`
- 数据库：刚创建的 `lg-site-db`

Production 和 Preview 环境都要按你的需要分别设置，随后重新部署。

也可以复制 `wrangler.d1.example.jsonc` 为 `wrangler.jsonc`，把占位的 `database_id` 换成自己的值。

## 2. 配置环境变量

参照 `.dev.vars.example`，至少配置：

```text
APPWRITE_ENDPOINT
APPWRITE_PROJECT_ID
APPWRITE_DATABASE_IDS_JSON
APPWRITE_COLLECTION_IDS_JSON
D1_PUBLIC_READ_COLLECTIONS
D1_ADMIN_USER_IDS
```

`APPWRITE_ENDPOINT` 和 `APPWRITE_PROJECT_ID` 会通过 `/api/runtime-config.js` 提供给浏览器，它们不是管理员密钥。`APPWRITE_API_KEY` 不参与正常运行；以后做服务器端补导时才可能需要，并且必须保存成 Secret。

`D1_PUBLIC_READ_COLLECTIONS` 应只放帖子、评论、表白等本来就允许公开读取的集合。不要把私密用户资料集合设为公开。候选 ID 见 `migration/collection-policy-suggestions.json`。

## 3. 导入架构和现有备份

项目目录执行：

```bash
npm install
node tools/apply-d1-import.mjs --database lg-site-db --remote
```

该命令依次执行：

1. `migrations/0001_d1_compat.sql`
2. `migration/generated/` 里的所有数据分片

本地测试则执行：

```bash
node tools/apply-d1-import.mjs --database lg-site-db --local
```

## 4. 部署前检查

- 打开 `migration/TRANSFORMATION_REPORT.md`，确认所有实际使用 `Databases` 的文件都被替换。
- 检查 `migration/SECURITY_NOTICE.md`；如果旧源码曾硬编码 API Key，请立即到 Appwrite 后台撤销并重建旧 Key。
- 在本地/Preview 测试注册、登录、帖子列表、发帖、修改、删除。
- 不要删除 Appwrite Database，至少保留到补导完成并核对数量以后。

## 5. 后续拿到更新备份时补数据

把新导出的 JSON 目录放到任意位置，然后运行：

```bash
node tools/prepare-d1-import.mjs --source /path/to/new-backup --output migration/generated --database-id <原数据库ID>
node tools/apply-d1-import.mjs --database lg-site-db --remote
```

生成器会按 `(database_id, collection_id, document_id)` 去重，并优先保留更新时间较新的记录。

## 兼容范围

兼容层支持项目最常用的：`listDocuments`、`getDocument`、`createDocument`、`updateDocument`、`deleteDocument`、数字增减，以及常见 Appwrite Query。Appwrite 的事务、复杂关系查询、全文索引和全部权限模型并未一比一复刻；迁移报告会列出仍需人工复核的调用。

## 公开 ID 也已集中配置

数据库 ID、集合 ID 本身不是管理员密钥，但项目中可识别的全大写配置常量也已迁到 `APPWRITE_DATABASE_IDS_JSON` 与 `APPWRITE_COLLECTION_IDS_JSON`。现有值和变量名见 `migration/detected-public-id-maps.json`；将 `.dev.vars.example` 中对应两行复制到 Cloudflare Variables。
