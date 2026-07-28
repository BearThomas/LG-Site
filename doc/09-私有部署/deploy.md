---
title: 我也要部署 (私有化部署指南)
order: 1
---

# 龙高北小站 —— 零成本私有化一键部署指南

欢迎使用 **龙高北小站（LG-Site）**！本项目采用轻量且强大的 **现代混合架构**，所有核心变量均已解耦为标准化环境变量，支持交互式一键向导配置，**零服务器成本、免配置 Nginx、无需备案**：

1. **用户认证与文件存储 (Appwrite)**：由 **Appwrite** 负责账号注册登录与头像/发帖图片的存储（推荐用官方免费云 [Appwrite Cloud](https://cloud.appwrite.io/)）。
2. **数据持久化与计算引擎 (Cloudflare D1 + Functions)**：由 **Cloudflare D1 (无服务器 SQLite)** 负责各类帖子、动态与评论读写；由 **Cloudflare Pages** 分发全球静态 CDN 与 API 函数。

---

## 一、 快速克隆项目与获取依赖

在电脑命令行终端（Terminal / PowerShell）依次执行以下指令：

```bash
# 1. 克隆源码至本地
git clone https://github.com/BearThomas/LG-Site.git

# 2. 进入工作空间
cd LG-Site

# 3. 安装依赖项目 (包括 wrangler 等 CLI 工具)
npm install
```

---

## 二、 [强烈推荐] 运行全自动交互式配置向导 (`npm run setup`)

为摆脱繁琐的手动改表和找 UUID 的步骤，本项目提供极简配置命令：

```bash
npm run setup
```

命令启动后，交互向导会带你逐步轻松完成全部必要步骤：
1. **Cloudflare 账号引导与授权登录**：向导首先会检查你是否开通了 Cloudflare 账号，并支持一键在终端调用 `npx wrangler login` 打开浏览器完成授权，或通过按回车键直接进入确认流程。
2. **自定义 Cloudflare D1 数据库命名**：你可以为数据库任意命名（例如 `my-forum-db`）。
3. **全自动创建与绑定**：向导会在后台直接帮你执行 `npx wrangler d1 create <你取的名字>`，**自动捕获返回的 Database ID 并将 `wrangler.json` 中的名称与 ID 回填更新**！
4. **Appwrite 账号建站与鉴权配置指引**：向导会分步告诉你如何免费注册 [Appwrite Cloud](https://cloud.appwrite.io/)、新建项目，以及必须勾选哪些 Key 权限（`sessions.write` 和 `users.write`），附带按回车确认环节，让你无门槛轻松填入 Endpoint、Project ID 及 API Key。
5. **随机加密秘钥自动生成**：向导会自动为你随机生成两组 64 位无规律高强度的十六进制机密字符串作为 `AUTH_TOKEN_SECRET` 和 `BACKUP_ENCRYPT_KEY`，省去手敲风险。
6. **本地配置文件安全持久化**：所有环境变量将以加密隔离规范写入根目录 **`.dev.vars`** 文件中。因受 `.gitignore` 保护，其凭密永远不会被上传至 Git，确保代码安全。
7. **一键数据库迁移**：询问并直接为你将全部初始数据库架构（12 张表）一键创建至生产或调试空间。

---

## 三、 本地调试 (npm run dev) 与一键上线验证

完成向导配置后，推荐首先进行本地调测运行：

```bash
npm run dev
```
打开 `http://localhost:8788`，你可以立刻测试发帖、用户认证与权限功能。

### 上线部署发布：只需 2 个操作

#### 1. 命令行打包上传至 Cloudflare Pages
注意：请将命令中的 `<你的项目名称>` 替换为你在 Cloudflare Pages 中的实际英文名称（例如你的网站是 `longgaobei.pages.dev`，项目名称就是 `longgaobei`）：
```bash
# Mac / Linux / Windows CMD 命令提示符 (使用 &&):
npm run build && npx wrangler pages deploy dist --project-name=<你的项目名称>

# Windows PowerShell 5.1 (使用分号 ; 连接):
npm run build; npx wrangler pages deploy dist --project-name=<你的项目名称>
```

#### 2. 在 Cloudflare 后台填入向导提示的生产机密 (Secret)
由于云端函数安全隔离规则，在 `npx wrangler pages deploy` 发布后，前往 [Cloudflare Dash](https://dash.cloudflare.com/) 对应站点的 **Settings -> Environment variables -> Production** 页面，粘贴你由向导最后输出给你的配置清单：

| 生产环境变量 / Secret 名称 | 建议值 / 说明 |
| :--- | :--- |
| `APPWRITE_ENDPOINT` | 默认 `https://cloud.appwrite.io/v1` |
| `APPWRITE_PROJECT_ID` | 向导给你的 Appwrite Project ID |
| `APPWRITE_API_KEY` | 向导中你传入并经安全检查的 API Key |
| `AUTH_TOKEN_SECRET` | 向导自动生成的 64 位十六进制签名安全键 |

同时，在 **Settings -> Functions -> D1 Database bindings** 中，绑定一个为名 **`DB`**、绑定到你自定义名称（如 `my-forum-db`）的 D1 数据库。

---

### 额外防护：如何防止 Appwrite 免费云因为长期无访问被休眠？
Appwrite Cloud 免费平台在长期没有任何 API 流量请求时，会自动暂停 (Pause) 您的应用。
为了帮助大家永久免除此困扰，我们在代码仓库中内置了专属的 **GitHub Actions 自动保活心跳工作流 (`.github/workflows/keep-appwrite-alive.yml`)**！
* **配置方式**：前往你的 GitHub 代码仓库 -> **Settings -> Secrets and variables -> Actions -> New repository secret**：
  * 添加秘钥名称 **`APPWRITE_PROJECT_ID`**，值为你社区对应的 Appwrite Project ID。
  * *(可选)* 也可以同时添加 `APPWRITE_API_KEY` 以获得强签权心跳。
* **生效原理**：GitHub 每日北京时间 10:00 与 22:00 会自动免费为你向 Appwrite 发送一次安全活动心跳请求，从而让你的社区中台永远处于唤醒与活跃状态！

---

## 四、 常规日常运维快速记忆指令表 (Cheat Sheet)

| 日常运维操作 | 快捷指令 | 说明 |
| :--- | :--- | :--- |
| **交互式配置向导** | `npm run setup` | 初始化配置、改写 `wrangler.json` 数据库并重新建立本地配置 |
| **全量静态文件打包** | `npm run build` | 重新生成包含文档索引的 HTML/CSS/JS 到 `dist/` |
| **本地服务调测** | `npm run dev` | 启动 `localhost:8788` 实时验证页面与服务端函数 |
| **线上 D1 数据库迁移** | `npm run d1:migrate:remote` | 在生产数据库上重建/升级社区的全部系统表结构 |
| **本地 D1 数据库迁移** | `npm run d1:migrate:local` | 在本机 SQLite 模拟层进行数据库表结构更新 |
| **生成文档菜单树** | `npm run docs:manifest` | 编写或更新 Markdown 文档后重建 `manifest.json` |
| **快速全推上线** | `npx wrangler pages deploy dist` | 把生成编译后的前端与后台函数全栈推送到 CDN 生产线 |
