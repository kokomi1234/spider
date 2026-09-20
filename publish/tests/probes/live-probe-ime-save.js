'use strict';
/* 真·页面验证两个 2026-09-20 晚的修复：
   ① task/subscription 页「保存到首页」必须弹成功（曾因 save async 化漏了 await，
      弹「保存失败」但实际存进去了）；
   ② searchable-select 的输入法组合态（IME）：组合中的 input 事件**不得改写 input.value**
      （改了会把拼音踢成裸英文字母）；compositionend 后要能按最终中文过滤。
   ②用合成事件模拟组合态（真 IME 无法自动化），并对 input.value 挂 setter 侦测改写。
   前置：cd publish && PROXY_OFFLINE=1 PROXY_PORT=3026 PROXY_QUERIES_DB=/tmp/dup-test.db node proxy.js */
const { chromium } = require('../../vendor/playwright-core');

const CHROME = process.env.SMOKE_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.PROBE_URL || 'http://127.0.0.1:3026';

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-proxy-server'] });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));

  const inject = () => page.evaluate(() => {
    const P = [{ userId: '1001', userName: '张三', orgId: '1645A', orgName: '中银软开', teamId: 'K4229', teamName: '开发一部' }];
    window.UserApi = {
      fetchUserList: async (kw) => ({ ok: true, list: P.filter((u) => u.userName.includes(String(kw || '').trim())) }),
      fetchUserDetail: async (id) => ({ ok: true, user: P.find((u) => u.userId === String(id || '').trim()) || null }),
    };
  });

  // ── ① task 页保存：真点，抓 toast ──
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  inject(); await page.waitForTimeout(600);
  await page.goto(BASE + '/task', { waitUntil: 'load' });
  inject(); await page.waitForTimeout(800);
  // 填一个条件（任务单号），点「保存到首页」
  const anyInput = page.locator('#t_taskNo').first();
  await anyInput.fill('2611001');
  // task 页没加载 dialog-utils，回退到原生 window.prompt（无头环境自动返回 null=取消）——
  // 桩掉它模拟「用户输入了名字并确认」
  await page.evaluate(() => { window.prompt = () => '任务页的保存'; });
  await page.click('text=保存到首页');
  await page.waitForTimeout(1500);
  const taskToasts = await page.evaluate(() =>
    [...document.querySelectorAll('.toast, [class*=toast]')].map((t) => (t.textContent || '').trim()).filter(Boolean));
  console.log('① task 页保存 toast:', JSON.stringify(taskToasts));

  // ── ② IME 组合态仿真（首页「当前用户」框）──
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  inject(); await page.waitForTimeout(600);
  const ime = await page.evaluate(() => {
    const input = document.querySelector('#userKeyword ~ .searchable-select .searchable-select-input');
    if (!input) return { err: '找不到输入框' };
    const log = [];
    // 侦测 value 写入：setter 记录每次程序化赋值
    const proto = Object.getPrototypeOf(input);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    Object.defineProperty(input, 'value', {
      get() { return desc.get.call(this); },
      set(v) {
        log.push('write:' + String(v) + ' ← ' + String(new Error().stack).split('\n')[2].trim().slice(0, 120));
        desc.set.call(this, v);
      },
    });
    const fire = (type, data, composing) => {
      input.dispatchEvent(new (type === 'input' ? window.Event : window.CompositionEvent)(type, {
        bubbles: true, data, inputType: 'insertCompositionText',
      }));
    };
    // 模拟：z（组合中）→ zh（组合中）→ 张（组合中）→ compositionend + 最终 input
    fire('compositionstart', '');
    fire('input', 'z');   // isComposing 态我们用 Event 的 isComposing? 构造器不支持 —— 组件同时看 isComposing 标志
    fire('input', 'zh');
    fire('input', '张');
    const writesDuringComposing = log.slice();
    // 模拟 IME 提交：真输入法在 compositionend 时已把最终中文写进框（用原生 setter，不走侦测）
    desc.set.call(input, '张三');
    fire('compositionend', '张三');
    fire('input', '张三');   // Chrome 在 end 后补发的最终 input
    return { writesDuringComposing, finalValue: input.value, writesTotal: log.length };
  });
  console.log('② IME 仿真:', JSON.stringify(ime));

  await browser.close();
})().catch((e) => { console.error('探针炸了:', e); process.exit(1); });
