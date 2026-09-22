/**
 * toast 提示队列（评估报告 U-07）
 *
 * 修复前：js/ui/toast.js 里共用一个 `timer` + `clearTimeout`，且直接改元素的 textContent。
 * 连续调用时后一条会**立刻覆盖**前一条并重置计时 —— 典型后果是
 * 「查询失败」的 error toast 刚冒头就被随后的「查询完成」顶掉，用户根本没看到失败原因。
 * 修复后：改为顺序播放队列。当前口径（2026-09-22 565c848）：上限 **3** 条、条间 **80ms** 淡出、
 * 默认时长 **1500ms**、内容相同的提示合并成「… ×N」。下面的用例把这些数值**逐个钉死**，
 * 改动实现必须连带改口径，否则变红 —— 上一版就是只断"某条被丢弃"，实现从 5 改 3 后照样绿。
 *
 * 为什么写成单测而不是冒烟：toast.js 需要 DOM，但只用 getElementById 拿元素 +
 * classList/style，不依赖真实布局。这里用假元素 + 可控假时钟，做成**确定性**用例；
 * 冒烟环境无后端，页面会持续异步弹提示、队列排空时间不可控，断言容易偶发失败。
 */
'use strict';

const { test, loadScript } = require('./harness');

/** 可控假时钟：手动推进时间，避免真实等待与时序抖动 */
function fakeClock() {
  let now = 0;
  let seq = 0;
  const jobs = new Map();
  return {
    setTimeout(fn, ms) {
      seq += 1;
      jobs.set(seq, { at: now + (ms || 0), fn });
      return seq;
    },
    /** 推进 ms 毫秒：按到期时间依次执行（允许回调里再排新的，队列正是这样工作的） */
    advance(ms) {
      const target = now + ms;
      for (;;) {
        let next = null;
        jobs.forEach((j, id) => {
          if (j.at <= target && (next === null || j.at < next.j.at)) next = { id, j };
        });
        if (!next) break;
        now = next.j.at;
        jobs.delete(next.id);
        next.j.fn();
      }
      now = target;
    },
  };
}

/** 假 toast 元素：className 与 classList 互相同步（toast.js 两者都会用） */
function fakeToastEl() {
  const classes = new Set();
  return {
    textContent: '',
    style: {},
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    },
    get className() { return Array.from(classes).join(' '); },
    set className(v) {
      classes.clear();
      String(v).split(/\s+/).filter(Boolean).forEach((c) => classes.add(c));
    },
  };
}

function loadToast(clock, el) {
  return loadScript('js/ui/toast.js', {
    document: { getElementById: (id) => (id === 'toast' ? el : null) },
    setTimeout: (fn, ms) => clock.setTimeout(fn, ms),
  }, {});
}

test('toast：连续调用时后一条排队等待，不立刻覆盖前一条', () => {
  const el = fakeToastEl();
  const clock = fakeClock();
  const win = loadToast(clock, el);

  win.toast('第一条', 400);
  if (el.textContent !== '第一条') {
    throw new Error(`第一条应立即显示，实际 "${el.textContent}"`);
  }
  if (!el.classList.contains('show')) throw new Error('第一条应处于 show 状态');

  win.toast('第二条', 400);
  if (el.textContent !== '第一条') {
    throw new Error(`第二条应排队等待、不得覆盖第一条，实际显示 "${el.textContent}"`);
  }

  clock.advance(400);                       // 第一条 duration 到 → 移除 show，进入间隔
  if (el.textContent !== '第一条') throw new Error('第一条播完后不应在同一时刻就换掉文本');
  if (el.classList.contains('show')) throw new Error('第一条播完应移除 show');

  clock.advance(200);                       // 间隔结束 → 第二条接上
  if (el.textContent !== '第二条') {
    throw new Error(`第二条应接上播放，实际 "${el.textContent}"`);
  }
  if (!el.classList.contains('show')) throw new Error('第二条应处于 show 状态');

  clock.advance(800);                       // 第二条播完 → 队列空，收起
  if (el.classList.contains('show')) throw new Error('全部播完后应移除 show');
});

test('toast：队列上限 3 条，超出丢弃最旧的（防异常风暴堆成长龙）', () => {
  const el = fakeToastEl();
  const clock = fakeClock();
  const win = loadToast(clock, el);

  for (let i = 1; i <= 7; i += 1) win.toast('T' + i, 100);
  // T1 立即播出，队列只留 3 条 → T2/T3/T4 被挤掉，最终看到 T1、T5、T6、T7。
  // ⚠️ 断言必须钉到**具体哪几条被丢**：上一版只断「T2 被丢弃」，
  //   而实现从上限 5 改成 3（565c848）之后 T2 照样被丢 → 用例**恰好蒙过**，防线形同虚设
  //   （2026-09-22 复测 D-18）。把 MAX_QUEUE 改回 5 时，本用例必须变红。
  const seen = [el.textContent];
  for (let k = 0; k < 9; k += 1) {
    clock.advance(220);
    if (seen[seen.length - 1] !== el.textContent) seen.push(el.textContent);
  }
  ['T1', 'T5', 'T6', 'T7'].forEach((t) => {
    if (!seen.includes(t)) throw new Error(`${t} 应播出，实际序列 ${JSON.stringify(seen)}`);
  });
  ['T2', 'T3', 'T4'].forEach((t) => {
    if (seen.includes(t)) throw new Error(`${t} 应被上限 3 丢弃，实际序列 ${JSON.stringify(seen)}`);
  });
});

test('toast：不传时长时默认 1500ms 就收（565c848 从 2500 缩短，改回就会变红）', () => {
  const el = fakeToastEl();
  const clock = fakeClock();
  const win = loadToast(clock, el);

  win.toast('只此一条');                      // 不传 duration → 走默认值
  if (!el.classList.contains('show')) throw new Error('默认时长：弹出后应立即 show');
  clock.advance(1499);
  if (!el.classList.contains('show')) throw new Error('默认时长应为 1500ms，1499ms 就收是回退到更短');
  clock.advance(200);
  if (el.classList.contains('show')) throw new Error('超过默认时长 1500ms 后应移除 show');
});
