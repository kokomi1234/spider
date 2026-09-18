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
 *   PROXY_API_CACHE_TTL  API 内存缓存 TTL 毫秒（默认 300000=5 分钟，0 关闭）。
 *                        目前只缓存订阅条件字典 /conditions/subscribe（后端 3~4s、93KB，
 *                        每次刷新页面都要拉）；订阅写接口会使它立即失效
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
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// .env 位置：默认就在代理脚本同级（publish/.env，与 ONBOARDING.md / .env.example 一致）。
// 若部署时把 publish 拷到别的目录导致路径嵌套异常（例如出现 spider/spider/...），
// 可用 PROXY_ENV_PATH 显式指到正确的 .env；前端「写入位置」也会跟着变化。
const envPath = process.env.PROXY_ENV_PATH || path.join(__dirname, '.env');

const PORT = process.env.PROXY_PORT || 3000;
const TARGET = process.env.PROXY_TARGET || 'http://itamp.bocsys.cn';
const TIMEOUT = Number(process.env.PROXY_TIMEOUT) || 20000;

// ── .env 热更新 ───────────────────────────────────────────────
function loadEnv() {
  if (!fs.existsSync(envPath)) return {};
  const vars = {};
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
    line = line.trim();
    if (line && !line.startsWith('#')) {
      const [key, ...rest] = line.split('=');
      const value = rest.join('=').trim();
      if (key && value !== undefined) {
        // 首次加载时不覆盖（命令行传参优先），热更新时强制覆盖
        if (FIRST_LOAD && !(key in process.env)) process.env[key] = value;
        if (!FIRST_LOAD) process.env[key] = value;
        vars[key] = value;
      }
    }
  });
  return vars;
}

function refreshConfig() {
  loadEnv();
  TOKEN_REFRESHED = process.env.PROXY_TOKEN || '';
  for (const [name, envKey] of [
    ['systemId', 'PROXY_SYSTEM_ID'],
    ['ssopSessionId', 'PROXY_SSOP_SESSION_ID'],
    ['authMethods', 'PROXY_AUTH_METHODS'],
    ['Cookie', 'PROXY_COOKIE'],
  ]) {
    const v = (process.env[envKey] || '').trim();
    if (v) EXTRA_HEADERS[name] = v;
    else delete EXTRA_HEADERS[name];
  }
  OFFLINE_REFRESHED = process.env.PROXY_OFFLINE === '1';
  console.log(`   🔄 已重新加载 .env：token=${TOKEN_REFRESHED ? TOKEN_REFRESHED.slice(0, 8) + '...' + TOKEN_REFRESHED.slice(-4) : '(空)'} headers=[${Object.keys(EXTRA_HEADERS).join(', ')}] offline=${OFFLINE_REFRESHED}`);
}

// 后端要求的公共请求头（启动时初始化，refreshConfig 会更新）
const EXTRA_HEADERS = {};

let TOKEN_REFRESHED = '';
let OFFLINE_REFRESHED = false;
let FIRST_LOAD = true;

// 启动时先加载一次 .env
refreshConfig();
FIRST_LOAD = false;

// ── .env 文件监听（保存即自动热更新）──────────────────────
let lastEnvStat = null;
try { lastEnvStat = fs.statSync(envPath); } catch (_) {}
const ENV_POLL_MS = 1500; // 1.5 秒轮询一次，够用且低开销
(function pollEnv() {
  try {
    const stat = fs.statSync(envPath);
    if (!lastEnvStat || stat.mtimeMs !== lastEnvStat.mtimeMs) {
      lastEnvStat = stat;
      refreshConfig();
    }
  } catch (_) { /* .env 被删除时忽略 */ }
  setTimeout(pollEnv, ENV_POLL_MS);
})();

