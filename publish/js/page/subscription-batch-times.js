/**
 * 订阅页「批量修改批次时间」子模块（从 subscription.js 拆出）
 *
 * ── 为什么单独成文件 ────────────────────────────────
 * 这段逻辑高度内聚（配置读写 + 弹窗渲染 + 预演基线转换 + 落盘），
 * 与「查询 / 渲染 / 分页」几乎不交叉，是最适合先切出来的一块。
 *
 * ── 依赖怎么来 ─────────────────────────────────────
 * 页面 own 的状态（state / decorateRow / render）不搬过来，改用注入：
 *   init({ toast, setLoading, batchWindow, refreshPriority, batchOptions })
 * 这样模块只管「批次时间」这一件事，不反向依赖页面的私有状态。
 *   · batchWindow  () => 近 12 个月窗口的批次 label
 *   · batchOptions () => 接口返回的真实批次列表 [{ label, value }]（含「26年8月独立批次」这类独立批次）
 *
 * ── 选择栏的取值规则（2026-09-14 定）───────────────────
 *   批次   ：常规月度批次（2608批次）与独立批次（26年8月独立批次）都要能选，
 *            两者都必须能解析出年月（否则算不出默认时间与可选范围）。
 *   功测时间：默认 = 批次月的**上一个月**；可选范围 = 批次月前 3 个月 ~ 批次月。
 *   上线时间：默认 = **批次月当月**；可选范围 = 批次月 ~ 批次月后 3 个月。
 *   联动   ：切换批次 → 两个时间重建选项并按上述默认值回填，用户仍可手动改。
 *   跨年   ：月份位移一律交给 Date 进位（2601批次 的功测时间 = 上一年 12 月）。
 *   落盘   ：界面只到年月，存 'YYYY-MM-15'（沿用里程碑「15 日」的口径）。
 *
 * ── 落盘路径（不走 ITAMP 后端）────────────────────────
 *   GET/POST local/batch-times（代理端点，写 config/batch-times.json）
 *   → 静态 config/batch-times.json → localStorage，三级降级。
 */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  // 延迟取，避免又多一处「脚本加载顺序敏感」的坑
  const esc = (v) => ((window.Fmt && window.Fmt.esc) || ((x) => String(x ?? '')))(v);

  /** 批次切换后两个时间的默认值与可选范围（相对批次月的月偏移，负数=往前） */
  const TEST_OFFSETS = { min: -3, max: 0, def: -1 };    // 功测：前 3 个月 ~ 当月，默认上一个月
  const RELEASE_OFFSETS = { min: 0, max: 3, def: 0 };   // 上线：当月 ~ 后 3 个月，默认当月
  const DEADLINE_DAY = 15;      // 落盘用的日号：与 js/ui/priority.js 的里程碑口径一致

  let batchTimes = {};          // 已落盘的配置 { '2609批次': { testDate, releaseDate } }
  let currentBatch = '';        // 选择栏当前选中的批次
  let barSelects = {};          // id -> searchable-select 实例（btBatch / btTest / btRelease）

  /** 页面注入的依赖：{ toast, setLoading, batchWindow, refreshPriority, batchOptions } */
  let deps = {};

  function init(injected) { deps = injected || {}; }

  function getBatchTimes() { return batchTimes; }

  /** 把批次时间配置注入优先级计算（设了日期 → 该批次截止日以所设日期为准） */
  function applyToPriority() {
    if (window.Priority && typeof window.Priority.setBatchTimes === 'function') {
      window.Priority.setBatchTimes(batchTimes);
    }
  }

  // ═══════════════════════════════════════════════════
  // 年月换算（纯函数：跨年交给 Date 自己进位）
  // ═══════════════════════════════════════════════════

  function pad2(n) { return String(n).padStart(2, '0'); }

  /**
   * 月份位移后的 'YYYY-MM'。month1 是 1~12，offset 可正可负 ——
   * 跨年由 Date 自己进位（month 传 0 / 13 / -1 都合法），不要手写 year--/year++。
   */
  function monthKey(year, month1, offset) {
    const d = new Date(year, month1 - 1 + offset, 1);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  }

  /** 'YYYY-MM' → { year, month }；非法返回 null */
  function parseYm(key) {
    const m = /^(\d{4})-(\d{1,2})$/.exec(String(key ?? '').trim());
    if (!m) return null;
    const month = Number(m[2]);
    if (month < 1 || month > 12) return null;
    return { year: Number(m[1]), month };
  }

  /** '2026-07' → '26年7月'（界面展示用） */
  function ymLabel(key) {
    const ym = parseYm(key);
    return ym ? `${String(ym.year).slice(2)}年${ym.month}月` : '—';
  }

  /** 界面的 'YYYY-MM' → 落盘的 'YYYY-MM-15' */
  function toStoredDate(key) {
    const ym = parseYm(key);
    return ym ? `${ym.year}-${pad2(ym.month)}-${pad2(DEADLINE_DAY)}` : '';
  }

  /** 落盘的 'YYYY-MM-DD'（含旧数据）→ 界面的 'YYYY-MM' */
  function toMonthKey(value) {
    const m = /^(\d{4})-(\d{1,2})/.exec(String(value ?? '').trim());
    if (!m) return '';
    const month = Number(m[2]);
    if (month < 1 || month > 12) return '';
    return `${m[1]}-${pad2(month)}`;
  }

  /** 批次 label → { year, month }；解析不出返回 null（复用 Priority 的解析，保持一处口径） */
  function batchYmOf(label) {
    if (!window.Priority || typeof window.Priority.parseBatchYearMonth !== 'function') return null;
    return window.Priority.parseBatchYearMonth(label);
  }

  /** 某批次的默认时间 / 可选范围 / 已保存值 */
  function timePlanFor(batchLabel) {
    const ym = batchYmOf(batchLabel);
    if (!ym) return { ym: null };

    const testOptions = [];
    for (let off = TEST_OFFSETS.min; off <= TEST_OFFSETS.max; off += 1) {
      testOptions.push(monthKey(ym.year, ym.month, off));
    }
    const releaseOptions = [];
    for (let off = RELEASE_OFFSETS.min; off <= RELEASE_OFFSETS.max; off += 1) {
      releaseOptions.push(monthKey(ym.year, ym.month, off));
    }

    const saved = batchTimes[batchLabel] || {};
    const defaultTest = monthKey(ym.year, ym.month, TEST_OFFSETS.def);
    const defaultRelease = monthKey(ym.year, ym.month, RELEASE_OFFSETS.def);

    return {
      ym,
      testOptions,
      releaseOptions,
      defaultTest,
      defaultRelease,
      // 已保存的值优先（即使超出默认范围也保留，见 optionList）；没有就用默认值
      test: toMonthKey(saved.testDate) || defaultTest,
      release: toMonthKey(saved.releaseDate) || defaultRelease,
    };
  }

  /** 月份选项：前面留一个「（不设置）」，超出范围的已保存值也补进来（旧数据不丢） */
  function optionList(keys, savedKey) {
    const opts = keys.map((k) => ({ value: k, label: ymLabel(k) }));
    if (savedKey && !keys.includes(savedKey)) {
      opts.unshift({ value: savedKey, label: `${ymLabel(savedKey)}（已保存，超出默认范围）` });
    }
    return [{ value: '', label: '（不设置）' }].concat(opts);
  }

  /** 批次展示文案：纯数字型（2608批次）补一个「（26年8月）」；本身带年月的独立批次不加 */
  function batchOptionLabel(label) {
    const ym = batchYmOf(label);
    if (!ym || /\d\s*年\s*\d+\s*月/.test(String(label))) return String(label);
    return `${label}（${ymLabel(monthKey(ym.year, ym.month, 0))}）`;
  }

  /** 年+月倒序（新的在前；解析不出年月的排最后） */
  function byYmDesc(a, b) {
    const ya = batchYmOf(a);
    const yb = batchYmOf(b);
    if (!ya && !yb) return String(a).localeCompare(String(b), 'zh-CN');
    if (!ya) return 1;
    if (!yb) return -1;
    return (yb.year * 12 + yb.month) - (ya.year * 12 + ya.month);
  }

  // ═══════════════════════════════════════════════════
  // 配置读写（不走 ITAMP 后端）
  // ═══════════════════════════════════════════════════

  /**
   * 读取批次时间配置（不走 ITAMP 后端）。三级降级：
   *   1) 代理的本地端点 GET /local/batch-times（可写回文件，开发态首选）
   *   2) 静态文件 config/batch-times.json（手改即可生效；静态部署时走这条）
   *   3) localStorage（无代理、无文件时的兜底）
   */
  async function load() {
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
      try {
        batchTimes = JSON.parse(localStorage.getItem('itamp.batchTimes') || '{}') || {};
      } catch (_) { batchTimes = {}; }
    }
    if (deps.refreshPriority) deps.refreshPriority();
  }

  /** 保存批次时间：优先写回配置文件（代理端点）；失败落 localStorage。返回 { ok, where|error } */
  async function persist(map) {
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

  // ═══════════════════════════════════════════════════
  // 弹窗：选择栏 + 已保存一览
  // ═══════════════════════════════════════════════════

  /** 可选批次：接口真实列表（含独立批次）+ 近 12 个月窗口 + 已保存的，去重后倒序 */
  function batchCandidates() {
    const fromApi = (typeof deps.batchOptions === 'function' ? deps.batchOptions() : [])
      .map((o) => (o && (o.label || o.value)) || '');
    const win = (typeof deps.batchWindow === 'function' ? deps.batchWindow() : []) || [];
    const saved = Object.keys(batchTimes || {});
    const all = new Set([...fromApi, ...win, ...saved].filter(Boolean));
    // 只保留能解析出年月的：时间默认值与可选范围都依赖批次月
    return Array.from(all).filter((b) => batchYmOf(b)).sort(byYmDesc);
  }

  /** 批次切换后：重建两个时间的选项 + 回填（已保存优先，否则默认） */
  function syncTimes() {
    const plan = timePlanFor(currentBatch);
    const rangeEl = $('#btRange');

    if (!plan.ym) {
      [barSelects.btTest, barSelects.btRelease].forEach((s) => { if (s) s.updateOptions([]); });
      if (rangeEl) rangeEl.textContent = '该批次解析不出年月，无法给出默认时间与可选范围。';
      return;
    }

    const saved = batchTimes[currentBatch] || {};
    if (barSelects.btTest) {
      barSelects.btTest.updateOptions(optionList(plan.testOptions, toMonthKey(saved.testDate)));
      barSelects.btTest.setValue(plan.test);
    }
    if (barSelects.btRelease) {
      barSelects.btRelease.updateOptions(optionList(plan.releaseOptions, toMonthKey(saved.releaseDate)));
      barSelects.btRelease.setValue(plan.release);
    }
    if (rangeEl) {
      rangeEl.textContent =
        `可选范围：功测时间 ${ymLabel(plan.testOptions[0])} ~ ${ymLabel(plan.testOptions[plan.testOptions.length - 1])}`
        + `（默认 ${ymLabel(plan.defaultTest)}）；`
        + `上线时间 ${ymLabel(plan.releaseOptions[0])} ~ ${ymLabel(plan.releaseOptions[plan.releaseOptions.length - 1])}`
        + `（默认 ${ymLabel(plan.defaultRelease)}）。落盘按当月 ${DEADLINE_DAY} 日计。`;
    }
  }

  /** 已保存一览（只读 + 「载入」把该批次放回选择栏改） */
  function renderList() {
    const tbody = $('#batchTimeList');
    if (!tbody) return;
    const keys = Object.keys(batchTimes || {}).sort(byYmDesc);
    if (!keys.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="bt-empty">还没有保存过任何批次时间</td></tr>';
      return;
    }
    tbody.innerHTML = keys.map((b) => {
      const v = batchTimes[b] || {};
      return `<tr>
        <td class="batch-label">${esc(batchOptionLabel(b))}</td>
        <td>${esc(ymLabel(toMonthKey(v.testDate)))}</td>
        <td>${esc(ymLabel(toMonthKey(v.releaseDate)))}</td>
        <td><button type="button" class="text-btn" data-load="${esc(b)}">载入</button></td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('button[data-load]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const batch = btn.dataset.load;
        if (!batch || !barSelects.btBatch) return;
        barSelects.btBatch.setValue(batch);
        currentBatch = batch;
        syncTimes();
      });
    });
  }

  function buildBarSelects() {
    if (typeof window.createSearchableSelect !== 'function') return;
    ['btBatch', 'btTest', 'btRelease'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el || barSelects[id]) return;
      barSelects[id] = window.createSearchableSelect(el, [], {});
    });

    // 联动：组件选中时会给原生 <select> 派发冒泡的 change（setValue 是静默的，
    // 所以「载入」这类主动赋值的场景要自己调 syncTimes）。
    const batchEl = document.getElementById('btBatch');
    if (batchEl && !batchEl.dataset.btBound) {
      batchEl.dataset.btBound = '1';
      batchEl.addEventListener('change', () => {
        currentBatch = String(batchEl.value || '').trim();
        syncTimes();
      });
    }
  }

  /** 打开弹窗：填批次下拉 → 联动带出两个时间 → 渲染已保存一览 */
  function open() {
    buildBarSelects();
    const batches = batchCandidates();
    if (barSelects.btBatch) {
      barSelects.btBatch.updateOptions(batches.map((b) => ({ value: b, label: batchOptionLabel(b) })));
      currentBatch = batches.includes(currentBatch) ? currentBatch : (batches[0] || '');
      barSelects.btBatch.setValue(currentBatch);
    }
    syncTimes();
    renderList();
    $('#batchTimeOverlay').classList.add('show');
    if (window.DialogUtils && window.DialogUtils.lockScroll) window.DialogUtils.lockScroll();
    $('#batchTimeDialog').focus();
  }

  function close() {
    $('#batchTimeOverlay').classList.remove('show');
    if (window.DialogUtils && window.DialogUtils.unlockScroll) window.DialogUtils.unlockScroll();
  }

  /**
   * 基线状态转换规则：设置时间后，该批次下所有订阅关系按以下规则自动升级 status。
   * 本页只负责把时间存进本地配置（config/batch-times.json），**不调后端**；
   * 这里预演「会触发哪些转换」给用户确认。
   */
  const BASELINE_TRANSITIONS = [
    { from: '开发基线',     to: '功能测试基线', dateField: 'testDate' },
    { from: '功能测试基线', to: '正式版基线',   dateField: 'releaseDate' },
  ];

  /** 选择栏当前值（'YYYY-MM'，未设置为 ''） */
  function barValues() {
    const test = barSelects.btTest ? String(barSelects.btTest.getValue() || '').trim() : '';
    const release = barSelects.btRelease ? String(barSelects.btRelease.getValue() || '').trim() : '';
    return { test, release };
  }

  /**
   * 保存：把选择栏里的两个月份写入本地配置（针对当前批次，不走 ITAMP 后端）。
   *   1. 校验批次与两个时间的先后顺序  2. 预演基线转换并确认  3. 合并落盘
   */
  async function save() {
    const toast = deps.toast || (() => {});
    const setLoading = deps.setLoading || (() => {});
    const btn = $('#btnBatchTimeSave');
    if (!currentBatch) { toast('⚠️ 请先选择批次', 2200); return; }

    const { test, release } = barValues();
    if (!test && !release) { toast('⚠️ 功测时间与上线时间至少设置一个', 2200); return; }
    // 功测不该晚于上线（值都是 'YYYY-MM'，字符串比较即可）
    if (test && release && test > release) {
      toast(`⚠️ 功测时间（${ymLabel(test)}）不能晚于上线时间（${ymLabel(release)}）`, 3200);
      return;
    }

    const nextTestDate = toStoredDate(test);
    const nextReleaseDate = toStoredDate(release);
    const saved = batchTimes[currentBatch] || {};
    if (nextTestDate === (saved.testDate || '') && nextReleaseDate === (saved.releaseDate || '')) {
      toast('⚠️ 该批次的时间没有变化', 2000);
      return;
    }

    if (btn) { btn.disabled = true; btn.textContent = '保存中…'; }
    setLoading(true);

    try {
      const hint = BASELINE_TRANSITIONS
        .filter((rule) => (rule.dateField === 'testDate' ? test : release))
        .map((rule) => `${currentBatch}：${rule.from} → ${rule.to}`)
        .join('；\n');
      if (hint) {
        const confirmMsg =
          `以下批次设置了时间，真实系统里会触发对应基线状态转换：\n${hint}\n\n`
          + `功测 ${test ? ymLabel(test) + '（' + nextTestDate + '）' : '不设置'}；`
          + `上线 ${release ? ymLabel(release) + '（' + nextReleaseDate + '）' : '不设置'}\n\n`
          + `（本页只把时间保存到本地配置，不调后端）是否继续保存？`;
        if (!window.confirm(confirmMsg)) return;
      }

      const next = Object.assign({}, batchTimes);
      next[currentBatch] = { testDate: nextTestDate, releaseDate: nextReleaseDate };
      const savedRes = await persist(next);
      if (!savedRes.ok) {
        toast(`⚠️ 保存失败：${savedRes.error}`, 3500);
        return;
      }
      batchTimes = next;
      toast(`✅ 已保存 ${currentBatch} 的时间（${savedRes.where}）`, 2600);
      renderList();
      syncTimes();
      if (deps.refreshPriority) deps.refreshPriority();
    } catch (e) {
      toast(`⚠️ 保存失败：${e.message || String(e)}`, 3000);
    } finally {
      setLoading(false);
      if (btn) { btn.disabled = false; btn.textContent = '保 存'; }
    }
  }

  window.SubscriptionBatchTimes = Object.freeze({
    init, load, open, close, save, getBatchTimes, applyToPriority,
    // 纯函数：月份规则是这次改动的核心，必须能被单测直接断言
    _rules: {
      TEST_OFFSETS, RELEASE_OFFSETS, DEADLINE_DAY,
      monthKey, parseYm, ymLabel, toStoredDate, toMonthKey,
    },
  });
})();
