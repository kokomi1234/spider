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

// .env 位置：**项目根目录**（publish/ 的上一级，即 spider/.env）。
// 2026-09-18 已从 publish/.env 迁出两件事一起做的：① 凭证不留在可部署的 publish/ 里，
// 免得随前端一起被拷走；② 相对脚本解析，不依赖 cwd（从哪个目录启动都不会错位）。
// 仍可用 PROXY_ENV_PATH 显式指定；前端「Token 管理」的写入位置也跟着这个值走。
const envPath = process.env.PROXY_ENV_PATH || path.join(__dirname, '..', '.env');

// ⚠️ .env 必须**先于下面这些常量**加载。曾经不是：loadEnv() 只在 refreshConfig() 里调，
// 而 refreshConfig() 在这些 const 之后才跑 —— 结果是 `.env` 里写 PROXY_HOST / PROXY_PORT /
// PROXY_TARGET / PROXY_TIMEOUT **完全无效**（只有 shell 环境变量管用），
// 「大家连同一份代理」按文档配了 .env 却仍绑在 127.0.0.1 上，同事连不上、各自存各自的。
// loadEnv() 用到 FIRST_LOAD（决定"命令行优先"），所以它的声明也必须一起提前，否则 TDZ 直接抛错。
let FIRST_LOAD = true;

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


loadEnv();   // ← 关键一行：让下面这几个常量读得到 .env

const PORT = Number(process.env.PROXY_PORT) || 3000;   // 数值：启动自检要拿它比端口（原来是从 .env 来的字符串，比不中）
// 默认**绑全网卡**（2026-09-20 用户拍板：内网自用，不做限制，同事直接连这份代理）。
// 只给本机用就设 PROXY_HOST=127.0.0.1。
// 安全口径（2026-09-20 用户拍板，别再加回来）：这份代理**不做鉴权** ——
// 原来那层 PROXY_ADMIN_TOKEN 的 token 校验已整体去掉。前提是"一个人部署、数据只落这一台、
// 跑在内网"。要收窄的话设 PROXY_HOST=127.0.0.1 就行（只绑本机）。
const HOST = process.env.PROXY_HOST || '0.0.0.0';
const TARGET = process.env.PROXY_TARGET || 'http://itamp.bocsys.cn';
// ⚠️ `let` 而不是 `const`：转发超时要能被 `/reload` 与 1.5s 的 .env 轮询改到。
//   原来是启动时定死的 const，而启动横幅承诺「修改后自动生效（约 1.5 秒）」、
//   `/reload` 还回 `keys:["PROXY_TIMEOUT"]` —— 改了不生效 + 谎报（2026-09-22 复测 D-7）。
let TIMEOUT = Number(process.env.PROXY_TIMEOUT) || 20000;


