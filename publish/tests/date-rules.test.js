/**
 * 批次时间的月份相关性用例：跨年 / 闰年 / 大小月 / 月末 / 跨时区。
 *
 * 起因：有人问「批次时间的计算结果会不会随月份变化而变动」。结论是**截止日推算本身是安全的**
 * （Date 的月份进位能正确处理跨年），真正的月份相关风险在**取"今天"用的时区**上：
 * 机器时区不是 UTC+8 时，北京时间每月 1 日 00:00~08:00 会被算成上个月，
 * "近 12 个月窗口"整体偏一个月。这里把两边都钉住。
 */
'use strict';

const assert = require('assert');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadScript, test } = require('./harness');

const win = loadScript('js/core/format.js');
loadScript('js/ui/priority.js', {}, win);
loadScript('js/data/batch-data.js', {}, win);
const { Priority, Fmt, batchWindowLabels } = win;

const pad = (n) => String(n).padStart(2, '0');
const ymdOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** 绝对月序号（年 * 12 + 月-1），便于比较连续性与跨年 */
const absMonth = (year, month1) => year * 12 + (month1 - 1);
/** '2609批次' → 绝对月序号；注意 label 里是两位年，和 Date 的四位年要统一到同一把尺子 */
const monthIndex = (label) => {
  const m = /^(\d{2})(\d{2})批次$/.exec(label);
  return absMonth(2000 + Number(m[1]), Number(m[2]));
};

// ── 1. 截止日：跨年 / 大小月 / 2 月 ────────────────────

test('截止日：12 个月的批次全部落在"批次月-1 的 15 日"，跨年由 Date 自己进位', () => {
  const now = new Date(2026, 8, 14);
  const expected = {
    '2601批次': '2025-12-15', '2602批次': '2026-01-15', '2603批次': '2026-02-15',
    '2604批次': '2026-03-15', '2605批次': '2026-04-15', '2606批次': '2026-05-15',
    '2607批次': '2026-06-15', '2608批次': '2026-07-15', '2609批次': '2026-08-15',
    '2610批次': '2026-09-15', '2611批次': '2026-10-15', '2612批次': '2026-11-15',
  };
  Object.entries(expected).forEach(([label, want]) => {
    const r = Priority.evaluate({ prodBatchList: label, status: '开发基线' }, now);
    assert.strictEqual(r.deadline, want, `${label} 的截止日应为 ${want}`);
    assert.strictEqual(r.from, 'rule');
  });
});

test('截止日：跨年两侧（2512 / 2701）不串年', () => {
  const now = new Date(2026, 8, 14);
  assert.strictEqual(Priority.evaluate({ prodBatchList: '2512批次', status: '开发基线' }, now).deadline, '2025-11-15');
  assert.strictEqual(Priority.evaluate({ prodBatchList: '2701批次', status: '开发基线' }, now).deadline, '2026-12-15');
  // 功能测试基线：批次月当月 15 日，不做 -1
  assert.strictEqual(Priority.evaluate({ prodBatchList: '2701批次', status: '功能测试基线' }, now).deadline, '2027-01-15');
});

test('截止日：day 超过目标月天数时钳到当月最后一天（2 月平年 28 / 闰年 29）', () => {
  // 规则现在恒用 15 号，这里守住的是「日后改 day 不会溢出到下个月」
  assert.strictEqual(ymdOf(Priority.deadlineOf({ year: 2026, month: 2 }, 0, 31)), '2026-02-28');
  assert.strictEqual(ymdOf(Priority.deadlineOf({ year: 2028, month: 2 }, 0, 31)), '2028-02-29');  // 闰年
  assert.strictEqual(ymdOf(Priority.deadlineOf({ year: 2026, month: 4 }, 0, 31)), '2026-04-30');  // 小月
  assert.strictEqual(ymdOf(Priority.deadlineOf({ year: 2026, month: 1 }, 0, 31)), '2026-01-31');  // 大月
  assert.strictEqual(ymdOf(Priority.deadlineOf({ year: 2026, month: 2 }, 0, 15)), '2026-02-15');  // 正常值不动
});

// ── 2. 剩余天数：月末 / 跨月 / 闰年 2 月 ────────────────

