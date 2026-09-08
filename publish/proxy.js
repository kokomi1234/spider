/**
 * 本地代理服务器（通用转发 + 本地录制/回放 + 静态文件服务）
 *
 * 设计目标：
 *   1. 静态文件服务 — serve index.html、JS/CSS 等前端资源
 *   2. API 代理 — 前端发【完整后端路径】（含模块），
 *      代理原样转发到 TARGET + req.url，只补充 CORS / token / 编码头
 *
 * 例：前端 POST http://localhost:3000/itamp-tool/publish/getOrgTreeList?orgID=M2534
 *     → 转发到 http://itamp.bocsys.cn/itamp-tool/publish/getOrgTreeList?orgID=M2534
 *    前端 POST http://itamp-comm/iam/getUserInfo
 *     → 转发到 http://itamp.bocsys.cn/itamp-comm/iam/getUserInfo
 *
 * ── 部署方式 ─────────────────────────────────────
 * cd publish && node proxy.js
 * 然后访问 http://服务器IP:3000 即可看到前端页面 + API 全部正常工作
 *
 * 静态文件优先匹配：GET 请求且路径对应 __dirname 下的文件 → 直接返回
 * 其他请求 → 走 API 代理逻辑
 *
 * ── 离线录制 / 回放 ──────────────────────────────────────────
 * 内网环境：真实响应自动录制到 cache/ 目录（只录 HTTP 200）。
 * 外网环境：后端不可达时自动回退，用本地缓存回放，
 *          响应头会带 X-Served-From: cache 便于区分。
 *
 * 缓存 key = sha1(method + path + 查询参数(剔除 n) + 规范化 JSON 请求体)
 *   · 剔除 ?n=xxx 防缓存随机数，否则每次请求都是新条目
 *   · 请求体参与计算，所以 getPublishDataList 的不同 pageNum 各自独立成条目
 *
 * 配置可用环境变量覆盖（避免改代码，也可写进 .env）：
 *   PROXY_PORT      端口，默认 3000
 *   PROXY_TARGET    后端基地址，默认 http://itamp.bocsys.cn
 *   PROXY_TOKEN     认证令牌（后端 token 约 12 小时过期，见 output/ITAMP接口总���.md）
 *   PROXY_OFFLINE   设为 1 → 纯离线回放，完全不访问网络（默认自动：先真实后缓存）
 *   PROXY_RECORD    设为 0 → 关闭录制
 *   PROXY_CACHE_DIR 缓存目录，默认 ./cache
 *
 * 管理端点：
 *   GET  /health       健康检查（含缓存条数）
 *   GET  /cache/list   列出所有已录制的缓存条目
 *   GET  /cache/clear  清空缓存
 *
 * ⚠️ cache/ 里是真实内网数据，注意不要外传。
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 自动加载 .env 文件（无需手动传环境变量）
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
    line = line.trim();
    if (line && !line.startsWith('#')) {
      const [key, ...rest] = line.split('=');
      const value = rest.join('=').trim();
      if (key && value !== undefined) {
        process.env[key] = value;
      }
    }
  });
}

const PORT = process.env.PROXY_PORT || 3000;
const TARGET = process.env.PROXY_TARGET || 'http://itamp.bocsys.cn';
const TOKEN = process.env.PROXY_TOKEN;

const OFFLINE = process.env.PROXY_OFFLINE === '1';   // 纯离线回放
const RECORD = process.env.PROXY_RECORD !== '0';     // 是否录制

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, token',
};

// ── 静态文件服务 ──────────────────────────────────────────────
// MIME 类型映射（按需扩展）
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
};

/** 判断是否是静态资源请求 */
function isStaticRequest(url) {
  // GET 请求且路径对应 __dirname 下的文件 → 静态
  if (url === '/') return true;           // / 首页 → index.html
  const ext = path.extname(url).toLowerCase();
  return ext in MIME;
}

