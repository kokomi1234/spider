'use strict';
/* 真·页面复现：同一个浏览器（同一份 localStorage，= 同一台机器两个人先后用）
   张三存「服务X」→ 切李四 → 存同名同条件的「服务X」→ 看李四的列表里有没有。
   ────────────────────────────────────────────────────────────────
   背景：用户报「一个查询被第一个用户存了，别人的存就无效了」。
   API 层已验证服务端没问题（两人各一条）；本探针盯的是前端链路。
   全程真打字真点按钮（唯一允许的 evaluate 是注入假 UserApi）。
   前置：cd publish && PROXY_OFFLINE=1 PROXY_PORT=3026 PROXY_QUERIES_DB=/tmp/dup-test.db node proxy.js */
const { chromium } = require('../../vendor/playwright-core');

const CHROME = process.env.SMOKE_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.PROBE_URL || 'http://127.0.0.1:3026';

const j = (v) => JSON.stringify(v);

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-proxy-server'] });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));

  const inject = () => page.evaluate(() => {
    const P = [
      { userId: '1001', userName: '张三', orgId: '1645A', orgName: '中银软开', teamId: 'K4229', teamName: '开发一部' },
      { userId: '1002', userName: '李四', orgId: '1645A', orgName: '中银软开', teamId: 'K4229', teamName: '开发一部' },
    ];
    window.UserApi = {
      fetchUserList: async (kw) => ({ ok: true, list: P.filter((u) => u.userName.includes(String(kw || '').trim())) }),
      fetchUserDetail: async (id) => ({ ok: true, user: P.find((u) => u.userId === String(id || '').trim()) || null }),
    };
  });

  /** 首页选人：真打字出候选 → 点候选 */
  async function pickUser(name) {
    await page.goto(BASE + '/index.html', { waitUntil: 'load' });
    inject();
    await page.waitForTimeout(600);
    const box = '#userKeyword ~ .searchable-select .searchable-select-input';
    // 已有人设过身份时输入框是藏着的，先真点「切换用户」
    const sw = page.locator('#btnUserChange').first();
    if (await sw.isVisible().catch(() => false)) { await sw.click(); await page.waitForTimeout(400); }
    await page.click(box);
    await page.type(box, name);
    await page.waitForTimeout(500);
    await page.locator('.searchable-select-option', { hasText: name }).first().click();
    await page.waitForTimeout(400);
    return page.locator('#currentUserBar, .current-user-bar, [id*=user]').first().innerText().catch(() => '(身份条读不到)');
  }

  /** 去发布页填条件 → 真点「保存到首页」→ 弹窗里真打字名字 → 确认 */
  async function saveQuery(name) {
    await page.goto(BASE + '/publish', { waitUntil: 'load' });
    inject();
    await page.waitForTimeout(600);
    await page.fill('#f_serviceName', '服务X');
    await page.click('text=保存到首页');
    await page.waitForTimeout(400);
    const dlgInput = page.locator('.dlg-util-overlay input[type=text]').first();
    await dlgInput.fill('');
    await dlgInput.type(name);
    await page.locator('.dlg-util-overlay .sub-foot .filled, .dlg-util-overlay button:has-text("确定")').first().click();
    await page.waitForTimeout(600);
    return page.locator('.toast, [class*=toast]').last().innerText().catch(() => '(无 toast)');
  }

  const cardNames = () => page.evaluate(() =>
    Array.from(document.querySelectorAll('#savedList .saved-item, #savedList [class*=card], #savedList > *'))
      .map((el) => (el.textContent || '').trim().slice(0, 40)));

  console.log('── 张三：存「服务X」');
  console.log('身份:', (await pickUser('张三')).replace(/\n/g, ' '));
  console.log('保存 toast:', (await saveQuery('服务X')).replace(/\n/g, ' '));
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  inject(); await page.waitForTimeout(700);
  console.log('张三首页卡片:', j(await cardNames()));

  console.log('── 李四：存同名「服务X」');
  console.log('身份:', (await pickUser('李四')).replace(/\n/g, ' '));
  console.log('保存 toast:', (await saveQuery('服务X')).replace(/\n/g, ' '));
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  inject(); await page.waitForTimeout(700);
  console.log('李四首页卡片:', j(await cardNames()));

  console.log('── 本机 localStorage 里现在有什么');
  console.log(j(await page.evaluate(() => {
    const keys = Object.keys(localStorage);
    const out = {};
    keys.forEach((k) => { out[k] = (localStorage.getItem(k) || '').slice(0, 400); });
    return out;
  })));

  await browser.close();
})().catch((e) => { console.error('探针炸了:', e); process.exit(1); });
