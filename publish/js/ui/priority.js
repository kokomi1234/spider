/**
 * 投产优先级计算（window.Priority）
 *
 * ── 业务规则（2026-09-10 与用户确认）─────────────────────
 * 以「调用方投产/变更批次」（订阅关系页的 prodBatch 字段）为准，
 * 在订阅关系基线状态（status）上排里程碑：
 *   · 开发基线     → 应于【批次月 - 3 个月】的 15 日之前转为 功能测试基线
 *   · 功能测试基线 → 应于【批次月】的 15 日之前转为 正式版基线（= 生产基线）
 *   · 正式版基线 / 下线 → 已到终点，不再提醒
 * 距截止日越近优先级越高；超过截止日 → 逾期，整行标红。
 *
 * 例：2609批次 → 2026-06-15 前转功能测试基线，2026-09-15 前转正式版基线。
 *
 * ── 批次 label 的真实格式（来自 conditions/subscribe 抓包，295 条）──
 *   "2606批次"  "2507-仿真"  "26年8月独立"  "技术支持类-2026年批次"
 * 前三种能解析出年月；最后一种只有年份，解析不出月份 → 不参与优先级。
 *
 * ── 截止日的「批次时间覆盖」─────────────────────────────
 * 订阅页「批量修改批次时间」里为某批次设了日期后，该批次的截止日**以所设日期为准**，
 * 不再用上面按批次月推算的默认值（由 setBatchTimes() 注入，见 js/page/subscription.js）。
 * 对应关系：testDate → 开发基线→功能测试基线；releaseDate → 功能测试基线→正式版基线。
 *
 * 本文件只做纯计算，不碰 DOM；改规则只需动 MILESTONES / LEVELS 两处。
 */