test('剩余天数：月末、跨月、闰年 2 月都按日历日算，不做 30 天估算', () => {
  const cases = [
    ['2026-01-31', '2026-03-01', 29],   // 1 月 31 → 3 月 1：平年 2 月 28 天
    ['2028-01-31', '2028-03-01', 30],   // 闰年 2 月 29 天
    ['2026-02-28', '2026-03-01', 1],
    ['2026-12-31', '2027-01-01', 1],    // 跨年
    ['2026-09-14', '2026-09-14', 0],    // 当天到期
    ['2026-09-14', '2026-09-13', -1],   // 逾期 1 天
  ];
  cases.forEach(([from, to, want]) => {
    const r = Priority.decorate({ prodBatchList: '2609批次', status: '开发基线' }, new Date(2026, 0, 1));
    assert.ok(r, 'decorate 应返回行');
    const days = Priority.evaluate(
      { prodBatchList: '2609批次', status: '开发基线' },
      new Date(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10))),
    );
    assert.ok(days.days != null);
    // 直接验证日期差：用 setBatchTimes 注入一个明确的截止日，排除批次解析的干扰
    Priority.setBatchTimes({ '2609批次': { testDate: to } });
    const got = Priority.evaluate(
      { prodBatchList: '2609批次', status: '开发基线' },
      new Date(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10))),
    );
    assert.strictEqual(got.days, want, `${from} → ${to} 应为 ${want} 天，实际 ${got.days}`);
    assert.strictEqual(got.from, 'config', '应走批次时间覆盖');
  });
  Priority.setBatchTimes({});   // 还原，别污染后续用例
});

// ── 3. 「近 12 个月窗口」：月末 / 跨年 / 不跳月 ──────────

test('窗口：任意基准月都是连续的 12 个月，不重不跳（含跨年与月末）', () => {
  // 每月 1 号 + 每月最后一天都测：月末基准最容易踩 setMonth 的 day 溢出
  const bases = [];
  for (let m = 0; m < 24; m += 1) {
    const y = 2026 + Math.floor(m / 12);
    const mm = m % 12;
    bases.push(new Date(y, mm, 1));                    // 月初
    bases.push(new Date(y, mm + 1, 0));                // 当月最后一天（28/29/30/31 都覆盖到）
  }

  bases.forEach((base) => {
    const labels = batchWindowLabels(base);
    assert.strictEqual(labels.length, 12, `${ymdOf(base)} 的窗口应有 12 个批次，实际 ${labels.length}`);

    const idx = labels.map(monthIndex);
    for (let i = 1; i < idx.length; i += 1) {
      assert.strictEqual(idx[i] - idx[i - 1], 1,
        `${ymdOf(base)}：${labels[i - 1]} → ${labels[i]} 之间跳月了`);
    }
    // 首尾 = 基准月 -2 / +9
    const baseIdx = absMonth(base.getFullYear(), base.getMonth() + 1);
    assert.strictEqual(idx[0], baseIdx - 2, `${ymdOf(base)}：窗口起点应为基准月 -2`);
    assert.strictEqual(idx[11], baseIdx + 9, `${ymdOf(base)}：窗口终点应为基准月 +9`);
  });
});

// ── 4. 跨时区：同一个物理时刻，结果与机器时区无关 ────────

test('业务时区：同一个物理时刻在任意机器时区下，"今天"和窗口都一致', () => {
  const probe = path.join(__dirname, 'probes', 'tz-probe.js');
  // 2026-09-30T20:00Z == 北京时间 2026-10-01 04:00（UTC/纽约还是 9/30 —— 正是会偏一个月的时刻）
  const at = Date.UTC(2026, 8, 30, 20, 0);

  const results = ['Asia/Shanghai', 'UTC', 'America/New_York', 'Europe/London'].map((tz) => {
    const out = execFileSync(process.execPath, [probe], {
      env: Object.assign({}, process.env, { TZ: tz, PROBE_AT: String(at) }),
      encoding: 'utf8',
    });
    return JSON.parse(out.trim().split('\n').pop());
  });

  results.forEach((r) => {
    assert.strictEqual(r.today, '2026-10-01', `TZ=${r.tz} 时应按北京时间算成 10-01，实际 ${r.today}`);
    assert.strictEqual(r.window.split(',')[0], '2608批次',
      `TZ=${r.tz} 时窗口起点应为 2608批次（北京时间已进 10 月），实际 ${r.window.split(',')[0]}`);
  });
  const first = results[0].today + '|' + results[0].window;
  results.forEach((r) => assert.strictEqual(r.today + '|' + r.window, first,
    `TZ=${r.tz} 的结果与其它时区不一致`));
});

test('businessToday：可传固定时刻，纯函数（同输入恒同输出）', () => {
  const at = Date.UTC(2026, 8, 30, 20, 0);
  assert.strictEqual(ymdOf(Fmt.businessToday(at)), '2026-10-01');
  assert.strictEqual(ymdOf(Fmt.businessToday(Date.UTC(2026, 8, 30, 15, 59))), '2026-09-30');  // 差 1 分钟 = 前一天
  assert.strictEqual(ymdOf(Fmt.businessToday(at)), ymdOf(Fmt.businessToday(at)));
});

test('stamp：按业务时区输出，不是 toISOString 的 UTC', () => {
  // 北京时间 2026-10-01 08:00 == UTC 2026-10-01 00:00
  const s = Fmt.stamp(Date.UTC(2026, 9, 1, 0, 0) - 480 * 60000);
  assert.ok(/^2026-10-01-\d{2}-\d{2}-\d{2}$/.test(s), 'stamp 应为业务时区的日期：' + s);
});