// ── API 内存缓存（读接口加速）─────────────────────────────────
// conditions/subscribe 后端要 3~4s（93KB），而每次刷新页面都要拉一次
// （前端 api-client 只在单个页面会话内记忆化）。这里在代理层加带 TTL 的内存缓存：
//   · 只缓存 API_CACHE_PATHS 里的读接口；key 复用 cacheKey()（已剔除防缓存随机数 n、
//     请求体归一化）—— 所以每次请求带的不同 ?n= 也能命中
//   · TTL 默认 5 分钟，PROXY_API_CACHE_TTL=0 关闭；命中响应带 X-Cache: HIT
//   · 订阅相关写接口（setSubcription / subscribe / unsubscribe / subscriptionReview）
//     请求一到就立即失效缓存 —— 保证写完再查拿的是最新数据
const API_CACHE_TTL = (() => {
  const n = Number(process.env.PROXY_API_CACHE_TTL);
  return Number.isFinite(n) && n >= 0 ? n : 5 * 60 * 1000;
})();
const API_CACHE_PATHS = [
  '/itamp-tool/intfcMgmt/conditions/subscribe',
];
const API_WRITE_PATHS = [
  '/itamp-tool/publish/setSubcription',
  '/itamp-tool/publish/subscribe',
  '/itamp-tool/publish/unsubscribe',
  '/itamp-tool/publish/subscriptionReview',
];
const apiCache = new Map();   // cacheKey -> { status, headers, body, at }
const RECORD = process.env.PROXY_RECORD !== '0';     // 是否录制
// 宽松匹配：精确 key 未命中时，退而按「method + path」回放同接口最近一条记录。
// 前端改了请求体（加字段、改 pageSize）后，旧缓存的 key 就再也命中不了，
// 离线调试会全线 404。这个兜底让离线回放继续可用。
// 想验证「参数是否严格一致」时用 PROXY_LOOSE_MATCH=0 关掉。
const LOOSE = process.env.PROXY_LOOSE_MATCH !== '0';

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

// ── 干净路由（去掉 .html 后缀）──────────────────────────────────
// /home → index.html（首页：三个查询页入口 + 常用查询）、
// /publish → publish.html（服务发布数据查询）、
// /subscription → subscription.html、/task → task.html。
// 旧地址（带 .html）仍可直接访问（按扩展名命中静态服务），这里只新增别名，
// 平滑迁移、不破坏书签与既有链接。要改路由改这里即可，无需动各页面文件。
const PAGE_ROUTES = {
  '/home':         'index.html',
  '/publish':      'publish.html',
  '/subscription': 'subscription.html',
  '/task':         'task.html',
};

/** 判断是否是静态资源请求 */
function isStaticRequest(url) {
  const clean = String(url).split('?')[0].split('#')[0];
  // 干净路由（/home /subscription /task）与 / 都按静态页处理
  if (clean === '/' || clean in PAGE_ROUTES) return true;
  // 必须先剥掉查询串/锚点：否则 /index.html?debug=1 的 extname 会算成
  // ".html?debug=1"，被判成非静态 → 走代理 → 404，地址栏加 ?debug=1 就打不开页面
  const ext = path.extname(clean).toLowerCase();
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

    // / → 302 跳转到 /home（干净路由，作为首页唯一入口）
    if (urlPath === '/' || urlPath === '') {
      res.writeHead(302, { 'Location': '/home' });
      res.end();
      return;
    }

    // 干净路由：/home /subscription /task → 对应 HTML 文件（去掉 .html 后缀）
    if (urlPath in PAGE_ROUTES) {
      filePath = path.join(__dirname, PAGE_ROUTES[urlPath]);
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
    // 先取文件元信息（本地文件，同步足够），用于 ETag / Last-Modified
    let stat;
    try { stat = fs.statSync(fullPath); }
    catch (_) {
      if (!res.headersSent) res.writeHead(404);
      res.end('Not Found');
      return;
    }
    const ext = path.extname(fullPath).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';

    // 默认不缓存：缓存 1 天时改完 HTML/CSS/JS 不硬刷新就看不到效果，
    // 是「改了没生效」最常见的误判来源。部署场景用 PROXY_STATIC_MAX_AGE=86400 打开。
    const maxAge = Number(process.env.PROXY_STATIC_MAX_AGE) || 0;
    const cacheControl = maxAge > 0 ? `public, max-age=${maxAge}` : 'no-store';

    // ETag 用「尺寸 + 修改时间」拼，避免每个请求都读全文件算哈希（改内容必改 mtime）。
    // 仅在 PROXY_STATIC_MAX_AGE>0（生产）时才有意义：默认 no-store 下浏览器不缓存，
    // 也就不会带 If-None-Match，304 分支不会触发，对开发体验零影响。
    const etag = `"${stat.size}-${stat.mtimeMs}"`;
    const lastModified = stat.mtime.toUTCString();

    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { 'ETag': etag, 'Cache-Control': cacheControl });
      res.end();
      return;
    }

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': cacheControl,
      'ETag': etag,
      'Last-Modified': lastModified,
    });
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

