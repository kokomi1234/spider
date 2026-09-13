/**
 * 服务订阅关系查询页（subscription.html）
 *
 * ── 数据来源 ────────────────────────────────────────────────
 * 接口全部来自抓包 `服务订阅关系查询.har`（2026-09-10），没有猜测字段：
 *   查询   POST /itamp-tool/publish/getSubscriptionPublishHistoryList?n=xx
 *   下拉   POST /itamp-tool/publish/getProdSysServeNoList?callerComponent=xx&n=xx
 * 下拉里的提供方系统 / 批次 / 部门沿用首页那套 data/*.js（同源接口，抓包已确认）。
 *
 * 两个仍未抓包、按铁律只做预留的点：
 *   1. 导出接口 → ToolApi.exportSubscriptionPublishHistory，endpoint 为空，
 *      未配置时不发请求，直接走本地 CSV（见 exportRows()）。
 *
 * ── 一个需要复核的字段映射 ──────────────────────────────────
 * 行内有 prodBatch 和 prodBatchList 两个批次字段，本页按下面推断取值：
 *   调用方投产/变更批次 = prodBatch        （与请求体同名，抓包里过滤的就是它）
 *   提供方最新变更批次 = prodBatchList     （无过滤抓包里 2405 ≥ 调用方 2305，
 *                                          提供方「最新」不早于订阅批次才说得通）
 * 若后续抓包出现反例，改 COLUMNS 里这两行即可，其余代码不用动。
 */
