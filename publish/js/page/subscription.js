/**
 * 服务订阅关系查询页（subscription.html）
 *
 * ── 数据来源 ────────────────────────────────────────────────
 * 接口全部来自抓包 `服务订阅关系查询.har`（2026-09-10），没有猜测字段：
 *   查询   POST /itamp-tool/publish/getSubscriptionPublishHistoryList?n=xx
 *   下拉   POST /itamp-tool/publish/getProdSysServeNoList?callerComponent=xx&n=xx
 * 下拉里的提供方系统 / 批次 / 部门沿用首页那套 data/*.js（同源接口，抓包已确认）。
 *
 * ── 两个批次字段：口径 2026-09-20 修正（旧注释的推断已作废）────
 * 行内有 prodBatch 和 prodBatchList 两个批次字段，绑定为：
 *   提供方最新变更批次 = prodBatch       （556 行 × 发布接口缓存交叉验证 99.1% 命中）
 *   调用方投产/变更批次 = prodBatchList  （用户业务确认：2607 是最新调用的批次，
 *     提供方时间必须早于调用方；另缓存实证：请求筛选 prodBatch='2607批次' 返回的
 *     3 行里 prodBatchList 全等于 2607、prodBatch 全不是 —— 后端拿请求 prodBatch
 *     过滤的就是调用方批次）
 * 旧注释「两字段没有大小关系」作废：语义归属错了才显得没规律。调用方投产批次
 * 与提供方「最新」变更批次无必然大小关系（先投产、提供方后来又变更很正常）。
 *
 * 请求体：prodBatch = 调用方批次筛选（后端认，实证同上）；
 *         putBatch  = 死字段（实证：putBatch='2609批次' 的查询 total=550 完全未过滤）。
 *         所以「提供方批次」筛选只能**前端本地过滤**（runSingleQuery 里的
 *         filterByProviderBatch），buildCond 仍传 putBatch 只是为了模板完整。
 *
 * ── 审核流程状态字段 ────────────────────────────────────────
 * 行内 prodReviewStatus 与 reviewStatus 都是 "00"~"04" 裸值；本页用
 * prodReviewStatus（取值 00/01/02/03/04 五种齐全，与 REVIEW_STATUS_MAP 完全对上）。
 */