// ── 宽松匹配：同 method + 同 path 的最近一条缓存 ───────────────
// 只比较 pathname（忽略 ?n= 这类查询串），请求体不参与。
function findLooseMatch(method, reqUrl) {
  let wantPath;
  try { wantPath = new URL(reqUrl, 'http://dummy').pathname; }
  catch (_) { return null; }

  const idx = readIndex();
  let best = null;
  for (const [k, v] of Object.entries(idx)) {
    if (String(v.method || '').toUpperCase() !== String(method || '').toUpperCase()) continue;
    let vp = String(v.path || '');
    try { vp = new URL(vp, 'http://dummy').pathname; } catch (_) { /* 保留原值 */ }
    if (vp !== wantPath) continue;
    if (!best || String(v.recordedAt || '') > String(best.meta.recordedAt || '')) {
      best = { key: k, meta: v };
    }
  }
  if (!best) return null;
  const entry = readCache(best.key);
  if (!entry) return null;
  return { entry, key: best.key, meta: best.meta };
}

// ── API 内存缓存：判断 / 读取 / 回写 / 失效 ────────────────────
function pathOf(reqUrl) {
  try { return new URL(reqUrl, 'http://dummy').pathname; } catch (_) { return String(reqUrl || ''); }
}
function isApiCachePath(reqUrl) {
  if (!API_CACHE_TTL) return false;
  const p = pathOf(reqUrl);
  return API_CACHE_PATHS.some((s) => p === s);
}
function isApiWritePath(reqUrl) {
  const p = pathOf(reqUrl);
  return API_WRITE_PATHS.some((s) => p === s);
}
function getApiCache(key) {
  const hit = apiCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > API_CACHE_TTL) { apiCache.delete(key); return null; }   // 过期即清理
  return hit;
}
function respondApiCache(res, hit) {
  const ageSec = Math.round((Date.now() - hit.at) / 1000);
  const headers = { ...(hit.headers || {}), ...CORS };
  delete headers['content-length'];
  delete headers['transfer-encoding'];
  delete headers['content-encoding'];
  delete headers['connection'];
  headers['X-Cache'] = 'HIT';
  headers['X-Api-Cache-Age'] = String(ageSec);
  res.writeHead(hit.status || 200, headers);
  res.end(hit.body);
  console.log(`   ⚡ API 内存缓存命中（${ageSec}s 前的响应，X-Cache: HIT）`);
}
function storeApiCache(key, entry) {
  if (!API_CACHE_TTL) return;
  apiCache.set(key, {
    status: entry.status || 200,
    headers: entry.headers || {},
    body: entry.body || '',
    at: Date.now(),
  });
}

function invalidateApiCache(reason) {
  if (!apiCache.size) return;
  const n = apiCache.size;
  apiCache.clear();
  console.log(`   ♻️  已失效 API 内存缓存 ${n} 条（${reason}）`);
}

