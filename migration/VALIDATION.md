# 自动验证结果

生成时间：2026-07-15T12:13:59.130972+00:00

- PASS `node --check functions/api/d1.js`
- PASS `node --check functions/api/runtime-config.js`
- PASS `node --check functions/_lib/http.js`
- PASS `node --check functions/_lib/auth.js`
- PASS `node --check functions/_lib/permissions.js`
- PASS `node --check functions/_lib/queries.js`
- PASS `node --check functions/_lib/documents.js`
- PASS `node --check lib/d1-appwrite-compat.js`
- PASS `node --check tools/prepare-d1-import.mjs`
- PASS `node --check tools/apply-d1-import.mjs`

- 生成 SQL 分片：1
- manifest 文档数：36
- manifest 集合数：4
- 原项目构建：未运行（最终使用者安装依赖后按原项目命令验证）
