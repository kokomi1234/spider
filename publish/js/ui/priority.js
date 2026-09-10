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
 * 本文件只做纯计算，不碰 DOM；改规则只需动 MILESTONES / LEVELS 两处。
 */
(function () {
  'use strict';

  /** 状态机：当前状态 → 下一个里程碑（offsetMonth 相对批次月，day 为当月几号） */
  const MILESTONES = [
    { from: '开发基线',     to: '功能测试基线', offsetMonth: -3, day: 15 },
    { from: '功能测试基线', to: '正式版基线',   offsetMonth: 0,  day: 15 },
  ];

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
      return { level: 'done', days: null, text: '已完成', next: '', deadline: '', sortKey: 9e6, overdue: false };
    }

    const step = MILESTONES.find((m) => m.from === status);
    const ym = parseBatchYearMonth(batchLabel);
    if (!step || !ym) {
      return {
        level: 'unknown', days: null, text: '—', next: '', deadline: '',
        sortKey: 9e6 + 1, overdue: false,
        reason: !step ? '基线状态不在里程碑里' : '批次解析不出年月',
      };
    }

    const deadline = deadlineOf(ym, step.offsetMonth, step.day);
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
      parseBatchYearMonth, deadlineOf, evaluate, decorate, compare,
    };
  }
})();
