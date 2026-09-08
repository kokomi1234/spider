#!/usr/bin/env node
/**
 * HAR → 本地代理缓存导入
 *
 * 用途：把抓包文件里的真实响应灌进 cache/，这样 proxy.js 在
 * 内网不可达（或 PROXY_OFFLINE=1）时也能回放，前端页面照常可用。
 *
 * 用法：
 *   cd publish
 *   node tools/har-import.js ../../analysis/任务单查询.har
 *   node tools/har-import.js ../../analysis/任务单查询.har --no-index   # 只写文件，不更新索引
 *
 * 缓存 key 的算法与 proxy.js 的 cacheKey() 完全一致：
 *   sha1( METHOD | pathname | JSON.stringify(排序后的查询参数，剔除 n) |
 *         JSON.stringify(键排序后的请求体) )
 * 所以前端只要发出一模一样的 method + path + 请求体，就能命中。
 *
 * ⚠️ cache/ 里是真实内网数据，注意不要外传。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CACHE_DIR = process.env.PROXY_CACHE_DIR || path.join(__dirname, '..', 'cache');
const INDEX_FILE = path.join(CACHE_DIR, '_index.json');

// ── 与 proxy.js 保持一致的 key 算法 ──────────────────────────
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
  catch (_) { return str; }
}

function cacheKey(method, reqUrl, bodyText) {
  const u = new URL(reqUrl, 'http://dummy');
  const params = [...u.searchParams.entries()]
    // 剔除防缓存随机数 n；再剔除空值参数 —— api-client.js 拼 query 时会跳过
    // 空值（v != null && v !== ''），抓包里常见的 "?deptName=" 就是这种情况，
    // 不剔除的话前端永远命中不了这条缓存。
    .filter(([k, v]) => k !== 'n' && v !== '')
    .sort(([a], [b]) => a.localeCompare(b));
  return crypto.createHash('sha1').update([
    String(method || '').toUpperCase(),
    u.pathname,
    JSON.stringify(params),
    normalizeJson(bodyText || ''),
  ].join('|')).digest('hex');
}

// ── HAR 解析 ────────────────────────────────────────────────

/** 取响应正文：content.text 可能是 base64 编码 */
function responseBody(entry) {
  const c = entry.response && entry.response.content;
  if (!c) return '';
  if (c.encoding === 'base64' && c.text) {
    return Buffer.from(c.text, 'base64').toString('utf8');
  }
  return c.text || '';
}

/** 取请求正文：优先 postData.text，其次是 params 表单 */
function requestBody(entry) {
  const r = entry.request;
  if (!r) return '';
  if (r.postData) {
    if (r.postData.text) return r.postData.text;
    if (Array.isArray(r.postData.params) && r.postData.params.length) {
      const obj = {};
      r.postData.params.forEach((p) => { obj[p.name] = p.value; });
      return JSON.stringify(obj);
    }
  }
  return '';
}

function headersToObject(list) {
  const out = {};
  (list || []).forEach((h) => { out[h.name.toLowerCase()] = h.value; });
  return out;
}

function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const updateIndex = !process.argv.includes('--no-index');

  if (!args.length) {
    console.error('用法: node tools/har-import.js <file.har> [--no-index]');
    process.exit(1);
  }

  const harPath = path.resolve(args[0]);
  if (!fs.existsSync(harPath)) {
    console.error('找不到 HAR 文件:', harPath);
    process.exit(1);
  }

  let har;
  try {
    har = JSON.parse(fs.readFileSync(harPath, 'utf8'));
  } catch (e) {
    console.error('HAR 解析失败:', e.message);
    process.exit(1);
  }

  const entries = (har.log && har.log.entries) || [];
  if (!entries.length) {
    console.error('HAR 里没有 entries');
    process.exit(1);
  }

  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  const index = updateIndex && fs.existsSync(INDEX_FILE)
    ? JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'))
    : {};

  let written = 0;
  let skipped = 0;

  entries.forEach((entry, i) => {
    const req = entry.request || {};
    const resp = entry.response || {};
    const status = Number(resp.status || 0);

    if (status !== 200) {
      console.log(`  [${i}] 跳过 HTTP ${status} ${req.url}`);
      skipped++;
      return;
    }

    const bodyText = requestBody(entry);
    const key = cacheKey(req.method, req.url, bodyText);
    const url = new URL(req.url);

    const record = {
      key,
      method: String(req.method || 'GET').toUpperCase(),
      path: url.pathname + url.search,
      requestBody: bodyText.slice(0, 500),
      recordedAt: entry.startedDateTime || new Date().toISOString(),
      status,
      headers: headersToObject(resp.headers),
      body: responseBody(entry),
    };

    // 回放用不到的头必须去掉，否则浏览器会挂住（与 proxy.replay() 一致）
    ['content-length', 'transfer-encoding', 'content-encoding', 'connection'].forEach((h) => {
      delete record.headers[h];
    });
    record.headers['content-type'] = record.headers['content-type'] || 'application/json; charset=utf-8';

    fs.writeFileSync(path.join(CACHE_DIR, key + '.json'), JSON.stringify(record, null, 2), 'utf8');
    index[key] = { method: record.method, path: record.path, requestBody: record.requestBody, recordedAt: record.recordedAt };
    written++;

    console.log(`  [${i}] ✅ ${record.method} ${url.pathname} → ${key}`);
  });

  if (updateIndex) {
    fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2), 'utf8');
  }

  console.log(`\n完成：写入 ${written} 条，跳过 ${skipped} 条，缓存目录 ${CACHE_DIR}`);
  console.log('提示：缓存按「method + path + 请求体」精确匹配，前端要发一样的请求体才会命中。');
}

main();