/** 流式读取并返回静态文件 */
function serveStatic(req, res) {
  try {
    // 去掉查询串（/theme.css?v=123 → /theme.css）和 URL 编码
    let urlPath;
    try {
      urlPath = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
    } catch (_) {
      urlPath = req.url.split('?')[0];
    }

    let filePath = path.join(__dirname, urlPath);

    // / → index.html
    if (urlPath === '/' || urlPath === '') {
      filePath = path.join(__dirname, 'index.html');
    }

    // 文件不存在（如浏览器自动请求的 /favicon.ico）→ 404，不能抛异常
    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    // 安全校验：防止目录穿越攻击
    const realPath = fs.realpathSync(filePath);
    const realDir  = fs.realpathSync(__dirname);
    if (!realPath.startsWith(realDir + path.sep)) {
      res.writeHead(403);
      res.end('Forbidden');
      console.log(`   🚫 目录穿越尝试: ${req.url}`);
      return;
    }

    const stat = fs.statSync(realPath);
    if (stat.isDirectory()) {
      // 目录 → 尝试 index.html
      const indexPath = path.join(realPath, 'index.html');
      if (fs.existsSync(indexPath)) {
        serveFile(indexPath);
      } else {
        res.writeHead(403);
        res.end('Directory listing not allowed');
      }
      return;
    }

    serveFile(realPath);
  } catch (e) {
    // 兜底：任何异常都返回 500，绝不让进程崩溃
    try {
      if (!res.headersSent) res.writeHead(500);
      res.end('Server Error: ' + e.message);
    } catch (_) {}
  }

  function serveFile(fullPath) {
    const ext = path.extname(fullPath).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';

    // 静态文件缓存 1 天（浏览器缓存后不再请求）
    const headers = {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400',
    };

    const stream = fs.createReadStream(fullPath);
    stream.on('error', () => {
      if (!res.headersSent) res.writeHead(500);
      res.end('Server Error');
    });
    stream.pipe(res);
  }
}

// ── 缓存目录 ──────────────────────────────────────────────────
const CACHE_DIR = process.env.PROXY_CACHE_DIR || path.join(__dirname, 'cache');
const INDEX_FILE = path.join(CACHE_DIR, '_index.json');

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}
ensureCacheDir();

const cacheFile = (key) => path.join(CACHE_DIR, key + '.json');

function readIndex() {
  try { return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')); }
  catch (_) { return {}; }
}

function writeIndex(idx) {
  try { fs.writeFileSync(INDEX_FILE, JSON.stringify(idx, null, 2), 'utf8'); }
  catch (e) { console.error('   写缓存索引失败:', e.message); }
}

function readCache(key) {
  try { return JSON.parse(fs.readFileSync(cacheFile(key), 'utf8')); }
  catch (_) { return null; }
}

function writeCache(key, meta, entry) {
  if (!RECORD) return;
  try {
    fs.writeFileSync(cacheFile(key), JSON.stringify(entry, null, 2), 'utf8');
    const idx = readIndex();
    idx[key] = meta;
    writeIndex(idx);
  } catch (e) {
    console.error('   写缓存失败:', e.message);
  }
}

// ── 缓存 key 计算 ─────────────────────────────────────────────
// 递归排序对象键，让 JSON 键顺序不同也能命中同一条目
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    return Object.keys(v).sort().reduce((acc, k) => {
      acc[k] = sortKeys(v[k]);
      return acc;
    }, {});
  }
  return v;
}

function normalizeJson(str) {
  if (!str) return '';
  try { return JSON.stringify(sortKeys(JSON.parse(str))); }
  catch (_) { return str; }   // 非 JSON（如表单），原样参与
}

function cacheKey(method, reqUrl, bodyBuf) {
  const u = new URL(reqUrl, 'http://dummy');
  // 剔除防缓存随机数 n —— 否则每次请求的 key 都不同，缓存永远命中不了
  const params = [...u.searchParams.entries()]
    .filter(([k]) => k !== 'n')
    .sort(([a], [b]) => a.localeCompare(b));

  const canonical = [
    String(method || '').toUpperCase(),
    u.pathname,
    JSON.stringify(params),
    normalizeJson(bodyBuf ? bodyBuf.toString('utf8') : ''),
  ].join('|');

  return crypto.createHash('sha1').update(canonical).digest('hex');
}

