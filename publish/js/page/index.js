/* ============================================================
  服务发布数据查询 — 页面装配层
  ------------------------------------------------------------
  本文件只干「页面」这一层的事：

    · 筛选控件的收集 / 实例管理（searchable-select、日期选择器）
    · 事件绑定（查询 / 重置 / 翻页 / 订阅筛选 / 回车 / 表格内委托）
    · 初始化接线（订阅 UI、字典下拉、网络状态）

  其余三层已各自成文件，本文件只做装配与 DOM 收集：
    · 纯业务逻辑   → publish-model.js  (window.PublishModel)
    · 渲染 / DOM   → publish-view.js   (window.PublishView)
    · 取数编排     → publish-query.js  (window.PublishQuery)

  跨模块共享的可变状态只有一处：下面的 state 对象（view / query 都直接读写它）。
============================================================ */

(() => {
  'use strict';

  // ── 常量 ────────────────────────────────────────────
  // BASE_URL / TOKEN 已统一收敛到 api-client.js（window.API），所有请求走 API.call
  // 运行时服务统一由 bootstrap.js 做完整性检查；这里继续兼容现有全局服务 API。
  const SUBSCRIBE_STORAGE_KEY = 'subscribed_services';

  // 调试日志：公共实现见 js/core/debug.js（默认不输出，?debug=1 或
  // window.__APP_DEBUG__ = true 才打印）。调用时才取，避免加载顺序敏感。
  const debugLog = (...a) => (window.debugLog || (() => {}))(...a);

  // ── DOM 引用 ────────────────────────────────────────
  // 只留本文件自己要用的事件源；渲染用的元素由 publish-view.js 按 id 自取。
  const $ = (sel) => document.querySelector(sel);

  const btnQuery       = $('#btnQuery');
  const btnReset       = $('#btnReset');
  const filterToggle   = $('#filterToggle');
  const filterCard     = $('#filterCard');
  const resultBody     = $('#resultBody');
  const btnPrev        = $('#btnPrev');
  const btnNext        = $('#btnNext');
  const btnFirst       = $('#btnFirst');
  const btnLast        = $('#btnLast');
  const pageNumbers    = $('#pageNumbers');
  const pageJump       = $('#pageJump');
  const btnExportCsv   = $('#btnExportCsv');
  const btnRetryFailed = $('#btnRetryFailed');

  // ── 页面可变状态（渲染层 / 查询编排层共用这一个对象）──
  const state = {
    currentFilter: 'all',  // 'all' | 'subscribed' | 'unsubscribed'
    displayedRows: [],     // 当前分页原始数据
    filteredRows: [],      // 经过订阅筛选后的数据
    pageNum: 1,
    pageSize: 10,          // 每页 10 条
    totalItems: 0,
    rawRows: [],
  };

  // ── 筛选字段定义（表单 ID → 接口字段名） ────────────
  //
  // 字段名来自 trace.har 里 getPublishDataList 的真实请求体，后端只认这 17 个：
  //   compNum / batch / serverCodingList / serviceName / callerComponent /
  //   subscriberStatus / isChecked / pageSize / pageNum / isSendOutsideSystem /
  //   principal / principalName / serviceStatus / sysServeNoList / sysServeNo /
  //   deptId / implementationUnit
  // 之前填的是 provideSystemNumber / prodBatch / offerServerState / deptName 等
  // 响应体字段名，后端一律忽略，所以筛选全部失效。定义见 PublishModel.FIELDS。
  //
  // 本文件只做「控件 → 值」的读取，条件怎么生效由 mode 决定（说明见 publish-model.js）。

  // ── 批次下拉搜索组件实例 ────────────────────────────
  let batchSelectInstance = null;

  // 暴露给外部模块（如订阅弹窗）读取首页已选批次。
  // 项目铁律禁止新增 window._私有桥：统一登记到 window.AppServices（bootstrap.js 里建的注册表）。
  const prodBatchInstance = { _inst: null, get value() { return batchSelectInstance ? batchSelectInstance.getValue() : ''; } };
  Object.defineProperty(prodBatchInstance, 'instance', {
    get() { return batchSelectInstance; },
    set(v) { batchSelectInstance = v; prodBatchInstance._inst = v; },
  });
  window.AppServices = window.AppServices || {};
  window.AppServices.prodBatchInstance = prodBatchInstance;

  /**
   * 批次选项的跨模块读写：统一走 AppServices。
   * 批次列表加载成功时才有，缺失时解析不出 label（见 resolveBatchLabel）。
   */
  function setBatchOptions(opts) {
    const list = opts || [];
    window.AppServices = window.AppServices || {};
    window.AppServices.batchOptions = list;
    return list;
  }
  function getBatchOptions() {
    const as = window.AppServices;
    return (as && as.batchOptions) || [];
  }

  // ── 提供方系统下拉搜索组件实例 ──────────────────────
  let providerSelectInstance = null;

  // ── 部门下拉搜索组件实例 ────────────────────────────
  let deptSelectInstance = null;
  let deptOptions = [];       // 部门选项缓存 [{label, value}]

  // ── CHECKOUT/IN 状态下拉搜索组件实例（禁用） ────────
  let checkoutSelectInstance = null;

  // ── 变更时间日期选择器实例 ────────────────────────
  let changeTimeInstance = null;

  // 所有包过的下拉实例：重置时要逐个 clear()，
  // 只改原生 select 的 value 不会同步组件内部的显示文本
  const selectInstances = [];
  function makeSelect(el, options, opts) {
    if (typeof window.createSearchableSelect !== 'function') return null;
    const inst = window.createSearchableSelect(el, options, opts);
    selectInstances.push(inst);
    // 如果是批次下拉，同步更新全局引用
    if (el.id === 'f_prodBatch') {
      batchSelectInstance = inst;
      prodBatchInstance._inst = inst;
    }
    return inst;
  }

  // ── 纯逻辑 / 视图 / 编排 / 响应解析（均先于本文件加载）──
  // 这几处**有意保留加载期捕获**：本文件是三页里最后一个 <script>，命名空间必然就位；
  // 若被挪到前面，下面 FIELDS 立即解引用会当场抛 TypeError —— 属「有声失败」，
  // 不是静默降级（静默降级的那几处已改成调用时取值）。再配合 bootstrap.js 的 PRESETS 校验。
  const PublishModel    = window.PublishModel;
  const PublishView     = window.PublishView;
  const PublishQuery    = window.PublishQuery;
  const FIELDS          = PublishModel.FIELDS;
  // 旧版本在此额外捕获了一份 PublishResponse，实际全文件已无引用（响应解析已下沉到
  // publish-query.js / publish-response.js），直接删掉，少一处加载期捕获。

  // ── 工具函数 ────────────────────────────────────────
  // 加载遮罩的统一实现见 js/ui/query-feedback.js（三页共用），本地保留原名。
  // 调用时才取 window.*：顶层捕获会让本页「顺序敏感」——依赖模块一旦排到本文件之后，
  // 加载遮罩与新提示都会静默退化成空实现（回归见 tests/module-order.test.js）。
  const QF = () => window.QueryFeedback || { setLoading() {} };
  function showLoading()  { QF().setLoading(true); }
  function hideLoading()  { QF().setLoading(false); }

  // Toast 公共实现见 js/ui/toast.js（三页共用；本地保留 showToast 这个名字）
  const showToast = (...a) => (window.toast || (() => {}))(...a);

  // 暴露给其他模块使用（统一登记到 AppServices）
  window.AppServices = window.AppServices || {};
  window.AppServices.toast = showToast;

  /** 检查服务是否已订阅 */
  function checkSubscribeStatus(serverCoding) {
    if (!window.SubscribeManager || !serverCoding) return 'unknown';
    return window.SubscribeManager.isSubscribed(serverCoding) ? 'subscribed' : 'unsubscribed';
  }

  /** 兜底：用查询结果里的 deptId + deptName 填充部门选项 */
  function fillDeptListFromRows(rows) {
    if (deptOptions.length) return;          // 已有 API 数据则跳过
    if (!Array.isArray(rows) || !rows.length) return;

    const map = new Map();
    rows.forEach((r) => {
      if (r.deptId && r.deptName && !map.has(r.deptId)) {
        map.set(r.deptId, { key: r.deptId, value: r.deptName });
      }
    });
    if (!map.size) return;

    deptOptions = PublishModel.deptsToOptions([...map.values()]);
    if (deptSelectInstance) {
      deptSelectInstance.updateOptions(deptOptions);
    } else if (typeof window.createSearchableSelect === 'function') {
      // 部门接口挂了但查询有结果：这时再补建下拉，别让用户只能手打
      deptSelectInstance = makeSelect($('#f_deptName'), deptOptions);
    }
  }

  /** 从部门 searchable-select 获取选中的 deptId */
  function getDeptValue() {
    if (deptSelectInstance) {
      return deptSelectInstance.getValue() || '';
    }
    // 降级：直接从 input 取
    const el = $('#f_deptName');
    return el ? el.value.trim() : '';
  }

  /**
   * 部门条件怎么生效，取决于下拉是否建起来了：
   *   · 建起来了 → value 就是 deptId，可以精确发给后端
   *   · 没建起来（接口挂了，用户手输的是中文名）→ 不能把中文名当 deptId 发给后端，
   *     改为前端按 deptName 模糊过滤
   * 判定逻辑见 PublishModel.resolveDeptCondition。
   */
  function getDeptCondition() {
    if (deptSelectInstance) {
      const id = deptSelectInstance.getValue() || '';
      const free = typeof deptSelectInstance.getFreeText === 'function'
        ? (deptSelectInstance.getFreeText() || '').trim()
        : '';
      return PublishModel.resolveDeptCondition({ deptId: id, freeText: free, hasInstance: true });
    }
    const el = $('#f_deptName');
    const txt = el ? el.value.trim() : '';
    return PublishModel.resolveDeptCondition({ deptId: txt, hasInstance: false });
  }

  /**
   * 批次下拉的 value 是 "2609pc" 这类代码，而请求体与行数据用的都是 label（"2609批次"）。
   * 批次选项（AppServices.batchOptions）只在批次列表加载成功时才有，缺失时解析不出 label。
   *
   * 原实现在解析失败时直接 `if (!val) return`，后果是：批次条件既没发给后端、
   * 也没进入前端兜底过滤，而必填校验用的是 getValue() 照样通过 ——
   * 用户以为查的是某批次，实际拿到的是全批次数据。
   * 所以这里把「解析失败」显式暴露出来（ok:false），由 doQuery 阻断查询。
   * 判定逻辑见 PublishModel.resolveBatchLabel。
   */
  function resolveBatchLabel() {
    const val = batchSelectInstance ? (batchSelectInstance.getValue() || '') : '';
    return PublishModel.resolveBatchLabel(val, getBatchOptions());
  }

  /** 提供方系统当前值（可能是原生 input 或 searchable-select） */
  function getProviderValue() {
    return providerSelectInstance
      ? providerSelectInstance.getValue()
      : ($('#f_provideSystemNumber')?.value || '').trim();
  }

  /** 批次当前值（可能是原生 select 或 searchable-select） */
  function getBatchValue() {
    return batchSelectInstance
      ? batchSelectInstance.getValue()
      : ($('#f_prodBatch')?.value || '').trim();
  }

  // 必填校验失败时的聚焦：只点击「查询」时主动聚焦；输入框按回车不抢焦点
  function focusProvider() {
    const el = providerSelectInstance
      ? document.querySelector('#f_provideSystemNumber + div .searchable-select-input')
      : $('#f_provideSystemNumber');
    if (el) el.focus();
  }
  function focusBatch() {
    if (!batchSelectInstance) return;
    const el = document.querySelector('#f_prodBatch + div .searchable-select-input');
    if (el) el.focus();
  }

  // ── 收集要发给后端的请求体 ──────────────────────────
  //
  // ⚠️ 必须全字段发送，空值用 "" / [] 占位，一个都不能省。
  // 抓包里后端收到的就是完整的 17 个字段。早期版本「只发非空值」有两个后果：
  //   1. 本地代理的缓存 key = sha1(method + path + query + body)，
  //      body 字段个数不同 → 算出来的 key 也不同 → 缓存永远命中不了，
  //      离线模式直接 404，前端还把 404 显示成「接口地址不存在」（误导）。
  //   2. 与后端真实契约不一致，本身就是隐患。
  //
  // 其中 subscriberStatus / isChecked / principal / sysServeNoList 目前没有
  // 对应的 UI 控件，固定发空值，保持结构完整即可。
  // API_BODY_DEFAULTS 见 publish-model.js。
  function collectApiBody() {
    const body = { ...PublishModel.API_BODY_DEFAULTS };

    FIELDS.forEach(({ id, key, mode, array }) => {
      if (mode === 'local' || !key) return;
      // 提供方系统：走 searchable-select 实例
      if (id === 'f_provideSystemNumber') {
        const val = getProviderValue();
        if (!val) return;
        body[key] = val;
        return;
      }
      // 批次：走 searchable-select 实例，取 label（后端需要 "2611批次" 而非 "2611"）
      if (id === 'f_prodBatch') {
        const r = resolveBatchLabel();
        // 选了批次却解析不出 label（下拉 options 没加载成功等）：doQuery 会用 !r.ok
        // 拦截整次查询，这里再留条痕，否则「以为查了某批次、实际拿到全量」毫无线索。
        if (r.value && !r.label) {
          console.warn('[collectApiBody] 批次已选但解析不出 label（options 未加载？），该条件被丢弃：', r.value);
        }
        if (!r.label) return;
        body[key] = r.label;
        return;
      }
      // 部门字段走 searchable-select，value 已经是 deptId
      if (id === 'f_deptName') {
        const cond = getDeptCondition();
        if (cond && cond.api) body[key] = cond.api;
        return;
      }
      const el = $(`#${id}`);
      if (!el) return;
      const val = el.value.trim();
      if (!val) return;
      body[key] = array ? [val] : val;
    });

    body.pageNum  = state.pageNum;
    body.pageSize = state.pageSize;

    debugLog('🔧 [collectApiBody] 收集结果:', body);

    return body;
  }

  // ── 收集需要前端兜底过滤的条件 ──────────────────────
  function collectLocalFilters() {
    const conds = [];
    FIELDS.forEach((f) => {
      if (f.mode === 'api' || !f.local) return;
      // 部门字段走 searchable-select，value 是 deptId
      if (f.id === 'f_deptName') {
        const cond = getDeptCondition();
        if (!cond) return;
        if (cond.api) {
          conds.push({ label: f.label, keys: f.local, value: cond.api, exact: true, date: false });
        } else {
          conds.push({ label: '部门名称', ...cond.local, date: false });
        }
        return;
      }
      // 批次：原生 select 的 value 是 "2706pc" 这类代码，但行数据与请求体
      // 用的都是 label（"2706批次"）。口径必须与请求体一致，否则本地兜底
      // 过滤会把整页结果误杀（症状：toast「本页数据均不满足筛选条件」）。
      if (f.id === 'f_prodBatch') {
        const r = resolveBatchLabel();   // 与请求体同源，口径必须一致
        if (r.value && !r.label) {
          console.warn('[collectLocalFilters] 批次已选但解析不出 label，本地兜底条件被丢弃：', r.value);
        }
        if (!r.label) return;
        conds.push({ label: f.label, keys: f.local, value: r.label, exact: false, date: false });
        return;
      }
      const el = $(`#${f.id}`);
      if (!el) return;
      const val = el.value.trim();
      if (!val) return;
      conds.push({ label: f.label, keys: f.local, value: val, exact: !!f.exact, date: !!f.date });
    });
    return conds;
  }

  // ── 查询编排接线（publish-query.js）─────────────────
  // 页面向编排层注入：共享状态 + 收集器 + 反馈通道，编排层不直接碰控件。
  PublishQuery.init({
    state,
    retryBtn: btnRetryFailed,
    checkSubscribeStatus,
    collectApiBody,
    collectLocalFilters,
    resolveBatchLabel,
    getDeptValue,
    getProviderValue,
    getBatchValue,
    focusProvider,
    focusBatch,
    fillDeptListFromRows,
    showToast,
    showLoading,
    hideLoading,
    debugLog,
  });

  // ── 重置 ────────────────────────────────────────────
  function resetForm() {
    PublishQuery.cancel();       // 作废在途查询 + 清掉失败分页重试上下文
    hideLoading();
    FIELDS.forEach(({ id }) => {
      const el = $(`#${id}`);
      if (el) el.value = '';
    });
    // 逐个清空下拉组件（只改原生 select 的 value，组件里的显示文本不会跟着变）
    selectInstances.forEach((inst) => inst.clear());
    // 清空变更时间日期选择器（内部 selectedValue 不随 input.value 复位）
    if (changeTimeInstance) changeTimeInstance.clear();

    // 清空结果（含统计面板 / 分页条 / 计数）
    PublishView.renderInitialResult();
    state.pageNum = 1;
    state.rawRows = [];
    state.totalItems = 0;
    state.displayedRows = [];
    state.filteredRows = [];
    PublishView.updateRetryBar([]);
    setFilter('all');            // 同步「全部 / 未订阅 / 已订阅」按钮高亮
    showToast('筛选条件已重置', 1500, 'info');
  }

  // ── 折叠面板 ────────────────────────────────────────
  // 改成 <button> 后天然可 Tab 聚焦、回车/空格触发；syncFilterToggle 同步 aria-expanded
  filterToggle.addEventListener('click', () => {
    filterCard.classList.toggle('collapsed');
    PublishView.syncFilterToggle();
  });
  PublishView.syncFilterToggle();

  // ── 订阅筛选按钮事件绑定 ────────────────────────────
  const btnFilterAll          = $('#btnFilterAll');
  const btnFilterUnsubscribed = $('#btnFilterUnsubscribed');
  const btnFilterSubscribed   = $('#btnFilterSubscribed');

  function setFilter(filterType) {
    state.currentFilter = filterType;
    // 更新按钮样式
    btnFilterAll.classList.toggle('active', filterType === 'all');
    btnFilterUnsubscribed.classList.toggle('active', filterType === 'unsubscribed');
    btnFilterSubscribed.classList.toggle('active', filterType === 'subscribed');
    // 重新应用筛选
    if (state.displayedRows.length > 0) {
      PublishView.applySubscribeFilter(state, checkSubscribeStatus);
    }
  }

  btnFilterAll.addEventListener('click', () => setFilter('all'));
  btnFilterUnsubscribed.addEventListener('click', () => setFilter('unsubscribed'));
  btnFilterSubscribed.addEventListener('click', () => setFilter('subscribed'));

  // ── 主事件绑定 ──────────────────────────────────────
  btnQuery.addEventListener('click', () => {
    state.pageNum = 1;
    state.currentFilter = 'all'; // 重置筛选状态
    setFilter('all');
    PublishQuery.doQuery({ focusMissing: true });
  });

  btnReset.addEventListener('click', resetForm);

  /**
   * 首页切页统一入口：重绘当前页 + 复位表格纵向滚动。
   * 滚动复位见 TableUtils.resetTableScroll —— 结果表在 .tbl-scroll 里自成滚动容器，
   * 滚到中下部再点「下一页」时新页会停在中下部，前几行看不到。
   */
  function gotoPage(n) {
    // 夹到有效范围：页码按钮与跳页框都按「当时」的总页数渲染，但筛选 / 订阅状态
    // 变化后总页数可能变小，这里兜一下，避免停在「第 7 / 1 页」这种越界状态。
    const tp = window.TableUtils.totalPages(state.filteredRows.length, state.pageSize);
    state.pageNum = Math.min(Math.max(1, Math.floor(n) || 1), tp);
    PublishView.renderCurrentPage(state, checkSubscribeStatus);   // 纯客户端切页，保留当前订阅筛选
    PublishView.updatePagination(state);
    if (window.TableUtils && window.TableUtils.resetTableScroll) window.TableUtils.resetTableScroll();
  }

  const totalPagesNow = () => window.TableUtils.totalPages(state.filteredRows.length, state.pageSize);

  btnFirst.addEventListener('click', () => {
    if (state.pageNum > 1) gotoPage(1);
  });

  btnPrev.addEventListener('click', () => {
    if (state.pageNum > 1) gotoPage(state.pageNum - 1);
  });

  btnNext.addEventListener('click', () => {
    const tp = totalPagesNow();
    if (state.pageNum < tp) gotoPage(state.pageNum + 1);
  });

  btnLast.addEventListener('click', () => {
    const tp = totalPagesNow();
    if (state.pageNum < tp) gotoPage(tp);
  });

  // 页码按钮每页都整体重建，逐个绑事件会重复绑定 → 用事件委托（与结果表内按钮同一套做法）
  pageNumbers.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-page]');
    if (b) gotoPage(Number(b.dataset.page));
  });

  // 跳页：与任务单页同口径 —— 用 change（失焦/回车都会触发），值非法就退回当前页
  pageJump.addEventListener('change', (e) => {
    const tp = totalPagesNow();
    const n = Number(e.target.value);
    if (n >= 1 && n <= tp) gotoPage(n);
    else e.target.value = String(state.pageNum);
  });

  btnExportCsv.addEventListener('click', () => PublishQuery.exportCsv());
  btnRetryFailed.addEventListener('click', () => PublishQuery.retryFailedPages());

  // 表格内按钮走事件委托，不再内联 onclick
  // （原来把整行 JSON 塞进 onclick，服务名里带引号就会把 HTML 打断）
  resultBody.addEventListener('click', (e) => {
    const detailBtn = e.target.closest('button[data-detail]');
    if (detailBtn) {
      const idx = Number(detailBtn.dataset.detail);
      const D = window.DetailDialog;
      if (D) D.open(state.filteredRows[idx] || state.rawRows[idx]);
      return;
    }
    const subBtn = e.target.closest('button[data-sub]');
    if (subBtn) {
      // 与「详情」同口径：用 filteredRows 的绝对下标定位。
      // 原来按 serverCoding 反查 find()：该编码允许重复（rowKey 注释里就写了），
      // 会订阅到同编码的第一行；而且每点一次都 O(n) 扫一遍。
      const idx = Number(subBtn.dataset.sub);
      const row = state.filteredRows[idx] || state.rawRows[idx];
      if (row) window.SubscribeDialog.open(row);
      return;
    }
  });

  // 订阅弹窗已抽到 subscribe-dialog.js（window.SubscribeDialog.open(row)）
  const afterSubscribeChanged = () => {
    // 订阅状态变了，filteredRows（导出 / 计数 / 分页的唯一种子）必须跟着重建：
    // 否则在「未订阅」筛选态下刚订阅的一行仍残留在 filteredRows 里，
    // 导出会把它带上、计数与分页总数也都是旧的。
    PublishView.rebuildFilteredRows(state, checkSubscribeStatus);
    // 当前页可能因订阅而空了（如「未订阅」筛选下订阅了一行），回退到存在的最后一页。
    const tp = window.TableUtils.totalPages(state.filteredRows.length, state.pageSize);
    if (state.pageNum > tp) state.pageNum = tp;
    PublishView.renderCurrentPage(state, checkSubscribeStatus);
    PublishView.updateSubscribeStats(state.rawRows, checkSubscribeStatus);
    PublishView.updatePagination(state);
  };
  window.AppServices = window.AppServices || {};
  window.AppServices.afterSubscribeChanged = afterSubscribeChanged;
  // 已移除 viewDetail 旧入口：全仓检索确认没有任何调用点（声明后从未被使用）。
  // 详情页入口统一走 window.DetailDialog.open(row)。

  // 输入法状态：中文输入法的 compositionend 与确认键之间可能存在极短时序窗口。
  // 在这个窗口内，Enter 只能提交候选词，不能触发查询或把焦点跳到必填的提供方系统。
  let imeComposing = false;
  let imeEndedAt = 0;
  document.addEventListener('compositionstart', () => {
    imeComposing = true;
  }, true);
  document.addEventListener('compositionend', () => {
    imeComposing = false;
    imeEndedAt = Date.now();
  }, true);

  // 回车键触发查询
  // 下拉组件内部自己消化回车（展开 / 选中），并 stopPropagation，
  // 这里兜底再判一次，防止将来新增的下拉实例忘了拦
  document.addEventListener('keydown', (e) => {
    const el = document.activeElement;

    const detailOverlay = $('#detailOverlay');
    if (e.key === 'Escape' && detailOverlay && detailOverlay.classList.contains('show')) {
      if (window.DetailDialog) window.DetailDialog.close();
      return;
    }

    if (e.key !== 'Enter' || !el || el.tagName !== 'INPUT') return;
    // 自带键盘行为的控件先让它们自己消化回车：日期选择器（Enter = 展开面板）、
    // 可搜索下拉 / 多选（Enter = 展开、选中）。它们的 keydown 只 preventDefault、
    // 不 stopPropagation，不排除的话会在展开面板的同时顺带发起一次全量查询。
    if (el.closest('.searchable-select, .dp-wrapper, .msel')) return;
    // 输入法组合态 / compositionend 后的短暂窗口，Enter 只用于确认中文候选词。
    if (imeComposing || e.isComposing || e.keyCode === 229 || Date.now() - imeEndedAt < 300) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // 弹窗打开时回车交给弹窗自己用（订阅表单、文档选择、批次时间、详情…）：
    // 这些弹窗里的普通输入框按回车，原来会顺带触发一次主页全量查询，
    // 而 loading 遮罩的 z-index 比弹窗高，用户看到的是「填着表突然整页转圈」。
    // 判据用 .overlay.show —— 全站弹窗（含 dialog-utils 动态建的那种）都带这两个类。
    if (document.querySelector('.overlay.show')) return;
    PublishQuery.doQuery({ focusMissing: false });
  });

  /** 初始化页面加载状态 */
  function initPageState() {
    // 检测是否处于离线状态
    if (!navigator.onLine) {
      showToast('⚠️ 当前处于离线状态，部分功能可能不可用', 4000, 'warn');
    }

    // 监听网络状态变化
    window.addEventListener('online', () => {
      showToast('✅ 网络连接已恢复', 2000, 'success');
    });
    window.addEventListener('offline', () => {
      showToast('⚠️ 网络连接已断开', 3000, 'warn');
    });
  }

  // ── 初始化订阅管理 UI ───────────────────────────────
  // 必须包 try/catch：这里一旦抛错，后面整个 IIFE 就中断了，
  // 部门列表初始化会连注册都注册不上 —— 表现就是下拉永远是空的
  try {
    if (window.SubscribeUI) window.SubscribeUI.init();
  } catch (err) {
    console.error('订阅管理 UI 初始化失败:', err);
  }

  // ── 字典下拉（批次 / 部门 / 提供方 / 固定选项）──────────────
  // 这一段原本 250 多行内联在这里，已拆到 js/ui/dict-selects.js。
  // 模块只负责「取数据 + 建下拉」，实例交回来由本文件赋值（setter 照常生效）。
  async function initDictSelects() {
    const D = window.DictSelects;
    if (!D) { console.warn('[index] dict-selects.js 未加载，筛选项下拉不可用'); return; }

    const b = await D.initBatchList(makeSelect);
    if (b) {
      if (b.instance) batchSelectInstance = b.instance;
      setBatchOptions(b.options);   // collectApiBody 取 label 用
    }

    const d = await D.initDepartmentList(makeSelect, PublishModel.deptsToOptions);
    if (d) {
      if (d.instance) deptSelectInstance = d.instance;
      deptOptions = d.options || [];
    }

    const p = await D.initProviderList(makeSelect);
    if (p && p.instance) providerSelectInstance = p.instance;

    const s = D.initStaticSelects(makeSelect) || {};
    if (s.checkout) checkoutSelectInstance = s.checkout;
    if (s.changeTime) changeTimeInstance = s.changeTime;
  }

  // 页面 DOM 就绪后异步加载各字典下拉
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDictSelects, { once: true });
  } else {
    initDictSelects();
  }

  // ── 初始化页面状态（网络检测等） ────────────────
  initPageState();

  window.addEventListener('storage', (e) => {
    if (e.key === SUBSCRIBE_STORAGE_KEY) {
      PublishView.updateSubscribePanelCount();
    }
  });

})();