(function () {
  'use strict';

  // 调用时才取 window.debugLog（顶层捕获会在 debug.js 排后时静默变成空操作）
  const debugLog = (...a) => (window.debugLog || (() => {}))(...a);

  const $ = (sel) => document.querySelector(sel);

  // ═══════════════════════════════════════════════════
  // 常量 / 纯逻辑已下沉到 SubscriptionModel（同目录 subscription-model.js）
  // 纯渲染已下沉到 SubscriptionView（subscription-view.js）
  // ═══════════════════════════════════════════════════

  const {
    PAGE_SIZE, MIN_PAGE_SIZE, BULK_PAGE_SIZE, BULK_MAX,
    CLIENT_SORT_MAX, WINDOW_CONCURRENCY, PAGE_CONCURRENCY, DEFAULT_CALLER,
  } = SubscriptionModel;
  const V = SubscriptionView;   // 纯渲染层

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
    // 默认就按优先级排（逾期 / 紧急的顶上来），用户点列头可切宽松在前或恢复默认顺序
    sort: 'asc',              // 'asc' 紧急在前 / 'desc' 宽松在前 / null 默认顺序
    mode: 'server',           // 'client' = 全量在前端（排序 + 分页都在本地）；'server' = 后端分页
    allRows: null,            // client 模式下的全量结果（已算好优先级）
    sortLimited: false,       // 已提示过「数据量过大，只排当前页」，避免重复弹
    fetchAllWarned: false,    // 已提示过「整批拉取失败，退化为按页展示」
    progress: null,           // 取数中：{ done, total } —— 用于「先展示部分结果」的进度提示
  };

  let selects = {};             // id -> searchable-select 实例
  let multiSelects = {};        // key -> multi-select 实例

  // ═══════════════════════════════════════════════════
  // 小工具
  // ═══════════════════════════════════════════════════

  // 公共实现见 js/ui/toast.js / js/core/format.js（三页共用）。
  // 本地只留同名别名，调用点不用改。
  // 一律**调用时才取** window.*：顶层捕获会让本页「顺序敏感」——依赖模块一旦排到本文件
  // 之后，提示 / 数字格式化会永久退化成兜底实现且不报错（回归见 tests/module-order.test.js）。
  const toast = (...a) => (window.toast || (() => {}))(...a);
  const num = (v) => ((window.Fmt && window.Fmt.num) || ((x) => String(x ?? '—')))(v);

  // 加载态 / 失败常驻条 / 错误串压缩：实现统一在 js/ui/query-feedback.js（三页共用）。
  // 本地只留薄别名（把 state.queried 传进去），调用点不用改。
  const QF = () => window.QueryFeedback || { setLoading() {}, showQueryFail() {}, showFailText() {}, hideFail() {}, shortError: String };
  const setLoading = (on) => QF().setLoading(on);

  /**
   * 空态文案统一走 js/ui/table-utils.js 的 EMPTY_TEXT（延迟取，避免脚本顺序敏感）。
   * 此前本页自己写「查询失败，请检查代理或网络」——「代理」是开发概念，不该出现在业务界面。
   * @param {'initial'|'none'|'filtered'|'fail'} kind
   * @param {string} [what] none/filtered 用的对象名（如「订阅关系」）
   * @param {string} [fallback]
   */
  function emptyText(kind, what, fallback) {
    const et = (window.TableUtils && window.TableUtils.EMPTY_TEXT) || null;
    const v = et ? et[kind] : null;
    if (v == null) return fallback || '';
    return typeof v === 'function' ? v(what) : v;
  }

  /**
   * 错误串 → 一句人能读的话（抽后端 msg / 超长截断）。
   * 统一走全站唯一实现 QueryFeedback.shortError；该模块缺失时朴素截断，
   * 绝不把 `HTTP 500 {"code":...}` 整段原样弹给业务用户。
   */
  function errText(e) {
    if (window.QueryFeedback && typeof window.QueryFeedback.shortError === 'function') {
      return window.QueryFeedback.shortError(e);
    }
    const s = String(e == null || e === '' ? '未知错误' : e);
    return s.length > 90 ? s.slice(0, 90) + '…' : s;
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

  /** 行唯一 key：订阅关系ID 优先，退化为几个编号拼起来（实现见 SubscriptionModel.rowKey） */
  const rowKey = SubscriptionModel.rowKey;

  // ═══════════════════════════════════════════════════
  // 筛选条件
  // ═══════════════════════════════════════════════════

  function selValue(key) {
    const inst = selects[key];
    return inst ? String(inst.getValue() || '').trim() : '';
  }

  /**
   * 批次类筛选的取值器：优先取已正式选中的值（getValue），
   * 其次回退到「手输但未从下拉正式选中」的自由文本（getFreeText）。
   *
   * 背景（即线上「选了提供方批次却查出全部」的根因）：
   * searchable-select 在用户手输文本后直接点「查询」按钮时，失焦会把文本存进
   * freeText（见控件 blur 处理），而 selValue 只读 getValue，导致手输批次被
   * 静默丢弃、putBatch/prodBatch 为空、误走全量查询。这里回退读取，
   * 让手输批次也能真正参与过滤。正常「从下拉选中」流程下 selectedValue 非空、
   * freeText 为空，行为与原来完全一致，无回归。
   */
  function selBatchValue(key) {
    const inst = selects[key];
    if (!inst) return '';
    const committed = String(inst.getValue() || '').trim();
    if (committed) return committed;
    const free = (typeof inst.getFreeText === 'function')
      ? String(inst.getFreeText() || '').trim()
      : '';
    return free;
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

  // 条件收集下沉到 SubscriptionModel.buildCond；所有 DOM 读值经 getters 注入，便于单测。
  const buildCond = SubscriptionModel.buildCond;
  const condGetters = {
    selValue,
    selBatchValue,
    textValue,
    effectiveCaller,
    getMulti: (key) => (multiSelects[key] ? multiSelects[key].getValues() : []),
  };

  /**
   * 重置：清空筛选 + 结果回到初始空态 + 提示。
   *
   * 原来只清控件、**旧结果原样留着、也没有任何提示** —— 与首页「重置」的表现完全不同，
   * 用户按了以为没反应，或把上一轮数据当成新结果读（清单 C7）。
   * 排序方向 state.sort 保留：它是列头的查看偏好，不是筛选条件。
   */
  function resetForm() {
    state.reqSeq += 1;               // 作废在途查询，避免关闭后回来又往空界面回写
    setLoading(false);
    Object.values(selects).forEach((s) => s && s.clear());
    Object.values(multiSelects).forEach((m) => m && m.clear());
    ['#f_providerServiceNameAndId', '#f_subscriberName'].forEach((id) => {
      const el = $(id); if (el) el.value = '';
    });
    setQuickCaller(DEFAULT_CALLER);

    // 结果 / 计数 / 失败条一并回到初始空态
    hideQueryFail();
    state.queried = false;
    state.pageNum = 1;
    state.total = 0;
    state.rows = [];
    state.allRows = null;
    state.mode = 'server';
    state.progress = null;
    state.sortLimited = false;
    state.fetchAllWarned = false;
    renderEmpty(emptyText('initial', null, '请输入条件后点击「查询」'));
    renderCount();
    toast('筛选条件已重置', 1500, 'info');
  }

  // ═══════════════════════════════════════════════════
  // 查询 & 渲染
  // ═══════════════════════════════════════════════════

  /**
   * 入口：没指定调用方批次时，按「批次窗口（当月 −2 ~ +3，共 6 个）」把每个批次并行拉回来合并
   * （避免一次查出 years 历史导致响应慢）；指定了批次就走原来的单批次查询。
   */
  async function query(pageNum) {
    if (!window.ToolApi) { toast('⚠️ 接口层未加载', 2500); return; }
    state.pageNum = pageNum || state.pageNum || 1;

    // 必须指定调用方系统或提供方系统其中一个
    const callerComp = selValue('f_callerCompNum');
    const providerComp = selValue('f_providerCompNum');
    const vmsg = SubscriptionModel.validateQuery(callerComp, providerComp);
    if (vmsg) { toast(vmsg, 3000); return; }

    const nextCond = buildCond(condGetters);
    state.cond = nextCond;

    const seq = ++state.reqSeq;
    setLoading(true);
    try {
      // 满足以下任一条件 → 后端已有精确过滤，单条查询最快，不走12个月窗口：
      //   · 调用方批次 / 提供方批次
      //   · 提供方应用系统服务编号 / 接口编码 / 服务中文名称
      //   · 调用方应用系统服务编号
      // 以上条件都没有时才走窗口扇出（避免一次查出 years 历史导致响应慢）。
      if (SubscriptionModel.hasSpecificFilter(nextCond)) await runSingleQuery(seq, nextCond);
      else await runWindowQuery(seq, nextCond);
    } catch (e) {
      toast(`⚠️ 查询异常：${errText(e)}，请稍后重试`, 4000);
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
      if (!state.queried) renderEmpty(emptyText('fail', null, '查询失败，请检查网络或稍后重试'));
      return;
    }
    hideQueryFail();
    state.total = first.total;
    state.queried = true;

    // 提供方批次筛选：后端 putBatch 是死字段（见文件头注释），只能拉回后本地过滤。
    // 需要整批拉回（本地过滤必须看到全部行），上限 BULK_MAX 由 fetchAllPages 内部封顶。
    const localBatch = String(cond.putBatch || '').trim();

    // 排序开启且总量不大时，整批拉回来做「全局」排序 + 前端分页，
    // 这样逾期 / 紧急的才是真的排在最前面，而不是只在当前页里排。
    if ((state.sort || localBatch) && first.total > 0 && first.total <= BULK_MAX) {
      let all = null;
      if (first.total <= first.rows.length) {
        all = decorateRows(first.rows);             // 一页就装得下，不用再请求
      } else {
        // 先把第 1 页画出来 —— 整批拉完才渲染的话，几百条也要等十几秒才出第一屏
        state.mode = 'server';
        state.allRows = null;
        state.rows = decorateRows(first.rows);
        state.progress = {
          done: 1,
          total: Math.ceil(Math.min(first.total, BULK_MAX) / BULK_PAGE_SIZE),
          unit: '页',
        };
        render();
        try {
          all = (await SubscriptionModel.fetchAllPages(state.cond, state.total, window.ToolApi.fetchSubscriptionPublishHistory, (done, total) => {
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
      if (all) {
        // 提供方批次本地过滤放在**分支判定之前**：哪怕过滤出 0 条也要如实显示空，
        // 不能因为「过滤后没数据」就退回去展示未过滤的第一页。
        if (localBatch) all = SubscriptionModel.filterByProviderBatch(all, localBatch);
        state.allRows = all;
        state.total = all.length;
        state.mode = 'client';
      } else {
        // 整批拉取失败的退化路径：本地过滤只作用在第一页上（不完整，聊胜于无）
        state.mode = 'server';
        state.allRows = null;
        state.rows = decorateRows(localBatch
          ? SubscriptionModel.filterByProviderBatch(first.rows, localBatch)
          : first.rows);
      }
    } else {
      state.mode = 'server';
      state.allRows = null;
      state.rows = decorateRows(first.rows);
      if (localBatch && first.total > BULK_MAX && !state.sortLimited) {
        state.sortLimited = true;
        toast(`⚠️ 提供方批次筛选由前端本地过滤，结果共 ${num(first.total)} 条超过 ${num(BULK_MAX)} 条上限，`
          + '无法完整过滤，请配合其他条件（调用方系统等）缩小范围', 5000);
      }
      if (state.sort && first.total > CLIENT_SORT_MAX && !state.sortLimited) {
        state.sortLimited = true;
        toast(`⚠️ 结果共 ${num(first.total)} 条，超过 ${CLIENT_SORT_MAX} 条上限，`
          + '只对当前页排序；可缩小筛选范围后查看全局顺序', 4000);
      }
    }

    render();
    if (!state.total) toast('查询完成，没有匹配的订阅关系', 2200);
    if (first.local) toast('⚠️ 该查询暂未开放，无法返回结果', 3000);
  }

  /**
   * 没指定调用方批次：默认只看批次窗口「当月 −2 个月 → 当月 +3 个月」这 6 个批次
   * （如 26年9月 ⇒ 2607批次 ~ 2612批次），把窗口内每个批次并行拉回、合并、
   * 去重后统一前端分页 + 优先级排序。相比一次查出全部历史，响应更快也更聚焦。
   */
  async function runWindowQuery(seq, cond) {
    // 增量渲染：每有一个批次返回就先画一版（onProgress），不再等 6 个批次全部完成。
    const res = await SubscriptionModel.fetchWindowAll(cond, () => seq !== state.reqSeq, (rows, done, total) => {
      if (seq !== state.reqSeq) return;
      hideQueryFail();
      state.queried = true;
      state.allRows = decorateRows(rows);
      state.total = rows.length;
      state.mode = 'client';
      state.rows = [];
      state.progress = { done, total };
      render();
    }, window.ToolApi.fetchSubscriptionPublishHistory);
    if (seq !== state.reqSeq) return;              // 已被更新的查询取代，安静退出
    if (res.aborted) return;
    state.progress = null;

    if (!res.ok) {
      toast(`⚠️ 查询失败：${shortError(res.error)}`, 3500);
      showQueryFail(res.error || '未知错误');
      if (!state.queried) renderEmpty(emptyText('fail', null, '查询失败，请检查网络或稍后重试'));
      return;
    }
    hideQueryFail();
    state.queried = true;

    // 窗口内全量已在本地，统一走 client 模式（排序 / 分页 / 导出 / 统计都复用现成逻辑）
    const all = decorateRows(res.rows);
    state.allRows = all;
    state.total = all.length;
    state.mode = 'client';
    state.rows = [];

    if (res.partial.length) {
      // toast 只负责"立刻看到有失败"；完整批次清单交给常驻条（4 秒看不完一长串批次名，见 U-08）
      toast(`⚠️ 有 ${res.partial.length} 个批次查询失败，结果不完整`, 3000);
      showPartialFail(res.partial);
    }

    render();
    if (!state.total) toast('查询完成，窗口内（6 个批次）没有匹配的订阅关系', 2400);
    if (res.local) toast('⚠️ 该查询暂未开放，无法返回结果', 3000);
  }

  /**
   * 生成批次窗口 label 列表（当月 −2 ~ +3，共 6 个）。
   * 算法（含月份安全的两个约束）在 js/data/batch-data.js 的 batchWindowLabels()，
   * 这里只负责取基准日 —— 必须是业务时区（UTC+8）的今天，
   * 否则机器时区不是 +8 时，每月 1 日前后窗口会整体偏一个月。
   */
  // 批次窗口 label 列表的生成下沉到 SubscriptionModel.batchWindow（实现见该模块）。
  const batchWindow = SubscriptionModel.batchWindow;

  // 窗口扇出 / 单批次整批拉取下沉到 SubscriptionModel.fetchWindowAll / fetchBatchAllPages
  // （接口调用经 fetchHistory 注入、中止判断经 isAborted 注入，见该模块）。

  /** 取某一页（默认按当前每页条数） */
  function fetchPage(p, size) {
    return window.ToolApi.fetchSubscriptionPublishHistory({
      ...state.cond,
      pageNum: p,
      pageSize: size || state.pageSize,
    });
  }

    function totalPages() {
      return window.TableUtils.totalPages(state.total, state.pageSize);
    }

  /**
   * 给一行算出投产优先级（批次 + 基线状态 + 今天）。
   * 规则全在 js/ui/priority.js，写回的下划线字段只在前端用。
   * 具体实现见 SubscriptionModel（decorateRow / decorateRows / redecorateRows / todayBase）。
   */
  const decorateRow = SubscriptionModel.decorateRow;
  const decorateRows = SubscriptionModel.decorateRows;
  const redecorateRows = SubscriptionModel.redecorateRows;

  /** 按当前排序方向排一批行（不动入参数组；实现见 SubscriptionModel.sortRows） */
  const sortRows = (rows) => SubscriptionModel.sortRows(rows, state.sort);

  /**
   * 当前要渲染的行。
   * client 模式：全量已在 state.allRows，这里排序 + 切出当前页（翻页不发请求）
   * server 模式：只有当前页，就地排序
   */
  function pageRows() {
    if (state.mode === 'client' && state.allRows) {
      const sorted = sortRows(state.allRows);
      state.rows = SubscriptionModel.slicePage(sorted, state.pageNum, state.pageSize);
    } else if (state.sort && state.mode === 'server' && state.rows) {
      // 后端分页：本页内按当前优先级方向排（全局排序已在超阈值时提示，仅作用于当前页）。
      // 之前这里只排了 client 模式，server 模式下列头指示器变了但行序没动——排序形同虚设。
      state.rows = sortRows(state.rows);
    }
    return state.rows;
  }

  /** 表头排序指示器：↑ 紧急在前 / ↓ 宽松在前 / ⇅ 默认顺序 */
  function syncSortIndicator() {
    const ind = $('#prioSortInd');
    const th = $('#thPrio');
    if (ind) ind.textContent = state.sort === 'asc' ? '↑' : (state.sort === 'desc' ? '↓' : '⇅');
    if (th) {
      th.classList.toggle('is-sorted', !!state.sort);
      // aria-sort 三态与表头箭头一一对应（清单 B9）：读屏用户只靠视觉箭头听不出排序状态
      th.setAttribute('aria-sort', state.sort === 'asc' ? 'ascending'
        : (state.sort === 'desc' ? 'descending' : 'none'));
    }
  }

  /** 翻页统一入口：client 模式只重渲染，server 模式才请求后端 */
  function gotoPage(n) {
    const page = Math.min(Math.max(1, n), totalPages());
    if (page === state.pageNum && state.mode === 'server' && state.rows.length) return;
    const changed = page !== state.pageNum;
    state.pageNum = page;
    if (state.mode === 'client') render();
    else query(page);
    // 真的换了页才复位纵向滚动（保留横向位置）：表格滚到中下部时翻页，
    // 新页会停在中下部、前几行看不到，见 TableUtils.resetTableScroll
    if (changed && window.TableUtils && window.TableUtils.resetTableScroll) {
      window.TableUtils.resetTableScroll();
    }
  }

  function render() {
    const pages = totalPages();
    if (state.pageNum > pages) state.pageNum = pages;   // 结果变少时别停在不存在的页
    if (state.pageNum < 1) state.pageNum = 1;
    renderTable();
    renderPagination();
    renderCount();
  }

  // colspan 23 = 订阅页表格列数（22 个数据列 + 操作列）。
  // 空状态、分页条显隐、宽表空态浮层统一走 TableUtils ——
  // 「浮层上沿对齐表头下沿」的逻辑也在那边，别在本页另写一份。
  function renderEmpty(text) {
    window.TableUtils.renderEmpty(text, 23);
  }

  function renderCount() {
    const base = state.queried ? `共 ${num(state.total)} 条 · 本页 ${state.rows.length} 条` : '';
    // 取数还没完时告诉用户进度：先出来的这批已经是可用结果，不是「卡住了」
    $('#resultCount').textContent = state.progress
      ? `${base} · 加载中 ${state.progress.done}/${state.progress.total}${state.progress.unit || '批次'}`
      : base;
    // 逾期提示只统计当前页（原先的「统计全部逾期」要按页拉完整个结果集，代价太大，已移除）
    const overdue = SubscriptionModel.overdueCount(state.rows);
    const el = $('#overdueCount');
    if (el) el.textContent = overdue ? `⚠️ 本页逾期 ${overdue} 条` : '';
  }

  /**
   * 把接口层的错误串压成一句话。
   * tool-api 抛出来的是 `HTTP 404 {"code":404,"msg":"...","key":"..."}` 这种，
   * 整段塞进提示条会把真正有用的说明挤没，所以优先抽 msg 字段。
   */
  // shortError / showQueryFail / hideQueryFail 的统一实现见 js/ui/query-feedback.js。
  const shortError = (e) => QF().shortError(e);
  /** 失败时表格保留上一次结果（方便对照 / 重试），常驻条文案必须明说，否则像「点了没反应」 */
  const showQueryFail = (reason) => QF().showQueryFail(reason, state.queried);
  const hideQueryFail = () => QF().hideFail();

  /**
   * 窗口查询里**部分批次**失败：结果不完整，必须常驻说明是哪几个批次。
   * toast 只有几秒，一长串批次名根本看不完（评估报告 U-08），
   * 所以清单放常驻条，toast 只负责"立刻看到有失败"。
   */
  function showPartialFail(batches) {
    if (!batches || !batches.length) return;
    QF().showFailText(`⚠️ 窗口内有 ${batches.length} 个批次查询失败（${batches.join('、')}），当前结果不完整`);
  }

  // statusTag / reviewStatusTag / prioCell 的 HTML 生成已下沉到 SubscriptionView
  // （映射与「剩余 ≤3 天加粗」判定数据在 SubscriptionModel 的 STATUS_CLASS / REVIEW_STATUS_MAP / prioParts）。

  function renderTable() {
    // 注意顺序：必须先 pageRows()（client 模式下它会按排序切出当前页），
    // 再做空判断 —— 否则会用上一轮的 state.rows 提前返回。
    const rows = pageRows();
    if (!rows.length) {
      renderEmpty(emptyText('none', '订阅关系', '没有匹配的订阅关系'));
      return;
    }
    // 有数据了：收起宽表空态浮层，否则它会盖在数据行上
    window.TableUtils.hideEmptyOverlay();
    V.renderTable($('#resultBody'), rows, {
      onJump: (row) => jumpToServiceSearch(row),
      onCopy: (text) => copyToClipboard(text),
    });
  }

  function renderPagination() {
    V.renderPagination(
      {
        bar: $('#pagination'), pageTotal: $('#pageTotal'), pageNumbers: $('#pageNumbers'),
        btnPrev: $('#btnPrev'), btnNext: $('#btnNext'), pageJumpInput: $('#pageJumpInput'),
      },
      {
        pageNum: state.pageNum, total: state.total, pages: totalPages(),
        queried: state.queried, onGoto: gotoPage,
      }
    );
  }

  // ═══════════════════════════════════════════════════
  // 结果行「查 看」→ 跳转 ITAMP 服务搜索
  // ═══════════════════════════════════════════════════

  /**
   * 结果行「查 看」：新窗口打开 ITAMP 真实系统的「服务搜索查看」页
   * （/asserInstruments/serviceSearchView）。
   *
   * **不传任何 query 参数**：目标页不认这些按表单字段名拼出来的条件
   * （compNum / sysServeNoList / prodBatch… 过去既没预填也没触发查询），
   * 只做干净跳转，筛选由用户在目标页自行完成。
   * 参数拼接能力仍留在 js/core/app-navigator.js（buildUrl / openServiceSearch(params)），
   * 将来确认目标页认哪些参数，在这里传进去即可。
   */
  function jumpToServiceSearch(row) {
    if (!row) return;
    if (!window.AppNavigator || typeof window.AppNavigator.openServiceSearch !== 'function') {
      toast('⚠️ 跳转模块未加载，无法打开 ITAMP 服务搜索', 2600);
      return;
    }
    // 目标页无法识别这些参数，直接打开即可
    const url = window.AppNavigator.openServiceSearch();
    debugLog('[subscription] 跳转 ITAMP 服务搜索:', url);
    toast('🔗 已在新窗口打开 ITAMP 服务搜索', 2600);
  }

  // ═══════════════════════════════════════════════════
  // 整批取数（供单批次查询做全局优先级排序）
  // ═══════════════════════════════════════════════════

  /**
   * 按页把当前查询结果整批拉回来（服务端分页），顺手算好优先级。
   * 并发拉（PAGE_CONCURRENCY 个 worker），按页码顺序拼接 —— 原来是串行 for，
   * BULK_PAGE_SIZE=50 时 5000 条要 100 次串行往返，明显卡顿。
   * 实现见 SubscriptionModel.fetchAllPages（接口调用经 fetchHistory 注入）。
   */

  // ═══════════════════════════════════════════════════
  // 下拉数据源
  // ═══════════════════════════════════════════════════

  /** 批次：抓包里传的是 "2611批次" 这种 label，所以直接用 label 当 value（实现见 SubscriptionModel.toBatchOptions） */
  const toBatchOptions = SubscriptionModel.toBatchOptions;

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
      // 2026-09-21 补：失败要让用户在页面上看见。原先只 console.warn，
      // 下拉静默为空、面板写「没有匹配项」，用户分不清「业务上没数据」和「接口挂了」。
      toast('⚠️ 调用方服务编号选项加载失败，可重新选择或稍后再试', 4000, 'warn');
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
    // toOpts 遇到「请求失败」要记下来：这种空是**故障**，不是「本来就没数据」。
    // 两者在界面上都表现为下拉为空，不给提示的话用户会一直去调筛选条件。
    const failed = [];
    const toOpts = (res, label) => {
      if (!res) { failed.push(label); return []; }
      if (!res.ok) { failed.push(label); console.warn(`[subscription] ${label}加载失败:`, res.error); return []; }
      if (!Array.isArray(res.list)) return [];
      return res.list
        .map((it) => (typeof it === 'string'
          ? { value: it, label: it }
          : { value: String(it.value ?? it.label ?? ''), label: String(it.label ?? it.value ?? '') }))
        .filter((o) => o.value);
    };
    if (multiSelects.sysServeNo) multiSelects.sysServeNo.setOptions(toOpts(b, '提供方服务编号'));
    if (multiSelects.serverCoding) multiSelects.serverCoding.setOptions(toOpts(c, '接口编码'));
    if (failed.length) toast(`⚠️ ${failed.join('、')}选项加载失败，可重新选择或稍后再试`, 4000, 'warn');
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

  // 批次时间的读写 / 弹窗全部在 js/page/subscription-batch-times.js（见该文件头说明）。
  // 这里只留「把配置喂给优先级 + 重算重绘」，因为要碰本页的 state / decorateRow / render。
  function refreshPriority() {
    window.SubscriptionBatchTimes.applyToPriority();
    if (Array.isArray(state.allRows)) redecorateRows(state.allRows);
    else if (Array.isArray(state.rows)) redecorateRows(state.rows);
    if (state.queried) render();
  }

  // 批次时间弹窗的接线。**不在加载时一次性判断**：若 subscription-batch-times.js 排到
  // 本文件之后，原来那个 `if (window.SubscriptionBatchTimes)` 会静默跳过 init，
  // 弹窗从此「点了没反应」。改成幂等函数：加载时试一次，boot() 时再试一次
  //（boot 在 DOMContentLoaded 跑，那时脚本一定齐了）。
  let batchTimesInited = false;
  function initBatchTimes() {
    if (batchTimesInited || !window.SubscriptionBatchTimes) return;
    batchTimesInited = true;
    // 弹窗的行 = 批次字典里落在批次窗口（当月 −2 ~ +3）内的批次（月度 + 独立，见 subscription-batch-times.js）
    window.SubscriptionBatchTimes.init({ toast, setLoading, batchWindow, refreshPriority });
  }
  initBatchTimes();

  // 薄封装：bindEvents / boot 里的调用点保持不变
  const openBatchTimeDialog = () => window.SubscriptionBatchTimes.open();
  const closeBatchTimeDialog = () => window.SubscriptionBatchTimes.close();
  const saveBatchTimes = () => window.SubscriptionBatchTimes.save();
  const loadBatchTimes = () => window.SubscriptionBatchTimes.load();

  // ═══════════════════════════════════════════════════
  // 初始化
  // ═══════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════
  // 常用查询（保存到首页 / 从首页一键直达回填）
  // 存储层 window.SavedQuery 已在 saved-query.js 实现，本页只做「收集条件 → 存」和
  // 「启动读 ?saved= → 回填 → 自动查询」的胶水。所有 window.* 都在函数体内取
  // （项目铁律 1：顶层捕获会随脚本顺序变化静默降级成空实现）。
  // ═══════════════════════════════════════════════════

  // 单选下拉 / 文本 / 多选三类控件的 key 清单（key 即表单元素 id，回填时按 id 找实例/元素）
  const SAVED_SELECT_KEYS = ['f_callerCompNum', 'f_callerBatch', 'f_providerBatch',
    'f_providerCompNum', 'f_deptId', 'f_prodDeptId', 'f_status', 'f_isSendOutside'];
  const SAVED_TEXT_KEYS = ['f_providerServiceNameAndId', 'f_subscriberName'];
  const SAVED_MULTI_KEYS = ['msel_sysServeNo', 'msel_serverCoding', 'msel_prodSysServeNo'];

  // 字段 id → 中文名（仅用于生成可读摘要）；顺序决定摘要里字段先后
  const SAVED_LABELS = {
    f_callerCompNum: '调用方系统', f_callerBatch: '调用方批次', f_providerCompNum: '提供方系统',
    f_providerBatch: '提供方批次', f_providerServiceNameAndId: '提供方服务名称', f_deptId: '提供方部门',
    f_prodDeptId: '调用方部门', f_subscriberName: '订阅人', f_status: '基线状态',
    f_isSendOutside: '发往行外', msel_sysServeNo: '提供方服务编号', msel_serverCoding: '接口编码',
    msel_prodSysServeNo: '调用方服务编号',
  };
  const SAVED_ORDER = ['f_callerCompNum', 'f_callerBatch', 'f_providerCompNum', 'f_providerBatch',
    'f_providerServiceNameAndId', 'f_deptId', 'f_prodDeptId', 'f_subscriberName',
    'f_status', 'f_isSendOutside', 'msel_sysServeNo', 'msel_serverCoding', 'msel_prodSysServeNo'];

  // 收集当前筛选条件（只收有值的，空值不存）。单选下拉走实例 getValue，
  // 文本走原生 value，多选走实例 getValues（返回 string[]），与 SavedQuery 的字段契约一致。
  function collectSavedFields() {
    const fields = {};
    SAVED_SELECT_KEYS.forEach((key) => {
      if (selects[key]) { const v = String(selects[key].getValue() || '').trim(); if (v) fields[key] = v; }
    });
    SAVED_TEXT_KEYS.forEach((key) => {
      const el = document.getElementById(key);
      if (el && String(el.value || '').trim() !== '') fields[key] = String(el.value).trim();
    });
    SAVED_MULTI_KEYS.forEach((key) => {
      const inst = multiSelects[key];
      const arr = inst && inst.getValues ? inst.getValues() : [];
      if (arr && arr.length) fields[key] = arr;
    });
    return fields;
  }

  /**
   * 字段 id → **人类可读文本**：下拉取 label、多选取 labels。
   * 摘要是给首页卡片上的人看的，所以写「2608批次 / BOCNETC-O-MAPSN」而不是内部编码；
   * 只有拿不到 label（选项里没有该项）时才回落到编号本身。
   */
  /**
   * 长编码截断的短别名：把「E00301-互联网金融服务平台-BOCNET-G-IFS」变成「BOCNET-G-IFS」
   *（2026-09-22 用户要求「前面的编号和中文都不要」）。实现在 SavedQuery.shortCode，
   * 取不到就原样返回 —— 显示用的东西宁可长一点，也不能变成空。
   */
  function sc(text) {
    const S = window.SavedQuery;
    return (S && typeof S.shortCode === 'function') ? S.shortCode(text) : String(text == null ? '' : text);
  }

  function collectSavedLabels(fields) {
    const labels = {};
    SAVED_SELECT_KEYS.forEach((key) => {
      if (!fields[key]) return;
      const t = (selects[key] && typeof selects[key].getLabel === 'function')
        ? sc(String(selects[key].getLabel() || '').trim()) : '';
      if (t) labels[key] = t;
    });
    SAVED_MULTI_KEYS.forEach((key) => {
      if (!fields[key]) return;
      const arr = (multiSelects[key] && typeof multiSelects[key].getLabels === 'function')
        ? multiSelects[key].getLabels().map((x) => sc(String(x))).filter(Boolean) : [];
      if (arr.length) labels[key] = arr.join('、');
    });
    return labels;
  }

  // fields + labels → 一句人能读的摘要，例：「提供方系统：BOCNET-G-IFS · 调用方批次：2608批次」
  function buildSavedSummary(fields, labels) {
    const L = labels || {};
    return SAVED_ORDER
      .filter((id) => fields[id])
      .map((id) => {
        const raw = Array.isArray(fields[id]) ? fields[id].join('、') : fields[id];
        return `${SAVED_LABELS[id]}：${L[id] || raw}`;
      })
      .join(' · ');
  }

  /**
   * 旧记录（2026-09-18 前保存）的摘要写的是编号。从首页打开时字典已加载，
   * 这里把 labels + 摘要重算回写一次，用户不必手动重新保存。
   */
  function upgradeSavedSummary(item, fields) {
    const SQ = window.SavedQuery;
    if (!SQ || !item || !fields) return;
    if ((item.v || 1) >= 2 && item.labels && Object.keys(item.labels).length) return;
    const labels = collectSavedLabels(fields);
    const summary = buildSavedSummary(fields, labels);
    if (!summary) return;
    SQ.update(item.id, { labels, summary, v: SQ.SCHEMA_VERSION || 2 });
  }

  // 点「⭐ 保存到首页」：收集 → 命名 → 存 → toast
  async function onSaveQuery() {
    const SQ = window.SavedQuery;
    if (!SQ) { toast('⚠️ 存储模块未加载', 2500); return; }
    const fields = collectSavedFields();
    if (!Object.keys(fields).length) {
      toast('⚠️ 请先填写至少一个筛选条件', 2500);
      return;
    }
    const summary = buildSavedSummary(fields, collectSavedLabels(fields));
    // 优先用统一弹窗 DialogUtils.promptText；缺失再退回原生 prompt
    let name = null;
    if (window.DialogUtils && typeof window.DialogUtils.promptText === 'function') {
      name = await window.DialogUtils.promptText({
        title: '保存到首页',
        label: '查询名称',
        placeholder: '给这组筛选条件起个名字',
        value: summary ? summary.slice(0, 30) : '',
        message: summary ? `将保存：${summary}` : '',
      });
    } else {
      name = window.prompt('给这组筛选条件起个名字（将保存到首页）：', summary ? summary.slice(0, 30) : '');
    }
    if (name == null) return;                 // 用户取消
    name = String(name).trim();
    if (!name) { toast('⚠️ 名称不能为空', 2000); return; }
    // 2026-09-20 架构改版：save 是 async 的（服务端优先）。这里必须 await——
    // 否则读到的是 Promise，res.ok 恒为 undefined → 弹「保存失败」但东西其实存进去了。
    const res = await SQ.save({
      page: 'subscription', name, fields, summary,
      labels: collectSavedLabels(fields),
      autoName: summary ? summary.slice(0, 30) : '',   // 与弹窗预填的一致，部门榜用它
    });
    if (!res.ok) { toast('⚠️ 保存失败：' + (res.error || '未知错误'), 3000); return; }
    toast('已保存到首页' + (res.localOnly ? '（仅本机，连上共享库后会自动补上去）' : '')
      + (typeof SQ.syncSuffix === 'function' ? SQ.syncSuffix() : '')
      + (typeof SQ.ownerSuffix === 'function' ? SQ.ownerSuffix(res) : ''), 3200);
  }

  // 启动恢复：仅当 URL 带 ?saved=<id> 时回填并自动查询。
  // 必须挂在 loadDicts() 之后：单选下拉/多选的选项要等接口返回建好，否则 setValue 选中的项
  // 不在选项里会静默失效（searchable-select 找不到该 value 的 opt、multi-select 同理）。
  // 另外提供方/调用方系统的多选选项依赖对应「系统」选中后联动拉取，所以先回填系统、等联动
  // 接口返回再把多选 set 进去，顺序不能反。
  async function restoreSavedQuery() {
    const SQ = window.SavedQuery;
    if (!SQ) return;
    const id = new URLSearchParams(location.search).get('saved');
    if (!id) return;
    // 2026-09-21：getAsync —— 镜像（只含「我的」）没命中就去服务端按 id 捞。
    // 部门常用查询的卡片多半是**同事**存的，不在本机镜像里：这里如果用同步
    // SQ.get(id) 会静默拿不到 → 不回填 → 页面照常跑默认查询，看起来就是
    // 「点了部门卡却没填条件就查询了」（有概率 = 点到自己的查询则成功）。
    const item = await SQ.getAsync(id);
    if (!item || !item.fields) return;
    // 「我用了这份查询」上报（部门高频的时间衰减排序要用）。
    // 放在落地页而不是首页点卡片时：那一刻 <a> 在跳转，在途 fetch 会被中断。失败不影响回填。
    if (typeof SQ.markUsed === 'function') Promise.resolve(SQ.markUsed(id)).catch(() => {});
    const f = item.fields;

    // 1) 无联动依赖的单选下拉 + 文本输入先回填
    const soloSelects = ['f_callerBatch', 'f_providerBatch', 'f_deptId', 'f_prodDeptId', 'f_status', 'f_isSendOutside'];
    soloSelects.forEach((key) => {
      if (f[key] != null && selects[key]) selects[key].setValue(String(f[key]));
    });
    SAVED_TEXT_KEYS.forEach((key) => {
      if (f[key] != null) { const el = document.getElementById(key); if (el) el.value = String(f[key]); }
    });

    // 2) 提供方系统：先回填并触发联动（拉提供方服务编号/接口编码选项），再回填其多选
    if (f['f_providerCompNum'] != null && selects.f_providerCompNum) {
      selects.f_providerCompNum.setValue(String(f['f_providerCompNum']));
      await loadProviderServeNos(String(f['f_providerCompNum']));
    }
    if (f['msel_sysServeNo'] != null && multiSelects.sysServeNo && Array.isArray(f['msel_sysServeNo'])) {
      multiSelects.sysServeNo.setValue(f['msel_sysServeNo']);
    }
    if (f['msel_serverCoding'] != null && multiSelects.serverCoding && Array.isArray(f['msel_serverCoding'])) {
      multiSelects.serverCoding.setValue(f['msel_serverCoding']);
    }

    // 3) 调用方系统：先回填并触发联动（拉调用方服务编号选项），再回填其多选
    if (f['f_callerCompNum'] != null && selects.f_callerCompNum) {
      selects.f_callerCompNum.setValue(String(f['f_callerCompNum']));
      await loadCallerServeNos(String(f['f_callerCompNum']));
    }
    if (f['msel_prodSysServeNo'] != null && multiSelects.prodSysServeNo && Array.isArray(f['msel_prodSysServeNo'])) {
      multiSelects.prodSysServeNo.setValue(f['msel_prodSysServeNo']);
    }

    syncQuickButtons();   // 让「按调用方系统筛选」快捷按钮高亮与回填值一致
    // 旧记录（摘要里是编号）趁字典已加载重算回写一次，点一次卡片就自动修好
    upgradeSavedSummary(item, f);
    toast(`已载入常用查询：${item.name}`, 2000);
    // 回填完成后复用页面查询入口，自动执行一次查询
    await query(1);
  }

  function bindEvents() {
    $('#btnQuery').addEventListener('click', () => query(1));
    $('#btnReset').addEventListener('click', resetForm);
    $('#btnRefresh').addEventListener('click', () => query(state.pageNum));
    // 常用查询：把当前筛选条件保存到首页
    const saveBtn = $('#btnSaveQuery');
    if (saveBtn) saveBtn.addEventListener('click', onSaveQuery);

    // 优先级列头：点击循环 紧急在前 → 宽松在前 → 恢复默认顺序。
    // 排序入口是表头里的真 <button id="btnSortPrio">（清单 B9）——原来只在 th 上绑 click，
    // 「鼠标专属」，键盘用户完全改不了排序；换成 button 后 Tab 能到、Enter/空格原生可触发，
    // 也就不需要自己写 keydown。aria-sort 同步见 syncSortIndicator。
    const cyclePrioSort = () => {
      state.sort = state.sort === 'asc' ? 'desc' : (state.sort === 'desc' ? null : 'asc');
      syncSortIndicator();
      state.pageNum = 1;     // 换了排序就从头看

      // 全量已在手上（client 模式）时换个方向只是重排，不用再打扰后端；
      // 切到「默认顺序」或当前还没整批拉过，就重新查一次。
      if (state.sort && state.mode === 'client' && state.allRows) {
        render();
        toast(state.sort === 'asc'
          ? '已按优先级排序：逾期 / 紧急的在最上面'
          : '已按优先级倒序：宽松的在最上面', 2200);
        return;
      }
      query(1);
      if (state.sort === null) toast('已恢复默认顺序', 2200);
    };
    $('#btnSortPrio').addEventListener('click', cyclePrioSort);
    const retryBtn = $('#btnRetryQuery');
    if (retryBtn) retryBtn.addEventListener('click', () => query(state.pageNum));

    // 筛选区里按回车直接查询（与首页一致）。
    // 自带键盘行为的控件先排除：日期选择器（Enter = 展开）、可搜索下拉 / 多选
    // （Enter = 展开、选中）。它们只 preventDefault 不 stopPropagation，
    // 不排除就会在展开面板的同时顺带查一次。
    $('#filterBody').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
      const el = e.target;
      if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'SELECT')) return;
      if (el.type === 'checkbox' || el.type === 'number' || el.type === 'radio') return;
      if (el.closest('.dp-wrapper, .searchable-select, .msel')) return;
      e.preventDefault();
      query(1);
    });

    // 筛选卡片折叠
    $('#filterToggle').addEventListener('click', () => {
      const collapsed = $('#filterCard').classList.toggle('collapsed');
      $('#filterToggle').setAttribute('aria-expanded', String(!collapsed));
    });

    // （2026-09-22 删除）原来这里有「更多筛选项」的折叠开关：用户拍板去掉折叠、
    // 直接把 #advancedFields 平铺出来，所以 `#btnToggleAdvanced` 元素与这段绑定一并删掉。
    // 注意别再顺手把它加回来 —— HTML 里没有那个按钮了，addEventListener 会直接抛。

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

  async function boot() {
    bindEvents();
    syncSortIndicator();   // 默认就是「紧急在前」，把箭头摆对

    // 22 个数据列 + 操作列；表头挂拖拽把手：拖右边框改列宽，双击恢复默认，宽度记在本地。
    // 左固定区那 3 列不给把手 —— 它们的 left 偏移写死在 subscription.html，拖了会和 sticky 对不上。
    if (typeof window.createTableResizer === 'function') {
      window.createTableResizer(document.querySelector('.subq-table'), {
        minWidth: 60,
        skipFirst: false,                    // 第一列（优先级）已在 skipIndices 里，不需要额外跳过
        skipIndices: [0, 1, 2],                    // 优先级 / 基线状态 / 审核流程状态（服务中文名、接口编码不再固定）
        // v4：列宽按真实数据重排（3850 → 2926px），旧存档宽度与新列序/新语义对不上，换 key 防错位
        storageKey: 'itamp.subq.colWidths.v4',
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
    // 等下拉/多选选项就绪后再恢复常用查询：选项没建好时 setValue 会静默失效
    await loadDicts();
    await restoreSavedQuery();   // 挂在 loadDicts 之后，保证选项齐了再回填
    initBatchTimes();            // 兜底再试一次（脚本顺序被打乱时，加载期那次会落空）
    loadBatchTimes();            // 批次时间本地配置（弹窗打开时用它预填）

    // 首屏就是空态：显示宽表空态浮层并对齐到表头下沿。
    // （静态 HTML 里浮层是 hidden 的 —— 页面没加载完表头高度还测不准，先不显示，
    //   免得浮层按 top:0 盖住表头。）
    if (window.TableUtils && window.TableUtils.syncEmptyOverlay) window.TableUtils.syncEmptyOverlay();

    // Token 管理浮窗：三个查询页都要能改 token（2026-09-21 补，与发布页同一支）
    if (window.TokenManager && typeof window.TokenManager.init === 'function') window.TokenManager.init();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
