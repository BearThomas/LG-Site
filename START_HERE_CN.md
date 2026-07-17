# 从这里开始

这个版本的目标是：

- **Appwrite 继续负责账号登录和文件存储**；
- **Cloudflare D1 接管原 Appwrite Database 文档读写**；
- 旧页面仍尽量使用原来的 `Databases` 调用写法，由兼容层转发到 `/api/d1`；
- 上传的备份已经转换为可重复导入的 D1 SQL。

## 最少操作

1. 在 Cloudflare 新建一个 D1 数据库，建议叫 `lg-site-db`。
2. 在 Pages 项目设置里添加 D1 Binding：变量名必须是 **`DB`**。
3. 按 `.dev.vars.example` 在 Pages 的 Variables and Secrets 中设置环境变量。
4. 在本项目目录运行：

```bash
npm install
node tools/apply-d1-import.mjs --database lg-site-db --remote
```

5. 部署这个项目，在 Preview 环境依次测试：登录、帖子列表、发帖、评论、点赞、删除。

## 现在 Appwrite 读不了也能导入吗？

能。`migration/generated/` 中的 SQL 是直接从你上传的本地备份生成的，导入过程不会请求 Appwrite Database。

但有一个无法绕过的事实：**备份最后时间点之后、又没有被其他地方保存的数据，目前不能凭空恢复。** 请保留原 Appwrite 项目。额度重置后再导出一次最新数据，重复运行生成与导入命令即可补齐；导入使用 upsert，不会产生重复文档。

完整说明见 `MIGRATION_GUIDE_CN.md`；恢复范围见 `migration/generated/RECOVERY_STATUS.md`；自动改动范围见 `migration/TRANSFORMATION_REPORT.md`。
