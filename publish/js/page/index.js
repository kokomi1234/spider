/* ============================================================
  服务发布数据查询 — 业务逻辑（重构版）
============================================================ */

(() => {
  'use strict';

  // ── 常量 ────────────────────────────────────────────
  // BASE_URL / TOKEN 已统一收敛到 api-client.js（window.API），所有请求走 API.call
  // 运行时服务统一由 bootstrap.js 做完整性检查；这里继续兼容现有全局服务 API。
  const SUBSCRIBE_STORAGE_KEY = 'subscribed_services';

  // 调试日志：公共实现见 js/core/debug.js（默认不输出，?debug=1 或
  // window.__APP_DEBUG__ = true 才打印）
  const debugLog = window.debugLog || (() => {});

  // ── DOM 引用 ────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const btnQuery       = $('#btnQuery');
  const btnReset       = $('#btnReset');
  const filterToggle   = $('#filterToggle');
  const filterCard     = $('#filterCard');
  const loadingMask    = $('#loadingMask');
  const resultBody     = $('#resultBody');
  const pagination     = $('#pagination');
  const btnPrev        = $('#btnPrev');
  const btnNext        = $('#btnNext');
  const pageInfo       = $('#pageInfo');
  /** 结果表列数：thead 列数与空态 colspan 共用这一处口径 */
  const RESULT_COL_COUNT = 10;

  const resultCount    = $('#resultCount');
  const statsRow       = $('#statsRow');
  const subscribeStats   = $('#subscribeStats');
  const btnExportCsv   = $('#btnExportCsv');


  // 失败分页重试条
  const retryBar       = $('#retryBar');
  const retryText      = $('#retryText');
  const btnRetryFailed = $('#btnRetryFailed');

  // 缓存回放告警条（本地代理宽松匹配到旧录制数据时提示）
  const cacheReplayBar  = $('#cacheReplayBar');
  const cacheReplayText = $('#cacheReplayText');

  // ── 批次下拉搜索组件实例 ────────────────────────────
  let batchSelectInstance = null;

  // 暴露给外部模块（如订阅弹窗）读取首页已选批次
  window._prodBatchInstance = { _inst: null, get value() { return batchSelectInstance ? batchSelectInstance.getValue() : ''; } };
  Object.defineProperty(window._prodBatchInstance, 'instance', {
    get() { return batchSelectInstance; },
    set(v) { batchSelectInstance = v; window._prodBatchInstance._inst = v; },
  });

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
      window._prodBatchInstance._inst = inst;
    }
    return inst;
  }

  // ── 订阅筛选状态 ────────────────────────────────────
  let currentFilter = 'all'; // 'all' | 'subscribed' | 'unsubscribed'
  let displayedRows = [];    // 当前分页原始数据
  let filteredRows = [];     // 经过订阅筛选后的数据

  // ── 分页状态 ────────────────────────────────────────
  let pageNum    = 1;
  const pageSize = 10;  // 每页 10 条
  let totalItems = 0;
  let rawRows    = [];


  // 查询并发控制：新查询开始后，旧查询不得再覆盖页面状态。
  let querySeq = 0;
  let activeQueryController = null;

  // ── 失败分页重试上下文 ──────────────────────────────
  // 查询完成后若部分后端分页拉取失败，保留可重试所需的上下文。
  // 用户点「重试失败分页」时只重拉失败的那几页，再合并回已拉到的全量。
  let queryState = null; // {
  //   baseBody, FETCH_SIZE, localConds, firstData,
  //   pageCount, fetchedRaw: Map<pageNo, rows>, failedPages: number[]
  // }

  // ── 筛选字段定义（表单 ID → 接口字段名） ────────────
  //
  // 字段名来自 trace.har 里 getPublishDataList 的真实请求体，后端只认这 17 个：
  //   compNum / batch / serverCodingList / serviceName / callerComponent /
  //   subscriberStatus / isChecked / pageSize / pageNum / isSendOutsideSystem /
  //   principal / principalName / serviceStatus / sysServeNoList / sysServeNo /
  //   deptId / implementationUnit
  // 之前填的是 provideSystemNumber / prodBatch / offerServerState / deptName 等
  // 响应体字段名，后端一律忽略，所以筛选全部失效。
  //
  // mode 决定这个条件怎么生效：
  //   'api'   → 只发给后端
  //   'both'  → 发给后端，同时前端再兜底过滤一次。
  //             原因：这些后端字段在真实数据里全是 null（serviceStatus / batch），
  //             发过去大概率被忽略；前端改用有值的同义字段补过滤
  //   'local' → 后端无对应字段，纯前端过滤
  const FIELDS = [
    { id: 'f_provideSystemNumber',  key: 'compNum',             mode: 'api'   },
    { id: 'f_prodBatch',            key: 'batch',               mode: 'both', label: '变更批次',
      local: ['sheetProductBatch', 'prodBatch', 'productBatch', 'offerVersionBatch'] },
    { id: 'f_sysServeNo',           key: 'sysServeNo',          mode: 'api'   },
    { id: 'f_serviceName',          key: 'serviceName',         mode: 'api'   },
    { id: 'f_interfaceCode',        key: 'serverCodingList',    mode: 'both', array: true, label: '接口编码',
      local: ['interfaceCode', 'serverCoding', 'sysEnName', 'sysServeEnName'] },
    { id: 'f_sendOutSide',          key: 'isSendOutsideSystem', mode: 'api'   },
    { id: 'f_principalName',        key: 'principalName',       mode: 'api'   },
    { id: 'f_serviceStatus',        key: 'serviceStatus',       mode: 'both', label: '服务状态',
      local: ['offerServerState', 'serviceStatus', 'status'] },
    { id: 'f_deptName',             key: 'deptId',              mode: 'both', exact: true, label: '部门名称',
      local: ['deptId'] },
    { id: 'f_productImplementUnit', key: 'implementationUnit',  mode: 'api'   },
    { id: 'f_changeTime',           key: null,                  mode: 'local', date: true, label: '变更时间',
      local: ['offerEffectiveTime', 'effectiveTime'] },
  ];

  /** 将 [{key, value}] 转为 searchable-select 需要的 [{label, value}] */
  function deptsToOptions(depts) {
    return depts.map((d) => ({ label: d.value, value: d.key }));
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

    deptOptions = deptsToOptions([...map.values()]);
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
   */
  function getDeptCondition() {
    if (deptSelectInstance) {
      const id = deptSelectInstance.getValue() || '';
      if (id) return { api: id, local: null };
      // 下拉建起来了但用户没选中（只是手输了未选）：getValue() 拿不到，
      // 但 searchable-select 内部记着 freeText。把它退回成「按部门名前端模糊过滤」，
      // 与下拉未建时的降级分支行为一致 —— 否则手输条件会被静默丢弃，
      // 用户以为按部门查了，实际拿到的是全部门数据。
      const free = typeof deptSelectInstance.getFreeText === 'function'
        ? (deptSelectInstance.getFreeText() || '').trim()
        : '';
      if (free) return { api: null, local: { keys: ['deptName'], value: free, exact: false } };
      return null;
    }
    const el = $('#f_deptName');
    const txt = el ? el.value.trim() : '';
    return txt ? { api: null, local: { keys: ['deptName'], value: txt, exact: false } } : null;
  }

  // ── 工具函数 ────────────────────────────────────────
  function showLoading()  {
    loadingMask.classList.add('show');
    loadingMask.setAttribute('aria-busy', 'true');
  }
  function hideLoading()  {
    loadingMask.classList.remove('show');
    loadingMask.setAttribute('aria-busy', 'false');
  }

  // 公共实现见 js/core/format.js（三页共用，本地只留同名别名，调用点不用改）
  const esc = (window.Fmt && window.Fmt.esc) || ((v) => String(v ?? ''));

  // Toast 公共实现见 js/ui/toast.js（三页共用；本地保留 showToast 这个名字）
  const showToast = window.toast || (() => {});

  // 暴露给其他模块使用
  window._showToast = showToast;
  window.AppServices = window.AppServices || {};
  window.AppServices.toast = showToast;

  // ── 统一解析后端响应：非 2xx / 业务错误码 抛错 ──────
  // 查询与「失败分页重试」共用，避免两份解析逻辑漂移。
  // 响应解析 / 错误解析 / 参数校验 / 兼容性检查都在 js/core/publish-response.js；
  // 查询与「失败分页重试」共用同一份，避免两份解析逻辑漂移。
  const PublishResponse = window.PublishResponse || {};
  const parsePublish = PublishResponse.parse;
  const parseApiError = PublishResponse.parseApiError;
  const validateFilters = PublishResponse.validateFilters;
  const checkBrowserCompatibility = PublishResponse.checkBrowserCompatibility;

  /** 检查服务是否已订阅 */
  function checkSubscribeStatus(serverCoding) {
    if (!window.SubscribeManager || !serverCoding) return 'unknown';
    return window.SubscribeManager.isSubscribed(serverCoding) ? 'subscribed' : 'unsubscribed';
  }

  /**
   * 行的稳定主键 —— 只能用它做去重 / 详情定位。
   *
   * 必须用 r.id：真实数据里同一个 serverCoding 可能存在多条合法记录，
   * 它们的 sysServeNo 不同，是不同服务。例如 2609 批次：
   *   PsnFaceImageUpload → E00301TP0050 与 E00301TP0051
   *   PsnInsuranceRecordInfoQuery → E00301BX004 与 E00301BX001
   * 早先用 serverCoding 去重会把后一条静默丢掉，用户看到的条数比后端返回的少。
   *
   * 仅当 id 缺失时才回退到编码组合（此时无法区分，宁可去重要保守）。
   */
  function rowKey(r) {
    if (!r) return '';
    if (r.id != null && r.id !== '') return 'id:' + r.id;
    const code = r.serverCoding || r.sysServeNo || '';
    return code ? 'code:' + code : '';
  }

  /**
   * 批次下拉的 value 是 "2609pc" 这类代码，而请求体与行数据用的都是 label（"2609批次"）。
   * window._batchOptions 只在批次列表加载成功时才有，缺失时解析不出 label。
   *
   * 原实现在解析失败时直接 `if (!val) return`，后果是：批次条件既没发给后端、
   * 也没进入前端兜底过滤，而必填校验用的是 getValue() 照样通过 ——
   * 用户以为查的是某批次，实际拿到的是全批次数据。
   * 所以这里把「解析失败」显式暴露出来（ok:false），由调用方阻断查询。
   */
  function resolveBatchLabel() {
    if (!batchSelectInstance) return { value: '', label: '', ok: true };
    const val = batchSelectInstance.getValue() || '';
    if (!val) return { value: '', label: '', ok: true };
    const opt = (window._batchOptions || []).find((o) => o.value === val);
    if (opt) return { value: val, label: opt.label, ok: true };
    return { value: val, label: '', ok: false };   // 选了东西但解析不出 label
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
  const API_BODY_DEFAULTS = {
    compNum: '', batch: '', serverCodingList: [], serviceName: '',
    callerComponent: '', subscriberStatus: '', isChecked: '',
    isSendOutsideSystem: '', principal: '', principalName: '',
    serviceStatus: '', sysServeNoList: [], sysServeNo: '',
    deptId: '', implementationUnit: '',
  };

  function collectApiBody() {
    const body = { ...API_BODY_DEFAULTS };

    FIELDS.forEach(({ id, key, mode, array }) => {
      if (mode === 'local' || !key) return;
      // 提供方系统：走 searchable-select 实例
      if (id === 'f_provideSystemNumber') {
        let val = '';
        if (providerSelectInstance) {
          val = providerSelectInstance.getValue() || '';
        }
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

    body.pageNum  = pageNum;
    body.pageSize = pageSize;

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

  // ── 前端兜底过滤 ────────────────────────────────────
  // 后端不认的字段（或后端字段恒为 null 的）在这里补一刀。
  // 若后端本来就正确过滤了，这一步是幂等的，不会多筛。
  function applyLocalFilters(rows, conds) {
    if (!conds.length) return rows;
    return rows.filter((row) => conds.every(({ keys, value, exact, date }) => {
      const needle = value.toLowerCase();
      return keys.some((k) => {
        const v = row[k];
        if (v == null || v === '') return false;
        const s = String(v);
        if (date)  return s.slice(0, 10) === needle;      // 变更时间按 YYYY-MM-DD 比对
        if (exact) return s === value;                    // 部门用 deptId 精确匹配
        return s.toLowerCase().includes(needle);
      });
    }));
  }

  // ── 徽章渲染 ────────────────────────────────────────
  function stateBadge(val) {
    if (!val) return '<span class="badge b-off">未设置</span>';
    const map = {
      '编辑中':           ['chip-edit',    '编辑中'],
      '功能测试基线':     ['chip-ext',     '功能测试基线'],
      '开发基线':         ['chip-own',     '开发基线'],
      '正式版基线':       ['b-run',        '正式版基线'],
      '运行中':           ['b-run',        '运行中'],
      '已暂停':           ['b-pause',      '已暂停'],
      '已停止':           ['b-off',        '已停止'],
      '已下线':           ['b-off',        '已下线'],
    };
    const [cls, txt] = map[val] || ['b-off', val];
    return `<span class="badge ${cls}">${esc(txt)}</span>`;
  }

  // ── 统计面板更新 ────────────────────────────────────
  function updateStats(data) {
    const list = data?.rows || [];
    if (!list.length) {
      statsRow.style.display = 'none';
      subscribeStats.style.display = 'none';
      return;
    }
    statsRow.style.display = '';
    $('#statTotal').textContent    = data.total ?? list.length;
    $('#statCompNum').textContent  = list[0]?.provideSystemNumber || list[0]?.assemblyName || '—';

    // 按状态分类计数
    const counts = {};
    list.forEach(r => {
      const s = r.offerServerState || '未设置';
      counts[s] = (counts[s] || 0) + 1;
    });
    $('#statPublished').textContent = counts['正式版基线'] || counts['运行中'] || 0;
    $('#statPending').textContent   = (counts['功能测试基线'] || 0) + (counts['开发基线'] || 0) + (counts['编辑中'] || 0);
    $('#statFailed').textContent    = counts['已下线'] || 0;

    updateSubscribeStats(list);
  }

  function updateSubscribeStats(rows) {
    if (!rows.length) {
      subscribeStats.style.display = 'none';
      return;
    }

    const subscribed = rows.filter(r => {
      const code = r.serverCoding || r.sysServeNo;
      return checkSubscribeStatus(code) === 'subscribed';
    }).length;

    const unsubscribed = rows.length - subscribed;
    const rate = rows.length > 0 ? Math.round((subscribed / rows.length) * 100) : 0;

    $('#subCountSubscribed').textContent = subscribed;
    $('#subCountUnsubscribed').textContent = unsubscribed;
    $('#subRate').textContent = rate + '%';

    subscribeStats.style.display = '';
  }

  /**
   * 只按 currentFilter 重建 filteredRows（导出 / 计数 / 分页都读它），
   * 不动 pageNum。订阅状态变化但筛选维度没变时用它：当前页仍在就留在原地，
   * 别把用户从正在看的那一页弹回第一页。
   */
  function rebuildFilteredRows() {
    if (currentFilter === 'all') {
      filteredRows = [...rawRows];
    } else {
      filteredRows = rawRows.filter(r => {
        const code = r.serverCoding || r.sysServeNo;
        const status = checkSubscribeStatus(code);
        if (currentFilter === 'subscribed') {
          return status === 'subscribed';
        } else {
          return status === 'unsubscribed';
        }
      });
    }
  }

  // ── 应用订阅筛选（作用在全量 rawRows 上，而非单页） ──
  function applySubscribeFilter() {
    rebuildFilteredRows();
    pageNum = 1;                 // 切筛选后回到第一页
    renderCurrentPage();
  }

  

  // ── 渲染当前页（对筛选后全量做客户端分页切分） ─────
  function renderCurrentPage() {
    const isFiltered = currentFilter !== 'all';
    const start = (pageNum - 1) * pageSize;
    const slice = filteredRows.slice(start, start + pageSize);
    renderTable(slice, isFiltered);
    updatePagination();
  }

  // ── 渲染表格 ────────────────────────────────────────
  function renderTable(rows, isFiltered = false) {
    if (!rows.length) {
      // 文案走全站模板（js/ui/table-utils.js 的 EMPTY_TEXT），别再就地写字符串
      const et = (window.TableUtils && window.TableUtils.EMPTY_TEXT) || {};
      const hint = isFiltered
        ? (et.filtered ? et.filtered('服务') : '没有匹配的服务')
        : (et.none ? et.none('服务') : '暂无数据');
      resultBody.innerHTML = `<tr><td colspan="${RESULT_COL_COUNT}" class="empty-hint">${hint}</td></tr>`;
      // 早退前必须把计数 / 分页 / 统计一起复位。
      // 否则从「全部 129 条」切到「已订阅（0 条）」时，计数仍显示旧值、
      // 分页器仍停在「第 1 / 3 页」，用户会以为筛选没生效。
      resultCount.textContent = isFiltered
        ? `筛选后 0 条（共 ${rawRows.length} 条）`
        : '';
      pagination.style.display = 'none';
      if (!isFiltered) {
        statsRow.style.display = 'none';
        subscribeStats.style.display = 'none';
      }
      return;
    }

    if (!isFiltered) {
      resultCount.textContent = `共 ${rawRows.length} 条`;
      pagination.style.display = '';
    } else {
      resultCount.textContent = `筛选后 ${filteredRows.length} 条（共 ${rawRows.length} 条）`;
    }

    resultBody.innerHTML = rows.map((r, i) => {
      const idx = (pageNum - 1) * pageSize + i + 1;

      // 从真实返回数据中提取字段
      const serverCoding = r.serverCoding || r.sysServeNo || '—';
      const serviceName  = r.serviceName || '—';
      const interfaceCode = r.interfaceCode || r.sysServeEnName || '';
      const compNum      = r.sysServeNo || r.serverCoding || '—';
      const codeAndInterface = interfaceCode && interfaceCode !== serverCoding
        ? `${serverCoding} / ${interfaceCode}`
        : serverCoding;
      const batch        = r.sheetProductBatch || r.prodBatch || r.productBatch || '—';
      const serviceStatus = r.offerServerState || r.status || '—';

      // 是否已核对
      const isChecked = r.isChecked === '1' || r.isChecked === 1
        ? '<span class="badge b-run">是</span>'
        : '<span class="badge b-off">否</span>';

      // 根据真实接口数据：principal/principalName/implementationUnit 全为空
      // 所以用 deptName（部门名称）替代负责人列
      const deptName = r.deptName || '—';

      // 订阅标记列
      let subscribeMark = '—';
      let rowClass = '';
      if (serverCoding !== '—') {
        const status = checkSubscribeStatus(serverCoding);
        if (status === 'subscribed') {
          subscribeMark = '<span class="badge b-run">✓ 已订阅</span>';
        } else {
          subscribeMark = '<span class="badge b-exp">✗ 未订阅</span>';
          rowClass = ' unsubscribed-row';
        }
      }

      // 详情取的是 filteredRows 里的下标，必须是「全量偏移 + 页内偏移」，
      // 用页内 i 会导致从第 2 页开始点详情看到的是别人家的数据
      const absIdx = (pageNum - 1) * pageSize + i;

      return `<tr class="${rowClass}" data-code="${esc(serverCoding)}">
        <td class="cell-index">${idx}</td>
        <td class="cell-code" title="${esc(codeAndInterface)}">
          <span class="cell-primary-code">${esc(serverCoding)}</span>
          ${interfaceCode && interfaceCode !== serverCoding
            ? `<span class="cell-secondary-code">接口：${esc(interfaceCode)}</span>`
            : ''}
        </td>
        <td class="cell-name" title="${esc(serviceName)}"><span class="cell-clamp">${esc(serviceName)}</span></td>
        <td class="cell-comp" title="${esc(compNum)}">${esc(compNum)}</td>
        <td class="cell-batch" title="${esc(batch)}">${esc(batch)}</td>
        <td class="cell-status">${stateBadge(serviceStatus)}</td>
        <td class="cell-check">${isChecked}</td>
        <td class="cell-dept" title="${esc(deptName)}"><span class="cell-clamp">${esc(deptName)}</span></td>
        <td class="cell-sub">${subscribeMark}</td>
        <td class="col-op">
          <div class="action-row">
            <button class="text-btn btn-xs" data-detail="${absIdx}">详情</button>
            ${checkSubscribeStatus(serverCoding) === 'unsubscribed'
              ? `<button class="text-btn btn-xs btn-subscribe" data-sub="${absIdx}">订阅</button>`
              : ''}
          </div>
        </td>
      </tr>`;
    }).join('');
  }

  // ── 分页控制（基于筛选后的全量，纯客户端切分） ────
  function updatePagination() {
    const totalPages = window.TableUtils.totalPages(filteredRows.length, pageSize);
    pageInfo.textContent = `第 ${pageNum} / ${totalPages} 页`;
    btnPrev.disabled = pageNum <= 1;
    btnNext.disabled = pageNum >= totalPages;
  }

  // ── 失败分页重试条显隐 ──────────────────────────────
  function updateRetryBar() {
    if (!queryState || !queryState.failedPages.length) {
      retryBar.style.display = 'none';
      return;
    }
    const pages = queryState.failedPages;
    retryText.textContent = `第 ${pages.join('、')} 页获取失败，当前结果不完整`;
    retryBar.style.display = '';
  }

  // ── 缓存回放告警条显隐 ──────────────────────────────
  // 本地代理精确匹配失败时会「宽松匹配」到同接口的旧录制数据。
  // 不提示的话，用户会以为查到的就是当前条件下的真实数据。
  function updateCacheReplayBar(loose) {
    if (!loose) {
      cacheReplayBar.style.display = 'none';
      return;
    }
    cacheReplayText.textContent =
      '⚠️ 当前展示的是本地代理回放的旧录制数据（请求参数与录制时不一致），' +
      '仅供界面调试，数据不反映当前查询条件的真实结果。连内网重新请求一次即可刷新缓存。';
    cacheReplayBar.style.display = '';
  }

  /** 后端单次最多返回 200 条（已确认） */
  const FETCH_SIZE = 200;
  /**
   * 全量拉取的页数上限（2000 条/页 × 20 = 4000 条）。
   * 原先按后端 total 无上限扇出：一条宽条件查询可能拉几十页、几十 MB，
   * 页面会长时间无响应。超限时只取前 N 页并明确告知用户。
   */
  const MAX_FETCH_PAGES = 20;

  /**
   * 并发分页拉取（worker 池 + 按页码有序合并）。
   * 原先 doQuery 与 retryFailedPages 各写一份同样的池/合并/失败收集，改一处漏一处。
   * @param {{baseBody:object, pages:number[], concurrency?:number, signal?:AbortSignal,
   *          isCurrent:Function, onPage?:Function}} args
   * @returns {Promise<{byPage:Map<number,Array>, failed:number[], aborted:boolean}>}
   */
  async function fetchPages({ baseBody, pages, concurrency = 3, signal, isCurrent, onPage }) {
    const byPage = new Map();
    const failed = [];
    const pending = pages.slice();
    let aborted = false;

    const worker = async () => {
      while (pending.length) {
        if (aborted || !isCurrent()) { aborted = true; return; }
        const p = pending.shift();
        try {
          const resp = await window.ToolApi.fetchPublishDataList(
            { ...baseBody, pageNum: p, pageSize: FETCH_SIZE },
            { signal },
          );
          const parsed = await parsePublish(resp);
          if (!isCurrent()) { aborted = true; return; }
          byPage.set(p, parsed.rows || []);
          if (typeof onPage === 'function') onPage(p, parsed);
        } catch (err) {
          if (err?.name === 'AbortError' || (signal && signal.aborted) || !isCurrent()) { aborted = true; return; }
          failed.push(p);
          console.warn(`⚠️ 第 ${p} 页获取失败:`, err);
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, worker));
    return { byPage, failed, aborted };
  }

  /** 按页码顺序把各页行拼成一条数组（并发完成顺序不确定，不能边拉边 concat —— 既乱序又 O(n²)） */
  function flattenPages(pages, byPage) {
    const out = [];
    for (const p of pages) {
      const rows = byPage.get(p);
      if (rows) out.push(...rows);
    }
    return out;
  }

  // ── 失败分页重试：只重拉失败页，合并回全量 ──────────
  async function retryFailedPages() {
    if (!queryState || !queryState.failedPages.length) return;
    const { baseBody, FETCH_SIZE, localConds, firstData, pageCount, fetchedRaw } = queryState;

    // 作废任何在途查询，避免重试与「查询」互相覆盖
    const currentQuery = ++querySeq;
    if (activeQueryController) activeQueryController.abort();
    const controller = new AbortController();
    activeQueryController = controller;
    const isCurrent = () => currentQuery === querySeq && !controller.signal.aborted;

    const retryPages = [...queryState.failedPages];
    const prevLabel = btnRetryFailed.textContent;
    btnRetryFailed.disabled = true;
    btnRetryFailed.textContent = '重试中…';
    showToast('正在重试失败的分页…', 1800, 'info');

    // 与首屏共用同一套取数骨架（worker 池 + 有序合并 + 失败收集）
    let result = { byPage: new Map(), failed: retryPages };
    try {
      result = await fetchPages({
        baseBody,
        pages: retryPages,
        signal: controller.signal,
        isCurrent,
      });
    } catch (_) { /* 失败已在 fetchPages 内逐页吞掉，不向上抛 */ }

    result.byPage.forEach((rows, p) => {
      fetchedRaw.set(p, rows);
      const idx = queryState.failedPages.indexOf(p);
      if (idx >= 0) queryState.failedPages.splice(idx, 1);
    });

    if (!isCurrent()) {
      // 被新查询取消时，避免旧重试把按钮永久留在「重试中」状态。
      btnRetryFailed.disabled = false;
      btnRetryFailed.textContent = prevLabel;
      return;
    }

    // 用 fetchedRaw（成功页 + 刚重试成功的页）按页码顺序重建全量
    const pageList = [];
    for (let p = 1; p <= pageCount; p++) pageList.push(p);
    const all = flattenPages(pageList, fetchedRaw);

    // 去重 + 前端兜底过滤（与 doQuery 保持一致）
    const seen = new Set();
    const deduped = [];
    for (const r of all) {
      const key = rowKey(r);
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      deduped.push(r);
    }
    const records = applyLocalFilters(deduped, localConds);

    // 写回全局状态，保留用户当前的订阅筛选与页码
    rawRows = records;
    displayedRows = records;
    totalItems = records.length;

    updateStats({ ...firstData, rows: records, total: records.length });

    const savedPage = pageNum;
    applySubscribeFilter();   // 重建 filteredRows 并渲染（内部会把 pageNum 归 1）
    // 恢复到重试前的页码（夹到合法范围），避免用户被弹回第一页
    const totalPages = window.TableUtils.totalPages(filteredRows.length, pageSize);
    pageNum = Math.min(Math.max(1, savedPage), totalPages);
    renderCurrentPage();
    updatePagination();

    btnRetryFailed.disabled = false;
    btnRetryFailed.textContent = prevLabel;
    updateRetryBar();

    if (queryState.failedPages.length) {
      showToast(`⚠️ 仍有第 ${queryState.failedPages.join('、')} 页获取失败`, 4000, 'warn');
    } else {
      showToast(`✅ 已补齐失败分页，共 ${totalItems} 条`, 2500, 'success');
    }
  }
  btnRetryFailed.addEventListener('click', retryFailedPages);


  // ── 导出 CSV（feature 已拆到 csv-export.js）────────────
  function exportCsv() {
    if (!window.CsvExporter) {
      showToast('⚠️ 导出模块未加载', 2500, 'error');
      return;
    }
    window.CsvExporter.exportRows(filteredRows, checkSubscribeStatus, showToast);
  }

  btnExportCsv.addEventListener('click', exportCsv);

  // ── 核心：发起查询 ──────────────────────────────────
  async function doQuery({ focusMissing = true } = {}) {
    const apiBody    = collectApiBody();
    const localConds = collectLocalFilters();

    debugLog('🔍 [DEBUG] 请求体:', apiBody);
    debugLog('🔍 [DEBUG] 前端过滤条件:', localConds);
    debugLog('🔍 [DEBUG] 选中的部门 value:', getDeptValue());

    // 0. 浏览器兼容性检查（仅首次）
    if (!doQuery._compatChecked) {
      doQuery._compatChecked = true;
      const compatIssues = checkBrowserCompatibility();
      if (compatIssues.length > 0) {
        console.warn('浏览器兼容性问题:', compatIssues);
        compatIssues.forEach(issue => showToast(issue, 5000, 'warn'));
      }
    }

    // 1. 基础验证 — 必填项检查
    // 提供方系统可能是 input 或 searchable-select，需要兼容获取值
    let fCompNum = '';
    if (providerSelectInstance) {
      fCompNum = providerSelectInstance.getValue();
    } else {
      fCompNum = ($('#f_provideSystemNumber')?.value || '').trim();
    }
    
    // 批次可能是 input 或 searchable-select，需要兼容获取值
    let fBatch = '';
    if (batchSelectInstance) {
      fBatch = batchSelectInstance.getValue();
    } else {
      fBatch = ($('#f_prodBatch')?.value || '').trim();
    }
    
    if (!fCompNum) {
      showToast('⚠️ 请输入提供方系统', 2000, 'warn');
      const provEl = providerSelectInstance ? document.querySelector('#f_provideSystemNumber + div .searchable-select-input') : $('#f_provideSystemNumber');
      if (focusMissing && provEl) provEl.focus();
      return;
    }
    if (!fBatch) {
      showToast('⚠️ 请选择或输入提供方最新变更批次', 2000, 'warn');
      if (focusMissing && batchSelectInstance) {
        // 仅点击“查询”时主动聚焦；输入框按回车不抢焦点
        const inputEl = document.querySelector('#f_prodBatch + div .searchable-select-input');
        if (inputEl) inputEl.focus();
      }
      return;
    }
    // 选了批次但解析不出 label（批次列表没加载完成）时必须拦下来。
    // 放行的结果是请求体与前端过滤双双丢掉批次条件，静默返回全批次数据。
    if (fBatch && !resolveBatchLabel().ok) {
      showToast('⚠️ 批次列表尚未加载完成，无法解析所选批次。请刷新页面后重试', 4000, 'warn');
      return;
    }

    // 2. 筛选条件格式校验
    const validationErrors = validateFilters(apiBody);
    if (validationErrors.length > 0) {
      showToast('❌ ' + validationErrors[0], 3000, 'error');
      return;
    }

    showLoading();

    // 新查询开始：清掉上一次可能残留的失败分页重试上下文
    queryState = null;
    updateRetryBar();

    const currentQuery = ++querySeq;
    if (activeQueryController) activeQueryController.abort();
    const controller = new AbortController();
    activeQueryController = controller;
    const isCurrentQuery = () => currentQuery === querySeq && !controller.signal.aborted;

    try {
      const baseBody = { ...apiBody };   // FETCH_SIZE / 页数上限见文件上方的常量
      delete baseBody.pageNum;
      delete baseBody.pageSize;

      const requestPayload = { ...baseBody, pageNum: 1, pageSize: FETCH_SIZE };
      debugLog('📤 [查询请求] 最终发给后端的 body:', requestPayload);

      // 第一页（同时拿到后端 total，决定还要拉几页）
      const t0 = performance.now();
      const first = await parsePublish(await window.ToolApi.fetchPublishDataList(requestPayload, {
        signal: controller.signal,
      }));
      if (!isCurrentQuery()) return;

      // 本次结果是否来自本地代理的宽松回放（旧录制数据，未必属于当前查询条件）
      const replayLoose = !!first.loose;

      let all = first.rows;
      const backendTotal = first.total;
      const failedPages = [];

      // 拉取剩余页：共用 fetchPages（worker 池 + 按页码有序合并，不会再边拉边 concat）。
      // 页数封顶 MAX_FETCH_PAGES：宽条件下一味按 total 扇出会把页面拖死。
      if (all.length > 0 && backendTotal > all.length) {
        const pageCountTotal = Math.ceil(backendTotal / FETCH_SIZE);
        const pageCount = Math.min(pageCountTotal, MAX_FETCH_PAGES);
        if (pageCountTotal > pageCount) {
          showToast(`⚠️ 结果较多，只取了前 ${pageCount} 页（约 ${pageCount * FETCH_SIZE} 条）用于排序与筛选；`
            + `需要完整数据请把条件再收窄一些`, 6000, 'warn');
        }

        const pages = [];
        for (let p = 2; p <= pageCount; p++) pages.push(p);

        const { byPage, failed } = await fetchPages({
          baseBody,
          pages,
          signal: controller.signal,
          isCurrent: isCurrentQuery,
        });
        if (!isCurrentQuery()) return;
        failedPages.push(...failed);
        failedPages.sort((a, b) => a - b);   // 失败页码按升序，提示语顺序稳定

        // 按页码顺序拼接（第 1 页在前面），去重前的完整原始行
        const fetchedRaw = new Map();
        fetchedRaw.set(1, first.rows);
        byPage.forEach((rows, p) => fetchedRaw.set(p, rows));
        const orderedPages = [];
        for (let p = 1; p <= pageCount; p++) orderedPages.push(p);
        all = flattenPages(orderedPages, fetchedRaw);

        // 记录可重试上下文：失败时只需重拉 failedPages 这几页，再按页码顺序拼回全量。
        queryState = {
          baseBody,
          FETCH_SIZE,
          localConds,
          firstData: first.data,
          pageCount,
          fetchedRaw,
          failedPages: [...failedPages],
        };
      }

      const elapsed = Math.round(performance.now() - t0);
      if (!isCurrentQuery()) return;

      // 去重（个别后端忽略 pageNum 时会重复返回同一批）
      const seen = new Set();
      const deduped = [];
      for (const r of all) {
        const key = rowKey(r);
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        deduped.push(r);
      }
      const droppedDup = all.length - deduped.length;

      // 前端兜底过滤：后端不认的字段在这里补一刀
      debugLog(`🔍 [DEBUG] 后端返回总行数: ${all.length}（去重后 ${deduped.length}）`);
      const records = applyLocalFilters(deduped, localConds);
      const dropped = deduped.length - records.length;
      debugLog('🔍 [DEBUG] 过滤后行数:', records.length, '过滤掉:', dropped);

      // 空数据处理
      if (!records.length) {
        // 宽松回放时数据来自旧录制，跟当前筛选对不上是必然结果，
        // 这时提示「不满足筛选条件」会误导用户去调筛选条件，要单独说明。
        const hint = replayLoose && (dropped > 0 || droppedDup > 0)
          ? '本地代理回放的是旧录制数据，与当前查询条件不符，已被前端过滤。请连内网用当前条件重新请求一次以重新录制'
          : (dropped > 0 || droppedDup > 0)
            ? '本页数据均不满足筛选条件（部分条件后端未支持，已由前端过滤）'
            : '未找到匹配的数据，请尝试调整筛选条件';
        const incompleteHint = failedPages.length
          ? `（第 ${failedPages.join('、')} 页获取失败，结果不完整）`
          : '';
        showToast('📭 ' + hint + incompleteHint, 3000, failedPages.length ? 'warn' : 'info');
        resultBody.innerHTML = `<tr><td colspan="${RESULT_COL_COUNT}" class="empty-hint">${hint}</td></tr>`;
        statsRow.style.display = 'none';
        subscribeStats.style.display = 'none';
        pagination.style.display = 'none';
        resultCount.textContent = '';
        totalItems = 0;
        rawRows = [];
        displayedRows = [];
        filteredRows = [];
        updateRetryBar();   // 结果集为空但仍有分页失败 → 仍给出重试入口
        updateCacheReplayBar(false);
        hideLoading();
        return;
      }

      // 全量数据存盘：订阅筛选 / 翻页都在本地对全量进行
      totalItems = records.length;
      rawRows = records;
      displayedRows = records;

      debugLog(`查询完成: 全量 ${records.length} 条 (${elapsed}ms, 去重 ${droppedDup})`);

      // 顺手用结果里的 deptId + deptName 兜底填充部门下拉
      fillDeptListFromRows(records);

      updateStats({ ...first.data, rows: records, total: records.length });
      updateCacheReplayBar(replayLoose);

      pageNum = 1;
      applySubscribeFilter();   // 内部按 currentFilter 过滤全量并渲染当前页 + 分页

      if (dropped > 0) {
        const names = localConds.map((c) => c.label).filter(Boolean).join('、');
        showToast(`ℹ️ 本页过滤掉 ${dropped} 条不满足「${names}」的数据（后端未支持该字段）`, 4000, 'info');
      }

      // 成功提示（仅在数据量较大时显示）
      if (failedPages.length) {
        showToast(`⚠️ 查询完成但结果不完整：第 ${failedPages.join('、')} 页获取失败，当前 ${totalItems} 条`, 5000, 'warn');
      } else if (totalItems > 100) {
        showToast(`✅ 查询成功: 共 ${totalItems} 条数据`, 2000, 'success');
      }

      updateRetryBar();   // 有失败分页则展示重试入口；无则隐藏

    } catch (err) {
      if (err?.name === 'AbortError' || controller.signal.aborted || !isCurrentQuery()) return;
      console.error('查询失败:', err);
      const errorMsg = parseApiError(
        err.response || { status: 0, headers: {} },
        err
      );
      showToast(`❌ ${errorMsg}`, 5000, 'error');
      // 失败时表格、分页条、统计面板、结果计数要一起复位：
      // 只清表格的话，屏幕上会是「错误提示 + 上一次的统计数字」，看起来像数据没变。
      const etFail = (window.TableUtils && window.TableUtils.EMPTY_TEXT) || {};
      resultBody.innerHTML = `<tr><td colspan="${RESULT_COL_COUNT}" class="empty-hint">`
        + `${esc(etFail.fail || '查询失败，请检查网络或稍后重试')}`
        + '<br><small style="color:var(--muted);font-family:monospace;">'
        + esc(err?.message || '未知错误') + '</small></td></tr>';
      pagination.style.display = 'none';
      statsRow.style.display = 'none';
      subscribeStats.style.display = 'none';
      resultCount.textContent = '';
    } finally {
      if (currentQuery === querySeq) {
        activeQueryController = null;
        hideLoading();
      }
    }
  }

  // ── 重置 ────────────────────────────────────────────
  function resetForm() {
    querySeq++;
    if (activeQueryController) {
      activeQueryController.abort();
      activeQueryController = null;
    }
    hideLoading();
    FIELDS.forEach(({ id }) => {
      const el = $(`#${id}`);
      if (el) el.value = '';
    });
    // 逐个清空下拉组件（只改原生 select 的 value，组件里的显示文本不会跟着变）
    selectInstances.forEach((inst) => inst.clear());
    // 清空变更时间日期选择器（内部 selectedValue 不随 input.value 复位）
    if (changeTimeInstance) changeTimeInstance.clear();

    // 清空结果
    const etInit = (window.TableUtils && window.TableUtils.EMPTY_TEXT) || {};
    resultBody.innerHTML = `<tr><td colspan="${RESULT_COL_COUNT}" class="empty-hint">`
      + `${esc(etInit.initial || '请输入条件后点击「查询」')}</td></tr>`;
    pagination.style.display = 'none';
    resultCount.textContent = '';
    statsRow.style.display = 'none';
    subscribeStats.style.display = 'none';
    pageNum = 1;
    rawRows = [];
    totalItems = 0;
    displayedRows = [];
    filteredRows = [];
    queryState = null;           // 清掉失败分页重试上下文
    updateRetryBar();
    setFilter('all');            // 同步「全部 / 未订阅 / 已订阅」按钮高亮
    showToast('筛选条件已重置', 1500, 'info');
  }

  // ── 折叠面板 ────────────────────────────────────────
  // 改成 <button> 后天然可 Tab 聚焦、回车/空格触发；这里同步 aria-expanded
  function syncFilterToggle() {
    filterToggle.setAttribute(
      'aria-expanded',
      String(!filterCard.classList.contains('collapsed'))
    );
  }
  filterToggle.addEventListener('click', () => {
    filterCard.classList.toggle('collapsed');
    syncFilterToggle();
  });
  syncFilterToggle();

  // ── 订阅筛选按钮事件绑定 ────────────────────────────
  const btnFilterAll       = $('#btnFilterAll');
  const btnFilterUnsubscribed = $('#btnFilterUnsubscribed');
  const btnFilterSubscribed   = $('#btnFilterSubscribed');

  function setFilter(filterType) {
    currentFilter = filterType;
    // 更新按钮样式
    btnFilterAll.classList.toggle('active', filterType === 'all');
    btnFilterUnsubscribed.classList.toggle('active', filterType === 'unsubscribed');
    btnFilterSubscribed.classList.toggle('active', filterType === 'subscribed');
    // 重新应用筛选
    if (displayedRows.length > 0) {
      applySubscribeFilter();
    }
  }

  btnFilterAll.addEventListener('click', () => setFilter('all'));
  btnFilterUnsubscribed.addEventListener('click', () => setFilter('unsubscribed'));
  btnFilterSubscribed.addEventListener('click', () => setFilter('subscribed'));

  // ── 主事件绑定 ──────────────────────────────────────
    btnQuery.addEventListener('click', () => {
    pageNum = 1;
    currentFilter = 'all'; // 重置筛选状态
    setFilter('all');
    doQuery({ focusMissing: true });
  });

  btnReset.addEventListener('click', resetForm);

  btnPrev.addEventListener('click', () => {
    if (pageNum > 1) {
      pageNum--;
      renderCurrentPage();   // 纯客户端切页，保留当前订阅筛选
      updatePagination();
    }
  });

  btnNext.addEventListener('click', () => {
    const totalPages = window.TableUtils.totalPages(filteredRows.length, pageSize);
    if (pageNum < totalPages) {
      pageNum++;
      renderCurrentPage();   // 纯客户端切页，保留当前订阅筛选
      updatePagination();
    }
  });

  // 表格内按钮走事件委托，不再内联 onclick
  // （原来把整行 JSON 塞进 onclick，服务名里带引号就会把 HTML 打断）
  resultBody.addEventListener('click', (e) => {
    const detailBtn = e.target.closest('button[data-detail]');
    if (detailBtn) {
      const idx = Number(detailBtn.dataset.detail);
      const D = window.DetailDialog;
      if (D) D.open(filteredRows[idx] || rawRows[idx]);
      return;
    }
    const subBtn = e.target.closest('button[data-sub]');
    if (subBtn) {
      // 与「详情」同口径：用 filteredRows 的绝对下标定位。
      // 原来按 serverCoding 反查 find()：该编码允许重复（rowKey 注释里就写了），
      // 会订阅到同编码的第一行；而且每点一次都 O(n) 扫一遍。
      const idx = Number(subBtn.dataset.sub);
      const row = filteredRows[idx] || rawRows[idx];
      if (row) window.SubscribeDialog.open(row);
      return;
    }
  });

  // 订阅弹窗已抽到 subscribe-dialog.js（window.SubscribeDialog.open(row)）
  const afterSubscribeChanged = () => {
    // 订阅状态变了，filteredRows（导出 / 计数 / 分页的唯一种子）必须跟着重建：
    // 否则在「未订阅」筛选态下刚订阅的一行仍残留在 filteredRows 里，
    // 导出会把它带上、计数与分页总数也都是旧的。
    rebuildFilteredRows();
    // 当前页可能因订阅而空了（如「未订阅」筛选下订阅了一行），回退到存在的最后一页。
    const tp = window.TableUtils.totalPages(filteredRows.length, pageSize);
    if (pageNum > tp) pageNum = tp;
    renderCurrentPage();
    updateSubscribeStats(rawRows);
    updatePagination();
  };
  window.AppServices = window.AppServices || {};
  window.AppServices.afterSubscribeChanged = afterSubscribeChanged;
  // 旧入口保留，兼容此前在控制台或外部页面调用的集成代码。
  window._afterSubscribeChanged = afterSubscribeChanged;
  window._viewDetail          = (row) => window.DetailDialog && window.DetailDialog.open(row);

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

    if (e.key === 'Escape' && $('#detailOverlay').classList.contains('show')) {
      if (window.DetailDialog) window.DetailDialog.close();
      return;
    }

    if (e.key !== 'Enter' || !el || el.tagName !== 'INPUT') return;
    if (el.closest('.searchable-select')) return;
    // 输入法组合态 / compositionend 后的短暂窗口，Enter 只用于确认中文候选词。
    if (imeComposing || e.isComposing || e.keyCode === 229 || Date.now() - imeEndedAt < 300) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    doQuery({ focusMissing: false });
  });

  /** 更新已订阅面板按钮计数 */
  function updateSubscribePanelCount() {
    const count = window.SubscribeManager ? window.SubscribeManager.count() : 0;
    const btn = $('#btnSubscribePanel');
    if (btn) btn.textContent = `已订阅 (${count})`;
  }

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
      window._batchOptions = b.options || [];   // collectApiBody 取 label 用
    }

    const d = await D.initDepartmentList(makeSelect, deptsToOptions);
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
      updateSubscribePanelCount();
    }
  });

})();