function refreshConfig() {
  loadEnv();
  TOKEN_REFRESHED = process.env.PROXY_TOKEN || '';
  // 管理员工号（2026-09-22）：token 归属的分界线 —— 管理员自己用 .env 里的 PROXY_TOKEN，
  // 其他人在没录入自己 token / 录了但过期 / 没登录时**回落**到它。
  // 默认写死 4711510，.env 里配了就以 .env 为准。
  ADMIN_USER_ID_REFRESHED = String(process.env.ADMIN_USER_ID || '4711510').trim();
  // 转发超时一起跟着热更新（复测 D-7）；非法值/0/负数退回默认 20000，别把请求挂死。
  const nextTimeout = Number(process.env.PROXY_TIMEOUT);
  TIMEOUT = nextTimeout > 0 ? nextTimeout : 20000;
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
/** 管理员工号（refreshConfig 里从 .env 的 ADMIN_USER_ID 读，默认 4711510） */
let ADMIN_USER_ID_REFRESHED = '4711510';

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
  // x-user-token：用户本机录入的 token（2026-09-22 起随请求带过来，代理不存）
  // x-user-key：工号，**只用于日志/诊断**（让"用的谁的 token"能落到人）
  'Access-Control-Allow-Headers': 'Content-Type, token, x-user-token, x-user-key',
  // ⚠️ 不 Expose 的话，跨域下前端 JS **读不到**响应头 —— 「这次用的是谁的 token」
  //    正是靠 x-token-source 传回去的（用管理员 token 时要禁掉订阅写操作）。
  'Access-Control-Expose-Headers': 'x-token-source',
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
  //
  // 2026-09-22 按人取 token：本人录入过且没过期就用本人的；否则回落管理员 token。
  // x-token-source 随响应回给前端 —— 它同时是「是否禁掉订阅写操作」的依据。
  const tk = resolveToken(req);
  if (tk.token) fwdHeaders['token'] = tk.token;
  res.setHeader('x-token-source', tk.source);
  // （日志不在这里打：离线回放不走这个函数，会一条都看不到 —— 见 server 入口那段）
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

// ═══════════════════════════════════════════════════════════════
// 常用查询的存储后端
// ------------------------------------------------------------------
// 优先 SQLite（publish/lib/queries-db.js，用 Node 内置的 node:sqlite，零 npm 依赖）：
// 它能回答 JSON 文件回答不了的问题 —— 「同一份查询条件被本部门几个人保存过」。
// Node 版本不够 / 内置模块被裁时自动回落到原来的 JSON 文件实现，功能不残废。
// ═══════════════════════════════════════════════════════════════
const QUERIES_DB_DEFAULT = path.resolve(__dirname, '..', 'shared', 'saved-queries.db');
const QUERIES_JSON_DEFAULT = path.resolve(__dirname, '..', 'shared', 'saved-queries.json');
const QUERIES_JSON_LEGACY = path.join(__dirname, 'config', 'saved-queries.json');
// （2026-09-22 删除）TOKENS_DB_DEFAULT：用户 token 曾经存在 shared/user-tokens.db，
// 后按用户要求改成只存浏览器本机（见 resolveToken 的注释）——代理侧不再有任何用户凭证落盘。

// 批次时间（订阅页「批量修改批次时间」的落盘）。
// 2026-09-20 从 publish/config/ 搬到 shared/ —— 它和库一样是**运行时数据**，
// 而 config/ 在代码目录里：重新部署（新包覆盖目录）会把它盖成包里那份空文件，数据就没了。
const BATCH_TIMES_DEFAULT = path.resolve(__dirname, '..', 'shared', 'batch-times.json');
const BATCH_TIMES_LEGACY = path.join(__dirname, 'config', 'batch-times.json');

let queriesDbState = null;      // { store, file } | null（不可用 / 未成功打开）
let queriesDbTried = false;

/** JSON 兜底路径：环境变量优先
 * @returns {string} */
function legacyQueriesFile() {
  return process.env.PROXY_QUERIES_FILE || QUERIES_JSON_DEFAULT;
}

/** 批次时间的落盘文件：环境变量优先（与 legacyQueriesFile 同一口径）
 * @returns {string} */
function batchTimesFile() {
  const f = process.env.PROXY_BATCH_TIMES_FILE;
  return f ? path.resolve(f) : BATCH_TIMES_DEFAULT;
}

/** 把旧 JSON 文件里的记录搬进数据库（只在库还是空的时候做一次） */
function migrateJsonToDb(store) {
  if (store.all().length) return 0;
  const candidates = [process.env.PROXY_QUERIES_FILE || QUERIES_JSON_DEFAULT, QUERIES_JSON_LEGACY];
  for (const f of candidates) {
    if (!fs.existsSync(f)) continue;
    let items = [];
    try {
      const parsed = JSON.parse(fs.readFileSync(f, 'utf8'));
      items = Array.isArray(parsed) ? parsed : (Array.isArray(parsed && parsed.items) ? parsed.items : []);
    } catch (_) { continue; }
    if (!items.length) continue;
    store.upsert(items, []);
    console.log(`[saved-queries] 已把 ${items.length} 条旧记录从 ${f} 迁进 SQLite`);
    return items.length;
  }
  return 0;
}

/** 打开 SQLite 存储；不可用返回 null（调用方降级到 JSON） */
function getQueriesStore() {
  if (queriesDbTried) return queriesDbState && queriesDbState.store;
  queriesDbTried = true;
  let Mod = null;
  try { Mod = require('./lib/queries-db.js'); } catch (_) { Mod = null; }
  if (!Mod || !Mod.available()) {
    console.log('[saved-queries] 当前 Node 没有可用的 node:sqlite（需要 Node ≥ 22.5），回落 JSON 文件存储');
    return null;
  }
  const file = process.env.PROXY_QUERIES_DB || QUERIES_DB_DEFAULT;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const store = Mod.open(file);
    migrateJsonToDb(store);
    queriesDbState = { store, file };
    console.log(`[saved-queries] SQLite 已就绪：${file}（现有 ${store.peopleCount()} 个保存者）`);
    return store;
  } catch (e) {
    console.log('[saved-queries] SQLite 打开失败，回落 JSON 文件: ' + e.message);
    queriesDbState = null;
    return null;
  }
}

// ── 用户的 token（2026-09-22 用户改口径：**只存用户本机**）────────────
// 原来代理侧按工号存一张表；用户后来改主意：有的同事 token 权限较高，不愿交给后端存 ——
// 那就只留在用户自己的浏览器里，发请求时随请求头 `x-user-token` 带过来。
// **代理因此不保存任何用户凭证**（`lib/user-tokens.js` 与那张表已整体删除）。
//
// 过期（每天 5:00 失效）也由前端判：token 就在本地，带一个必然失效的只会换来 401。

/**
 * 这次请求用谁的 token。
 *
 * @returns {{token:string, source:'user'|'fallback', userKey:string, reason:string}}
 *   source 随响应头 `x-token-source` 回去（仅作诊断：界面判定由前端自己算），
 *   同时会打进日志 —— 排查「为什么订阅被禁 / 为什么用了管理员的」时一眼能看到。
 */