(function () {
  'use strict';

  /** 状态机：当前状态 → 下一个里程碑（offsetMonth 相对批次月，day 为当月几号）
      dateField：该里程碑可被「批次时间配置」中的哪个日期覆盖（'' 表示不覆盖） */
  const MILESTONES = [
    { from: '开发基线',     to: '功能测试基线', offsetMonth: -3, day: 15, dateField: 'testDate' },
    { from: '功能测试基线', to: '正式版基线',   offsetMonth: 0,  day: 15, dateField: 'releaseDate' },
  ];

  /** 批次时间覆盖表：{ '2609批次': { testDate, releaseDate } }（由 setBatchTimes 注入） */
  let batchTimeOverrides = {};

  /** 注入批次时间配置（来自本地配置文件 config/batch-times.json） */
  function setBatchTimes(map) {
    batchTimeOverrides = (map && typeof map === 'object') ? map : {};
  }

  /** 解析 'YYYY-MM-DD' → Date（当地 0 点）；非法返回 null */
  function parseYmd(s) {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(s ?? '').trim());
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
  }

  /** 终点状态：不用再催 */
  const DONE_STATUS = ['正式版基线', '下线'];

  /** 等级阈值（剩余天数，越小越紧急） */
  const LEVELS = [
    { key: 'overdue',  label: '逾期',   max: -1 },              // days < 0
    { key: 'critical', label: '紧急',   max: 7 },
    { key: 'soon',     label: '临近',   max: 30 },
    { key: 'normal',   label: '正常',   max: Infinity },
  ];

  const DAY = 24 * 60 * 60 * 1000;

  function today0() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /**
   * 解析批次 label → { year, month }，解析不出返回 null。
   * 支持："2606批次" / "2507-仿真" / "26年8月独立" / "26年11月"
   */
  function parseBatchYearMonth(label) {
    const s = String(label ?? '').trim();
    if (!s) return null;

    // "26年8月独立" / "26年11月"
    let m = /(\d{2})\s*年\s*(\d{1,2})\s*月/.exec(s);
    if (m) return { year: 2000 + Number(m[1]), month: Number(m[2]) };

    // "2606批次" / "2507-仿真" / "2611独立" / 纯 "2606"
    m = /(?:^|[^\d])(\d{2})(\d{2})(?:\s*(?:批次|仿真|独立))?(?:$|[^\d])/.exec(s);
    if (m) {
      const month = Number(m[2]);
      if (month >= 1 && month <= 12) return { year: 2000 + Number(m[1]), month };
    }

    // "2026年6月"（4 位年份写法）
    m = /(\d{4})\s*年\s*(\d{1,2})\s*月/.exec(s);
    if (m) return { year: Number(m[1]), month: Number(m[2]) };

    return null;   // 只有年份（如"技术支持类-2026年批次"）→ 无法判断
  }

  /** 里程碑截止日：批次月 + offsetMonth 个月的 day 号 */
  function deadlineOf(ym, offsetMonth, day) {
    return new Date(ym.year, ym.month - 1 + offsetMonth, day);
  }

  function dateText(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  /** 剩余天数（负数=逾期）；两个日期都按当地 0 点算 */
  function daysBetween(from, to) {
    const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
    return Math.round((b - a) / DAY);
  }

  function levelOf(days) {
    return (LEVELS.find((l) => days <= l.max) || LEVELS[LEVELS.length - 1]).key;
  }

  /**
   * 计算一行的优先级。
   * @param {object} row 订阅关系行（用 prodBatch + status）
   * @param {Date} [now] 计算基准，默认今天
   * @returns {{level:string, days:number|null, text:string, next:string,
   *            deadline:string, sortKey:number, overdue:boolean}}
   */
  function evaluate(row, now) {
    const base = now || today0();
    const status = String((row && row.status) ?? '').trim();
    const batchLabel = String((row && row.prodBatch) ?? '').trim();

    // 已到终点
    if (DONE_STATUS.includes(status)) {
      return { level: 'done', days: null, text: '已完成', next: '', deadline: '', sortKey: 9e6, overdue: false, from: 'done' };
    }

    const step = MILESTONES.find((m) => m.from === status);
    if (!step) {
      return {
        level: 'unknown', days: null, text: '—', next: '', deadline: '',
        sortKey: 9e6 + 1, overdue: false, from: 'unknown', reason: '基线状态不在里程碑里',
      };
    }

    // 截止日：优先用「批量修改批次时间」为该批次设的日期，否则按批次月推算
    const ovRaw = step.dateField ? (batchTimeOverrides[batchLabel] || {})[step.dateField] : '';
    const ovDate = ovRaw ? parseYmd(ovRaw) : null;
    const ym = ovDate ? null : parseBatchYearMonth(batchLabel);
    const deadline = ovDate || (ym ? deadlineOf(ym, step.offsetMonth, step.day) : null);

    if (!deadline) {
      return {
        level: 'unknown', days: null, text: '—', next: '', deadline: '',
        sortKey: 9e6 + 1, overdue: false, from: 'unknown', reason: '批次解析不出年月',
      };
    }

    const days = daysBetween(base, deadline);
    const level = levelOf(days);
    const overdue = days < 0;

    return {
      level,
      days,
      text: overdue ? `逾期 ${Math.abs(days)} 天` : `剩 ${days} 天`,
      next: step.to,
      deadline: dateText(deadline),
      // 逾期：拖得越久越靠前（-days 越大 → 值越小）；未逾期：剩得越少越靠前
      sortKey: overdue ? -100000 - Math.abs(days) : days,
      overdue,
      from: ovDate ? 'config' : 'rule',   // 截止日来源：批次时间配置 / 批次月规则
    };
  }

  /** 把优先级写回行对象（下划线前缀，避免和报文字段撞名） */
  function decorate(row, now) {
    const p = evaluate(row, now);
    row._prio = p;
    row._prioText = p.text;
    row._prioNext = p.next ? `${p.next}（${p.deadline} 前）` : '';
    row._prioDeadline = p.deadline;
    return row;
  }

  /** 排序比较器：紧急在前（sortKey 升序），已完成 / 无法判断恒在最后 */
  function compare(a, b) {
    return (a._prio ? a._prio.sortKey : 9e6) - (b._prio ? b._prio.sortKey : 9e6);
  }

  if (typeof window !== 'undefined') {
    window.Priority = {
      MILESTONES, LEVELS, DONE_STATUS,
      setBatchTimes, parseYmd,
      parseBatchYearMonth, deadlineOf, evaluate, decorate, compare,
    };
  }
})();