(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);

  // ═══════════════════════════════════════════════════
  // 常量
  // ═══════════════════════════════════════════════════

  /** 默认不预填调用方：下拉为空 = 不限定调用方（全部调用方），用户用快捷按钮或下拉自行选择 */
  const DEFAULT_CALLER = '';

  /** 表格列：[字段 key, 中文列名, 是否等宽字体]，顺序与 HTML 表头一致。
      前两列是固定左列：优先级（算出来的，一眼看该先处理哪条）+ 订阅关系基线状态。
      剩下的是可横向滚动的数据列。 */
  const COLUMNS = [
    ['_prioText',              '优先级',                       false],
    ['status',                 '订阅关系基线状态',             false],   // 与优先级一起固定左列
    ['sysNo',                  '提供方应用系统编号',           true],
    ['assemblyEnName',         '提供方应用系统英文简称',       true],
    ['sysServeNo',             '提供方应用系统服务编号',       true],
    ['sysServeEnName',         '提供方应用系统服务英文名称',   true],
    ['sysServeName',           '提供方应用系统服务中文名称',   false],
    ['prodBatchList',          '提供方最新变更批次',           false],
    ['deptName',               '提供方部门名称',               false],
    ['serverCoding',           '接口编码',                     true],
    ['callerComponent',        '调用方系统/分行编号',          true],
    ['callerComponentEnName',  '调用方系统英文简称/分行名称',  true],
    ['prodSysServeNo',         '调用方应用系统服务编号',       true],
    ['prodBatch',              '调用方投产/变更批次',          false],
    ['prodTaskNo',             '调用方任务编号',               true],
    ['prodReviewStatus',       '订阅关系审核流程状态',         false],
    ['prodImplementationUnit', '订阅方产品实施单元',           false],
    ['subscriberUserName',     '订阅人',                       false],
    ['prodDeptName',           '调用方部门名称',               false],
    ['isBackup',               '是否做副本',                   false],
    ['backupInfo',             '副本使用场景说明',             false],
    ['implementationUnit',     '产品实施单元',                 false],
  ];

  // 结果行的「查 看」不再弹本地详情，而是跳转 ITAMP 真实系统的「服务搜索查看」页
  // 并带上该行条件（见 jumpToServiceSearch）。原详情弹窗的字段分组已移除，
  // 字段清单在 COLUMNS 里，需要时可从 git 历史（49fa429 之前）取回 DETAIL_GROUPS。

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
  const EXPORT_PAGE_SIZE = 50;
  const EXPORT_MAX = 5000;
  /** 结果不超过这个条数时，排序走「整批拉回来 + 前端分页」，逾期/临期才是全局排在最前 */
  const CLIENT_SORT_MAX = 1000;
  /** 窗口扇出的并发上限：12 个批次分 2 波（6×2），墙钟时间≈最慢单个批次，避免一次性打爆 */
  const WINDOW_CONCURRENCY = 12;
  /** 单个批次内部翻页的并发上限（先取第 1 页拿到 total，再并发拉剩余页）。
      原来是串行 page++，批次条数一多就成了「一个批次 N 次往返」的瓶颈。 */
  const PAGE_CONCURRENCY = 3;

  // ═══════════════════════════════════════════════════
  // 状态
  // ═══════════════════════════════════════════════════

  const state = {
    pageNum: 1,
    pageSize: PAGE_SIZE,
    total: 0,
    rows: [],
    cond: null,
    queried: false,
    caller: '',              // 生效的调用方系统编号（'' = 不限定 / 全部调用方）
    reqSeq: 0,                // 请求序号，旧响应直接丢弃
    // 默认就按优先级排（逾期 / 临期的顶上来），用户点列头可切宽松在前或恢复后端原序
    sort: 'asc',              // 'asc' 紧急在前 / 'desc' 宽松在前 / null 后端原序
    mode: 'server',           // 'client' = 全量在前端（排序 + 分页都在本地）；'server' = 后端分页
    allRows: null,            // client 模式下的全量结果（已算好优先级）
    sortLimited: false,       // 已提示过「数据量过大，只排当前页」，避免重复弹
    fetchAllWarned: false,    // 已提示过「整批拉取失败，退化为按页展示」
    progress: null,           // 取数中：{ done, total } —— 用于「先展示部分结果」的进度提示
  };

  const selected = new Set();   // 勾选的行 key（当前页）
  let selects = {};             // id -> searchable-select 实例
  let multiSelects = {};        // key -> multi-select 实例

  // ═══════════════════════════════════════════════════
  // 小工具
  // ═══════════════════════════════════════════════════

  // 公共实现见 js/ui/toast.js / js/core/format.js（三页共用）。
  // 本地只留同名别名，调用点不用改。
  const toast = window.toast || (() => {});
  const esc = (window.Fmt && window.Fmt.esc) || ((v) => String(v ?? ''));
  const num = (window.Fmt && window.Fmt.num) || ((n) => String(n ?? '—'));

  function setLoading(on) {
    const el = $('#loadingMask');
    if (el) el.classList.toggle('show', !!on);
  }

  /** 复制到剪贴板：点击时把文本写入剪贴板，toast 提示成功 */
  async function copyToClipboard(text, toastEl) {
    const raw = String(text ?? '').trim();
    if (!raw || raw === '—') return;
    try {
      await navigator.clipboard.writeText(raw);
      toast('✅ 已复制: ' + raw, 1500);
    } catch (e) {
      // 降级方案：创建临时 textarea 复制
      const ta = document.createElement('textarea');
      ta.value = raw;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); toast('✅ 已复制: ' + raw, 1500); } catch (_) {
        toast('⚠️ 复制失败，请手动复制', 2000);
      }
      document.body.removeChild(ta);
    }
  }

  /** 行唯一 key：订阅关系ID 优先，退化为几个编号拼起来 */
  function rowKey(r) {
    return r.publishSubcriptionId
      || [r.sysServeNo, r.prodSysServeNo, r.publishId].filter(Boolean).join('|');
  }

  // ═══════════════════════════════════════════════════
  // 筛选条件
  // ═══════════════════════════════════════════════════

  function selValue(key) {
    const inst = selects[key];
    return inst ? String(inst.getValue() || '').trim() : '';
  }

  function textValue(id) {
    const el = $(id);
    return el ? String(el.value || '').trim() : '';
  }

  /** 生效的调用方系统：表单里的「调用方系统/分行」优先于快速筛选按钮 */
  /**
   * 生效的调用方系统：直接读「调用方系统/分行」下拉的当前值。
   * 关键：下拉为空（用户没选 / 点了 ✕）就返回 ''，表示「不限定调用方」，
   * 不能回退到 DEFAULT_CALLER —— 否则「只搜提供方系统」会被偷偷限定成某个固定调用方，
   * 结果从几千条掉到几条（2026-09-11 的 bug）。
   */
  function effectiveCaller() {
    return selValue('f_callerCompNum');
  }

  function collectCond() {
    // 订阅人：纯数字当 EHR 号走 subscriberId，否则走姓名（抓包里两个字段都空着，
    // 这里只是前端分流，后端最终以哪个为准有待抓包确认）
    const subscriber = textValue('#f_subscriberName');
    const isEhr = /^\d+$/.test(subscriber);

    return {
      compNum:                  selValue('f_providerCompNum'),
      putBatch:                 selValue('f_providerBatch'),
      isSendOutsideSystem:      selValue('f_isSendOutside'),
      sysServeNoList:           multiSelects.sysServeNo ? multiSelects.sysServeNo.getValues() : [],
      serverCodingList:         multiSelects.serverCoding ? multiSelects.serverCoding.getValues() : [],
      providerServiceNameAndId: textValue('#f_providerServiceNameAndId'),
      prodSysServeNoList:       multiSelects.prodSysServeNo ? multiSelects.prodSysServeNo.getValues() : [],
      useNum:                   effectiveCaller(),
      callerComponent:          effectiveCaller(),
      prodBatch:                selValue('f_callerBatch'),
      subscriberId:             isEhr ? subscriber : '',
      subscriberName:           isEhr ? '' : subscriber,
      status:                   selValue('f_status'),
      deptId:                   selValue('f_deptId'),
      prodDeptId:               selValue('f_prodDeptId'),
      // 下面两个字段抓包里恒为空，页面上也没有对应筛选项，按原样传空串
      prodSysServeNo:           '',
      batch:                    '',
    };
  }

  function resetForm() {
    Object.values(selects).forEach((s) => s && s.clear());
    Object.values(multiSelects).forEach((m) => m && m.clear());
    ['#f_providerServiceNameAndId', '#f_subscriberName'].forEach((id) => {
      const el = $(id); if (el) el.value = '';
    });
    setQuickCaller(DEFAULT_CALLER);
  }

  // ═══════════════════════════════════════════════════
  // 查询 & 渲染
  // ═══════════════════════════════════════════════════

  /**
   * 入口：没指定调用方批次时，按「近 12 个月窗口」把每个批次并行拉回来合并
   * （避免一次查出 years 历史导致响应慢）；指定了批次就走原来的单批次查询。
   */
  async function query(pageNum) {
    if (!window.ToolApi) { toast('⚠️ 接口层未加载', 2500); return; }
    state.pageNum = pageNum || state.pageNum || 1;

    // 必须指定调用方系统或提供方系统其中一个
    const callerComp = selValue('f_callerCompNum');
    const providerComp = selValue('f_providerCompNum');
    if (!callerComp && !providerComp) {
      toast('⚠️ 请至少选择「调用方系统/分行」或「提供方系统」之一', 3000);
      return;
    }

    // 只有「查询条件真的变了」才清空勾选：翻页 / 刷新 / 切换排序只是重新取数，
    // 不该把用户已经勾好的行丢掉（勾选是按行 key 跨页累计的）。
    const nextCond = collectCond();
    const condChanged = !state.cond || JSON.stringify(nextCond) !== JSON.stringify(state.cond);
    state.cond = nextCond;
    if (condChanged) selected.clear();

    // 条件一变，上一次的全量统计就不对应当前条件了 —— 无论这次查询成功与否都要撤掉，
    // 否则查询失败时旧统计会配着新条件一起显示，容易误判。
    hideSummary();

    const seq = ++state.reqSeq;
    setLoading(true);
    try {
      // 满足以下任一条件 → 后端已有精确过滤，单条查询最快，不走12个月窗口：
      //   · 调用方批次 / 提供方批次
      //   · 提供方应用系统服务编号 / 接口编码 / 服务中文名称
      //   · 调用方应用系统服务编号
      // 以上条件都没有时才走窗口扇出（避免一次查出 years 历史导致响应慢）。
      const hasSpecificFilter = nextCond.prodBatch
        || nextCond.putBatch
        || (nextCond.sysServeNoList && nextCond.sysServeNoList.length > 0)
        || (nextCond.serverCodingList && nextCond.serverCodingList.length > 0)
        || nextCond.providerServiceNameAndId
        || (nextCond.prodSysServeNoList && nextCond.prodSysServeNoList.length > 0);
      if (hasSpecificFilter) await runSingleQuery(seq, nextCond);
      else await runWindowQuery(seq, nextCond);
    } catch (e) {
      toast('⚠️ 查询异常：' + (e && e.message ? e.message : e), 3500);
      console.error('[subscription] query 异常', e);
    } finally {
      if (seq === state.reqSeq) setLoading(false);
    }
  }

  /** 指定了调用方批次：与原逻辑一致，单条查询 +（可选）整批拉回排序 */
  async function runSingleQuery(seq, cond) {
    const first = await fetchPage(1);
    if (seq !== state.reqSeq) return;              // 已经有更新的请求发出去了
    if (!first.ok) {
      toast(`⚠️ 查询失败：${shortError(first.error)}`, 3500);
      showQueryFail(first.error || '未知错误');
      if (!state.queried) renderEmpty('查询失败，请检查代理或网络');
      return;
    }
    hideQueryFail();
    state.total = first.total;
    state.queried = true;

    // 排序开启且总量不大时，整批拉回来做「全局」排序 + 前端分页，
    // 这样逾期 / 临期的才是真的排在最前面，而不是只在当前页里排。
    if (state.sort && first.total > 0 && first.total <= CLIENT_SORT_MAX) {
      let all = null;
      if (first.total <= first.rows.length) {
        all = first.rows.map(decorateRow);          // 一页就装得下，不用再请求
      } else {
        // 先把第 1 页画出来 —— 整批拉完才渲染的话，几百条也要等十几秒才出第一屏
        state.mode = 'server';
        state.allRows = null;
        state.rows = first.rows.map((r) => decorateRow(r));
        state.progress = {
          done: 1,
          total: Math.ceil(Math.min(first.total, EXPORT_MAX) / EXPORT_PAGE_SIZE),
          unit: '页',
        };
        render();
        try {
          all = (await fetchAll((done, total) => {
            if (seq !== state.reqSeq) return;
            state.progress = { done, total, unit: '页' };
            render();
          })).rows;
        } catch (e) {
          // 整批拉取失败（网络抖动 / 离线回放缺条目）不该让整个查询报错 ——
          // 第一页的数据是好的，退化成后端分页照样能用，只是排序只作用于当前页。
          all = null;
          if (!state.fetchAllWarned) {
            state.fetchAllWarned = true;
            toast(`⚠️ 未能整批拉取全部 ${num(first.total)} 条（${shortError(e.message)}），`
              + '已退化为按页展示，排序只作用于当前页', 4200);
          }
        }
        state.progress = null;
        if (seq !== state.reqSeq) return;
      }
      if (all && all.length) {
        state.allRows = all;
        state.total = all.length;
        state.mode = 'client';
      } else {
        state.mode = 'server';
        state.allRows = null;
        state.rows = first.rows.map((r) => decorateRow(r));
      }
    } else {
      state.mode = 'server';
      state.allRows = null;
      state.rows = first.rows.map((r) => decorateRow(r));
      if (state.sort && first.total > CLIENT_SORT_MAX && !state.sortLimited) {
        state.sortLimited = true;
        toast(`⚠️ 结果共 ${num(first.total)} 条，超过 ${CLIENT_SORT_MAX} 条上限，`
          + '只对当前页排序；可缩小筛选范围后查看全局顺序', 4000);
      }
    }

    render();
    if (!state.total) toast('查询完成，没有匹配的订阅关系', 2200);
    if (first.local) toast('⚠️ 查询接口未接入（endpoint 为空），返回空结果', 3000);
  }

  /**
   * 没指定调用方批次：默认只看「当月 −2 个月 → 当月 +9 个月」这 12 个批次
   * （如 26年9月 ⇒ 2607批次 ~ 2706批次），把窗口内每个批次并行拉回、合并、
   * 去重后统一前端分页 + 优先级排序。相比一次查出全部历史，响应更快也更聚焦。
   */
  async function runWindowQuery(seq, cond) {
    // 增量渲染：每有一个批次返回就先画一版（onProgress），不再等 12 个批次全部完成。
    const res = await fetchWindowAll(cond, seq, (rows, done, total) => {
      if (seq !== state.reqSeq) return;
      hideQueryFail();
      state.queried = true;
      state.allRows = rows.map(decorateRow);
      state.total = rows.length;
      state.mode = 'client';
      state.rows = [];
      state.progress = { done, total };
      render();
    });
    if (seq !== state.reqSeq) return;              // 已被更新的查询取代，安静退出
    if (res.aborted) return;
    state.progress = null;

    if (!res.ok) {
      toast(`⚠️ 查询失败：${shortError(res.error)}`, 3500);
      showQueryFail(res.error || '未知错误');
      if (!state.queried) renderEmpty('查询失败，请检查代理或网络');
      return;
    }
    hideQueryFail();
    state.queried = true;

    // 窗口内全量已在本地，统一走 client 模式（排序 / 分页 / 导出 / 统计都复用现成逻辑）
    const all = res.rows.map(decorateRow);
    state.allRows = all;
    state.total = all.length;
    state.mode = 'client';
    state.rows = [];

    if (res.partial.length) {
      toast(`⚠️ 窗口内有 ${res.partial.length} 个批次查询失败（${res.partial.join('、')}），已展示其余批次`, 4200);
    }

    render();
    if (!state.total) toast('查询完成，窗口内（近 12 个月）没有匹配的订阅关系', 2400);
    if (res.local) toast('⚠️ 查询接口未接入（endpoint 空），返回空结果', 3000);
  }

  /**
   * 生成「近 12 个月」批次 label 列表：从 (当前月 −2) 到 (当前月 +9)，含两端。
   * 例：26年9月 ⇒ [2607批次, 2608批次, …, 2706批次]，共 12 个。
   * label 格式与抓包一致（YYMM批次），直接作为 prodBatch 过滤值发后端。
   */
  function batchWindow() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 9, 1);
    const out = [];
    const cur = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cur <= end) {
      const yy = String(cur.getFullYear()).slice(2);
      const mm = String(cur.getMonth() + 1).padStart(2, '0');
      out.push(`${yy}${mm}批次`);
      cur.setMonth(cur.getMonth() + 1);
    }
    return out;
  }

  /**
   * 窗口扇出：按批次并行拉取（并发上限 WINDOW_CONCURRENCY），**增量**合并。
   *
   * 关键：给每个批次的 promise 单独挂 then —— 谁先回来就把当时的合并结果通过
   * onProgress 交给上层先渲染一版，用户几秒内就能看到并开始操作，而不是等
   * 12 个批次全部完成才有第一屏。
   * 行序稳定：结果按批次存 Map，组装时按窗口顺序遍历 + 去重，不依赖完成顺序。
   *
   * @param {object}   cond
   * @param {number}   seq
   * @param {Function} [onProgress] (rows, done, total) => void，每完成一个批次调用一次
   * @returns {Promise<{ok, rows, partial[], local, error, aborted}>}
   */
  async function fetchWindowAll(cond, seq, onProgress) {
    const batches = batchWindow();
    const batchRows = new Map();   // batch -> rows
    const partial = [];
    let local = false;
    let done = 0;

    const assemble = () => {
      const seen = new Set();
      const rows = [];
      batches.forEach((b) => {
        for (const row of (batchRows.get(b) || [])) {
          const k = rowKey(row);
          if (!seen.has(k)) { seen.add(k); rows.push(row); }
        }
      });
      return rows;
    };

    for (let i = 0; i < batches.length; i += WINDOW_CONCURRENCY) {
      if (seq !== state.reqSeq) return { aborted: true };
      const slice = batches.slice(i, i + WINDOW_CONCURRENCY);
      await Promise.all(slice.map((b) => fetchBatchAllPages(cond, b).then((r) => {
        if (seq !== state.reqSeq) return;              // 已被更新的查询取代
        if (r.local) local = true;
        if (!r.ok) { partial.push(b); return; }
        batchRows.set(b, r.rows);
        done++;
        if (onProgress) onProgress(assemble(), done, batches.length);
      })));
    }
    const ok = partial.length < batches.length;     // 全失败才算失败
    return { ok, rows: assemble(), partial, local, error: ok ? '' : `批次 ${partial.join('、')} 查询失败` };
  }

  /**
   * 单个批次：先取第 1 页拿到 total，再**并发**拉剩余页（PAGE_CONCURRENCY 个 worker），
   * 最后按页码顺序拼接（并发完成顺序不确定，边拉边 concat 会让行序随网络抖动变化）。
   * 返回 { ok, rows, local }。
   */
  async function fetchBatchAllPages(cond, batch) {
    const fetchP = (page) => window.ToolApi.fetchSubscriptionPublishHistory({
      ...cond,
      prodBatch: batch,
      pageNum: page,
      pageSize: EXPORT_PAGE_SIZE,
    });

    const first = await fetchP(1);
    if (!first.ok) return { ok: false, error: first.error, local: first.local };
    const pageRows = new Map([[1, first.rows || []]]);
    const total = Number(first.total) || 0;
    let got = (first.rows || []).length;

    // 一页就装完（或接口未接入）→ 直接收尾
    if (!got || got >= total || got >= EXPORT_MAX) {
      return { ok: true, local: !!first.local, rows: (first.rows || []).slice(0, EXPORT_MAX) };
    }

    const pageCount = Math.min(
      Math.ceil(total / EXPORT_PAGE_SIZE),
      Math.ceil(EXPORT_MAX / EXPORT_PAGE_SIZE)
    );
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
        if (!(res.rows || []).length || got >= total || got >= EXPORT_MAX) return;
      }
    };
    await Promise.all(Array.from({ length: Math.min(PAGE_CONCURRENCY, pending.length) }, worker));
    if (failed) return { ok: false, error: failed, local: false };

    const out = [];
    for (let p = 1; p <= pageCount; p++) out.push(...(pageRows.get(p) || []));
    return { ok: true, local: !!first.local, rows: out.slice(0, EXPORT_MAX) };
  }

  /** 取某一页（默认按当前每页条数） */
  function fetchPage(p, size) {
    return window.ToolApi.fetchSubscriptionPublishHistory({
      ...state.cond,
      pageNum: p,
      pageSize: size || state.pageSize,
    });
  }

  function totalPages() {
    return Math.max(1, Math.ceil(state.total / state.pageSize));
  }

  /**
   * 给一行算出投产优先级（批次 + 基线状态 + 今天）。
   * 规则全在 js/ui/priority.js，写回的下划线字段只在前端用。
   */
  function decorateRow(r) {
    if (window.Priority && typeof window.Priority.decorate === 'function') {
      return window.Priority.decorate(r);
    }
    // 组件没加载：退化成不影响展示的占位
    r._prio = { level: 'unknown', days: null, text: '—', next: '', deadline: '', sortKey: 9e6, overdue: false };
    r._prioText = '—';
    r._prioNext = '';
    r._prioDeadline = '';
    return r;
  }

  /** 按当前排序方向排一批行（不动入参数组） */
  function sortRows(rows) {
    if (!state.sort || !window.Priority) return rows.slice();
    const arr = rows.slice().sort(window.Priority.compare);
    return state.sort === 'desc' ? arr.reverse() : arr;
  }

  /**
   * 当前要渲染的行。
   * client 模式：全量已在 state.allRows，这里排序 + 切出当前页（翻页不发请求）
   * server 模式：只有当前页，就地排序
   */
  function pageRows() {
    if (state.mode === 'client' && state.allRows) {
      const sorted = sortRows(state.allRows);
      const start = (state.pageNum - 1) * state.pageSize;
      state.rows = sorted.slice(start, start + state.pageSize);
    } else if (state.sort && state.mode === 'server' && state.rows) {
      // 后端分页：本页内按当前优先级方向排（全局排序已在超阈值时提示，仅作用于当前页）。
      // 之前这里只排了 client 模式，server 模式下列头指示器变了但行序没动——排序形同虚设。
      state.rows = sortRows(state.rows);
    }
    return state.rows;
  }

  /** 表头排序指示器：↑ 紧急在前 / ↓ 宽松在前 / ⇅ 后端原序 */
  function syncSortIndicator() {
    const ind = $('#prioSortInd');
    const th = $('#thPrio');
    if (ind) ind.textContent = state.sort === 'asc' ? '↑' : (state.sort === 'desc' ? '↓' : '⇅');
    if (th) th.classList.toggle('is-sorted', !!state.sort);
  }

  /** 翻页统一入口：client 模式只重渲染，server 模式才请求后端 */
  function gotoPage(n) {
    const page = Math.min(Math.max(1, n), totalPages());
    if (page === state.pageNum && state.mode === 'server' && state.rows.length) return;
    state.pageNum = page;
    if (state.mode === 'client') render();
    else query(page);
  }

  function render() {
    const pages = totalPages();
    if (state.pageNum > pages) state.pageNum = pages;   // 结果变少时别停在不存在的页
    if (state.pageNum < 1) state.pageNum = 1;
    renderTable();
    renderPagination();
    renderCount();
  }

  function renderEmpty(text) {
    $('#resultBody').innerHTML = `<tr><td colspan="24" class="empty-hint">${esc(text)}</td></tr>`;
    $('#pagination').style.display = 'none';
  }

  function renderCount() {
    const base = state.queried ? `共 ${num(state.total)} 条 · 本页 ${state.rows.length} 条` : '';
    // 取数还没完时告诉用户进度：先出来的这批已经是可用结果，不是「卡住了」
    $('#resultCount').textContent = state.progress
      ? `${base} · 加载中 ${state.progress.done}/${state.progress.total}${state.progress.unit || '批次'}`
      : base;
    const overdue = state.rows.filter((r) => r._prio && r._prio.overdue).length;
    const el = $('#overdueCount');
    if (el) el.textContent = overdue ? `⚠️ 本页逾期 ${overdue} 条` : '';
    // 勾选跨页累计，所以要随时告诉用户一共勾了多少（否则翻页后就看不见自己勾了什么）
    const picked = $('#pickedCount');
    if (picked) picked.textContent = selected.size ? `☑ 已勾选 ${selected.size} 条` : '';
  }

  /**
   * 把接口层的错误串压成一句话。
   * tool-api 抛出来的是 `HTTP 404 {"code":404,"msg":"...","key":"..."}` 这种，
   * 整段塞进提示条会把真正有用的说明挤没，所以优先抽 msg 字段。
   */
  function shortError(err) {
    const s = String(err == null ? '未知错误' : err);
    const m = /"msg"\s*:\s*"([^"]+)"/.exec(s);
    if (m) return m[1];
    return s.length > 90 ? s.slice(0, 90) + '…' : s;
  }

  /**
   * 查询失败的显眼提示：失败时表格会保留上一次的结果（方便对照 / 重试），
   * 但用户容易误以为「点了没反应」，所以在结果区顶部挂一条说明。
   */
  function showQueryFail(reason) {
    const bar = $('#failBar');
    if (!bar) return;
    const msg = shortError(reason);
    $('#failText').textContent = state.queried
      ? `⚠️ 本次查询失败，下面仍是上一次成功查询的结果（${msg}）`
      : `⚠️ 查询失败：${msg}`;
    bar.style.display = '';
  }

  function hideQueryFail() {
    const bar = $('#failBar');
    if (bar) bar.style.display = 'none';
  }

  /** 全量统计条：查询条件一变就失效（数据不再是同一批） */
  function hideSummary() {
    const box = $('#prioSummary');
    if (box) { box.style.display = 'none'; box.innerHTML = ''; }
  }

  function statusTag(v) {
    const s = String(v ?? '').trim();
    if (!s) return '<span class="st-tag is-offline">—</span>';
    const cls = STATUS_CLASS[s] || 'is-offline';
    return `<span class="st-tag ${cls}">${esc(s)}</span>`;
  }

  /** 审核流程状态标签：裸值 → 中文 + 色块 */
  function reviewStatusTag(v) {
    const code = String(v ?? '').trim();
    if (!code) return '<span class="st-tag is-offline">—</span>';
    const info = REVIEW_STATUS_MAP[code];
    if (!info) return `<span class="st-tag is-offline">${esc(code)}</span>`;
    return `<span class="st-tag ${info.cls}">${esc(info.text)}</span>`;
  }

  /** 优先级单元格：色块 + 天数，title 里写清「为什么」 */
  function prioCell(r) {
    const p = r._prio || { level: 'unknown', text: '—' };
    const src = p.from === 'config' ? '（按批次时间配置）' : '';
    const hint = p.next
      ? `${r.prodBatch || '（无批次）'}：应于 ${p.deadline} 前转为${p.next}${src}`
      : (p.level === 'done' ? '已到正式版基线 / 已下线' : '批次或基线状态无法判断');
    return `<td class="col-prio" title="${esc(hint)}">
      <span class="prio-tag is-${esc(p.level)}">${esc(p.text)}</span>
    </td>`;
  }

  function renderTable() {
    // 注意顺序：必须先 pageRows()（client 模式下它会按排序切出当前页），
    // 再做空判断 —— 否则会用上一轮的 state.rows 提前返回。
    const rows = pageRows();
    const body = $('#resultBody');
    if (!rows.length) {
      renderEmpty('没有匹配的订阅关系');
      return;
    }
    body.innerHTML = rows.map((r) => {
      const index = state.rows.indexOf(r);        // 详情 / 勾选仍按原数组下标
      const key = esc(rowKey(r));
      const picked = selected.has(rowKey(r)) ? ' is-picked' : '';
      const overdue = r._prio && r._prio.overdue ? ' is-overdue' : '';
      const cells = COLUMNS.map(([k, , mono]) => {
        const raw = r[k];
        const text = (raw === null || raw === undefined || raw === '') ? '—' : String(raw);
        if (k === 'status') return `<td class="col-st copy-cell" data-copy="${esc(String(raw ?? ''))}" title="点击复制">${statusTag(raw)}</td>`;
        if (k === 'prodReviewStatus') return `<td class="col-st copy-cell" data-copy="${esc(String(raw ?? ''))}" title="点击复制">${reviewStatusTag(raw)}</td>`;
        if (k === '_prioText') return prioCell(r);
        return `<td class="${mono ? 'cell-code' : ''} copy-cell" data-copy="${esc(String(raw ?? ''))}" title="点击复制: ${esc(text)}">${esc(text)}</td>`;
      }).join('');
      return `<tr class="${(picked + overdue).trim()}" data-key="${key}" data-index="${index}">
        <td class="col-chk"><input type="checkbox" data-pick="${key}" ${picked ? 'checked' : ''}></td>
        ${cells}
        <td class="col-op"><button class="text-btn" type="button" data-jump="${index}"
                title="在 ITAMP 服务搜索中查看该订阅关系（新窗口，预填该行条件）">查 看</button></td>
      </tr>`;
    }).join('');

    body.querySelectorAll('button[data-jump]').forEach((b) => {
      b.addEventListener('click', () => jumpToServiceSearch(state.rows[Number(b.dataset.jump)]));
    });
    // 表格数据单元格：点击复制到剪贴板
    body.querySelectorAll('td.copy-cell').forEach((td) => {
      td.addEventListener('click', (e) => {
        e.stopPropagation();
        const text = td.dataset.copy;
        if (text) copyToClipboard(text);
      });
    });
    body.querySelectorAll('input[data-pick]').forEach((cb) => {
      cb.addEventListener('change', () => {
        if (cb.checked) selected.add(cb.dataset.pick);
        else selected.delete(cb.dataset.pick);
        cb.closest('tr').classList.toggle('is-picked', cb.checked);
        syncCheckAll();
        renderCount();
      });
    });
    syncCheckAll();
  }

  function syncCheckAll() {
    const all = $('#checkAll');
    if (!all) return;
    all.checked = state.rows.length > 0 && state.rows.every((r) => selected.has(rowKey(r)));
  }

  function renderPagination() {
    const bar = $('#pagination');
    // 条数文案始终同步，避免分页条被隐藏后还留着上一轮的旧数字
    $('#pageTotal').textContent = `共 ${num(state.total)} 条`;
    // 总数还没超过最小每页条数时，分页条没有意义（切每页条数也切不动），直接不显示。
    // 条数信息在结果卡片头的「共 X 条 · 本页 Y 条」里已经有了。
    if (!state.queried || !state.total || state.total <= MIN_PAGE_SIZE) {
      bar.style.display = 'none';
      return;
    }
    bar.style.display = '';
    const pages = totalPages();
    $('#pageNumbers').innerHTML = pageNumbersHtml(pages);
    $('#btnPrev').disabled = state.pageNum <= 1;
    $('#btnNext').disabled = state.pageNum >= pages;
    const jump = $('#pageJumpInput');
    jump.max = String(pages);
    jump.value = String(state.pageNum);
    $('#pageNumbers').querySelectorAll('button[data-page]').forEach((b) => {
      b.addEventListener('click', () => gotoPage(Number(b.dataset.page)));
    });
  }

  /** 页码条：首页 + 当前页 ±2 + 末页，中间用省略号 */
  function pageNumbersHtml(pages) {
    const cur = state.pageNum;
    const set = new Set([1, pages, cur, cur - 1, cur + 1, cur - 2, cur + 2]);
    const nums = [...set].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
    let out = '';
    let prev = 0;
    nums.forEach((n) => {
      if (prev && n - prev > 1) out += '<li class="page-ellipsis">…</li>';
      out += `<li><button type="button" data-page="${n}" class="${n === cur ? 'is-current' : ''}">${n}</button></li>`;
      prev = n;
    });
    return out;
  }

  // ═══════════════════════════════════════════════════
  // 结果行「查 看」→ 跳转 ITAMP 服务搜索
  // ═══════════════════════════════════════════════════

  /**
   * 结果行「查 看」：新窗口打开 ITAMP 真实系统的「服务搜索查看」页
   * （/asserInstruments/serviceSearchView），并带上该行的条件，尽量让目标页预填并查询。
   *
   * 参数名用目标页的表单字段名（来源：2026-09-11 serviceSearchView 抓包），
   * 只带「能定位这条订阅关系」的条件，不带 status —— 否则在真实系统里会把
   * 「本该核对的基线状态」也当成过滤条件，反而查不到待处理的记录。
   *
   * ⚠️ 目标页是否认这些 query 参数、预填后是否自动查询，尚未在真实环境确认；
   *    不认就退化成「跳过去手动填」。
   */
  function jumpToServiceSearch(row) {
    if (!row) return;
    if (!window.AppNavigator || typeof window.AppNavigator.openServiceSearch !== 'function') {
      toast('⚠️ 跳转模块未加载，无法打开 ITAMP 服务搜索', 2600);
      return;
    }
    const params = {
      compNum:                  row.sysNo || '',                              // 提供方系统编号
      sysServeNoList:           row.sysServeNo ? [row.sysServeNo] : [],       // 提供方服务编号
      serverCodingList:         row.serverCoding ? [row.serverCoding] : [],   // 接口编码
      providerServiceNameAndId: row.sysServeName || '',                       // 提供方应用系统服务中文名称
      useNum:                   row.callerComponent || '',                    // 调用方系统/分行
      callerComponent:          row.callerComponent || '',
      prodBatch:                row.prodBatch || '',                          // 调用方投产/变更批次
    };
    const url = window.AppNavigator.openServiceSearch(params);
    console.log('[subscription] 跳转 ITAMP 服务搜索:', url);
    toast('🔗 已在新窗口打开 ITAMP 服务搜索（预填该行条件）', 2600);
  }

  // ═══════════════════════════════════════════════════
  // 导出
  // ═══════════════════════════════════════════════════

  /** CSV 末尾追加的两列优先级信息（表格里已展示优先级本身，这里补上截止日） */
  const CSV_EXTRA = [
    ['_prioNext', '下一步里程碑'],
    ['_prioDeadline', '里程碑截止日'],
  ];

  // CSV 导出走 js/ui/csv-export.js 的 CsvExporter.downloadRows（含模块缺失保护）

  /**
   * 按页把当前查询结果全部拉回来（服务端分页），顺手算好优先级。
   * 并发拉（PAGE_CONCURRENCY 个 worker），按页码顺序拼接 —— 原来是串行 for，
   * EXPORT_PAGE_SIZE=50 时 5000 条要 100 次串行往返，导出/统计会明显卡顿。
   * @param {Function} [onProgress] (done, total) => void，每完成一页调用一次
   */
  async function fetchAll(onProgress) {
    const want = Math.min(state.total, EXPORT_MAX);
    const fetchP = (p) => window.ToolApi.fetchSubscriptionPublishHistory({
      ...state.cond, pageNum: p, pageSize: EXPORT_PAGE_SIZE,
    });

    const first = await fetchP(1);
    if (!first.ok) throw new Error(first.error || '未知错误');
    const pageRows = new Map([[1, (first.rows || []).map(decorateRow)]]);
    let got = (first.rows || []).length;

    if (!got || got >= want) {
      return { rows: (pageRows.get(1) || []).slice(0, want), truncated: state.total > EXPORT_MAX };
    }

    const pageCount = Math.ceil(want / EXPORT_PAGE_SIZE);
    const pending = [];
    for (let p = 2; p <= pageCount; p++) pending.push(p);

    const worker = async () => {
      while (pending.length) {
        const p = pending.shift();
        const res = await fetchP(p);
        if (!res.ok) throw new Error(res.error || '未知错误');
        if (!res.rows.length) return;
        pageRows.set(p, res.rows.map(decorateRow));
        got += res.rows.length;
        if (onProgress) onProgress(pageRows.size, pageCount);
      }
    };
    await Promise.all(Array.from({ length: Math.min(PAGE_CONCURRENCY, pending.length) }, worker));

    const out = [];
    for (let p = 1; p <= pageCount; p++) out.push(...(pageRows.get(p) || []));
    return { rows: out.slice(0, want), truncated: state.total > EXPORT_MAX };
  }

  /**
   * 导出。两个按钮共用：
   *   · 后端导出接口已配置（__APP_CONFIG__.toolEndpoints.subscriptionExport）→ 走后端文件流
   *   · 未配置（现状，缺抓包）→ 本地 CSV，并在 toast 里说明
   * byBatch=true 时按「提供方最新变更批次 + 接口编码」排序，文件名加后缀。
   */
  async function exportRows(byBatch) {
    if (!state.queried || !state.total) { toast('⚠️ 请先查询再导出', 2200); return; }
    const btn = byBatch ? $('#btnExportByBatch') : $('#btnExport');
    const label = byBatch ? '按接口变更批次导出' : '按查询结果导出';
    if (btn) { btn.disabled = true; btn.textContent = '导出中…'; }
    setLoading(true);

    try {
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const api = window.ToolApi;

      // 后端导出（预留路径，当前默认关闭）
      if (api && api.isEnabled && api.isEnabled('subscriptionExport')) {
        const res = await api.exportSubscriptionPublishHistory({
          ...state.cond, pageNum: 1, pageSize: state.pageSize,
        });
        if (!res.ok) throw new Error(res.error || '未知错误');
        toast(`✅ 已导出：${res.filename || '订阅关系文件'}`, 2600);
        return;
      }

      // 本地兜底
      let rows;
      let truncated = false;
      if (selected.size) {
        // 勾选是跨页累计的（key 存 Set），导出要把其他页勾中的也带上
        const pool = (state.mode === 'client' && state.allRows)
          ? state.allRows
          : (await fetchAll((d, t) => { if (btn) btn.textContent = `导出中 ${d}/${t} 页`; })).rows;
        rows = pool.filter((r) => selected.has(rowKey(r)));
      } else if (state.mode === 'client' && state.allRows) {
        rows = sortRows(state.allRows);      // 全量已在手上，顺序与页面一致
      } else {
        const all = await fetchAll((d, t) => { if (btn) btn.textContent = `导出中 ${d}/${t} 页`; });
        rows = all.rows;
        rows = sortRows(rows);     // 与屏幕一致：按当前优先级方向排（byBatch 分支会再覆盖为批次序）
        truncated = all.truncated;
      }
      if (!rows.length) { toast('⚠️ 没有可导出的数据', 2200); return; }

      if (byBatch) {
        rows = rows.slice().sort((a, b) => {
          const d = String(a.prodBatchList || '').localeCompare(String(b.prodBatchList || ''), 'zh-CN');
          return d !== 0 ? d : String(a.serverCoding || '').localeCompare(String(b.serverCoding || ''), 'zh-CN');
        });
      }
      window.CsvExporter.downloadRows(rows, COLUMNS.concat(CSV_EXTRA), `服务订阅关系${byBatch ? '_按变更批次' : ''}_${stamp}.csv`);
      toast(
        (selected.size ? `✅ 已按勾选导出 ${rows.length} 条` : `✅ 已导出 ${rows.length} 条`) +
        (truncated ? `（共 ${state.total} 条，超出上限 ${EXPORT_MAX}）` : ''),
        2800
      );
    } catch (e) {
      toast(`⚠️ 导出失败：${e.message || String(e)}`, 3000);
    } finally {
      setLoading(false);
      if (btn) { btn.disabled = false; btn.textContent = label; }
    }
  }

  // ═══════════════════════════════════════════════════
  // 全量逾期统计
  // ═══════════════════════════════════════════════════

  /** 等级 → 中文名 / 样式（与 js/ui/priority.js 的 LEVELS 对应） */
  const LEVEL_META = [
    ['overdue',  '逾期'],
    ['critical', '紧急（≤7 天）'],
    ['soon',     '临近（≤30 天）'],
    ['normal',   '正常'],
    ['done',     '已完成'],
    ['unknown',  '无法判断'],
  ];

  /**
   * 拉全量结果做一次逾期统计。
   * 后端是分页的，本页只能算本页，所以这里按页拉完（上限 EXPORT_MAX 条）。
   */
  async function countAll() {
    if (!state.queried || !state.total) { toast('⚠️ 请先查询再统计', 2200); return; }
    const btn = $('#btnCountAll');
    if (btn) { btn.disabled = true; btn.textContent = '统计中…'; }
    setLoading(true);
    try {
      // 全量已在手上就不要再拉一遍
      const all = (state.mode === 'client' && state.allRows)
        ? { rows: state.allRows, truncated: false }
        : await fetchAll((d, t) => { if (btn) btn.textContent = `统计中 ${d}/${t} 页`; });
      const { rows, truncated } = all;
      if (!rows.length) { toast('⚠️ 没有可统计的数据', 2200); return; }

      const buckets = {};
      rows.forEach((r) => {
        const lv = (r._prio && r._prio.level) || 'unknown';
        buckets[lv] = (buckets[lv] || 0) + 1;
      });

      const chips = LEVEL_META
        .filter(([key]) => buckets[key])
        .map(([key, label]) => `<span class="prio-chip is-${key}">${esc(label)} <b>${buckets[key]}</b></span>`)
        .join('');
      const box = $('#prioSummary');
      box.innerHTML = `<span class="prio-summary-title">全部 ${num(rows.length)} 条：</span>${chips}`
        + (truncated ? `<span class="prio-summary-note">仅统计前 ${EXPORT_MAX} 条（共 ${num(state.total)} 条）</span>` : '')
        + '<button type="button" class="text-btn" id="btnSummaryClose">收起</button>';
      box.style.display = '';
      box.querySelector('#btnSummaryClose').addEventListener('click', hideSummary);

      const od = buckets.overdue || 0;
      toast(od ? `⚠️ 全部 ${num(rows.length)} 条里有 ${od} 条已逾期` : `✅ 全部 ${num(rows.length)} 条均未逾期`, 3000);
    } catch (e) {
      toast(`⚠️ 统计失败：${e.message || String(e)}`, 3000);
    } finally {
      setLoading(false);
      if (btn) { btn.disabled = false; btn.textContent = '统计全部逾期'; }
    }
  }

  // ═══════════════════════════════════════════════════
  // 下拉数据源
  // ═══════════════════════════════════════════════════

  /** 批次：抓包里传的是 "2611批次" 这种 label，所以直接用 label 当 value */
  function toBatchOptions(batches) {
    return (batches || []).map((b) => ({ value: b.label, label: b.label }));
  }

  async function loadDicts() {
    const tasks = [];
    if (typeof window.loadProviderList === 'function') tasks.push(window.loadProviderList());
    if (typeof window.loadBatchList === 'function') tasks.push(window.loadBatchList());
    if (typeof window.loadDepartmentList === 'function') tasks.push(window.loadDepartmentList());

    const [providers, batches, departments] = await Promise.allSettled(tasks);
    const systems = providers.status === 'fulfilled' ? providers.value : [];
    const batchList = batches.status === 'fulfilled' ? batches.value : [];
    const deptList = departments.status === 'fulfilled' ? departments.value : [];

    ['f_providerCompNum', 'f_callerCompNum'].forEach((id) => {
      if (selects[id]) selects[id].updateOptions(systems);
    });
    ['f_providerBatch', 'f_callerBatch'].forEach((id) => {
      if (selects[id]) selects[id].updateOptions(toBatchOptions(batchList));
    });
    // 部门：value 用部门ID（key），与抓包里的 deptId / prodDeptId 同口径
    const deptOptions = deptList.map((d) => ({ value: d.key, label: d.value }));
    ['f_deptId', 'f_prodDeptId'].forEach((id) => {
      if (selects[id]) selects[id].updateOptions(deptOptions);
    });

    if (providers.status === 'rejected') console.warn('[subscription] 系统列表加载失败:', providers.reason);
    if (batches.status === 'rejected') console.warn('[subscription] 批次列表加载失败:', batches.reason);
    if (departments.status === 'rejected') console.warn('[subscription] 部门列表加载失败:', departments.reason);
  }

  /** 调用方应用系统服务编号：POST getProdSysServeNoList?callerComponent=xx（抓包确认，无请求体） */
  async function loadCallerServeNos(caller) {
    if (!window.ToolApi || !multiSelects.prodSysServeNo) return;
    const res = await window.ToolApi.fetchProdSysServeNoList(caller);
    if (!res.ok) {
      console.warn('[subscription] 调用方服务编号加载失败:', res.error);
      return;
    }
    multiSelects.prodSysServeNo.setOptions(
      res.list.map((it) => ({ value: String(it.value ?? it.label ?? ''), label: String(it.label ?? it.value ?? '') }))
    );
  }

  /**
   * 提供方应用系统服务编号 / 接口编码：随「提供方系统」联动。
   * 数据源是 ToolApi 里已抓包的两个信息维护接口（body { compNum }）。
   */
  async function loadProviderServeNos(compNum) {
    if (!window.ToolApi) return;
    if (!compNum) {
      if (multiSelects.sysServeNo) multiSelects.sysServeNo.setOptions([]);
      if (multiSelects.serverCoding) multiSelects.serverCoding.setOptions([]);
      return;
    }
    const [b, c] = await Promise.all([
      window.ToolApi.fetchInformationProdBatch(compNum),
      window.ToolApi.fetchInformationServerCoding(compNum),
    ]);
    const toOpts = (res) => {
      if (!res || !res.ok || !Array.isArray(res.list)) return [];
      return res.list
        .map((it) => (typeof it === 'string'
          ? { value: it, label: it }
          : { value: String(it.value ?? it.label ?? ''), label: String(it.label ?? it.value ?? '') }))
        .filter((o) => o.value);
    };
    if (multiSelects.sysServeNo) multiSelects.sysServeNo.setOptions(toOpts(b));
    if (multiSelects.serverCoding) multiSelects.serverCoding.setOptions(toOpts(c));
  }

  // ═══════════════════════════════════════════════════
  // 快速筛选
  // ═══════════════════════════════════════════════════

  function setQuickCaller(value, autoQuery) {
    // value='' 表示「不限定调用方」（全部调用方），不要再回退到默认系统
    state.caller = value || '';
    document.querySelectorAll('#callerQuick .filter-quick-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.caller === state.caller);
    });
    // 表单里的「调用方系统/分行」跟着同步，避免两个入口显示矛盾；
    // 空值 → setValue('') 清空下拉（不限定调用方）
    if (selects.f_callerCompNum) selects.f_callerCompNum.setValue(state.caller);
    // 选了具体调用方才去拉它的服务编号下拉；不限定就清空，避免发一次注定空的结果
    if (state.caller) loadCallerServeNos(state.caller);
    else if (multiSelects.prodSysServeNo) multiSelects.prodSysServeNo.setOptions([]);
    // 点了就查（首次也查），否则用户点完看不到任何动静会以为按钮坏了
    if (autoQuery) query(1);
  }

  // ═══════════════════════════════════════════════════
  // 批量修改批次时间
  // ═══════════════════════════════════════════════════

  let batchTimeData = [];   // 弹窗内的可编辑行 { batch, testDate, releaseDate }
  let batchTimes = {};      // 已落盘的配置 { '2609批次': { testDate, releaseDate } }

  /** 把批次时间配置注入优先级计算（设了日期 → 该批次截止日以所设日期为准） */
  function applyBatchTimesToPriority() {
    if (window.Priority && typeof window.Priority.setBatchTimes === 'function') {
      window.Priority.setBatchTimes(batchTimes);
    }
  }

  /** 批次时间变化后：重算已加载行的优先级并重绘（不重新请求后端） */
  function refreshPriority() {
    applyBatchTimesToPriority();
    if (Array.isArray(state.allRows)) state.allRows.forEach(decorateRow);
    else if (Array.isArray(state.rows)) state.rows.forEach(decorateRow);
    if (state.queried) render();
  }

  /**
   * 读取批次时间配置（不走 ITAMP 后端）。三级降级：
   *   1) 代理的本地端点 GET /local/batch-times（可写回文件，开发态首选）
   *   2) 静态文件 config/batch-times.json（手改即可生效；静态部署时走这条）
   *   3) localStorage（无代理、无文件时的兜底）
   */
  async function loadBatchTimes() {
    const pick = (obj) => (obj && typeof obj.batchTimes === 'object' && obj.batchTimes) || {};
    let loaded = false;
    try {
      const r = await fetch('local/batch-times', { headers: { Accept: 'application/json' } });
      if (r.ok) { batchTimes = pick((await r.json()).data); loaded = true; }
    } catch (_) { /* 代理端点不可用，继续降级 */ }
    if (!loaded) {
      try {
        const r2 = await fetch('config/batch-times.json', { cache: 'no-store' });
        if (r2.ok) { batchTimes = pick(await r2.json()); loaded = true; }
      } catch (_) { /* 文件不存在，继续降级 */ }
    }
    if (!loaded) {
      try { batchTimes = JSON.parse(localStorage.getItem('itamp.batchTimes') || '{}') || {}; } catch (_) { batchTimes = {}; }
    }
    refreshPriority();   // 注入优先级计算（设了日期就覆盖默认里程碑截止日）
  }

  /** 保存批次时间：优先写回配置文件（代理端点）；失败落 localStorage。返回 { ok, where|error } */
  async function persistBatchTimes(map) {
    try {
      const r = await fetch('local/batch-times', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchTimes: map }),
      });
      if (r.ok) return { ok: true, where: 'config/batch-times.json' };
      const j = await r.json().catch(() => ({}));
      return { ok: false, error: (j && j.msg) || ('HTTP ' + r.status) };
    } catch (_) { /* 无代理端点 → localStorage 兜底 */ }
    try {
      localStorage.setItem('itamp.batchTimes', JSON.stringify(map));
      return { ok: true, where: 'localStorage' };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  }

  /** 打开批次时间修改弹窗（并入已保存、但不在当前窗口里的批次，避免看不到） */
  function openBatchTimeDialog() {
    const batches = Array.from(new Set([...batchWindow(), ...Object.keys(batchTimes)]));
    batchTimeData = batches.map((b) => {
      const saved = batchTimes[b] || {};
      return { batch: b, testDate: saved.testDate || '', releaseDate: saved.releaseDate || '' };
    });
    renderBatchTimeList();
    const ov = $('#batchTimeOverlay');
    ov.classList.add('show');
    if (window.DialogUtils && window.DialogUtils.lockScroll) window.DialogUtils.lockScroll();
    $('#batchTimeDialog').focus();
  }

  /** 渲染批次时间列表 */
  function renderBatchTimeList() {
    const tbody = $('#batchTimeList');
    tbody.innerHTML = batchTimeData.map((item, idx) => {
      return `<tr>
        <td class="batch-label">${esc(item.batch)}</td>
        <td><input type="date" data-idx="${idx}" data-field="testDate" value="${esc(item.testDate)}"></td>
        <td><input type="date" data-idx="${idx}" data-field="releaseDate" value="${esc(item.releaseDate)}"></td>
      </tr>`;
    }).join('');

    // 绑定日期选择器变化事件（仅用于 UI 反馈，不触发 API）
    tbody.querySelectorAll('input[type="date"]').forEach((input) => {
      input.addEventListener('change', () => {
        const idx = Number(input.dataset.idx);
        const field = input.dataset.field;
        batchTimeData[idx][field] = input.value;
      });
    });
  }

  /** 关闭批次时间修改弹窗 */
  function closeBatchTimeDialog() {
    $('#batchTimeOverlay').classList.remove('show');
    if (window.DialogUtils && window.DialogUtils.unlockScroll) window.DialogUtils.unlockScroll();
    batchTimeData = [];
  }

  /**
   * 基线状态转换规则：设置日期后，该批次下所有订阅关系按以下规则自动升级 status。
   * 规则与 priority.js 的里程碑一致：
   *   · 设了功能测试时间（testDate） → 「开发基线」→「功能测试基线」
   *   · 设了上线时间（releaseDate）  → 「功能测试基线」→「正式版基线」
   * 本页只负责把日期存进本地配置（config/batch-times.json），**不调后端**；
   * 这里预演「会触发哪些转换」给用户确认，也是优先级里程碑规则的书面说明。
   */
  const BASELINE_TRANSITIONS = [
    { from: '开发基线',     to: '功能测试基线', dateField: 'testDate' },
    { from: '功能测试基线', to: '正式版基线',   dateField: 'releaseDate' },
  ];

  /**
   * 保存批次时间：把弹窗里填的日期写入本地配置（不走 ITAMP 后端）。
   *
   * 流程：
   *   1. 校验有修改的批次
   *   2. 预演基线状态转换（提示用户「真实系统里会触发什么」）
   *   3. 合并进 batchTimes 并落盘（config/batch-times.json；无代理时降级 localStorage）
   */
  async function saveBatchTimes() {
    const btn = $('#btnBatchTimeSave');
    if (btn) { btn.disabled = true; btn.textContent = '保存中…'; }
    setLoading(true);

    try {
      // 找出相对「已保存配置」有变化的批次（预填但没动过的行不算变更）
      const changed = batchTimeData.filter((item) => {
        const saved = batchTimes[item.batch] || {};
        return (item.testDate || '') !== (saved.testDate || '')
            || (item.releaseDate || '') !== (saved.releaseDate || '');
      });
      if (!changed.length) {
        toast('⚠️ 没有需要修改的批次时间', 2000);
        closeBatchTimeDialog();
        return;
      }

      // ── 预演基线状态转换（仅用于展示给用户看）──
      // 按批次预演：对每个有改动的批次，按 BASELINE_TRANSITIONS 检查它设了哪些日期。
      const transitions = [];
      for (const item of changed) {
        for (const rule of BASELINE_TRANSITIONS) {
          if (!item[rule.dateField]) continue;
          const dateLabel = rule.dateField === 'testDate' ? '功能测试时间' : '上线时间';
          transitions.push({
            batch: item.batch,
            from: rule.from,
            to: rule.to,
            hint: `设了${dateLabel}后，该批次「${rule.from}」的记录将转为「${rule.to}」`,
          });
        }
      }

      // ── 确认对话框（如果有转换发生）──
      if (transitions.length > 0) {
        const transText = transitions.map((t) => `${t.batch}：${t.from} → ${t.to}`).join('；\n');
        const confirmMsg =
          `以下批次设置了日期，真实系统里会触发对应基线状态转换：\n${transText}\n\n` +
          `（本页只把日期保存到本地配置，不调后端）是否继续保存？`;
        if (!window.confirm(confirmMsg)) {
          btn.disabled = false;
          btn.textContent = '保 存';
          setLoading(false);
          return;
        }
      }

      // ── 合并进配置并落盘（不走后端）──
      const next = Object.assign({}, batchTimes);
      changed.forEach((it) => {
        next[it.batch] = { testDate: it.testDate || '', releaseDate: it.releaseDate || '' };
      });
      const savedRes = await persistBatchTimes(next);
      if (!savedRes.ok) {
        toast(`⚠️ 保存失败：${savedRes.error}`, 3500);
        return;
      }
      batchTimes = next;
      toast(`✅ 已保存 ${changed.length} 个批次的日期（${savedRes.where}）`, 2600);
      closeBatchTimeDialog();
      refreshPriority();   // 优先级截止日随之更新（设了日期 → 覆盖默认里程碑）
    } catch (e) {
      toast(`⚠️ 保存失败：${e.message || String(e)}`, 3000);
    } finally {
      setLoading(false);
      if (btn) { btn.disabled = false; btn.textContent = '保 存'; }
    }
  }

  // ═══════════════════════════════════════════════════
  // 初始化
  // ═══════════════════════════════════════════════════

  function bindEvents() {
    $('#btnQuery').addEventListener('click', () => query(1));
    $('#btnReset').addEventListener('click', resetForm);
    $('#btnRefresh').addEventListener('click', () => query(state.pageNum));

    // 优先级列头：点击循环 紧急在前 → 宽松在前 → 恢复后端顺序
    $('#thPrio').addEventListener('click', () => {
      state.sort = state.sort === 'asc' ? 'desc' : (state.sort === 'desc' ? null : 'asc');
      syncSortIndicator();
      state.pageNum = 1;     // 换了排序就从头看

      // 全量已在手上（client 模式）时换个方向只是重排，不用再打扰后端；
      // 切到「后端原序」或当前还没整批拉过，就重新查一次。
      if (state.sort && state.mode === 'client' && state.allRows) {
        render();
        toast(state.sort === 'asc'
          ? '已按优先级排序：逾期 / 临期的在最上面'
          : '已按优先级倒序：宽松的在最上面', 2200);
        return;
      }
      query(1);
      if (state.sort === null) toast('已恢复后端返回顺序', 2200);
    });
    $('#btnExport').addEventListener('click', () => exportRows(false));
    $('#btnExportByBatch').addEventListener('click', () => exportRows(true));
    $('#btnCountAll').addEventListener('click', countAll);
    const retryBtn = $('#btnRetryQuery');
    if (retryBtn) retryBtn.addEventListener('click', () => query(state.pageNum));

    // 筛选区里按回车直接查询（与首页一致）。下拉组件内部已经 stopPropagation，
    // 所以这里只会在文本输入框里触发。
    $('#filterBody').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
      const el = e.target;
      if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'SELECT')) return;
      if (el.type === 'checkbox' || el.type === 'number') return;
      e.preventDefault();
      query(1);
    });

    // 筛选卡片折叠
    $('#filterToggle').addEventListener('click', () => {
      const collapsed = $('#filterCard').classList.toggle('collapsed');
      $('#filterToggle').setAttribute('aria-expanded', String(!collapsed));
    });

    // 更多筛选项
    $('#btnToggleAdvanced').addEventListener('click', () => {
      const body = $('#advancedFields');
      const open = body.style.display !== 'none';
      body.style.display = open ? 'none' : '';
      $('#btnToggleAdvanced').style.transform = open ? 'rotate(-90deg)' : '';
      $('#btnToggleAdvanced').setAttribute('aria-expanded', String(!open));
    });

    // 快速筛选
    document.querySelectorAll('#callerQuick .filter-quick-btn').forEach((b) => {
      b.addEventListener('click', () => setQuickCaller(b.dataset.caller, true));
    });

    // 分页（client 模式只重渲染，server 模式才请求后端，见 gotoPage）
    $('#btnPrev').addEventListener('click', () => gotoPage(state.pageNum - 1));
    $('#btnNext').addEventListener('click', () => gotoPage(state.pageNum + 1));
    $('#pageSizeSelect').addEventListener('change', (e) => {
      state.pageSize = Number(e.target.value) || PAGE_SIZE;
      state.pageNum = 1;
      if (state.mode === 'client') render();
      else query(1);
    });
    $('#pageJumpInput').addEventListener('change', (e) => {
      const n = Number(e.target.value);
      if (n >= 1 && n <= totalPages()) gotoPage(n);
      else e.target.value = String(state.pageNum);
    });
    $('#checkAll').addEventListener('change', (e) => {
      const on = e.target.checked;
      state.rows.forEach((r) => { if (on) selected.add(rowKey(r)); else selected.delete(rowKey(r)); });
      $('#resultBody').querySelectorAll('input[data-pick]').forEach((cb) => { cb.checked = on; });
      $('#resultBody').querySelectorAll('tr[data-key]').forEach((tr) => {
        tr.classList.toggle('is-picked', on);
      });
      renderCount();
    });

    // ESC 关闭批次时间弹窗（详情弹窗已移除，「查 看」改为跳转 ITAMP 服务搜索）
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && $('#batchTimeOverlay').classList.contains('show')) closeBatchTimeDialog();
    });

    // 批量修改批次时间弹窗
    $('#btnBatchTimeEdit').addEventListener('click', openBatchTimeDialog);
    $('#btnBatchTimeClose').addEventListener('click', closeBatchTimeDialog);
    $('#btnBatchTimeCancel').addEventListener('click', closeBatchTimeDialog);
    $('#btnBatchTimeSave').addEventListener('click', saveBatchTimes);
    $('#batchTimeOverlay').addEventListener('click', (e) => {
      if (e.target === $('#batchTimeOverlay')) closeBatchTimeDialog();
    });
  }

  function buildSelects() {
    if (typeof window.createSearchableSelect !== 'function') return;
    // 单选下拉一律走 searchable-select（含小字典），保持全站控件外观一致。
    // pageSizeSelect（每页条数）也包进来：不选中它时它是全站仅剩的原生下拉，观感突兀。
    ['f_providerCompNum', 'f_providerBatch', 'f_isSendOutside',
     'f_callerCompNum', 'f_callerBatch', 'f_status',
     'f_deptId', 'f_prodDeptId', 'pageSizeSelect'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) selects[id] = window.createSearchableSelect(el, [], {});
    });

    // 联动：组件选中后会给原生 <select> 派发冒泡的 change（searchable-select.js）
    const providerEl = document.getElementById('f_providerCompNum');
    if (providerEl) {
      providerEl.addEventListener('change', () => loadProviderServeNos(String(providerEl.value || '')));
    }
    // 调用方系统变化时刷新「调用方应用系统服务编号」
    const callerEl = document.getElementById('f_callerCompNum');
    if (callerEl) {
      callerEl.addEventListener('change', () => {
        const v = String(callerEl.value || '');
        if (v) { state.caller = v; loadCallerServeNos(v); syncQuickButtons(); }
        else syncQuickButtons();
      });
    }
  }

  function syncQuickButtons() {
    document.querySelectorAll('#callerQuick .filter-quick-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.caller === effectiveCaller());
    });
  }

  function boot() {
    bindEvents();
    syncSortIndicator();   // 默认就是「紧急在前」，把箭头摆对

    // 24 列 + 固定列宽，表头挂拖拽把手：拖右边框改列宽，双击恢复默认，宽度记在本地
    if (typeof window.createTableResizer === 'function') {
      window.createTableResizer(document.querySelector('.subq-table'), {
        minWidth: 60,
        skipFirst: true,                     // 复选框列固定 55px，不参与拖拽
        skipIndices: [1, 2],                 // 优先级列 + 基线状态列（左固定区，拖动会破坏 sticky 偏移）
        // v2：列顺序调整（基线状态移到优先级右侧）后旧存档已失效，换 key 防错位
        storageKey: 'itamp.subq.colWidths.v2',
      });
    }

    multiSelects.sysServeNo = window.createMultiSelect($('#msel_sysServeNo'), [], '全部服务编号');
    multiSelects.serverCoding = window.createMultiSelect($('#msel_serverCoding'), [], '全部接口编码');
    multiSelects.prodSysServeNo = window.createMultiSelect($('#msel_prodSysServeNo'), [], '全部调用方服务编号');

    buildSelects();

    if (window.DialogUtils && window.DialogUtils.makeDraggable) {
      window.DialogUtils.makeDraggable($('#batchTimeDialog'), $('#batchTimeDialog .sub-head'));
    }

    setQuickCaller('', false);   // 默认不限定调用方（全部），用户可点快捷按钮或下拉选具体系统
    loadDicts();
    loadBatchTimes();            // 批次时间本地配置（弹窗打开时用它预填）
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
