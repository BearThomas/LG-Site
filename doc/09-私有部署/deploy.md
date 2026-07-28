---
title: 我也要部署 (私有化部署指南)
order: 1
---

# 龙高北小站 —— 零成本私有化一键部署指南

欢迎使用 **龙高北小站（LG-Site）**！本项目采用了轻量且强大的 **现代混合架构**：

1. **用户认证与文件存储 (Appwrite)**：由 **Appwrite** 负责账号的安全登录、会话鉴权（Auth & Session）以及用户头像/发帖图片的云端存储（Storage）。
2. **数据持久化与业务逻辑 (Cloudflare D1 + Functions)**：由 **Cloudflare D1（无服务器 SQLite）** 承载所有帖子、评论与表白墙文档数据的毫秒级读写；由 **Cloudflare Pages / Functions** 分发纯前端静态资源与接口处理。

借助这份指南，你可以利用免费云服务与个人电脑，**无需购买 VPS，无需备案，零服务器维护成本**，快速建构属于自己的全功能专属论坛！

---

## 准备工作 (Prerequisites)

请确保你的个人 PC 或开发环境中已具备以下工具和账号：
- **Node.js**（要求 `v20.0.0` 及以上版本）和 `npm`
- **Git** 客户端
- **Cloudflare 账号**（用于部署托管站点与 D1 数据库）
- **Appwrite 账号**（可直接免费使用 [Appwrite Cloud](https://cloud.appwrite.io/) 官方免费云，也可以使用私有 Docker 自建服务）

---

## 一、 快速获取开源代码

在电脑命令行终端（PowerShell 或 Terminal）执行以下命令：

```bash
# 1. 克隆代码仓库到本地
git clone https://github.com/BearThomas/LG-Site.git

# 2. 进入项目目录
cd LG-Site

# 3. 安装开发依赖（自动安装 wrangler CLI 等必要包）
npm install
```

---

## 二、 配置 Appwrite 用户认证与存储中心

本项目依靠 Appwrite 来管理注册/登录账号与鉴权安全。按照以下步骤在 **[Appwrite Cloud](https://cloud.appwrite.io/)** 中完成基础配置：

1. **新建应用项目**：
   - 登录 Appwrite Cloud 后台，点击 **"Create project"** 创建新项目（例如命名为 `lg-site-auth`）。
   - 在项目 **Overview** 面板，复制保存你的 **`Project ID`** 与 **`API Endpoint`**（默认值为 `https://cloud.appwrite.io/v1`）。
2. **生成服务端鉴权秘钥 (API Key)**：
   - 进入 **Overview -> API Keys -> Create API Key**。
   - 输入名称（如 `Cloudflare Server Key`），在 **Scopes（权限勾选）** 中必须额外勾选以下两项核心权限：
     - `sessions.write`（管理用户登录会话）
     - `users.write`（处理注册与账号信息写入）
   - 创建成功后，复制生成的一长串 **`API Key`** 字符串备用。
3. **配置用户认证体系 (Auth)**：
   - 在左侧菜单点击 **Auth -> Settings**，确保已启用 **Email/Password** 注册与登录方式。

---

## 三、 创建并初始化 Cloudflare D1 数据库

所有帖子内容、动态、点赞与关注列表均由 Cloudflare 提供的无服务器 D1 数据库管理：

```bash
# 1. 登录 Cloudflare（命令行会自动弹窗在浏览器中完成验证）
npx wrangler login

# 2. 创建用于论坛数据存储的 D1 数据库
npx wrangler d1 create lg-site-db
```

命令成功运行后，终端将提示生成数据库的绑定配置信息，格式类似如下：
```toml
[[d1_databases]]
binding = "DB"
database_name = "lg-site-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

> **绝对关键步骤**：请将返回的 **`database_id`** 复制，打开项目根目录下的 **`wrangler.json`**（或 `wrangler.toml`），替换到对应的 `database_id` 字段中。

### 执行数据表迁移
配置完毕后，在控制台执行一键建表，为 D1 创建全部规范表结构：
```bash
# 为线上远程 (Cloudflare 生产环境) 执行 D1 数据库表初始化
npm run d1:migrate:remote

# (可选) 同时为本地开发调试环境生成 SQLite 数据表
npm run d1:migrate:local
```

---

## 四、 环境变量与 Secrets 配置对照表

要将 Appwrite 和 Cloudflare D1 联结运行，需在项目根目录复制一份环境变量模板：
```bash
cp .dev.vars.example .dev.vars
```

请在本地 `.dev.vars` 文件以及线上 [Cloudflare 控制台](https://dash.cloudflare.com/) 项目下的 **Settings -> Environment variables / Secrets** 中，对照填入以下配置：

| 环境变量 / Secret 名称 | 必须配置 | 配置内容说明与示例值 |
| :--- | :---: | :--- |
| `APPWRITE_ENDPOINT` | **是** | Appwrite 服务端地址，示例：`https://cloud.appwrite.io/v1` |
| `APPWRITE_PROJECT_ID` | **是** | 你在 Appwrite 新建项目时生成的 `Project ID` |
| `APPWRITE_API_KEY` | **是** | 你在 Appwrite 申请的、且已勾选 `sessions.write` 及 `users.write` 权限的 API Key |
| `AUTH_TOKEN_SECRET` | **是** | 必须填入**长于 32 位**的任意高强度随机字符，用于加密并对会话 JWT 签名 |
| `D1_DATABASE_NAME` | **是** | 你的 D1 数据库名称，例如 `lg-site-db` |
| `D1_DATABASE_ID` | **是** | 你的 D1 数据库在 Cloudflare 中对应的 UUID 字符串 |

> **关键补充（D1 绑定）**：在 Cloudflare Pages 项目管理的 **Settings -> Functions -> D1 Database bindings** 菜单中，务必添加一个绑定条目：**Variable name 填 `DB`**，下拉选择你此前建立的 `lg-site-db`。

---

## 五、 本地开发调试与快速验证

全部配置就绪后，通过一键启动命令开启本地模拟环境调试：

```bash
npm run dev
```

启动完毕后访问 `http://localhost:8788`，你可以测试账号注册、登录、发布帖子与评论，一切接口将与远端 Appwrite 鉴权及 D1 数据库完整联通。

---

## 六、 生产发布与持续集成上线

### 方案 1：命令行直接编译打包发布（最简单极速）
如果不需要依赖 Git 仓库自动更新，可在命令行中用 wrangler 一键打包至全球节点：

```bash
# 1. 编译生成带有全新索引与资源版本号的静态产物目录 ./dist
npm run build

# 2. 将编译好的 dist 上传发布至 Cloudflare Pages
npx wrangler pages deploy dist --project-name=lg-site
```

### 方案 2：将 GitHub 仓库绑定至 Cloudflare Pages CI/CD（推荐使用）
1. 登录 Cloudflare 控制台，进入 **Workers & Pages -> Create -> Pages -> Connect to Git**。
2. 关联当前 `LG-Site` 项目代码库。
3. 填入生产线构建参数（Build settings）：
   - **Framework preset**: `None`
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
4. 将第四步提到的环境变量（APPWRITE_KEY、AUTH_SECRET 等）填入项目变量后，点击 Deploy，你专属的高性能个人社区即可完成全球发版！

---

## 七、 运维操作命令速查表 (Cheat Sheet)

| 命令操作 | 执行指令 | 简述与作用场景 |
| :--- | :--- | :--- |
| **项目整体构筑** | `npm run build` | 重新生成并打包静态资源及全部指南文档索引到 `./dist` |
| **开发全栈服务器** | `npm run dev` | 打开带有 D1 与 Functions 运行环境的本地 Web 调测环境 |
| **线上数据库迁移** | `npm run d1:migrate:remote` | 在生产环境中向 Cloudflare D1 执行所有建表及字段升级 |
| **本地数据库迁移** | `npm run d1:migrate:local` | 仅为本地研发的 SQLite 表结构更新应用变更 |
| **同步更新文档目录** | `npm run docs:manifest` | 编写或修改 `doc/` 文档后快速重构 `manifest.json` 目录结构 |
| **快速全推上线** | `npx wrangler pages deploy dist` | 跳过 Git CI 直接上传最新构筑的 HTML/CSS/JS/APK 资源 |
