/* ============================================================
  服务订阅关系查询页 — 业务模型（无 DOM 依赖）
  ------------------------------------------------------------
  本模块只放「输入数据 → 输出数据 / 文本」的纯函数与常量，不碰任何 DOM、
  不读 window.* 运行时状态（除挂自身接口、以及调用时已存在的 window.Priority /
  window.Fmt 这类纯逻辑模块）。subscription.js 负责 DOM 读写、事件绑定与查询
  编排，需要纯逻辑时调用 window.SubscriptionModel.*。

  约定（与项目其它模块一致）：浏览器 IIFE，挂 window.SubscriptionModel。
  依赖 window.SubscriptionView（纯渲染，先于本文件加载无要求 —— 本文件不反向依赖它）。
============================================================ */

(function () {
  'use strict';

  // ═══════════════════════════════════════════════════
  // 常量
  // ═══════════════════════════════════════════════════

  /** 默认不预填调用方：下拉为空 = 不限定调用方（全部调用方），用户用快捷按钮或下拉自行选择 */
  const DEFAULT_CALLER = '';

  /** 表格列：[字段 key, 中文列名, 是否等宽字体]，顺序必须与 HTML 的 colgroup / thead 完全一致。
      前 3 列是左固定列（sticky，横向滚动时不丢）：优先级（算出来的，一眼看该先处理哪条）+
      订阅关系基线状态 + 订阅关系审核流程状态（服务中文名 / 接口编码已取消固定，见 FIXED_COL_CLASS）。
      其余为可横向滚动的数据列，按「提供方身份 → 调用方身份 → 实施 / 人员 / 附加」分组。
      列宽不在这里，在 subscription.html 的 colgroup（按真实数据的文本宽度定，注释里有依据）。
      ⚠️ 列增删都要同步改 subscription.html 的 colgroup / thead 与 renderEmpty() 的 colspan。 */
  const COLUMNS = [
    ['_prioText',              '优先级',                       false],   // 左固定 1
    ['status',                 '订阅关系基线状态',             false],   // 左固定 2
    ['prodReviewStatus',       '订阅关系审核流程状态',         false],   // 左固定 3
    ['sysServeName',           '提供方应用系统服务中文名称',   false],   // 左固定 4
    ['serverCoding',           '接口编码',                     true],    // 左固定 5
    ['sysNo',                  '提供方应用系统编号',           true],
    ['assemblyEnName',         '提供方应用系统英文简称',       true],
    ['sysServeNo',             '提供方应用系统服务编号',       true],
    ['sysServeEnName',         '提供方应用系统服务英文名称',   true],
    ['prodBatchList',          '提供方最新变更批次',           false],
    ['deptName',               '提供方部门名称',               false],
    ['callerComponent',        '调用方系统/分行编号',          true],
    ['callerComponentEnName',  '调用方系统英文简称/分行名称',  true],
    ['prodSysServeNo',         '调用方应用系统服务编号',       true],
    ['prodBatch',              '调用方投产/变更批次',          false],
    ['prodTaskNo',             '调用方任务编号',               true],
    ['prodImplementationUnit', '订阅方产品实施单元',           false],
    ['subscriberUserName',     '订阅人',                       false],
    ['prodDeptName',           '调用方部门名称',               false],
    ['isBackup',               '是否做副本',                   false],
    ['backupInfo',             '副本使用场景说明',             false],
    ['implementationUnit',     '产品实施单元',                 false],
  ];

  /** 左固定列：字段 key → 固定列 CSS 类（left 偏移写在 subscription.html，与 colgroup 宽度一一对应）。
      渲染时按这张表给 <td> 加类，别在 renderTable 里散落 if。 */
  const FIXED_COL_CLASS = {
    _prioText:        'col-prio',
    status:           'col-st',
    prodReviewStatus: 'col-review',
    // 提供方应用系统服务中文名称(col-name) / 接口编码(col-coding) 不再固定：
    // 用户反馈固定列过多会让横向滚动时可见信息太少。
  };

  /** 基线状态 → 色块样式（值来自抓包里真实出现的 status） */
  const STATUS_CLASS = {
    '开发基线':     'is-dev',
    '功能测试基线': 'is-test',
    '正式版基线':   'is-official',
    '下线':         'is-offline',
  };

  /** 审核流程状态 → { text, class }（值来自后端裸值 "00"/"01"/"02"/"03"/"04"） */
  const REVIEW_STATUS_MAP = {
    '00': { text: '未审核', cls: '' },
    '01': { text: '审核中', cls: 'is-soon' },
    '02': { text: '审核中', cls: 'is-soon' },
    '03': { text: '审核完成', cls: 'is-official' },
    '04': { text: '关闭', cls: 'is-offline' },
  };

  const PAGE_SIZE = 10;          // 抓包里的默认 pageSize（=10）
  const MIN_PAGE_SIZE = 10;      // 小于等于这个条数就不显示分页条
  /** 整批拉取时的每页条数（窗口扇出 / 单批次全局排序共用）。
      用户定的 50：后端若允许 500 可降到 1/10 请求数 —— 别靠调小 pageSize「治慢」，
      总字节不变，只会把请求数和后端 COUNT 次数放大。 */
  const BULK_PAGE_SIZE = 50;
  /** 整批拉取的条数上限，避免一条查询把几万行拉进内存 */
  const BULK_MAX = 5000;
  /** 结果不超过这个条数时，排序走「整批拉回来 + 前端分页」，逾期/紧急才是全局排在最前 */
  const CLIENT_SORT_MAX = 1000;
  /** 窗口扇出的并发上限：12 个批次分 2 波（6×2），墙钟时间≈最慢单个批次，避免一次性打爆 */
  const WINDOW_CONCURRENCY = 12;
  /** 单个批次内部翻页的并发上限（先取第 1 页拿到 total，再并发拉剩余页）。
      原来是串行 page++，批次条数一多就成了「一个批次 N 次往返」的瓶颈。 */
  const PAGE_CONCURRENCY = 3;

  // ═══════════════════════════════════════════════════
  // 行键 / 选项
  // ═══════════════════════════════════════════════════

  /** 行唯一 key：订阅关系ID 优先，退化为几个编号拼起来 */
  function rowKey(r) {
    return r.publishSubcriptionId
      || [r.sysServeNo, r.prodSysServeNo, r.publishId].filter(Boolean).join('|');
  }

  /** 批次：抓包里传的是 "2611批次" 这种 label，所以直接用 label 当 value */
  function toBatchOptions(batches) {
    return (batches || []).map((b) => ({ value: b.label, label: b.label }));
  }

  // ═══════════════════════════════════════════════════
  // 筛选条件
  // ═══════════════════════════════════════════════════

  /**
   * 收集查询条件。纯函数：所有 DOM 读值都通过 getters 注入，便于单测。
   * @param {object} g 取值器
   *   g.selValue(id)             → 单选下拉当前值
   *   g.textValue(sel)           → 文本/输入框当前值
   *   g.effectiveCaller()        → 生效调用方系统编号
   *   g.getMulti(key)            → 多选下拉的当前值数组（key ∈ sysServeNo/serverCoding/prodSysServeNo）
   * @returns {object} 接口请求体（字段名与抓包一致）
   */
  function buildCond(g) {
    // 订阅人：纯数字当 EHR 号走 subscriberId，否则走姓名（抓包里两个字段都空着，
    // 这里只是前端分流，后端最终以哪个为准有待抓包确认）
    const subscriber = g.textValue('#f_subscriberName');
    const isEhr = isEhrSplit(subscriber);

    return {
      compNum:                  g.selValue('f_providerCompNum'),
      putBatch:                 g.selValue('f_providerBatch'),
      isSendOutsideSystem:      g.selValue('f_isSendOutside'),
      sysServeNoList:           g.getMulti ? g.getMulti('sysServeNo') : [],
      serverCodingList:         g.getMulti ? g.getMulti('serverCoding') : [],
      providerServiceNameAndId: g.textValue('#f_providerServiceNameAndId'),
      prodSysServeNoList:       g.getMulti ? g.getMulti('prodSysServeNo') : [],
      useNum:                   g.effectiveCaller(),
      callerComponent:          g.effectiveCaller(),
      prodBatch:                g.selValue('f_callerBatch'),
      subscriberId:             isEhr ? subscriber : '',
      subscriberName:           isEhr ? '' : subscriber,
      status:                   g.selValue('f_status'),
      deptId:                   g.selValue('f_deptId'),
      prodDeptId:               g.selValue('f_prodDeptId'),
      // 下面两个字段抓包里恒为空，页面上也没有对应筛选项，按原样传空串
      prodSysServeNo:           '',
      batch:                    '',
    };
  }

  /** 订阅人是否纯数字（EHR 号）：是则走 subscriberId，否则走姓名 */
  function isEhrSplit(subscriber) {
    return /^\d+$/.test(String(subscriber ?? ''));
  }

  /** 必须指定调用方系统或提供方系统其中一个，否则拦截查询。返回错误提示文案（带 ⚠️ 前缀），通过校验返回 null */
  function validateQuery(callerComp, providerComp) {
    if (callerComp || providerComp) return null;
    return '⚠️ 请至少选择「调用方系统/分行」或「提供方系统」之一';
  }

  /**
   * 满足以下任一条件 → 后端已有精确过滤，单条查询最快，不走12个月窗口：
   *   · 调用方批次 / 提供方批次
   *   · 提供方应用系统服务编号 / 接口编码 / 服务中文名称
   *   · 调用方应用系统服务编号
   * 以上条件都没有时才走窗口扇出（避免一次查出 years 历史导致响应慢）。
   */
  function hasSpecificFilter(cond) {
    return !!(cond.prodBatch
      || cond.putBatch
      || (cond.sysServeNoList && cond.sysServeNoList.length > 0)
      || (cond.serverCodingList && cond.serverCodingList.length > 0)
      || cond.providerServiceNameAndId
      || (cond.prodSysServeNoList && cond.prodSysServeNoList.length > 0));
  }

  // ═══════════════════════════════════════════════════
  // 分页数学
  // ═══════════════════════════════════════════════════

  /**
   * 页码条：首页 + 当前页 ±2 + 末页，中间用省略号。
   * 当前页带 `aria-current="page"`：只靠 .is-current 的视觉样式，读屏用户听不出
   * 自己在第几页（清单 A9）。样式仍只认 .is-current，两者互不影响。
   */
  function buildPageNumbers(pages, cur) {
    const set = new Set([1, pages, cur, cur - 1, cur + 1, cur - 2, cur + 2]);
    const nums = [...set].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
    let out = '';
    let prev = 0;
    nums.forEach((n) => {
      const isCur = n === cur;
      if (prev && n - prev > 1) out += '<li class="page-ellipsis">…</li>';
      out += `<li><button type="button" data-page="${n}" class="${isCur ? 'is-current' : ''}"`
        + `${isCur ? ' aria-current="page"' : ''}>${n}</button></li>`;
      prev = n;
    });
    return out;
  }

  /**
   * 整批拉取的页数（窗口扇出 / 单批次全局排序共用）：按每页 BULK_PAGE_SIZE 算，
   * 并对 BULK_MAX 封顶（避免一条查询把几万行拉进内存）。total<=0 直接返回 0。
   */
  function planPageFetches(total) {
    if (!total || total <= 0) return 0;
    return Math.min(
      Math.ceil(total / BULK_PAGE_SIZE),
      Math.ceil(BULK_MAX / BULK_PAGE_SIZE)
    );
  }

  /** 按当前页码切出当前页（不动入参数组） */
  function slicePage(allRows, pageNum, pageSize) {
    const start = (pageNum - 1) * pageSize;
    return (allRows || []).slice(start, start + pageSize);
  }

  /** 当前页逾期条数（行内 _prio.overdue 由优先级模块算好） */
  function overdueCount(rows) {
    return (rows || []).filter((r) => r._prio && r._prio.overdue).length;
  }

  /**
   * 窗口扇出合并：按批次 Map/对象存各行，组装时按窗口顺序遍历 + 去重。
   * 行序稳定，不依赖各批次完成顺序（并发回来谁先谁后都行）。
   * @param {Map|object} rowsByBatch batch -> rows[]
   * @param {Array<string>} batches 窗口批次顺序
   */
  function mergeBatchRows(rowsByBatch, batches) {
    const seen = new Set();
    const rows = [];
    const listOf = (b) => (rowsByBatch && rowsByBatch.get)
      ? (rowsByBatch.get(b) || [])
      : ((rowsByBatch && rowsByBatch[b]) || []);
    (batches || []).forEach((b) => {
      for (const row of listOf(b)) {
        const k = rowKey(row);
        if (!seen.has(k)) { seen.add(k); rows.push(row); }
      }
    });
    return rows;
  }

  // ═══════════════════════════════════════════════════
  // 优先级 / 排序（纯逻辑，落到前端字段；window.Priority 缺失时退化占位）
  // ═══════════════════════════════════════════════════

  /** "今天"的基准：一律取业务时区（UTC+8），见 Fmt.businessToday 的说明 */
  function todayBase() {
    const Fmt = window.Fmt;
    return (Fmt && typeof Fmt.businessToday === 'function') ? Fmt.businessToday() : new Date();
  }

  /**
   * 给一行算优先级。
   * @param {object} row 订阅关系行
   * @param {Date} [now] 计算基准；**必须**由 decorateRows / redecorateRows 传入同一个值 ——
   *   逐行各取一次"今天"的话，跨零点时同一屏结果会出现两种天数、排序也会错乱。
   */
  function decorateRow(row, now) {
    if (window.Priority && typeof window.Priority.decorate === 'function') {
      return window.Priority.decorate(row, now);
    }
    // 组件没加载：退化成不影响展示的占位
    row._prio = { level: 'unknown', days: null, text: '—', next: '', deadline: '', sortKey: 9e6, overdue: false };
    row._prioText = '—';
    row._prioNext = '';
    row._prioDeadline = '';
    return row;
  }

  /** 一批行：共用同一个"今天"，返回新数组（.map(decorateRow) 会把下标当基准传进去，别直接传函数） */
  function decorateRows(rows) {
    const base = todayBase();
    return (rows || []).map((r) => decorateRow(r, base));
  }

  /** 一批行：共用同一个"今天"，原地重算（优先级配置变了以后刷新用） */
  function redecorateRows(rows) {
    const base = todayBase();
    (rows || []).forEach((r) => decorateRow(r, base));
  }

  /** 按当前排序方向排一批行（不动入参数组） */
  function sortRows(rows, sort) {
    if (!sort || !window.Priority) return (rows || []).slice();
    const arr = (rows || []).slice().sort(window.Priority.compare);
    return sort === 'desc' ? arr.reverse() : arr;
  }

  // ═══════════════════════════════════════════════════
  // 批次时间窗口
  // ═══════════════════════════════════════════════════

  /**
   * 生成「近 12 个月」批次 label 列表。
   * 算法（含月份安全的两个约束）在 js/data/batch-data.js 的 batchWindowLabels()，
   * 这里只负责取基准日 —— 必须是业务时区（UTC+8）的今天，
   * 否则机器时区不是 +8 时，每月 1 日前后窗口会整体偏一个月。
   */
  function batchWindow() {
    const Fmt = window.Fmt;
    const now = (Fmt && typeof Fmt.businessToday === 'function') ? Fmt.businessToday() : new Date();
    if (typeof window.batchWindowLabels === 'function') return window.batchWindowLabels(now);
    return [];   // 模块缺失时不猜：宁可空窗口，也别发出错月份的请求
  }

  // ═══════════════════════════════════════════════════
  // 整批取数（供单批次查询做全局优先级排序 / 窗口扇出）
  // 这些函数没有 DOM 依赖：接口调用经 fetchHistory 注入，状态判断经 isAborted 注入，
  // 渲染回调经 onProgress 注入，因此可放进纯模型单测。
  // ═══════════════════════════════════════════════════

  /**
   * 按页把查询结果整批拉回来（服务端分页），顺手算好优先级。
   * 并发拉（PAGE_CONCURRENCY 个 worker），按页码顺序拼接 —— 原来是串行 for，
   * BULK_PAGE_SIZE=50 时 5000 条要 100 次串行往返，明显卡顿。
   * @param {object} cond 查询条件
   * @param {number} total 后端 total
   * @param {Function} fetchHistory (pagedCond) => Promise<{ok,rows,total,error,local}>
   * @param {Function} [onProgress] (done, total) => void，每完成一页调用一次
   */
  async function fetchAllPages(cond, total, fetchHistory, onProgress) {
    const want = Math.min(total, BULK_MAX);
    const fetchP = (p) => fetchHistory({ ...cond, pageNum: p, pageSize: BULK_PAGE_SIZE });

    const first = await fetchP(1);
    if (!first.ok) throw new Error(first.error || '未知错误');
    const pageRows = new Map([[1, decorateRows(first.rows || [])]]);
    let got = (first.rows || []).length;

    if (!got || got >= want) {
      return { rows: (pageRows.get(1) || []).slice(0, want), truncated: total > BULK_MAX };
    }

    const pageCount = planPageFetches(want);
    const pending = [];
    for (let p = 2; p <= pageCount; p++) pending.push(p);

    const worker = async () => {
      while (pending.length) {
        const p = pending.shift();
        const res = await fetchP(p);
        if (!res.ok) throw new Error(res.error || '未知错误');
        if (!res.rows.length) return;
        pageRows.set(p, decorateRows(res.rows));
        got += res.rows.length;
        if (onProgress) onProgress(pageRows.size, pageCount);
      }
    };
    await Promise.all(Array.from({ length: Math.min(PAGE_CONCURRENCY, pending.length) }, worker));

    const out = [];
    for (let p = 1; p <= pageCount; p++) out.push(...(pageRows.get(p) || []));
    return { rows: out.slice(0, want), truncated: total > BULK_MAX };
  }

  /**
   * 单个批次：先取第 1 页拿到 total，再**并发**拉剩余页（PAGE_CONCURRENCY 个 worker），
   * 最后按页码顺序拼接（并发完成顺序不确定，边拉边 concat 会让行序随网络抖动变化）。
   * 返回 { ok, rows, local }。
   */
  async function fetchBatchAllPages(cond, batch, fetchHistory) {
    const fetchP = (page) => fetchHistory({ ...cond, prodBatch: batch, pageNum: page, pageSize: BULK_PAGE_SIZE });

    const first = await fetchP(1);
    if (!first.ok) return { ok: false, error: first.error, local: first.local };
    const pageRows = new Map([[1, first.rows || []]]);
    const total = Number(first.total) || 0;
    let got = (first.rows || []).length;

    // 一页就装完（或接口未接入）→ 直接收尾
    if (!got || got >= total || got >= BULK_MAX) {
      return { ok: true, local: !!first.local, rows: (first.rows || []).slice(0, BULK_MAX) };
    }

    const pageCount = planPageFetches(total);
    const pending = [];
    for (let p = 2; p <= pageCount; p++) pending.push(p);

    let failed = null;
    const worker = async () => {
      while (pending.length && !failed) {
        const p = pending.shift();
        const res = await fetchP(p);
        if (!res.ok) { failed = res.error || '未知错误'; return; }
        pageRows.set(p, res.rows || []);
        got += (res.rows || []).length;
        if (!(res.rows || []).length || got >= total || got >= BULK_MAX) return;
      }
    };
    await Promise.all(Array.from({ length: Math.min(PAGE_CONCURRENCY, pending.length) }, worker));
    if (failed) return { ok: false, error: failed, local: false };

    const out = [];
    for (let p = 1; p <= pageCount; p++) out.push(...(pageRows.get(p) || []));
    return { ok: true, local: !!first.local, rows: out.slice(0, BULK_MAX) };
  }

  /**
   * 窗口扇出：按批次并行拉取（并发上限 WINDOW_CONCURRENCY），**增量**合并。
   *
   * 关键：给每个批次的 promise 单独挂 then —— 谁先回来就把当时的合并结果通过
   * onProgress 交给上层先渲染一版，用户几秒内就能看到并开始操作，而不是等
   * 12 个批次全部完成。行序稳定：结果按批次存 Map，组装时按窗口顺序遍历 + 去重，不依赖完成顺序。
   *
   * @param {object}   cond
   * @param {Function} isAborted () => boolean，已有更新请求时中止（替代原 state.reqSeq 比较）
   * @param {Function} [onProgress] (rows, done, total) => void，每完成一个批次调用一次
   * @param {Function} fetchHistory (pagedCond) => Promise
   * @returns {Promise<{ok, rows, partial[], local, error, aborted}>}
   */
  async function fetchWindowAll(cond, isAborted, onProgress, fetchHistory) {
    const batches = batchWindow();
    const batchRows = new Map();   // batch -> rows
    const partial = [];
    let local = false;
    let done = 0;

    for (let i = 0; i < batches.length; i += WINDOW_CONCURRENCY) {
      if (isAborted()) return { aborted: true };
      const slice = batches.slice(i, i + WINDOW_CONCURRENCY);
      await Promise.all(slice.map((b) => fetchBatchAllPages(cond, b, fetchHistory).then((r) => {
        if (isAborted()) return;              // 已被更新的查询取代
        if (r.local) local = true;
        if (!r.ok) { partial.push(b); return; }
        batchRows.set(b, r.rows);
        done++;
        if (onProgress) onProgress(mergeBatchRows(batchRows, batches), done, batches.length);
      })));
    }
    const ok = partial.length < batches.length;     // 全失败才算失败
    return { ok, rows: mergeBatchRows(batchRows, batches), partial, local, error: ok ? '' : `批次 ${partial.join('、')} 查询失败` };
  }

  // ═══════════════════════════════════════════════════
  // 优先级单元格（数据部分；HTML 拼装在 SubscriptionView）
  // ═══════════════════════════════════════════════════

  /**
   * 优先级单元格的数据部分（纯，无 DOM）：色块 + 天数，title 里写清「为什么」。
   * @param {object} row 行（需已 decorate，含 _prio）
   * @returns {{level:string, text:string, near:boolean, hint:string}}
   */
  function prioParts(row) {
    const p = row._prio || { level: 'unknown', text: '—' };
    const src = p.from === 'config' ? '（按批次时间配置）' : '';
    const hint = p.next
      ? `${row.prodBatch || '（无批次）'}：应于 ${p.deadline} 前转为${p.next}${src}`
      : (p.level === 'done' ? '已到正式版基线 / 已下线' : '批次或基线状态无法判断');
    // 剩余 ≥0 且 ≤3 天：优先级这一格加粗标红（整行不变红，与「逾期整行标红」区分）。
    // 它**不是独立等级**：等级词只有 LEVELS 那四档（逾期 / 紧急（≤7天）/ 临近（≤30天）/ 正常），
    // is-near 只是「紧急」档内部针对最后 3 天的一层视觉强调（清单 C6）。
    const near = p.days !== null && p.days >= 0 && p.days <= 3;
    return { level: p.level, text: p.text, near, hint };
  }

  window.SubscriptionModel = Object.freeze({
    // 常量
    DEFAULT_CALLER,
    COLUMNS,
    FIXED_COL_CLASS,
    STATUS_CLASS,
    REVIEW_STATUS_MAP,
    PAGE_SIZE,
    MIN_PAGE_SIZE,
    BULK_PAGE_SIZE,
    BULK_MAX,
    CLIENT_SORT_MAX,
    WINDOW_CONCURRENCY,
    PAGE_CONCURRENCY,
    // 行键 / 选项
    rowKey,
    toBatchOptions,
    // 筛选条件
    buildCond,
    isEhrSplit,
    validateQuery,
    hasSpecificFilter,
    // 分页数学
    buildPageNumbers,
    planPageFetches,
    slicePage,
    overdueCount,
    mergeBatchRows,
    // 优先级 / 排序
    todayBase,
    decorateRow,
    decorateRows,
    redecorateRows,
    sortRows,
    // 批次窗口
    batchWindow,
    // 整批取数（注入 fetchHistory / isAborted / onProgress，无 DOM 依赖）
    fetchAllPages,
    fetchBatchAllPages,
    fetchWindowAll,
    // 优先级单元格数据
    prioParts,
  });
})();
