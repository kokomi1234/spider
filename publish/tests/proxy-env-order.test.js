/**
 * proxy.js 的 .env 加载顺序防线。
 *
 * 为什么单独钉：这些配置是**模块顶层的 const**，值在"执行到那一行"时就定死了。
 * 以前 loadEnv() 只在 refreshConfig() 里调，而 refreshConfig() 排在它们后面 ——
 * 结果 `.env` 里写 PROXY_HOST / PROXY_PORT / PROXY_TARGET / PROXY_TIMEOUT **一个字都不生效**
 * （只有 shell 环境变量管用）。表现是"按文档配了 .env、同事还是连不上这份代理"，
 * 而且不报错、日志还照样打印一行监听地址，极难自查（2026-09-20 实测踩过）。
 *
 * 所以这里不做数值断言，只钉**顺序**：第一次 loadEnv() 调用必须早于第一次
 * `const <大写> = process.env.PROXY_*`。谁把顺序改回去，这条就红。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { ROOT, test } = require('./harness');

const SRC = fs.readFileSync(path.join(ROOT, 'proxy.js'), 'utf8');

test('proxy.js：.env 必须早于所有读 process.env 的顶层 const 被加载', () => {
  const lines = SRC.split('\n');
  const firstCall = lines.findIndex((l) => /^\s*loadEnv\(\);/.test(l));
  const firstConstFromEnv = lines.findIndex((l) => /^\s*const\s+[A-Z_]+\s*=\s*.*process\.env\.PROXY_/.test(l));

  assert.ok(firstCall >= 0, '没找到顶层的 loadEnv() 调用 —— .env 是不是又只在 refreshConfig() 里读了？');
  assert.ok(firstConstFromEnv >= 0, '没匹配到「const X = process.env.PROXY_*」这类行，用例的正则要跟着源码更新');
  assert.ok(firstCall < firstConstFromEnv,
    `loadEnv() 在第 ${firstCall + 1} 行，但第 ${firstConstFromEnv + 1} 行已经在读 process.env：\n`
    + `  ${lines[firstConstFromEnv].trim()}\n`
    + '—— 这行的值会绕过 .env，只有 shell 环境变量生效。把 loadEnv() 及其依赖（FIRST_LOAD）挪到它前面。');
});

test('proxy.js：PROXY_HOST 的默认仍是只绑回环（放开必须显式设 .env）', () => {
  const m = /const\s+HOST\s*=\s*process\.env\.PROXY_HOST\s*\|\|\s*'([^']*)'/.exec(SRC);
  assert.ok(m, '没找到 HOST 的默认值写法，用例要跟着源码更新');
  assert.strictEqual(m[1], '127.0.0.1',
    'HOST 默认放开成全网卡 = /local/* 与 /cache/* 谁都能读写（CORS 是 *，且不鉴权）');
});
