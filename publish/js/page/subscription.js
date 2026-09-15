/**
 * 服务订阅关系查询页（subscription.html）
 *
 * ── 数据来源 ────────────────────────────────────────────────
 * 接口全部来自抓包 `服务订阅关系查询.har`（2026-09-10），没有猜测字段：
 *   查询   POST /itamp-tool/publish/getSubscriptionPublishHistoryList?n=xx
 *   下拉   POST /itamp-tool/publish/getProdSysServeNoList?callerComponent=xx&n=xx
 * 下拉里的提供方系统 / 批次 / 部门沿用首页那套 data/*.js（同源接口，抓包已确认）。
 *
 * ── 一个需要复核的字段映射 ──────────────────────────────────
 * 行内有 prodBatch 和 prodBatchList 两个批次字段，本页按下面推断取值：
 *   调用方投产/变更批次 = prodBatch        （与请求体同名，抓包里过滤的就是它）
 *   提供方最新变更批次 = prodBatchList     （无过滤抓包里 2405 ≥ 调用方 2305，
 *                                          提供方「最新」不早于订阅批次才说得通）
 * 若后续抓包出现反例，改 COLUMNS 里这两行即可，其余代码不用动。
 *
 * ── 审核流程状态字段 ────────────────────────────────────────
 * 行内 prodReviewStatus 与 reviewStatus 都是 "00"~"04" 裸值；本页用
 * prodReviewStatus（取值 00/01/02/03/04 五种齐全，与 REVIEW_STATUS_MAP 完全对上）。
 */
