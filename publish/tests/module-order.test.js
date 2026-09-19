/**
 * 脚本顺序无关性回归。
 *
 * ── 为什么单独钉 ──────────────────────────────────────────
 * 模块都是浏览器 IIFE，靠 window.X 互相取用。只要在 IIFE **顶层**就把依赖取进闭包
 * （`const REQ = window.API && ...` / `const toast = window.toast || fallback`），
 * 一旦脚本顺序变了，依赖就永久降级成兜底实现，而且**不报错**——
 * 表现是「点了没反应」「提示不出来」「筛选不生效」，极难自查（项目踩过）。
 *
 * 这里的防线有两层：
 *   1. 运行时：故意把被依赖模块排到后面加载，断言依赖仍然生效（第一组用例）。
 *   2. 静态：扫描全部 js/ 源码，顶层不得再有「会静默降级」的捕获
 *      （第二组用例；命名空间对象除外 —— 那种错序会当场抛错，属有声失败，见 ALLOWED）。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { ROOT, loadScript, test } = require('./harness');

const okResp = (payload) => async () => ({ ok: true, status: 200, json: async () => payload });

// ══════════════════════════════════════════════════════════
// 1) 运行时：反序加载，依赖仍要生效
// ══════════════════════════════════════════════════════════

test('顺序无关：task-api.js 先于 api-client.js 加载，请求层不降级', async () => {
  const win = {};
  loadScript('js/api/task-api.js', {}, win);       // 此刻 window.API 还不存在
  loadScript('js/core/api-client.js', {}, win);    // 之后才就位
  win.API.call = okResp({ code: 0, total: 1, rows: [{ serverCoding: 'C1' }] });

  const res = await win.TaskApi.fetchTaskList({}, 1, 20);
  assert.strictEqual(res.ok, true, '反序加载后请求层仍应可用，实际：' + JSON.stringify(res));
  assert.strictEqual(res.rows.length, 1, '应真的把响应解析出来，而不是走兜底');
});

test('顺序无关：service-api.js 先于 api-client.js 加载，写入链路不降级', async () => {
  const win = {};
  loadScript('js/api/service-api.js', {}, win);
  loadScript('js/core/api-client.js', {}, win);

  let called = 0;
  win.API.call = async () => {
    called += 1;
    return { ok: true, status: 200, json: async () => ({ code: 200, msg: 'ok' }) };
  };

  const res = await win.ServiceApi.subscribeWithForm({ serverCoding: 'C1' }, { callerSystem: 'E00406' });
  assert.strictEqual(res.ok, true, '反序加载后写入链路仍应可用，实际：' + JSON.stringify(res));
  assert.strictEqual(called, 1, '应真的发出请求，而不是抛「请求层未就绪」');
});

test('顺序无关：tool-api.js / user-api.js 先于 api-client.js 加载，请求层不降级', async () => {
  const cases = [
    { rel: 'js/api/tool-api.js', ns: 'ToolApi', call: (api) => api.fetchProdSysServeNoList('E00406') },
    { rel: 'js/api/user-api.js', ns: 'UserApi', call: (api) => api.fetchUserDetail('u1') },
  ];

  for (const c of cases) {
    const win = {};
    loadScript(c.rel, {}, win);                    // 先加载，window.API 尚未就位
    loadScript('js/core/api-client.js', {}, win);
    win.API.call = okResp({ code: 0, data: { userId: 'u1' }, list: [] });

    const res = await c.call(win[c.ns]);
    assert.strictEqual(res.ok, true, `${c.ns} 反序加载后仍应可用，实际：` + JSON.stringify(res));
    assert.strictEqual(res.local, false, `${c.ns} 应走真实请求层，而不是本地兜底`);
  }
});

// ══════════════════════════════════════════════════════════
// 2) 静态：顶层不得再有会「静默降级」的 window.X 捕获
// ══════════════════════════════════════════════════════════

/**
 * 允许保留在 IIFE 顶层的捕获（**有意为之**，逐条说明）。
 *
 * 判定标准：错序时是「当场抛错」还是「静默降级」。
 * 前者可以留（有声失败，再配合 bootstrap.js 的 PRESETS 校验与 html 里的顺序注释），
 * 后者一律要改成调用时取值。
 */
const ALLOWED = [
  // ── 命名空间对象：紧接着就解引用成员（PublishModel.FIELDS），错序会当场 TypeError ──
  ['js/page/publish.js', 'const PublishModel    = window.PublishModel;'],
  ['js/page/publish.js', 'const PublishView     = window.PublishView;'],
  ['js/page/publish.js', 'const PublishQuery    = window.PublishQuery;'],
  ['js/page/publish.js', 'const FIELDS          = PublishModel.FIELDS;'],
  // ── subscription.js：同上（SubscriptionModel 的成员被立即解引用成局部函数）──
  ['js/page/subscription.js', 'const V = SubscriptionView;   // 纯渲染层'],
  ['js/page/subscription.js', 'const rowKey = SubscriptionModel.rowKey;'],
  ['js/page/subscription.js', 'const buildCond = SubscriptionModel.buildCond;'],
  ['js/page/subscription.js', 'const batchWindow = SubscriptionModel.batchWindow;'],
  ['js/page/subscription.js', 'const decorateRow = SubscriptionModel.decorateRow;'],
  ['js/page/subscription.js', 'const decorateRows = SubscriptionModel.decorateRows;'],
  ['js/page/subscription.js', 'const redecorateRows = SubscriptionModel.redecorateRows;'],
  ['js/page/subscription.js', 'const toBatchOptions = SubscriptionModel.toBatchOptions;'],
];

