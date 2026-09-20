'use strict';
/* 两用户端到端探针：同一个浏览器里，A 存过一条，B 用**同样的名字**再存 —— 看 B 能不能看到自己的。
   ────────────────────────────────────────────────────────────────
   为什么留它：2026-09-20 用户报「第二个用户怎么搞都没法保存、条数还是第一个用户的」。
   根因链条（同名复用 id → 服务端按 id 覆盖 → 返回的 owner 取 savers[0]（最早那位）
   → 本机列表被服务端全集覆盖 → listForUser 恒空）在单测里没法一步到位地重演，
   必须真浏览器 + 真代理 + 真库跑一遍。本文件把现场固定下来，动这条链路后重跑对照。

   前置：另开一个终端，**用临时库**（别指到团队库 shared/saved-queries.db）：
     cd publish && PROXY_OFFLINE=1 PROXY_PORT=3012 PROXY_QUERIES_DB=/tmp/probe-two-users.db node proxy.js
   运行：
     SMOKE_CHROME_PATH="<chrome路径>" node tests/probes/live-probe-two-users.js
   说明：只打印事实、不做断言（人名与数据会变）；会往上面那个临时库写两条测试记录。
   已知：工号查询在离线宽松匹配下会命中「同 path 的最近一条」而返回别人，
   所以这里第二个身份走**姓名**设置（见 R1 那两行输出）。 */
const { chromium } = require('../../vendor/playwright-core');

const CHROME = process.env.SMOKE_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.PROBE_URL || 'http://127.0.0.1:3012';

const A = { userId: '4711510', userName: '郑梓辉', orgId: '1645A', orgName: '中国银行软件中心（深圳）', teamId: 'K4229', teamName: '中国银行软件中心（深圳）开发三部' };
const B = { userId: '6464402', userName: '吴树海', orgId: '1645A', orgName: '中国银行软件中心（深圳）', teamId: 'K4229', teamName: '中国银行软件中心（深圳）开发三部' };

const j = (v) => JSON.stringify(v);

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  const wire = [];
  page.on('response', async (r) => {
    if (!/saved-queries/.test(r.url())) return;
    let body = null;
    try { body = await r.json(); } catch (_) { /* 非 JSON */ }
    const d = body && body.data;
    wire.push({
      m: r.request().method(),
      url: r.url().replace(BASE, ''),
      mode: d ? d.mode : null,
      n: d && Array.isArray(d.items) ? d.items.length : null,
      owner: d && Array.isArray(d.items) ? d.items.map((it) => (it.owner && (it.owner.userId || it.owner.userName)) || null) : null,
      savers: d && Array.isArray(d.items) ? d.items.map((it) => it.savers) : null,
    });
  });

  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(1200);

  const look = (kw) => page.evaluate(async (k) => {
    const r = await window.CurrentUser.lookup(k);
    return { kw: k, ok: r.ok, mode: r.mode, error: r.error || '', got: (r.list || []).map((u) => u.userId + '/' + u.userName) };
  }, kw);

  console.log('\n===== R1：第二个用户到底能不能设上 =====');
  console.log('工号 6464402 →', j(await look('6464402')));
  console.log('姓名 吴树海  →', j(await look('吴树海')));

  const setUser = (u) => page.evaluate((x) => { window.CurrentUser.set(x); return window.CurrentUser.get(); }, u);
  const saveQ = (name) => page.evaluate((n) => {
    const r = window.SavedQuery.save({ page: 'publish', name: n, fields: { prodBatch: '2611' } });
    return { ok: r.ok, error: r.error || '', ownerMissing: !!r.ownerMissing, id: r.item && r.item.id };
  }, name);
  const snap = () => page.evaluate(() => window.SavedQuery.list().map((it) => ({
    id: it.id, name: it.name, owner: (it.owner && (it.owner.userId || it.owner.userName)) || null,
    saverKeys: it.saverKeys || [], fields: it.fields,
  })));
  const mine = (u) => page.evaluate((x) => window.SavedQuery.listForUser(x).map((it) => it.name), u);

  console.log('\n===== A（郑梓辉 4711510）保存一条 =====');
  console.log('set   →', j(await setUser(A)));
  console.log('save  →', j(await saveQ('探针-共同查询')));
  await page.waitForTimeout(2000);
  console.log('list()→', j(await snap()));
  console.log('mine(A)→', j(await mine(A)));

  console.log('\n===== 切到 B（吴树海 6464402），保存「同名」再保存「不同名」 =====');
  console.log('set   →', j(await setUser(B)));
  console.log('mine(B) 切完立刻 →', j(await mine(B)));
  console.log('B save 同名   →', j(await saveQ('探针-共同查询')));
  await page.waitForTimeout(2000);
  console.log('list()→', j(await snap()));
  console.log('mine(B)→', j(await mine(B)));
  console.log('B save 不同名 →', j(await saveQ('探针-独有查询')));
  await page.waitForTimeout(2000);
  console.log('list()→', j(await snap()));
  console.log('mine(B)→', j(await mine(B)));

  console.log('\n===== 重载首页，看真实渲染 =====');
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2500);
  console.log('savedTitle →', j(await page.evaluate(() => (document.getElementById('savedTitle') || {}).textContent || '')));
  console.log('savedCount →', j(await page.evaluate(() => (document.getElementById('savedCount') || {}).textContent || '')));
  console.log('HomePage.count() →', j(await page.evaluate(() => window.HomePage.count())));
  console.log('卡片 →', j(await page.evaluate(() => [...document.querySelectorAll('#savedList .saved-item .saved-name')].map((e) => e.textContent))));

  console.log('\n===== 网络侧 /local/saved-queries =====');
  wire.forEach((w) => console.log(j(w)));
  if (pageErrors.length) console.log('\n[pageerror]', j(pageErrors));

  await browser.close();
})();