(function () {
  'use strict';

  const debugLog = window.debugLog || (() => {});

  const $ = (sel) => document.querySelector(sel);

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
  /** 整批拉取时的每页条数（窗口扇出 / 单批次全局排序共用）。
      用户定的 50：后端若允许 500 可降到 1/10 请求数 —— 别靠调小 pageSize「治慢」，
      总字节不变，只会把请求数和后端 COUNT 次数放大。 */
  const BULK_PAGE_SIZE = 50;
  /** 整批拉取的条数上限，避免一条查询把几万行拉进内存 */
  const BULK_MAX = 5000;
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

    const nextCond = collectCond();
    state.cond = nextCond;

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
      if (!state.queried) renderEmpty(emptyText('fail', null, '查询失败，请检查网络或稍后重试'));
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
        state.rows = decorateRows(first.rows);
      }
    } else {
      state.mode = 'server';
      state.allRows = null;
      state.rows = decorateRows(first.rows);
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
      state.allRows = decorateRows(rows);
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
    if (!state.total) toast('查询完成，窗口内（近 12 个月）没有匹配的订阅关系', 2400);
    if (res.local) toast('⚠️ 查询接口未接入（endpoint 空），返回空结果', 3000);
  }

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
      pageSize: BULK_PAGE_SIZE,
    });

    const first = await fetchP(1);
    if (!first.ok) return { ok: false, error: first.error, local: first.local };
    const pageRows = new Map([[1, first.rows || []]]);
    const total = Number(first.total) || 0;
    let got = (first.rows || []).length;

    // 一页就装完（或接口未接入）→ 直接收尾
    if (!got || got >= total || got >= BULK_MAX) {
      return { ok: true, local: !!first.local, rows: (first.rows || []).slice(0, BULK_MAX) };
    }

    const pageCount = Math.min(
      Math.ceil(total / BULK_PAGE_SIZE),
      Math.ceil(BULK_MAX / BULK_PAGE_SIZE)
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
        if (!(res.rows || []).length || got >= total || got >= BULK_MAX) return;
      }
    };
    await Promise.all(Array.from({ length: Math.min(PAGE_CONCURRENCY, pending.length) }, worker));
    if (failed) return { ok: false, error: failed, local: false };

    const out = [];
    for (let p = 1; p <= pageCount; p++) out.push(...(pageRows.get(p) || []));
    return { ok: true, local: !!first.local, rows: out.slice(0, BULK_MAX) };
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
      return window.TableUtils.totalPages(state.total, state.pageSize);
    }

  /**
   * 给一行算出投产优先级（批次 + 基线状态 + 今天）。
   * 规则全在 js/ui/priority.js，写回的下划线字段只在前端用。
   */
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

  // colspan 23 = 订阅页表格列数（22 个数据列 + 操作列）；空状态与分页条显隐统一走 TableUtils
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
    const overdue = state.rows.filter((r) => r._prio && r._prio.overdue).length;
    const el = $('#overdueCount');
    if (el) el.textContent = overdue ? `⚠️ 本页逾期 ${overdue} 条` : '';
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

  /**
   * 窗口查询里**部分批次**失败：结果不完整，必须常驻说明是哪几个批次。
   * toast 只有几秒，一长串批次名根本看不完（评估报告 U-08），
   * 所以清单放常驻条，toast 只负责"立刻看到有失败"。
   */
  function showPartialFail(batches) {
    const bar = $('#failBar');
    if (!bar || !batches || !batches.length) return;
    const txt = $('#failText');
    if (txt) {
      txt.textContent = `⚠️ 窗口内有 ${batches.length} 个批次查询失败（${batches.join('、')}），当前结果不完整`;
    }
    bar.style.display = '';
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
    // 临期（剩余 ≥0 且 ≤3 天）：优先级这一格变红，但整行不变红（与「逾期整行标红」区分）
    const near = p.days !== null && p.days >= 0 && p.days <= 3;
    const tagCls = `prio-tag is-${esc(p.level)}${near ? ' is-near' : ''}`;
    return `<td class="col-prio" title="${esc(hint)}">
      <span class="${tagCls}">${esc(p.text)}</span>
    </td>`;
  }

  function renderTable() {
    // 注意顺序：必须先 pageRows()（client 模式下它会按排序切出当前页），
    // 再做空判断 —— 否则会用上一轮的 state.rows 提前返回。
    const rows = pageRows();
    const body = $('#resultBody');
    if (!rows.length) {
      renderEmpty(emptyText('none', '订阅关系', '没有匹配的订阅关系'));
      return;
    }
    body.innerHTML = rows.map((r) => {
      const index = state.rows.indexOf(r);        // 「查 看」按原数组下标取行
      const overdue = r._prio && r._prio.overdue ? ' is-overdue' : '';
      const cells = COLUMNS.map(([k, , mono]) => {
        const raw = r[k];
        const text = (raw === null || raw === undefined || raw === '') ? '—' : String(raw);
        const copyAttr = `data-copy="${esc(String(raw ?? ''))}"`;
        const fixed = FIXED_COL_CLASS[k] ? FIXED_COL_CLASS[k] + ' ' : '';
        if (k === '_prioText') return prioCell(r);          // 自己带 col-prio
        if (k === 'status' || k === 'prodReviewStatus') {
          const tag = k === 'status' ? statusTag(raw) : reviewStatusTag(raw);
          return `<td class="${fixed}copy-cell" ${copyAttr} title="点击复制">${tag}</td>`;
        }
        // 数据格统一套一层 .cell-clamp：列宽不够时折到 2 行再省略，而不是一上来就截断。
        // 用内层 span 而不是给 td 加类，是因为 -webkit-line-clamp 会改 display，加在 td 上会毁掉表格布局。
        return `<td class="${fixed}cell-wrap ${mono ? 'cell-code ' : ''}copy-cell" ${copyAttr}`
          + ` title="点击复制: ${esc(text)}"><span class="cell-clamp">${esc(text)}</span></td>`;
      }).join('');
      return `<tr class="${overdue.trim()}" data-index="${index}">
        ${cells}
        <td class="col-op"><button class="text-btn" type="button" data-jump="${index}"
                title="在 ITAMP 服务搜索中查看该订阅关系（新窗口）">查 看</button></td>
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
   * @param {Function} [onProgress] (done, total) => void，每完成一页调用一次
   */
  async function fetchAll(onProgress) {
    const want = Math.min(state.total, BULK_MAX);
    const fetchP = (p) => window.ToolApi.fetchSubscriptionPublishHistory({
      ...state.cond, pageNum: p, pageSize: BULK_PAGE_SIZE,
    });

    const first = await fetchP(1);
    if (!first.ok) throw new Error(first.error || '未知错误');
    const pageRows = new Map([[1, decorateRows(first.rows || [])]]);
    let got = (first.rows || []).length;

    if (!got || got >= want) {
      return { rows: (pageRows.get(1) || []).slice(0, want), truncated: state.total > BULK_MAX };
    }

    const pageCount = Math.ceil(want / BULK_PAGE_SIZE);
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
    return { rows: out.slice(0, want), truncated: state.total > BULK_MAX };
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

  // 批次时间的读写 / 弹窗全部在 js/page/subscription-batch-times.js（见该文件头说明）。
  // 这里只留「把配置喂给优先级 + 重算重绘」，因为要碰本页的 state / decorateRow / render。
  function refreshPriority() {
    window.SubscriptionBatchTimes.applyToPriority();
    if (Array.isArray(state.allRows)) redecorateRows(state.allRows);
    else if (Array.isArray(state.rows)) redecorateRows(state.rows);
    if (state.queried) render();
  }

  if (window.SubscriptionBatchTimes) {
    // 弹窗的行 = 批次字典里落在近 12 个月窗口内的批次（月度 + 独立，见 subscription-batch-times.js）
    window.SubscriptionBatchTimes.init({ toast, setLoading, batchWindow, refreshPriority });
  }

  // 薄封装：bindEvents / boot 里的调用点保持不变
  const openBatchTimeDialog = () => window.SubscriptionBatchTimes.open();
  const closeBatchTimeDialog = () => window.SubscriptionBatchTimes.close();
  const saveBatchTimes = () => window.SubscriptionBatchTimes.save();
  const loadBatchTimes = () => window.SubscriptionBatchTimes.load();

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
    loadDicts();
    loadBatchTimes();            // 批次时间本地配置（弹窗打开时用它预填）
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
