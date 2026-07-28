---
title: 我也要部署 (私有化部署指南)
order: 1
---

# 龙高北小站 —— 零成本私有化一键部署指南

欢迎使用 **龙高北小站（LG-Site）**！本项目采用前后端分离与原生 ES Module 构建，借助 **Cloudflare Pages** 托管静态文件和函数 API，使用 **Cloudflare D1（无服务器 SQLite）** 提供极致的数据读写体验。

本篇指南将带你从零开始，在一台没有 Linux 服务器、零成本运营的环境下，利用个人 PC 将完整站点部署至全球极速 CDN！

---

## 为什么选择这套部署方案？

1. **永久免费额度**：
   - **Cloudflare Pages**：全球极速无限静态请求 CDN 分发。
   - **Cloudflare Functions (Workers)**：每日 **100,000 次** 免费服务端 API 计算调用。
   - **Cloudflare D1 Database**：每日 **5,000,000 次** 免费读取 / **100,000 次** 免费写入。
2. **零运维成本**：
   - 无需购买云服务器 VPS、无需配置 Nginx / Apache、无需续费公网 IP 或处理备案（默认分配 `*.pages.dev` HTTPS 域名）。
3. **极速持续集成**：
   - 本地 `git push` 或通过 CLI 工具 `wrangler` 即可在秒级完成线上发版。

---

## 准备工作 (Prerequisites)

在进行命令操作前，请确保你电脑（PC/Mac/Linux）上已安装以下基础开发环境：

- **Node.js** (要求 `v20.0.0` 或以上版本) 与 `npm`
- **Git** 工具
- **Cloudflare 账号**（在官网免费注册）

---

## 一键部署与命令行实操步骤

### 步骤 1：克隆开源仓库并安装依赖

打开命令行终端（Terminal / PowerShell），运行以下命令获取源码：

```bash
# 1. 克隆 GitHub 代码仓库
git clone https://github.com/BearThomas/LG-Site.git

# 2. 进入项目工作目录
cd LG-Site

# 3. 安装项目开发依赖 (包括 wrangler 等构建工具)
npm install
```

---

### 步骤 2：创建 Serverless D1 数据库

本项目使用 Cloudflare D1 作为主数据持久化存储。使用 Wrangler CLI 工具一键创建并初始化：

```bash
# 1. 登录你的 Cloudflare 账号（会自动弹窗在浏览器中授权）
npx wrangler login

# 2. 创建名为 lg-site-db 的 D1 数据库
npx wrangler d1 create lg-site-db
```

命令执行成功后，终端会输出一串 **database_id**，类似如下：
```toml
[[d1_databases]]
binding = "DB"
database_name = "lg-site-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

> **非常重要**：请复制你生成的 `database_id`，打开项目根目录的 **`wrangler.json`**（或 `wrangler.toml`），将其更新至 `d1_databases` 字段中。

---

### 步骤 3：初始化数据库表结构与预置数据

绑定好 D1 Database 后，执行迁移脚本自动建立发帖、评论、表白墙、用户信息等基本表结构：

```bash
# 1. 为本地调试环境初始化 D1 数据库表
npm run d1:migrate:local

# 2. 为线上远程 (Cloudflare 生产环境) 初始化 D1 数据库表
npm run d1:migrate:remote
```

*(可选)* 如果你有之前已备份的 SQL 数据，可执行以下命令导入旧数据：
```bash
node tools/apply-d1-import.mjs --database lg-site-db --remote
```

---

### 步骤 4：本地环境调试 (Dev Server)

在上传线上环境前，推荐先启动本地全栈调试服务器预览效果：

```bash
# 自动执行静态构建并启动带本地 D1 模拟的开发环境
npm run dev
```

启动后在浏览器打开 `http://localhost:8788`，即可完整体验和调试论坛发帖、评论与关注机制。

---

### 步骤 5：配置生产环境绑定与一键上线

#### 方式一：Wrangler 命令行一键打包部署（最快捷）

只需执行两条指令即可完成静态资源生成与全球发布：

```bash
# 1. 生成最终待部署的静态资源产物至 ./dist 文件夹
npm run build

# 2. 上传 ./dist 目录并部署至 Cloudflare Pages
npx wrangler pages deploy dist --project-name=lg-site
```

#### 方式二：GitHub 持续集成部署（推荐长期维护）

1. 登录 [Cloudflare 控制台](https://dash.cloudflare.com/)，选择 **Workers & Pages -> Create application -> Pages -> Connect to Git**。
2. 选择你 Fork/克隆的 `LG-Site` 仓库。
3. 部署构建设置（Build settings）填入：
   - **Framework preset**: `None`
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
4. **非常关键：设置 D1 Binding**
   进入创建的项目 **Settings -> Functions -> D1 Database bindings**：
   - **Variable name**: 必须填写 **`DB`**
   - **D1 database**: 下拉选择此前创建的 **`lg-site-db`**

完成后重新触发一次重新构建，你的专属私有化社区即刻上线！

---

## 常用运维命令快查表 (Cheat Sheet)

为方便日常开发调试与版本迭代，我们将常用的快捷命令行整理如下：

| 功能操作 | 命令行指令 | 适用场景 |
| :--- | :--- | :--- |
| **整体静态构建** | `npm run build` | 重新生成页面和文档的索引与静态文件目录（`dist/`） |
| **本地开发服务器** | `npm run dev` | 在本机 `localhost:8788` 上启动带 Functions 运行环境的全栈服务 |
| **本地数据表迁移** | `npm run d1:migrate:local` | 在本地 SQLite 开发环境创建 / 更新 D1 表结构 |
| **生产数据表迁移** | `npm run d1:migrate:remote` | 在线上 Cloudflare D1 数据库创建 / 更新表结构 |
| **更新文档索引** | `npm run docs:manifest` | 编写或增加 `doc/` 目录下 markdown 文档后更新 `manifest.json` |
| **命令行手动发布** | `npx wrangler pages deploy dist` | 跳过 Git CI，直接将 `dist/` 上传至生产线部署 |

---

## 遇到问题？

在部署或配置环境变量中如遇到任何疑问，可进入社区的 [常见问题 (QA)](./08-其他/QA.md) 查看解决方案，或随时在“帖子/讨论板块”发布反馈。
