'use strict';
/* 复现：同一台机器上先给 A 存几条，切成 B 之后再存，B 的「我的常用查询」是不是空的。
   前置：cd publish && PROXY_OFFLINE=1 PROXY_PORT=3013 PROXY_QUERIES_DB=/tmp/xxx.db node proxy.js
   运行：node _probe-switch-user.js
   只打印事实，不做断言。 */
const { chromium } = require('./publish/vendor/playwright-core');

const CHROME = process.env.SMOKE_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.PROBE_URL || 'http://127.0.0.1:3013';

// 用缓存里真实存在的两个人（这样身份查询走真实 current-user.js，不 stub）
const A = { userId: '6464402', userName: '吴树海', orgId: '1645A', orgName: '中国银行软件中心（深圳）', teamId: 'K4229', teamName: '中国银行软件中心（深圳）开发三部' };
const B = { userId: '4711510', userName: '郑梓辉', orgId: '1645A', orgName: '中国银行软件中心（深圳）', teamId: 'K4229', teamName: '中国银行软件中心（深圳）开发三部' };

const j = (v) => JSON.stringify(v);

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));

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
      owners: d && Array.isArray(d.items) ? d.items.map((it) => (it.owner && it.owner.userId) || null) : null,
      saverKeys: d && Array.isArray(d.items) ? d.items.map((it) => it.saverKeys || []) : null,
    });
  });

  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(1200);

  const setUser = (u) => page.evaluate((x) => { window.CurrentUser.set(x); return window.CurrentUser.get(); }, u);
  const saveQ = (name) => page.evaluate((n) => {
    const r = window.SavedQuery.save({ page: 'publish', name: n, fields: { prodBatch: n } });
    return { ok: r.ok, error: r.error || '', ownerMissing: !!r.ownerMissing, id: r.item && r.item.id,
      owner: r.item && r.item.owner && r.item.owner.userId };
  }, name);
  const snap = () => page.evaluate(() => window.SavedQuery.list().map((it) => ({
    id: it.id, name: it.name, owner: (it.owner && it.owner.userId) || null, saverKeys: it.saverKeys || [],
  })));
  const mine = (u) => page.evaluate((x) => window.SavedQuery.listForUser(x).map((it) => it.name), u);
  const serverMine = (key) => page.evaluate(async (k) => {
    const r = await fetch('/local/saved-queries?user=' + encodeURIComponent(k), { headers: { Accept: 'application/json' }, cache: 'no-store' });
    const jj = await r.json();
    const d = (jj && jj.data) || {};
    return { mode: d.mode, n: (d.items || []).length, names: (d.items || []).map((i) => i.name), owners: (d.items || []).map((i) => (i.owner && i.owner.userId) || null) };
  }, key);
  const serverDept = (key) => page.evaluate(async (k) => {
    const r = await fetch('/local/saved-queries?dept=' + encodeURIComponent(k) + '&limit=10', { headers: { Accept: 'application/json' }, cache: 'no-store' });
    const jj = await r.json();
    const d = (jj && jj.data) || {};
    return { mode: d.mode, n: (d.items || []).length, rows: (d.items || []).map((i) => i.name + ' / savers=' + i.savers) };
  }, key);

  console.log('\n===== ① A（吴树海 6464402）先存 3 条 =====');
  console.log('set →', j(await setUser(A)));
  for (const n of ['A-条件一', 'A-条件二', 'A-条件三']) {
    console.log('save ' + n + ' →', j(await saveQ(n)));
  }
  await page.waitForTimeout(2200);
  console.log('本机 list() →', j(await snap()));
  console.log('mine(A) →', j(await mine(A)));
  console.log('服务端 ?user=A →', j(await serverMine(A.userId)));

  console.log('\n===== ② 切成 B（郑梓辉 4711510），B 存 1 条 =====');
  console.log('set →', j(await setUser(B)));
  console.log('mine(B) 切完立刻 →', j(await mine(B)));
  console.log('save B-我的条件 →', j(await saveQ('B-我的条件')));
  await page.waitForTimeout(2200);
  console.log('本机 list() →', j(await snap()));
  console.log('mine(B) →', j(await mine(B)));
  console.log('服务端 ?user=B →', j(await serverMine(B.userId)));

  console.log('\n===== ③ 部门视图（两人同部门 K4229）=====');
  console.log('本机 listByDept(B) →', j(await page.evaluate((x) => window.SavedQuery.listByDept(x, 10).map((i) => i.name + ' / savers=' + i.savers), B)));
  console.log('服务端 ?dept=K4229 →', j(await serverDept('K4229')));

  console.log('\n===== ④ 重载首页，看真实渲染 =====');
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2500);
  console.log('savedTitle →', j(await page.evaluate(() => (document.getElementById('savedTitle') || {}).textContent || '')));
  console.log('savedCount →', j(await page.evaluate(() => (document.getElementById('savedCount') || {}).textContent || '')));
  console.log('我的卡片 →', j(await page.evaluate(() => [...document.querySelectorAll('#savedList .saved-item .saved-name')].map((e) => e.textContent))));
  console.log('部门卡片 →', j(await page.evaluate(() => [...document.querySelectorAll('#deptList .saved-item .saved-name')].map((e) => e.textContent))));

  console.log('\n===== 网络侧 /local/saved-queries =====');
  wire.forEach((w) => console.log(j(w)));

  await browser.close();
})();
