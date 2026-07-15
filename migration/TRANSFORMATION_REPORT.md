# 自动改造报告

- 原项目根目录：`LG-Site`
- 扫描到包含 Appwrite/Database 调用的文件：40
- 替换 ESM `Databases` 导入：0
- 替换 CDN/全局 `Appwrite.Databases` 构造：0
- 注入运行时环境配置的 HTML：8
- 替换硬编码 Endpoint/Project：1
- 替换可安全识别的硬编码服务端 Key：0
- 实际修改的源文件：9

## 修改文件

- `confession.html`
- `docs.html`
- `events.html`
- `index.html`
- `js/nav-bar.js`
- `login.html`
- `post.html`
- `posts.html`
- `profile.html`

## 仍需重点复核的数据库调用文件

- `functions/_lib/documents.js`
- `functions/api/auth-register.js`
- `functions/api/create-confession.js`
- `functions/api/create-post.js`
- `functions/api/d1.js`
- `js/confession.js`
- `js/home.js`
- `js/nav-bar.js`
- `js/post-detail.js`
- `js/posts.js`
- `js/profile.js`
- `js/shared.js`
- `netlify/functions/auth-register.js`
- `netlify/functions/create-confession.js`
- `netlify/functions/create-post.js`
- `netlify/functions/join-board.js`
- `netlify/functions/search-users.js`

这些文件未必有问题：兼容层自身、服务端旧接口或注释也会被静态扫描命中。部署前按功能测试即可。

## Cloudflare Functions 二次安全处理

- 从原项目恢复并重新处理旧 Functions；环境变量替换文件：0
- 因无法静态判断 handler 环境变量作用域而使用安全占位符的文件：0

## Cloudflare Functions 二次安全处理

- 从原项目恢复并重新处理旧 Functions；环境变量替换文件：0
- 因无法静态判断 handler 环境变量作用域而使用安全占位符的文件：0

## 数据库/集合公开 ID 运行时化

- 替换文件：0
- 数据库常量：0
- 集合常量：0
- 映射：`migration/detected-public-id-maps.json`
