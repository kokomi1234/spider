/**
 * 通用格式化 + 日期基准（三页共用）。
 *
 * 以前 index.js / task.js / subscription.js 各有一份 esc，
 * task.js / subscription.js 各有一份 num —— 同一段代码三份，改一处要改三次。
 * 这里收敛成唯一实现，页面脚本用别名引用（调用点不用动）。
 *
 * ── 为什么日期要锁业务时区 ────────────────────────────
 * 投产批次是内地分行的业务概念，"今天 / 当前月"必须按北京时间算。
 * 直接用 `new Date()` 读的是**机器时区**：服务器 / CI / 装了英文系统的机器常是 UTC，
 * 于是北京时间每月 1 日 00:00~08:00（UTC 还是上个月最后一天）会被算成上个月 ——
 * 「近 12 个月窗口」会整体偏掉一个月。所有"取今天/当月"的地方一律走 businessToday()。
 */
(function () {
  'use strict';

  /** 业务时区偏移（分钟）：480 = UTC+8（北京时间） */
  const BUSINESS_TZ_OFFSET_MIN = 480;

  /**
   * 按业务时区取「当天 0 点」，返回的 Date 用 getFullYear/Month/Date 读到的
   * 就是业务时区的日历日。
   * @param {number|Date} [at] 物理时刻；留空取当前时刻（测试可传固定值）
   */
  function businessToday(at) {
    const t = at == null
      ? Date.now()
      : (at instanceof Date ? at.getTime() : Number(at));
    if (!isFinite(t)) return new Date();
    // 目标时区的"墙上时间" = UTC 时刻 + 偏移；再按 UTC 分量截取到当天
    const wall = new Date(t + BUSINESS_TZ_OFFSET_MIN * 60000);
    return new Date(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate());
  }

  /** 'YYYY-MM-DD'（业务时区日历日） */
  function ymd(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  /**
   * 文件名用的时间戳 'YYYY-MM-DD-HH-MM-SS'（业务时区）。
   * 别用 `new Date().toISOString()`：那是 UTC，北京时间 00:00~08:00 会落成前一天。
   * @param {number|Date} [at]
   */
  function stamp(at) {
    const t = at == null
      ? Date.now()
      : (at instanceof Date ? at.getTime() : Number(at));
    const wall = new Date((isFinite(t) ? t : Date.now()) + BUSINESS_TZ_OFFSET_MIN * 60000);
    const p = (n) => String(n).padStart(2, '0');
    return `${wall.getUTCFullYear()}-${p(wall.getUTCMonth() + 1)}-${p(wall.getUTCDate())}`
      + `-${p(wall.getUTCHours())}-${p(wall.getUTCMinutes())}-${p(wall.getUTCSeconds())}`;
  }

  /** HTML 转义：任何要插值进 innerHTML 的字符串都先过一遍 */
  function esc(v) {
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** 数字千分位；非数字原样输出（null / undefined → —） */
  function num(n) {
    return typeof n === 'number' ? n.toLocaleString('zh-CN') : String(n ?? '—');
  }

  window.Fmt = {
    esc, num,
    BUSINESS_TZ_OFFSET_MIN,
    businessToday,
    ymd,
    stamp,
  };
})();