// ── 回放 ──────────────────────────────────────────────────────
function replay(res, entry, reason) {
  const headers = { ...(entry.headers || {}), ...CORS };
  // 逐跳头 / 长度头必须去掉，否则浏览器会一直挂着
  delete headers['content-length'];
  delete headers['transfer-encoding'];
  delete headers['content-encoding'];
  delete headers['connection'];
  headers['X-Served-From'] = 'cache';
  headers['X-Cache-Recorded-At'] = entry.recordedAt || '';

  res.writeHead(entry.status || 200, headers);
  res.end(entry.body);

  console.log(`   📦 回放本地缓存（${reason}）· 录制于 ${entry.recordedAt || '未知'}`);
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...CORS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

// ── 转发到真实后端 ────────────────────────────────────────────
function forward(req, res, bodyBuf, key, meta) {
  const target = new URL(TARGET);

  // 透传浏览器发来的请求头（去掉逐跳头），再补认证 / 编码头
  const fwdHeaders = { ...req.headers };
  delete fwdHeaders.host;
  delete fwdHeaders.connection;
  delete fwdHeaders['content-length'];
  delete fwdHeaders['transfer-encoding'];
  fwdHeaders['token'] = TOKEN;                 // 统一注入认证令牌
  fwdHeaders['Accept-Encoding'] = 'identity'; // 不压缩，便于调试与录制
  if (!fwdHeaders['content-type']) fwdHeaders['content-type'] = 'application/json';
  if (bodyBuf && bodyBuf.length) fwdHeaders['content-length'] = String(bodyBuf.length);

  const options = {
    hostname: target.hostname,
    port: target.port || 80,
    path: req.url,
    method: req.method,
    headers: fwdHeaders,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    // 要先收集完整响应才能写缓存，所以这里不再直接 pipe
    const chunks = [];
    proxyRes.on('data', (c) => chunks.push(c));
    proxyRes.on('end', () => {
      const body = Buffer.concat(chunks);

      const headers = { ...proxyRes.headers, ...CORS };
      delete headers['content-length'];
      delete headers['transfer-encoding'];
      res.writeHead(proxyRes.statusCode, headers);
      res.end(body);

      // 只录 200：token 过期返回的 401 / 后端 500 不能被录进去，
      // 否则离线回放拿到的就是错误响应
      if (proxyRes.statusCode === 200) {
        writeCache(key, meta, {
          key,
          ...meta,
          status: proxyRes.statusCode,
          headers: proxyRes.headers,
          body: body.toString('utf8'),
        });
        console.log(`   💾 已录制 (${key.slice(0, 8)}…)`);
      } else {
        console.log(`   ⚠️  HTTP ${proxyRes.statusCode}，未录制（只缓存 200）`);
      }
    });
  });

  proxyReq.on('error', (e) => {
    console.error('   转发失败:', e.message);

    // 关键路径：外网 / 内网不可达 → 回退到本地缓存
    const hit = readCache(key);
    if (hit) return replay(res, hit, '后端不可达: ' + e.message);

    // 错误响应也必须带 CORS 头。
    // 之前没带，浏览器只会抛一句看不懂的 CORS 错误，
    // 真正的 ENOTFOUND / 连接超时全被盖住了。
    sendJson(res, 502, {
      code: 502,
      msg: '代理转发失败，且本地没有可用缓存：' + e.message,
      target: TARGET + req.url,
      key,
      hint: '连上内网用相同参数请求一次即可录制该条目，之后离线可回放',
    });
  });

  if (bodyBuf && bodyBuf.length) proxyReq.write(bodyBuf);
  proxyReq.end();
}