function resolveToken(req) {
  const h = req.headers || {};
  const own = String(h['x-user-token'] || '').trim();
  // 工号只用于**日志与诊断**与「是不是管理员本人」的判断，不参与选 token（token 本身就在请求里）。
  // 没登录时前端不带，日志里就显示"未登录"。
  const userKey = String(h['x-user-key'] || '').trim();
  if (own) return { token: own, source: 'user', userKey, reason: '本人 token' };
  const admin = String(ADMIN_USER_ID_REFRESHED || '').trim();
  // 管理员本人**没有"自己的 token"可录** —— 他用的就是 .env 里那个全局 token，而且是全套权限。
  // 以前这里和"同事没录/录了但过期"共用一个 'fallback'，日志写成「本人没有可用 token
  //（未录入或已过期） · 工号 4711510」，看着像管理员忘了录入（2026-09-22 用户问的就是这条）。
  // 前端本来就用同一个 ADMIN_USER_ID 区分 'admin' 与 'fallback'（api-client 的 tokenSource），
  // 代理这边没跟上 → 两边的口径不一致，响应头 x-token-source 也跟着报错类别。
  if (userKey && admin && userKey === admin) {
    return { token: TOKEN_REFRESHED, source: 'admin', userKey, reason: '管理员本人：用的就是全局 token（全套权限）' };
  }
  return {
    token: TOKEN_REFRESHED,
    source: 'fallback',
    userKey,
    reason: userKey ? '本人没有可用 token（未录入或已过期）' : '未登录',
  };
}
/**
 * SQLite 分支的请求处理。
 * @returns {boolean} true = 已接走（含 405）；false = 交给调用方继续
 */
function handleQueriesSqlite(req, res, store) {
  let search = null;
  try { search = new URL(req.url, 'http://localhost').searchParams; } catch (_) { search = new URLSearchParams(); }

  if (req.method === 'GET' || req.method === 'HEAD') {
    try {
      const base = { file: store.file, storage: 'sqlite', people: store.peopleCount() };
      const dept = search.get('dept');
      const user = search.get('user');
      const limit = Number(search.get('limit')) || 0;
      if (dept) {
        // 部门高频：同一份条件按「几个人保存过」排序（人的数量才是热度）
        const items = store.deptTop(dept, limit || 10);
        sendJson(res, 200, { code: 200, data: { ...base, mode: 'dept', dept, items, deleted: store.tombstones() } });
      } else if (user) {
        // 个人视图：这个人保存/打开过的
        const items = store.byUser(user, limit || 50);
        sendJson(res, 200, { code: 200, data: { ...base, mode: 'user', user, items, deleted: store.tombstones() } });
      } else {
        const items = store.all();
        sendJson(res, 200, { code: 200, data: { ...base, mode: 'all', items, deleted: store.tombstones() } });
      }
    } catch (e) {
      sendJson(res, 500, { code: 500, msg: '读取常用查询失败: ' + e.message });
    }
    return true;
  }

  if (req.method === 'POST' || req.method === 'PUT') {
    const bufs = [];
    req.on('data', (c) => bufs.push(c));
    req.on('end', () => {
      try {
        const text = Buffer.concat(bufs).toString('utf8') || '{}';
        if (text.length > 2 * 1024 * 1024) { sendJson(res, 413, { code: 413, msg: '内容过大' }); return; }
        const parsed = JSON.parse(text);
        const incoming = Array.isArray(parsed) ? parsed : (parsed && parsed.items);
        if (!Array.isArray(incoming)) { sendJson(res, 400, { code: 400, msg: 'body 需要 { items: [...] }' }); return; }
        const delIds = Array.isArray(parsed.deletedIds) ? parsed.deletedIds : [];
        // 上限保护：一次最多收 2000 条。**截断要如实回传**（2026-09-21 补）：
        // 以前是静默丢弃，前端拿着「我提交了多少」去报数，用户以为全存进去了。
        const keptArr = incoming.slice(0, 2000);
        const truncated = incoming.length - keptArr.length;
        const r = store.upsert(keptArr, delIds);
        // 「谁用过这份查询」（部门高频的时间衰减排序要用，见 docs/部门高频查询排序方案.md）。
        // 与 items 分开传：它是**使用关系**，不是保存关系，混进 upsert 会把 savers 口径搞乱。
        // 失败不当成保存失败 —— 使用上报丢了最多让热度算得粗一点，不该让用户以为保存没成功。
        let used = 0; let useErr = '';
        const uses = Array.isArray(parsed.uses) ? parsed.uses.slice(0, 2000) : [];
        if (uses.length) {
          try { used = store.markUsed(uses); } catch (e) { useErr = String((e && e.message) || e); }
        }
        const skipped = Number(r.skipped) || 0;   // 字段不全 / 没有归属人 → 库层如实报数（复测 D-5）
        const dropNotes = [
          truncated ? `超出 2000 条上限，丢弃 ${truncated} 条` : '',
          skipped ? `${skipped} 条字段不全或没有归属人，未入库` : '',
        ].filter(Boolean);
        sendJson(res, 200, {
          code: 200, msg: dropNotes.length ? `已合并保存（${dropNotes.join('；')}）` : '已合并保存',
          data: { items: r.items, deleted: r.deleted, file: store.file, storage: 'sqlite',
            people: store.peopleCount(), mode: 'all', truncated, skipped, used,
            ...(useErr ? { useError: useErr } : {}) },
        });
      } catch (e) {
        sendJson(res, 400, { code: 400, msg: '保存失败（需合法 JSON）: ' + e.message });
      }
    });
    req.on('error', (e) => sendJson(res, 400, { code: 400, msg: '读取请求体失败: ' + e.message }));
    return true;
  }

  return false;
}

