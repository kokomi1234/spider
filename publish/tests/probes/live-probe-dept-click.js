'use strict';
/* 真·页面复现：点「部门常用查询」卡片，有概率条件没填进去就查询了（2026-09-21 用户报）。
   场景：张三/李四（同部门）各存一份同条件查询 → 王五（同部门）从首页点部门卡 →
   落到发布页后抓：表单值、查询请求体、toast。重复多轮抓概率性。
   前置：cd publish && PROXY_OFFLINE=1 PROXY_PORT=3026 PROXY_QUERIES_DB=/tmp/dup-test.db node proxy.js */
const { chromium } = require('../../vendor/playwright-core');

const CHROME = process.env.SMOKE_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.PROBE_URL || 'http://127.0.0.1:3026';

const PEOPLE = [
  { userId: '1001', userName: '张三', orgId: '1645A', orgName: '中银软开', teamId: 'K4229', teamName: '开发一部' },
  { userId: '1002', userName: '李四', orgId: '1645A', orgName: '中银软开', teamId: 'K4229', teamName: '开发一部' },
  { userId: '1003', userName: '王五', orgId: '1645A', orgName: '中银软开', teamId: 'K4229', teamName: '开发一部' },
];

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-proxy-server'] });

  const inject = (page) => page.evaluate((P) => {
    window.UserApi = {
      fetchUserList: async (kw) => ({ ok: true, list: P.filter((u) => u.userName.includes(String(kw || '').trim())) }),
      fetchUserDetail: async (id) => ({ ok: true, user: P.find((u) => u.userId === String(id || '').trim()) || null }),
    };
  }, PEOPLE);

  async function pickUser(page, name) {
    await page.goto(BASE + '/index.html', { waitUntil: 'load' });
    await inject(page);
    await page.waitForTimeout(500);
    const sw = page.locator('#btnUserChange').first();
    if (await sw.isVisible().catch(() => false)) { await sw.click(); await page.waitForTimeout(300); }
    const box = '#userKeyword ~ .searchable-select .searchable-select-input';
    await page.click(box);
    await page.type(box, name);
    await page.waitForTimeout(400);
    await page.locator('.searchable-select-option', { hasText: name }).first().click();
    await page.waitForTimeout(300);
  }

  async function saveOnPublish(page, name) {
    await page.goto(BASE + '/publish', { waitUntil: 'load' });
    await inject(page);
    await page.waitForTimeout(700);
    await page.fill('#f_serviceName', '服务X');
    await page.click('text=保存到首页');
    await page.waitForTimeout(400);
    const dlgInput = page.locator('.dlg-util-overlay input[type=text]').first();
    await dlgInput.fill('');
    await dlgInput.type(name);
    await page.locator('.dlg-util-overlay .sub-foot .filled').first().click();
    await page.waitForTimeout(800);
  }

  async function saveOnSubscription(page, name) {
    await page.goto(BASE + '/subscription', { waitUntil: 'load' });
    await inject(page);
    await page.waitForTimeout(900);
    const box = '#f_callerCompNum ~ .searchable-select .searchable-select-input';
    await page.click(box);
    await page.type(box, 'E00404');
    await page.waitForTimeout(600);
    await page.locator('.searchable-select-option', { hasText: 'E00404' }).first().click();
    await page.waitForTimeout(300);
    await page.click('text=保存到首页');
    await page.waitForTimeout(400);
    const dlgInput = page.locator('.dlg-util-overlay input[type=text]').first();
    await dlgInput.fill('');
    await dlgInput.type(name);
    await page.locator('.dlg-util-overlay .sub-foot .filled').first().click();
    await page.waitForTimeout(800);
  }

  // 前置数据：张三、李四各存一份（发布页 + 订阅页）
  const c1 = await browser.newContext(); const p1 = await c1.newPage();
  await pickUser(p1, '张三'); await saveOnPublish(p1, '张三的部门查询');
  const c2 = await browser.newContext(); const p2 = await c2.newPage();
  await pickUser(p2, '李四'); await saveOnPublish(p2, '李四的部门查询');
  await pickUser(p2, '李四'); await saveOnSubscription(p2, '李四的订阅查询');
  await c1.close(); await c2.close();
  console.log('前置：张三/李四 各存一份完成（含订阅页）');

  // 王五：点部门卡（服务端渲染出来的那张），多轮
  const c3 = await browser.newContext(); const page = await c3.newPage();
  const queryBodies = [];
  page.on('request', (req) => {
    if (req.url().includes('getPublishDataHistoryList') && req.method() === 'POST') {
      queryBodies.push((req.postData() || '').slice(0, 220));
    }
  });

  for (let round = 1; round <= 5; round++) {
    queryBodies.length = 0;
    await pickUser(page, '王五');                       // 每轮从首页开始
    await page.waitForTimeout(900);                     // 等部门区服务端渲染替换
    // 点第一张部门卡（与服务端渲染对应的真实卡片）
    const card = page.locator('#deptList .saved-item, #deptList a').first();
    const href = await card.getAttribute('href').catch(() => null);
    await card.click();
    await page.waitForTimeout(1800);                    // 等回填 + 自动查询
    const url = page.url();
    const svc = await page.inputValue('#f_serviceName').catch(() => '(读不到)');
        const toasts = await page.evaluate(() =>
      [...document.querySelectorAll('.toast, [class*=toast]')].map((t) => (t.textContent || '').trim()).filter(Boolean));
    console.log(`── 第${round}轮`);
    console.log('  卡片href:', href, '| 落地URL:', url.replace(BASE, ''));
    console.log('  表单值: serviceName=', JSON.stringify(svc));
    console.log('  toast:', JSON.stringify(toasts).slice(0, 160));
    console.log('  查询请求数:', queryBodies.length, queryBodies.length ? '| 首条:' + queryBodies[0].slice(0, 120) : '');
  }

  // 订阅页部门卡：王五点同事（李四）存的订阅查询 → 回填调用方系统 E00404
  for (let round = 1; round <= 3; round++) {
    await pickUser(page, '王五');
    await page.waitForTimeout(900);
    const card = page.locator('#deptList a[href*="/subscription"]').first();
    const cnt = await page.locator('#deptList a[href*="/subscription"]').count();
    if (!cnt) { console.log(`订阅第${round}轮: 部门区没有订阅卡片`); continue; }
    const href = await card.getAttribute('href');
    await card.click();
    await page.waitForTimeout(2200);   // 回填含联动拉取，多等一点
    const url = page.url();
    const callerVal = await page.inputValue('#f_callerCompNum ~ .searchable-select .searchable-select-input').catch(() => '(读不到)');
    const toasts = await page.evaluate(() =>
      [...document.querySelectorAll('.toast, [class*=toast]')].map((t) => (t.textContent || '').trim()).filter(Boolean));
    console.log(`── 订阅第${round}轮`);
    console.log('  卡片href:', href, '| 落地URL:', url.replace(BASE, ''));
    console.log('  调用方系统值:', JSON.stringify(callerVal));
    console.log('  toast:', JSON.stringify(toasts).slice(0, 160));
  }

  await browser.close();
})().catch((e) => { console.error('探针炸了:', e); process.exit(1); });
