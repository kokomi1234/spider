---
globs: '["publish/proxy.js"]'
alwaysApply: true
---

proxy.js 已改造为同时 serve 静态文件和代理 API。serveStatic() 函数判断请求路径：如果是 / 或 .html/.css/.js/.png/.ico 等静态资源，从 __dirname 读取并返回；否则走 API 代理逻辑。静态文件使用 fs.createReadStream 流式读取、设置 Cache-Control 缓存头、根据扩展名自动设置 Content-Type。