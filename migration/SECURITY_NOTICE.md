# 安全检查

静态扫描未发现明确的长 API Key；仍应在 Cloudflare Dashboard 中复核 Variables and Secrets。

新项目只提交 `.dev.vars.example` / `.env.example`，真实 `.dev.vars`、`.env` 已加入 `.gitignore`。
