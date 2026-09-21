'use strict';
/**
 * 跨时区稳定性探针（子进程用，不是用例）。
 *
 * 用法：TZ=<时区> PROBE_AT=<毫秒> node tests/probes/tz-probe.js
 * 打印「业务时区的今天」与「批次窗口（当月 −2 ~ +3）」，由 tests/date-rules.test.js 在多个时区下
 * 分别跑一遍，断言结果完全一致。放在子进程里跑是因为 Node 的时区在进程启动后不易改。
 */
const { loadScript } = require('../harness');

const win = loadScript('js/core/format.js');
loadScript('js/data/batch-data.js', {}, win);

const at = Number(process.env.PROBE_AT);
const d = win.Fmt.businessToday(at);
const pad = (n) => String(n).padStart(2, '0');

console.log(JSON.stringify({
  tz: process.env.TZ || '(未设置)',
  today: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
  window: win.batchWindowLabels(d).join(','),
}));