/** 只看「读取」：注释、挂载/赋值（window.X = ...）都不算 */
function looksLikeRead(raw) {
  if (/^\s*\*/.test(raw)) return false;                          // 块注释正文
  if (/^\s*window\.[\w$.]+\s*=/.test(raw)) return false;         // 往 window 上挂/改属性
  if (/window\.[A-Za-z_$][\w$]*\s*(\|\||&&)?\s*=[^=]/.test(raw)) return false;   // window.X = ...
  return true;
}

/** JS 内建全局：Object.assign / Object.freeze 这类不是「项目模块」 */
const BUILTIN = /^(?:Object|Array|Math|JSON|Date|Number|String|Boolean|Promise|Map|Set|WeakMap|WeakSet|RegExp|Error|Intl|Symbol|Proxy|Reflect|URL|Blob|File|FormData|Headers|Request|Response|Event|CustomEvent|HTMLElement|Node|CSS|AbortController)$/;

/** 扫出 IIFE 顶层「把依赖立刻取进闭包」的行 */
function scanTopLevelCaptures() {
  const hits = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      if (!e.name.endsWith('.js')) continue;

      const rel = path.relative(ROOT, abs).split(path.sep).join('/');
      let depth = 0;
      fs.readFileSync(abs, 'utf8').split('\n').forEach((raw, i) => {
        const code = raw.replace(/\/\/.*$/, '');
        if (depth <= 1 && looksLikeRead(raw)) {
          // RHS 是「window.Xxx」或裸命名空间「Xxx.member」，且**不是**箭头 / 函数字面量
          const m = /=\s*(?:window\.([A-Z][\w$]*)|([A-Z][\w$]*)\s*(?:[;,.]|$))/.exec(code);
          const rhsIsFn = /=\s*(?:\(|function|async)/.test(code);
          const ident = m && (m[1] || m[2]);
          if (m && !rhsIsFn && !BUILTIN.test(ident)) hits.push({ rel, line: i + 1, text: raw.trim() });
        }
        for (const ch of code) { if (ch === '{') depth += 1; else if (ch === '}') depth -= 1; }
      });
    }
  };
  walk(path.join(ROOT, 'js'));
  return hits;
}

test('静态：IIFE 顶层不得再出现会「静默降级」的 window.X 捕获', () => {
  const key = (x) => x.rel + '::' + x.text;
  const hits = scanTopLevelCaptures();
  const found = new Set(hits.map(key));
  const allowed = new Set(ALLOWED.map(([f, t]) => f + '::' + t));

  const offenders = hits.filter((h) => !allowed.has(key(h)));
  assert.deepStrictEqual(
    offenders,
    [],
    '以下位置在 IIFE 顶层就把依赖取进闭包，脚本顺序一变会**静默降级**。\n' +
    '请改成「调用时才取」——写法参考 js/ui/dict-selects.js 的 notify / js/api/task-api.js 的 requester：\n' +
    offenders.map((h) => `  ${h.rel}:${h.line}  ${h.text}`).join('\n'),
  );

  // 反向断言：白名单条目必须真的还能被扫到。否则说明扫描逻辑失效（形同虚设）或白名单过期，
  // 那样这个静态防线就只是「假装在防」。
  const stale = [...allowed].filter((k) => !found.has(k));
  assert.deepStrictEqual(
    stale,
    [],
    'ALLOWED 里有扫不到的条目（扫描逻辑可能已失效，或该处已被改写），请重新核对并更新：\n' +
    stale.map((s) => '  ' + s).join('\n'),
  );
});

// ── 转发口径要一致（协议层只有一份实现，四个模块都只是薄转发）────────
// 教训：给 api-client 的 request() 加了第 4 个参数（opts：signal / timeout）之后，
// 只有 task-api 转发了它，另外三个照样丢掉 —— 于是「别的模块也能取消」这句话
// 当时是假的。这类「接线」用行为测不出来（不传就是没影响），所以直接钉源码。
test('四个接口模块都把 opts 透传给协议层（不再只转发 3 个参数）', () => {
  const fs = require('fs');
  const path = require('path');
  const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  ['service-api', 'task-api', 'tool-api', 'user-api'].forEach((m) => {
    const src = read('js/api/' + m + '.js');
    assert.ok(
      /function request\(name, body, query, opts\)/.test(src),
      m + '.js 的 request() 少了 opts 形参',
    );
    assert.ok(
      /req\.request\(name, body, query, opts\)/.test(src),
      m + '.js 没有把 opts 转发给 req.request()',
    );
  });
});