// ── 主服务 ────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  // 请求日志：记录来源 IP + 方法 + 路径，便于排查「外部访问进不来」
  const clientIp = (req.socket && req.socket.remoteAddress) || '?';
  console.log(`[req] ${clientIp} ${req.method} ${req.url}`);

  // CORS 预检
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  // 响应完成时记录最终状态码（转发成功/失败一目了然）
  res.on('finish', () => {
    console.log(`[res] ${clientIp} ${req.method} ${req.url} → ${res.statusCode}`);
  });

  // 静态文件优先：GET/HEAD 请求且是静态资源 → 直接返回
  if ((req.method === 'GET' || req.method === 'HEAD') && isStaticRequest(req.url)) {
    serveStatic(req, res);
    return;
  }

  // 健康检查：快速判断代理是否还活着（也被前端用来提示「代理未启动」）
  if (req.url === '/health') {
    sendJson(res, 200, {
      code: 200,
      msg: 'proxy ok',
      target: TARGET,
      offline: OFFLINE,
      record: RECORD,
      cacheDir: CACHE_DIR,
      cacheCount: Object.keys(readIndex()).length,
    });
    return;
  }

  // 缓存管理
  if (req.url === '/cache/list') {
    const idx = readIndex();
    sendJson(res, 200, {
      code: 200,
      cacheDir: CACHE_DIR,
      count: Object.keys(idx).length,
      entries: Object.entries(idx).map(([k, v]) => ({ key: k, ...v })),
    });
    return;
  }

  if (req.url === '/cache/clear') {
    try {
      let removed = 0;
      for (const f of fs.readdirSync(CACHE_DIR)) {
        if (f.endsWith('.json')) {
          fs.unlinkSync(path.join(CACHE_DIR, f));
          removed++;
        }
      }
      sendJson(res, 200, { code: 200, msg: `已清空 ${removed} 个缓存文件`, cacheDir: CACHE_DIR });
    } catch (e) {
      sendJson(res, 500, { code: 500, msg: '清空失败: ' + e.message });
    }
    return;
  }

  // 请求体要参与缓存 key，必须先缓冲（不能再直接 req.pipe）
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => handle(req, res, Buffer.concat(chunks)));
  req.on('error', (e) => {
    console.error('   读取请求体失败:', e.message);
    sendJson(res, 400, { code: 400, msg: '读取请求体失败: ' + e.message });
  });
});

function handle(req, res, bodyBuf) {
  const key = cacheKey(req.method, req.url, bodyBuf);
  const meta = {
    method: req.method,
    path: req.url,
    requestBody: bodyBuf ? bodyBuf.toString('utf8').slice(0, 500) : '',
    recordedAt: new Date().toISOString(),
  };

  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);

  // 纯离线模式：只读本地缓存，完全不访问网络
  if (OFFLINE) {
    const hit = readCache(key);
    if (hit) return replay(res, hit, 'PROXY_OFFLINE=1');
    return sendJson(res, 404, {
      code: 404,
      msg: '离线模式：本地缓存中没有这条记录。请连内网用相同参数请求一次以录制。',
      key,
      path: req.url,
      requestBody: meta.requestBody,
    });
  }

  forward(req, res, bodyBuf, key, meta);
}

// 兜底：任何未捕获异常/坏请求都不应让整个进程崩溃（否则一个 favicon.ico 就能打挂服务）
process.on('uncaughtException', (err) => {
  console.error('[proxy] uncaughtException（已忽略，服务继续运行）:', err.message);
});
process.on('unhandledRejection', (err) => {
  console.error('[proxy] unhandledRejection（已忽略）:', err && err.message);
});

server.on('clientError', (err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  socket.destroy();
});

server.listen(PORT, () => {
  console.log(`\n✅ 服务器运行在 http://localhost:${PORT}`);
  console.log(`   📄 静态文件：从 ${__dirname} 提供（HTML/JS/CSS 等）`);
  console.log(`   🔀 API 代理：→ ${TARGET}`);
  console.log(`   模式：${OFFLINE ? '🟡 纯离线回放（PROXY_OFFLINE=1）' : '🟢 真实转发 + 自动录制，失败回退缓存'}`);
  console.log(`   录制：${RECORD ? '开启' : '关闭（PROXY_RECORD=0）'}`);
  console.log(`   缓存目录：${CACHE_DIR}（已录 ${Object.keys(readIndex()).length} 条）`);
  console.log(`   健康检查：http://localhost:${PORT}/health`);
  console.log(`   缓存列表：http://localhost:${PORT}/cache/list`);
  console.log(`   用法：浏览器访问 http://localhost:${PORT} 即可看到前端页面\n`);
});