// ── 主服务 ────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  // 请求日志：记录来源 IP + 方法 + 路径，便于排查「外部访问进不来」
  const clientIp = (req.socket && req.socket.remoteAddress) || '?';
  console.log(`[req] ${clientIp} ${req.method} ${req.url}`);

  // 「这次用谁的 token」（2026-09-22）：写在这里而不是转发函数里 ——
  // 离线回放（PROXY_OFFLINE=1）根本不走转发，日志放那儿会一条都看不到。
  // 只打**会转发到内网的**那些请求（静态资源、/local/*、/admin/* 不打），
  // 因为只要"没带 x-user-* 头"就判定条件的话，未登录的查询反而会被漏掉。
  const isLocalEndpoint = /^\/(local|admin|cache)\b/.test(req.url);
  if (req.method !== 'OPTIONS' && !isLocalEndpoint && !isStaticRequest(req.url)) {
    const tkLog = resolveToken(req);
    console.log(tkLog.source === 'user'
      ? `   🔑 用本人 token（工号 ${tkLog.userKey || '未带'}）`
      : tkLog.source === 'admin'
        ? `   🔑 用全局 token（管理员本人 · 工号 ${tkLog.userKey} · 全套权限）`
        : `   🔑 用管理员 token（${tkLog.reason}${tkLog.userKey ? ' · 工号 ' + tkLog.userKey : ''}）`);
  }

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

  // 本地端点一律按**去掉查询串的路径**判定（下面 /cache/list、/local/*、/admin/* 都是这么写的）。
  // ⚠️ 必须先于 /health 定义：/health 原来用 `req.url === '/health'` 精确匹配，
  //   于是 `/health?t=1` 判不上、一路掉到转发层去打内网（502 还要等满 20s，2026-09-22 复测 D-8）。
  const cachePath = (() => { try { return new URL(req.url, 'http://localhost').pathname; } catch (_) { return req.url; } })();

  // 健康检查：快速判断代理是否还活着（也被前端用来提示「代理未启动」）
  if (cachePath === '/health') {
    sendJson(res, 200, {
      code: 200,
      msg: 'proxy ok',
      target: TARGET,
      port: PORT,                 // 回给自己是谁：启动自检靠这个判断连到的是哪一份代理
      offline: OFFLINE_REFRESHED,
      record: RECORD,
      timeout: TIMEOUT,               // 如实播报：PROXY_TIMEOUT 改没改，这里一眼能核对（复测 D-7）
      cacheDir: CACHE_DIR,
      cacheCount: Object.keys(readIndex()).length,
      apiCache: { ttlMs: API_CACHE_TTL, size: apiCache.size, paths: API_CACHE_PATHS },
    });
    return;
  }

  // 缓存管理。这些是**内网自用**的管理端点，不做鉴权。
  // （2026-09-20 用户拍板：整台服务器只有他一个人部署、数据也只落这一台，
  //   原来那层 PROXY_ADMIN_TOKEN 的 token 校验一并去掉，别再加回来。）

  if (cachePath === '/cache/list') {
    // 不做鉴权：内网自用、只有一台部署（2026-09-20 用户拍板去掉 token 校验）
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
    // 不做鉴权：内网自用、只有一台部署（2026-09-20 用户拍板去掉 token 校验）
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
  // ⚠️ 这条以前既不鉴权、又把 loadEnv() 原样回出去（= 任何人 curl 一下就拿到
  //    PROXY_TOKEN / PROXY_COOKIE，而代理默认监听所有网卡）。现在：要 token、且只回键名。
  if (cachePath === '/reload') {
    // 不做鉴权：内网自用、只有一台部署（2026-09-20 用户拍板去掉 token 校验）
    refreshConfig();
    const keys = Object.keys(loadEnv() || {});
    sendJson(res, 200, { code: 200, msg: 'reloaded', keys });
    return;
  }

  // Token 管理端点：页面上更改 token，支持覆盖 .env 或仅当次有效
  // 内网自用，不做鉴权（与 /cache/* 同一口径）
  if (cachePath === '/admin/token') {
    // 不做鉴权：内网自用、只有一台部署（2026-09-20 用户拍板去掉 token 校验）
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
        // （2026-09-22 简化）这里原来还有两条用户 token 的分支：按 userKey 存/清
        // 「他自己的 token」。用户随后改口径 —— token 只存用户本机，代理不保存任何用户凭证，
        // 那两条整体删掉了。**这个端点现在只管管理员那个全局 token。**
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

  // 获取当前 token 状态（同 /admin/token）
  if (cachePath === '/admin/token/status') {
    // 不做鉴权：内网自用、只有一台部署（2026-09-20 用户拍板去掉 token 校验）
    // 2026-09-22：只回**代理侧**的状态（管理员 token + 管理员工号 + 失效时刻）。
    // 用户自己的 token 存在浏览器本机，前端直接读 localStorage，不从这里要 ——
    // 这也是「token 不交给后端」的一部分：代理连它的存在都不需要知道。
    let adminKey = '';
    const expiryHour = 5;   // 与前端 UserToken.expiryHour 同一口径（每天 5:00 失效）
    adminKey = String(ADMIN_USER_ID_REFRESHED || '').trim();
    sendJson(res, 200, {
      code: 200,
      hasToken: !!TOKEN_REFRESHED,
      tokenPreview: TOKEN_REFRESHED ? TOKEN_REFRESHED.slice(0, 8) + '...' + TOKEN_REFRESHED.slice(-4) : '(未配置)',
      envPath: envPath,
      adminUserId: adminKey,
      expiryHour,
    });
    return;
  }

  // 订阅页「批量修改批次时间」的本地落盘（不走 ITAMP 后端）。
  // 存到 **shared/batch-times.json**（BATCH_TIMES_DEFAULT，可用 PROXY_BATCH_TIMES_FILE 改），
  //   **不是** publish/config/batch-times.json —— config/ 在代码目录里，重新部署会被新包里的
  //   空文件盖掉，所以 2026-09-20 迁到 shared/，旧文件首次使用时自动搬过来（留着当备份）。
  //   （2026-09-21 更正本注释：原来这里写的是迁走前的旧路径，会把人带错。）
  //   GET  /local/batch-times → { code:200, data:{ batchTimes:{...} } }
  //   POST /local/batch-times   body { batchTimes:{...} } → 按键合并后写回文件
  if (cachePath === '/local/batch-times') {
    const FILE = batchTimesFile();
    // 老位置（publish/config/）的文件第一次用到时**复制**过去，不删原文件（留着当备份）——
    // 与 saved-queries 的迁移同一手法：只在"新位置还没有"时搬，免得把已经写进去的新数据盖掉。
    if (FILE === BATCH_TIMES_DEFAULT && !fs.existsSync(FILE) && fs.existsSync(BATCH_TIMES_LEGACY)) {
      try {
        fs.mkdirSync(path.dirname(FILE), { recursive: true });
        fs.copyFileSync(BATCH_TIMES_LEGACY, FILE);
        console.log(`[batch-times] 已把旧文件迁到 ${FILE}（旧的留着当备份，可自行删除）`);
      } catch (e) {
        console.log(`[batch-times] 迁移旧文件失败（不影响使用）: ${e.message}`);
      }
    }

    /** 读当前文件：不存在 / 坏了都当"空配置"，不让一次坏数据把端点打成 500 */
    const readBatch = () => {
      try {
        const raw = fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8') : '';
        if (!raw) return { batchTimes: {} };
        const parsed = JSON.parse(raw);
        return (parsed && typeof parsed === 'object') ? parsed : { batchTimes: {} };
      } catch (_) {
        return { batchTimes: {} };
      }
    };

    if (req.method === 'GET' || req.method === 'HEAD') {
      sendJson(res, 200, { code: 200, data: readBatch() });
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

          // ⚠️ **按键合并，不是整份覆盖**（2026-09-20 改）。
          // 页面发上来的是"它手上那份完整 batchTimes"，而多个人可能同时在改**不同批次**：
          // 直接覆盖会让后保存的那份把先保存的整份盖掉 —— 甲的改动凭空消失。
          // 规则：以文件里现有的铺底，再用这次的键覆盖同名键。
          // （页面传空串表示"清空这个批次的日期"，也算一次有效覆盖，要保留。）
          const old = readBatch();
          const merged = Object.assign({}, old, parsed);
          merged.batchTimes = Object.assign({}, old.batchTimes || {}, (parsed && parsed.batchTimes) || {});
          // 页面只写 batchTimes，保留文件里的 _comment（让配置自带说明）
          if (old && old._comment && merged._comment == null) merged._comment = old._comment;

          // 原子写：先写 .tmp 再 rename。直接 writeFileSync 中途失败（磁盘满 / 进程被杀）
          // 会留下半截 JSON，下次 GET 就再也读不出来 —— 与 saved-queries 的 JSON 分支同一手法。
          fs.mkdirSync(path.dirname(FILE), { recursive: true });
          const tmp = `${FILE}.tmp-${process.pid}-${Date.now()}`;
          try {
            fs.writeFileSync(tmp, JSON.stringify(merged, null, 2) + '\n', 'utf8');
            fs.renameSync(tmp, FILE);
          } catch (e) {
            try { fs.unlinkSync(tmp); } catch (_) { /* 临时文件清不掉不重要 */ }
            sendJson(res, 500, { code: 500, msg: `写入失败（${FILE}）: ${e.message}` });
            return;
          }
          sendJson(res, 200, { code: 200, msg: '已保存', file: path.basename(FILE), batchTimes: merged.batchTimes });
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

  // 首页「常用查询」的落盘（不走 ITAMP 后端）。
  //   GET  /local/saved-queries                     → { items, deleted, file }
  //   GET  /local/saved-queries?dept=<部门键>&limit=N → 部门高频（按「几个人保存过」排序）
  //   GET  /local/saved-queries?user=<工号>&limit=N   → 这一个人的常用查询
  //   POST /local/saved-queries  { items, deletedIds } → 提交本机记录，返回全集
  // 存储：优先 SQLite（shared/saved-queries.db，能回答「多少人保存过」）；
  //       Node 不支持内置 node:sqlite 时自动降级到原来的 JSON 文件实现。
  if (cachePath === '/local/saved-queries') {
    // 同 /local/batch-times：内网自用，不做鉴权。
    // 不设这道关时，同网段任何机器（甚至任意网页，因为 CORS 是 *）都能读光、改写、删空这份团队库。
    // 不做鉴权：内网自用、只有一台部署（2026-09-20 用户拍板去掉 token 校验）
    const store = getQueriesStore();          // SQLite 不可用返回 null → 走下面 JSON 兜底
    if (store) {
      if (handleQueriesSqlite(req, res, store)) return;
      // 走到这里说明是 405 之类，照旧由下面统一处理
      sendJson(res, 405, { code: 405, msg: 'Method Not Allowed' });
      return;
    }
    const FILE = legacyQueriesFile();          // JSON 兜底用（SQLite 不可用时才走到这）
    const MAX_ITEMS = 200;   // 服务端宽松些：多人累积，比前端的 50 条上限大
    const DEFAULT_QUERIES_FILE = QUERIES_JSON_DEFAULT;
    const LEGACY_QUERIES_FILE = QUERIES_JSON_LEGACY;

    // 老机器上的 publish/config/saved-queries.json 不能直接丢：第一次用到新路径时
    // 把它复制过去（只在「新文件还没有」时搬，避免把别人共享库里的新内容覆盖掉）。
    if (FILE === DEFAULT_QUERIES_FILE && !fs.existsSync(FILE) && fs.existsSync(LEGACY_QUERIES_FILE)) {
      try {
        fs.mkdirSync(path.dirname(FILE), { recursive: true });
        fs.copyFileSync(LEGACY_QUERIES_FILE, FILE);
        console.log('[saved-queries] 已把旧文件迁到 ' + FILE + '（旧的留着当备份，可自行删除）');
      } catch (e) {
        console.log('[saved-queries] 迁移旧文件失败（不影响使用）: ' + e.message);
      }
    }

    /** 合并键：同页面 + 同名 视为同一条（与前端 importJson 一致） */
    const keyOf = (it) => ((it && it.page && it.name)
      ? (String(it.page) + '\u0000' + String(it.name))
      : ('id:' + String(it && it.id)));

    /**
     * 读文件。**「文件坏了」与「还没有文件」必须区分开**：
     * 以前两种都返回空表，于是下一次 POST 会用「只含这次提交」的内容把整个团队库重写一遍
     * —— 别人存的全没（实测复现）。坏文件现在带 corrupt 标，POST 见它就拒写。
     * 读侧仍返回 200 + 空列表，不因一份坏数据把端点打成 500。
     */
    const readFile = () => {
      let raw = '';
      try {
        raw = fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8') : '';
        if (!raw) return { items: [], deleted: [], corrupt: false };
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return { items: parsed, deleted: [], corrupt: false };
        const items = Array.isArray(parsed && parsed.items) ? parsed.items : [];
        const deleted = Array.isArray(parsed && parsed.deleted) ? parsed.deleted : [];
        // 墓碑只留 30 天：够覆盖「同事几天后打开」的情况，又不会让文件无限增长
        const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
        return {
          items: items.filter((it) => it && typeof it === 'object' && it.id && it.page),
          deleted: deleted.filter((d) => d && d.key && (Number(d.at) || 0) >= cutoff),
          corrupt: false,
        };
      } catch (e) {
        return { items: [], deleted: [], corrupt: true, error: e.message, bytes: raw.length };
      }
    };
    const readItems = () => readFile().items;

    /**
     * JSON 兜底分支的元信息。**必须与 SQLite 分支同形状**：
     * 前端 js/ui/saved-query.js 的 deptTopFromServer 靠「mode 必须是 dept」拒绝降级后端，
     * 而这条防线读的是 `data.mode` —— 这里少发一个 mode，JSON 兜底时 `?dept=` 会被忽略、
     * 直接把**全部门全量**当成本部门排行渲染到首页卡片上（实测复现）。
     */
    /**
     * people = **几个人**保存过（与 SQLite 分支的 `COUNT(DISTINCT user_key)` 同口径）。
     * 键必须先是「人」：以前先取 teamId，结果同部门两个人各存一份也只算 1 个人（实测）。
     * 没有工号/姓名时才退化到部门键，至少不至于报 0。
     */
    const jsonPeople = (items) => {
      const keys = new Set();
      (items || []).forEach((it) => {
        const o = (it && it.owner) || {};
        const k = String(o.userId || o.userName || o.teamId || o.teamName || '');
        if (k) keys.add(k);
      });
      return keys.size;
    };
    const jsonMeta = (items) => ({
      storage: 'json', mode: 'all', people: jsonPeople(items),
      note: 'JSON 兜底：不支持按部门排行（Node 需 ≥ 22.5 的 node:sqlite）',
    });

    /**
     * 合并两份列表。规则与前端 SavedQuery.importJson 一致：
     *   · 「同页面 + 同名」视为同一条（前端也用这条判重）
     *   · hits / saves / lastAt 取 max —— 反复提交同一个文件不该把热度刷上去
     *   · owner / labels 缺的从对方补
     */
    const mergeItems = (a, b, tombstone) => {
      const out = [];
      const idx = new Map();
      const dead = tombstone || new Set();
      [...(a || []), ...(b || [])].forEach((raw) => {
        if (!raw || typeof raw !== 'object' || !raw.id) return;
        const k = keyOf(raw);
        // 已被删掉的（墓碑）不再接受——否则同事的本地副本一推送就把删除记录"复活"了
        if (dead.has(k) || dead.has('id:' + String(raw.id))) return;
        const prev = idx.get(k);
        if (!prev) {
          const copy = JSON.parse(JSON.stringify(raw));
          idx.set(k, copy);
          out.push(copy);
          return;
        }
        prev.hits = Math.max(Number(prev.hits) || 0, Number(raw.hits) || 0);
        prev.saves = Math.max(Number(prev.saves) || 1, Number(raw.saves) || 1);
        prev.lastAt = Math.max(Number(prev.lastAt) || 0, Number(raw.lastAt) || 0);
        if (!prev.owner && raw.owner) prev.owner = raw.owner;
        if (!prev.labels && raw.labels) prev.labels = raw.labels;
      });
      // 最近打开/保存的排前面，文件本身也可读
      out.sort((x, y) => (Number(y.lastAt) || Number(y.at) || 0) - (Number(x.lastAt) || Number(x.at) || 0));
      return out.slice(0, MAX_ITEMS);
    };

    if (req.method === 'GET' || req.method === 'HEAD') {
      try {
        const f = readFile();
        sendJson(res, 200, {
          code: 200,
          data: {
            items: f.items, deleted: f.deleted, file: FILE, ...jsonMeta(f.items),
            // 如实告诉调用方「这个库现在是坏的」，前端角标才不会说「已同步」
            ...(f.corrupt ? { corrupt: true, note: '共享库文件解析失败，已按空库读取（未覆盖原文件）：' + f.error } : {}),
          },
        });
      } catch (e) {
        sendJson(res, 500, { code: 500, msg: '读取常用查询失败: ' + e.message });
      }
      return;
    }
    if (req.method === 'POST' || req.method === 'PUT') {
      const bufs = [];
      req.on('data', (c) => bufs.push(c));
      req.on('end', () => {
        try {
          const text = Buffer.concat(bufs).toString('utf8') || '{}';
          if (text.length > 2 * 1024 * 1024) { sendJson(res, 413, { code: 413, msg: '内容过大' }); return; }
          const parsed = JSON.parse(text);
          const incoming = Array.isArray(parsed) ? parsed : (parsed && parsed.items);
          if (!Array.isArray(incoming)) { sendJson(res, 400, { code: 400, msg: 'body 需要 { items: [...] }' }); return; }

          const f = readFile();
          // 文件坏了就**拒写**：这时按空表合并会把别人的记录整份抹掉（实测过那条路径）。
          // 宁可返回 500 让角标显示「同步失败：<原因>」，也不能悄悄覆盖团队库。
          if (f.corrupt) {
            sendJson(res, 500, {
              code: 500,
              msg: `共享库文件已损坏，拒绝覆盖（先修好或删掉 ${FILE}）：${f.error}`,
            });
            return;
          }
          // 删除意图：提交方删掉的条目要**从文件里移除并立墓碑**，
          // 否则合并时它会把删除的记录原样带回来（同事的本地副本一推送就"复活"）。
          const delIds = new Set((Array.isArray(parsed.deletedIds) ? parsed.deletedIds : []).map(String));
          const deleted = f.deleted.slice();
          let remaining = f.items;
          if (delIds.size) {
            remaining.forEach((it) => {
              if (delIds.has(String(it.id))) deleted.push({ key: keyOf(it), at: Date.now() });
            });
            remaining = remaining.filter((it) => !delIds.has(String(it.id)));
          }
          const deadKeys = new Set(deleted.map((d) => d.key));
          const merged = mergeItems(remaining, incoming, deadKeys);

          // 原子写：先写 .tmp 再 rename。直接 writeFileSync 中途失败（磁盘满 / 权限）
          // 会留下半截文件，下一次读就当坏文件 —— 对团队库来说是灾难。
          const payload = JSON.stringify({
            v: 2, updatedAt: new Date().toISOString(), items: merged, deleted,
          }, null, 2) + '\n';
          const tmp = `${FILE}.tmp-${process.pid}-${Date.now()}`;
          fs.mkdirSync(path.dirname(FILE), { recursive: true });
          try {
            fs.writeFileSync(tmp, payload, 'utf8');
            fs.renameSync(tmp, FILE);
          } catch (e) {
            try { fs.unlinkSync(tmp); } catch (_) { /* 临时文件清不掉不重要 */ }
            // 写盘失败必须如实报，不能返回 200 —— 否则前端角标会说「已同步」
            sendJson(res, 500, { code: 500, msg: `写入共享库失败（${FILE}）: ${e.message}` });
            return;
          }
          sendJson(res, 200, { code: 200, msg: '已合并保存', data: { items: merged, deleted, file: FILE, written: true, ...jsonMeta(merged) } });
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
  // 能走到这里就说明没有任何本地端点接住它 —— **本地前缀必须当场 404，不许进转发层**
  //（2026-09-22 复测 D-8：`/local/unknown-x`、`/admin/unknown-x`、`/cache/unknown-x`
  //  原来被原样转发去打内网，非离线环境要等满 TIMEOUT 才回一个 502，还顺带把内网地址暴露在前端）。
  let pathname = req.url;
  try { pathname = new URL(req.url, 'http://localhost').pathname; } catch (_) { /* 保留原串 */ }
  if (/^\/(local|admin|cache|health|reload)(\/|$)/.test(pathname)) {
    sendJson(res, 404, { code: 404, msg: '未知的本地端点：' + pathname });
    return;
  }

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

// ── 启动自检：这份常用查询库是不是**已经有另一份代理在跑** ──────────────────
// 2026-09-22 用户拍板：不在代码里钉死"一个库文件只许一个实例"，但要把另一份**报出来**
//（开发机上忘关一份、同事连到另一份，就会踩实测过的坑：20 并发只落进 10 条、最长阻塞 5.3 分钟）。
// 不用 lsof/fuser：部署机是 Windows，跨平台判活最稳的办法是问那个端口 `/health` 认不认。
// 锁文件写在 `<库文件>.proxy-lock`，与库同目录 ⇒ 捡到锁就一定是在说同一份库；
// 每次启动都把自己的信息覆盖上去，所以进程被 kill 掉留下的陈锁不需要谁去清理。
function probeProxyHealth(port, cb) {
  let done = false;
  const finish = (v) => { if (!done) { done = true; cb(v); } };
  try {
    const req = http.get({ host: '127.0.0.1', port, path: '/health', timeout: 500 }, (res) => {
      let s = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { s += c; if (s.length > 4096) req.destroy(); });
      res.on('end', () => {
        let j = null;
        try { j = JSON.parse(s); } catch (_) { /* 应答的不是本项目的代理 */ }
        finish(!!(j && j.msg === 'proxy ok'));
      });
    });
    req.on('error', () => finish(false));
    req.on('timeout', () => { req.destroy(); finish(false); });
  } catch (_) { finish(false); }
}

function checkOtherProxyInstance() {
  const dbFile = process.env.PROXY_QUERIES_DB || QUERIES_DB_DEFAULT;
  const lockFile = dbFile + '.proxy-lock';
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(lockFile, 'utf8')); } catch (_) { /* 没有锁 / 内容坏了 */ }
  try {
    fs.writeFileSync(lockFile, JSON.stringify({
      pid: process.pid, port: PORT, host: HOST, db: dbFile, startedAt: new Date().toISOString(),
    }));
  } catch (_) { /* 只读目录等：放弃自检，绝不影响启动 */ }
  const otherPort = Number(prev && prev.port) || 0;
  if (!otherPort || otherPort === PORT) return;      // 同一端口起不来（EADDRINUSE），这里只管不同端口
  probeProxyHealth(otherPort, (alive) => {
    if (!alive) return;                              // 那份早退了，刚才已把锁换成自己的
    console.log(`   ⚠️ 另有一份代理正在跑同一份常用查询库：http://127.0.0.1:${otherPort}`
      + `（pid ${prev.pid || '?'}，启动于 ${prev.startedAt || '?'}）`);
    console.log('      两个进程写同一个 SQLite 文件会互相抢锁、丢记录（实测 20 并发只落进 10 条）。'
      + '请只保留一份，并确认同事连的是哪个端口。');
  });
}

server.listen(PORT, HOST, () => {
  console.log(`\n✅ 服务器运行在 http://${HOST === '0.0.0.0' || HOST === '::' ? 'localhost' : HOST}:${PORT}`);
  console.log(`   🌐 监听地址：${HOST}` + (HOST === '127.0.0.1' ? '（只本机）' : '（全网卡，同事可直接连这台）')
    + '；/local/* 与 /cache/* 不鉴权（内网自用，见 proxy.js 顶部注释）');
  console.log(`   📄 静态文件：从 ${__dirname} 提供（HTML/JS/CSS 等）`);
  console.log(`   🔀 API 代理：→ ${TARGET}`);
  console.log(`   Token：${TOKEN_REFRESHED ? TOKEN_REFRESHED.slice(0, 8) + '...' + TOKEN_REFRESHED.slice(-4) : '(未配置)'}`);
  console.log(`   模式：${OFFLINE_REFRESHED ? '🟡 纯离线回放（PROXY_OFFLINE=1）' : '🟢 真实转发 + 自动录制，失败回退缓存'}`);
  console.log(`   🔑 .env 位置：${envPath}（前端「Token 管理」写入此处；可用 PROXY_ENV_PATH 改）`);
  // 「同一份条件 + 同一个人」的历史重复归并一次（2026-09-22）：
  // 旧的判重比的是名字，改名 / 认领攒下的重复不会自己消失 —— 启动时扫一遍收干净。
  // 只删「仅属于这一个人」的重复行，别人也存过的行不动。
  try {
    const st = getQueriesStore();
    if (st && typeof st.dedupeAll === 'function') {
      const d = st.dedupeAll();
      if (d && d.removed) console.log(`   🧹 已归并 ${d.removed} 条旧记录（同一个人重复保存了同一份条件）`);
    }
  } catch (e) {
    console.log(`   ⚠️ 归并历史重复失败（不影响运行）：${(e && e.message) || e}`);
  }
  if (!OFFLINE_REFRESHED) {
    console.log(`   转发超时：${TIMEOUT}ms（PROXY_TIMEOUT 可调）`);
    if (!TOKEN_REFRESHED) {
      console.log(`   ⚠️  未配置 PROXY_TOKEN：转发时不会带 token 头，后端大概率 401。` +
                  `请在 .env 里补上（后端 token 约 12 小时过期）`);
    }
  }
  console.log(`   健康检查：http://localhost:${PORT}/health`);
  checkOtherProxyInstance();   // 同一份库上是否还有别的代理在跑（不同端口时只能靠这个自检发现）
  console.log(`   热更新 .env：修改后自动生效（约 1.5 秒），也可 curl http://localhost:${PORT}/reload 立即生效`);
  console.log(`   用法：浏览器访问 http://localhost:${PORT} 即可看到前端页面`);
  console.log(`   订阅预演台（dry-run）：http://localhost:${PORT}/publish.html?dryrun=1`);
  console.log(`     拦截写请求、打印完整报文，不产生任何真实写入。说明见 docs/订阅预演台使用说明.md\n`);
});