// ── 回放 ──────────────────────────────────────────────────────
function replay(res, entry, reason, loose) {
  const headers = { ...(entry.headers || {}), ...CORS };
  // 逐跳头 / 长度头必须去掉，否则浏览器会一直挂着
  delete headers['content-length'];
  delete headers['transfer-encoding'];
  delete headers['content-encoding'];
  delete headers['connection'];
  headers['X-Served-From'] = 'cache';
  headers['X-Cache-Recorded-At'] = entry.recordedAt || '';
  headers['X-Cache-Match'] = loose ? 'loose' : 'exact';

  res.writeHead(entry.status || 200, headers);
  res.end(entry.body);

  console.log(`   📦 回放本地缓存（${reason}）· 录制于 ${entry.recordedAt || '未知'}`);
  if (loose) {
    console.log(`   ⚠️  宽松匹配：请求参数与录制时不一致，回放的是同接口最近一条记录，` +
                `数据可能与当前筛选条件不符，仅供参考`);
  }
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

  // ⚠️ 必须在配了 token 时才写这个头。写成 undefined 时 http.request 会同步抛
  // ERR_HTTP_INVALID_HEADER_VALUE，异常被 uncaughtException 吞掉后响应永远不会发出，
  // 客户端只能一直转圈（实测 6s 无响应）。token 约 12 小时过期，这个坑迟早踩到。
  if (TOKEN_REFRESHED) fwdHeaders['token'] = TOKEN_REFRESHED;
  Object.assign(fwdHeaders, EXTRA_HEADERS);    // systemId / ssopSessionId / authMethods
  fwdHeaders['Accept-Encoding'] = 'identity'; // 不压缩，便于调试与录制
  if (!fwdHeaders['content-type']) fwdHeaders['content-type'] = 'application/json';
  if (bodyBuf && bodyBuf.length) fwdHeaders['content-length'] = String(bodyBuf.length);

  const isHttps = target.protocol === 'https:';
  const client = isHttps ? https : http;
  const options = {
    hostname: target.hostname,
    port: target.port || (isHttps ? 443 : 80),
    path: req.url,
    method: req.method,
    headers: fwdHeaders,
    timeout: TIMEOUT,
  };
  // 内网常用自签证书，需要时 PROXY_REJECT_UNAUTHORIZED=0 关掉校验
  if (isHttps && process.env.PROXY_REJECT_UNAUTHORIZED === '0') {
    options.rejectUnauthorized = false;
  }

  const proxyReq = client.request(options, (proxyRes) => {
    // 要先收集完整响应才能写缓存，所以这里不再直接 pipe
    const chunks = [];
    proxyRes.on('data', (c) => chunks.push(c));
    proxyRes.on('end', () => {
      const body = Buffer.concat(chunks);

      const headers = { ...proxyRes.headers, ...CORS };
      delete headers['content-length'];
      delete headers['transfer-encoding'];
      if (isApiCachePath(req.url)) headers['X-Cache'] = 'MISS';
      res.writeHead(proxyRes.statusCode, headers);
      res.end(body);

      // API 内存缓存：字典响应存一份（带 TTL），下回同参数请求直接命中
      if (isApiCachePath(req.url) && proxyRes.statusCode === 200) {
        storeApiCache(key, { status: proxyRes.statusCode, headers: proxyRes.headers, body: body.toString('utf8') });
        console.log('   ⚡ 已存入 API 内存缓存（下次同参数请求 X-Cache: HIT）');
      }

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

  // 超时主动断开：不设这个的话，目标不可路由时请求会挂到 OS 层超时（可达数分钟）。
  // destroy(err) 会触发下面的 error 分支，从而走「回退本地缓存」的降级路径。
  proxyReq.on('timeout', () => {
    proxyReq.destroy(new Error(`转发超时（${TIMEOUT}ms）`));
  });

  proxyReq.on('error', (e) => {
    console.error('   转发失败:', e.message);

    // 关键路径：外网 / 内网不可达 → 回退到本地缓存
    const hit = readCache(key);
    if (hit) return replay(res, hit, '后端不可达: ' + e.message);

    // 精确未命中 → 宽松匹配兜底
    if (LOOSE) {
      const loose = findLooseMatch(req.method, req.url);
      if (loose) return replay(res, loose.entry, '后端不可达，宽松匹配: ' + e.message, true);
    }

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
      offline: OFFLINE_REFRESHED,
      record: RECORD,
      cacheDir: CACHE_DIR,
      cacheCount: Object.keys(readIndex()).length,
      apiCache: { ttlMs: API_CACHE_TTL, size: apiCache.size, paths: API_CACHE_PATHS },
    });
    return;
  }

  // 缓存管理：设了 PROXY_ADMIN_TOKEN 才需要带 ?token= 才放行（默认不设=不鉴权，方便本地开发）
  const ADMIN_TOKEN = process.env.PROXY_ADMIN_TOKEN || '';
  const cachePath = (() => { try { return new URL(req.url, 'http://localhost').pathname; } catch (_) { return req.url; } })();
  const adminOk = () => {
    if (!ADMIN_TOKEN) return true;
    try {
      const t = new URL(req.url, 'http://localhost').searchParams.get('token') || '';
      return t === ADMIN_TOKEN;
    } catch (_) { return false; }
  };

  if (cachePath === '/cache/list') {
    if (!adminOk()) { sendJson(res, 401, { code: 401, msg: '未授权：缺少或错误的 token（需 ?token=）' }); return; }
    const idx = readIndex();
    sendJson(res, 200, {
      code: 200,
      cacheDir: CACHE_DIR,
      count: Object.keys(idx).length,
      entries: Object.entries(idx).map(([k, v]) => ({ key: k, ...v })),
    });
    return;
  }

  if (cachePath === '/cache/clear') {
    if (!adminOk()) { sendJson(res, 401, { code: 401, msg: '未授权：缺少或错误的 token（需 ?token=）' }); return; }
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

  // .env 热更新：修改 token / OFFLINE 等配置后无需重启
  if (cachePath === '/reload') {
    refreshConfig();
    sendJson(res, 200, { code: 200, msg: 'reloaded', env: loadEnv() });
    return;
  }

  // Token 管理端点：页面上更改 token，支持覆盖 .env 或仅当次有效
  // 鉴权与 /cache/* 一致：设了 PROXY_ADMIN_TOKEN 才要求 ?token=（默认不设=不鉴权，方便本地开发）
  if (cachePath === '/admin/token') {
    if (!adminOk()) { sendJson(res, 401, { code: 401, msg: '未授权：缺少或错误的 token（需 ?token=）' }); return; }
    const bufs = [];
    req.on('data', (c) => bufs.push(c));
    req.on('end', () => {
      try {
        const text = Buffer.concat(bufs).toString('utf8');
        if (text.length > 1024) { sendJson(res, 413, { code: 413, msg: '内容过大' }); return; }
        const { token, saveToEnv } = JSON.parse(text);
        if (!token || typeof token !== 'string') {
          sendJson(res, 400, { code: 400, msg: '缺少 token 字段' });
          return;
        }
        // 立即生效
        const prevToken = TOKEN_REFRESHED;
        process.env.PROXY_TOKEN = token;
        TOKEN_REFRESHED = token;
        console.log(`   🔑 Token 已更新${saveToEnv ? ' 并写入 .env' : '（仅当次有效）'}`);
        // 可选：覆盖 .env 文件
        if (saveToEnv) {
          try {
            // 确保父目录存在：自定义 PROXY_ENV_PATH 或目录被清理时，
            // writeFileSync 才不会因「父目录不存在」而 ENOENT。
            fs.mkdirSync(path.dirname(envPath), { recursive: true });
            // 文件可能还不存在（.env 被 gitignore，首次部署常没有）——没有就当空内容，
            // 这样「覆盖 .env」首次也能创建文件，而不是 readFileSync 抛 ENOENT 直接 500。
            const content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';
            const lines = content.split('\n');
            let found = false;
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].trim().startsWith('PROXY_TOKEN=')) {
                lines[i] = `PROXY_TOKEN=${token}`;
                found = true;
                break;
              }
            }
            if (!found) lines.unshift(`PROXY_TOKEN=${token}`);
            fs.writeFileSync(envPath, lines.join('\n'), 'utf-8');
          } catch (e) {
            // 写盘失败就把运行时回滚：否则会出现「页面提示失败、代理其实已经换了 token」
            // 的不一致状态，用户以为没生效，实际请求已经在用新 token。
            process.env.PROXY_TOKEN = prevToken;
            TOKEN_REFRESHED = prevToken;
            sendJson(res, 500, { code: 500, msg: '写入 .env 失败: ' + e.message });
            return;
          }
        }
        sendJson(res, 200, { code: 200, msg: 'token updated', saved: !!saveToEnv });
      } catch (e) {
        sendJson(res, 400, { code: 400, msg: '解析失败: ' + e.message });
      }
    });
    req.on('error', (e) => sendJson(res, 400, { code: 400, msg: '读取请求体失败: ' + e.message }));
    return;
  }

  // 获取当前 token 状态（同 /admin/token，设了 PROXY_ADMIN_TOKEN 才鉴权）
  if (cachePath === '/admin/token/status') {
    if (!adminOk()) { sendJson(res, 401, { code: 401, msg: '未授权：缺少或错误的 token（需 ?token=）' }); return; }
    sendJson(res, 200, {
      code: 200,
      hasToken: !!TOKEN_REFRESHED,
      tokenPreview: TOKEN_REFRESHED ? TOKEN_REFRESHED.slice(0, 8) + '...' + TOKEN_REFRESHED.slice(-4) : '(未配置)',
      envPath: envPath,
    });
    return;
  }

  // 订阅页「批量修改批次时间」的本地落盘（不走 ITAMP 后端）。
  // 存到 config/batch-times.json：页面可直接读写，也可手改该文件。
  //   GET  /local/batch-times → { code:200, data:{ batchTimes:{...} } }
  //   POST /local/batch-times   body { batchTimes:{...} } → 写回文件
  if (cachePath === '/local/batch-times') {
    const FILE = path.join(__dirname, 'config', 'batch-times.json');
    if (req.method === 'GET' || req.method === 'HEAD') {
      try {
        const raw = fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8') : '';
        const data = raw ? JSON.parse(raw) : { batchTimes: {} };
        sendJson(res, 200, { code: 200, data });
      } catch (e) {
        sendJson(res, 500, { code: 500, msg: '读取批次时间失败: ' + e.message });
      }
      return;
    }
    if (req.method === 'POST' || req.method === 'PUT') {
      const bufs = [];
      req.on('data', (c) => bufs.push(c));
      req.on('end', () => {
        try {
          const text = Buffer.concat(bufs).toString('utf8') || '{}';
          if (text.length > 64 * 1024) { sendJson(res, 413, { code: 413, msg: '内容过大' }); return; }
          const parsed = JSON.parse(text);   // 必须是合法 JSON，避免把配置文件写坏
          // 页面只写 batchTimes，保留文件里的 _comment（让配置自带说明）
          try {
            const old = JSON.parse(fs.readFileSync(FILE, 'utf8'));
            if (old && old._comment && parsed._comment == null) parsed._comment = old._comment;
          } catch (_) { /* 旧文件不存在/损坏 → 忽略 */ }
          fs.mkdirSync(path.dirname(FILE), { recursive: true });
          fs.writeFileSync(FILE, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
          sendJson(res, 200, { code: 200, msg: '已保存', file: 'config/batch-times.json' });
        } catch (e) {
          sendJson(res, 400, { code: 400, msg: '保存失败（需合法 JSON）: ' + e.message });
        }
      });
      req.on('error', (e) => sendJson(res, 400, { code: 400, msg: '读取请求体失败: ' + e.message }));
      return;
    }
    sendJson(res, 405, { code: 405, msg: 'Method Not Allowed' });
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

  // API 内存缓存：命中直接返回（放在离线回放之前 —— 它服务的就是「重复请求」这个场景）
  if (isApiCachePath(req.url)) {
    const hit = getApiCache(key);
    if (hit) return respondApiCache(res, hit);
  }
  // 订阅相关写接口：请求一到就失效字典缓存。
  // 放在转发前而不是「成功后」，是为了不依赖响应路径；写失败导致的代价只是多发一次字典请求。
  if (isApiWritePath(req.url)) invalidateApiCache('写接口 ' + pathOf(req.url));

  // 纯离线模式：只读本地缓存，完全不访问网络
  if (OFFLINE_REFRESHED) {
    const hit = readCache(key);
    if (hit) {
      if (isApiCachePath(req.url)) storeApiCache(key, hit);   // 下一回同参数直接走内存缓存
      return replay(res, hit, 'PROXY_OFFLINE=1');
    }

    // 精确未命中 → 尝试宽松匹配（同 method + 同 path 的最近一条）
    if (LOOSE) {
      const loose = findLooseMatch(req.method, req.url);
      if (loose) {
        if (isApiCachePath(req.url)) storeApiCache(key, loose.entry);
        return replay(res, loose.entry, 'PROXY_OFFLINE=1 宽松匹配', true);
      }
    }

    return sendJson(res, 404, {
      code: 404,
      msg: '离线模式：本地缓存中没有这条记录。请连内网用相同参数请求一次以录制。',
      key,
      path: req.url,
      requestBody: meta.requestBody,
      looseMatch: LOOSE ? '已尝试宽松匹配，仍无同路径的缓存记录' : '已关闭（PROXY_LOOSE_MATCH=0）',
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

// 监听失败必须显式报出来并退出。
// 原先没有这个分支：端口被占用时 EADDRINUSE 会被上面的 uncaughtException 兜成
// 「已忽略，服务继续运行」，日志看起来一切正常 —— 于是你会对着一个根本没起来的代理
// 去排查前端 bug。这里直接点名端口并给换端口的命令。
server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`\n❌ 端口 ${PORT} 已被占用，代理没有启动。`);
    console.error(`   换个端口：PROXY_PORT=3001 node proxy.js`);
    console.error(`   或先查占用：lsof -nP -iTCP:${PORT} -sTCP:LISTEN\n`);
    // 端口占用是「根本没起来」的启动期失败，必须退出让调用方知道。
    process.exit(1);
  }
  // 其余 server 级错误（运行期偶发，例如对端异常断开/RST）只记录，不退出：
  // 否则一个坏连接就能把正在对外服务的代理整个拖垮（历史表现就是跑 2~3 分钟莫名 exit 1）。
  console.error('[proxy] server error（已记录，服务继续运行）:', (err && err.message) || err);
});

server.listen(PORT, () => {
  console.log(`\n✅ 服务器运行在 http://localhost:${PORT}`);
  console.log(`   📄 静态文件：从 ${__dirname} 提供（HTML/JS/CSS 等）`);
  console.log(`   🔀 API 代理：→ ${TARGET}`);
  console.log(`   Token：${TOKEN_REFRESHED ? TOKEN_REFRESHED.slice(0, 8) + '...' + TOKEN_REFRESHED.slice(-4) : '(未配置)'}`);
  console.log(`   模式：${OFFLINE_REFRESHED ? '🟡 纯离线回放（PROXY_OFFLINE=1）' : '🟢 真实转发 + 自动录制，失败回退缓存'}`);
  console.log(`   录制：${RECORD ? '开启' : '关闭（PROXY_RECORD=0）'}`);
  console.log(`   缓存目录：${CACHE_DIR}（已录 ${Object.keys(readIndex()).length} 条）`);
  console.log(`   🔑 .env 位置：${envPath}（前端「Token 管理」写入此处；可用 PROXY_ENV_PATH 改）`);
  if (!OFFLINE_REFRESHED) {
    console.log(`   转发超时：${TIMEOUT}ms（PROXY_TIMEOUT 可调）`);
    if (!TOKEN_REFRESHED) {
      console.log(`   ⚠️  未配置 PROXY_TOKEN：转发时不会带 token 头，后端大概率 401。` +
                  `请在 .env 里补上（后端 token 约 12 小时过期）`);
    }
  }
  console.log(`   健康检查：http://localhost:${PORT}/health`);
  console.log(`   缓存列表：http://localhost:${PORT}/cache/list`);
  console.log(`   热更新 .env：修改后自动生效（约 1.5 秒），也可 curl http://localhost:${PORT}/reload 立即生效`);
  console.log(`   用法：浏览器访问 http://localhost:${PORT} 即可看到前端页面`);
  console.log(`   订阅预演台（dry-run）：http://localhost:${PORT}/publish.html?dryrun=1`);
  console.log(`     拦截写请求、打印完整报文，不产生任何真实写入。说明见 docs/订阅预演台使用说明.md\n`);
});
