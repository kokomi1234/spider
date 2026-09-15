/**
 * 订阅页「批量修改批次时间」子模块（从 subscription.js 拆出）
 *
 * ── 界面形态（2026-09-15 定案：表格，不用选择栏）────────────
 * 弹窗里是一张表，一行一个批次，两列日期输入：
 *     批次 | 功能测试时间 | 上线时间
 * 直接就地改，改完一次保存。没有「先选批次再填时间」的选择栏，也没有「已保存一览 + 载入」。
 *
 * ── 日期精确到日 ──────────────────────────────────────
 * 两列都是完整日期（YYYY-MM-DD，走全站同款的 createDatePicker），**不按 15 号取整**。
 * 存进配置的就是所选日期；优先级里的里程碑截止日以它为准（`priority.js` 的
 * evaluate() 会返回 from:'config'）。
 * 没设过的行保持空白、不塞默认值 —— 否则一次保存会把整张表的默认值都写进配置。
 *
 * ── 行从哪来 ─────────────────────────────────────────
 *   1) 近 12 个月窗口的常规月度批次（deps.batchWindow）
 *   2) 当前查询结果里出现过的批次（deps.observedBatches）—— 独立批次（如「26年8月独立批次」）
 *      不在月度窗口里，但用户确实在结果里看得到，要能给它设时间
 *   3) 已经保存过的批次（放最后，保证历史配置不丢、还能继续改）
 *
 * ── 依赖怎么来 ─────────────────────────────────────
 * 页面 own 的状态（state / decorateRow / render）不搬过来，改用注入：
 *   init({ toast, setLoading, batchWindow, observedBatches, refreshPriority })
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

  let batchTimeData = [];   // 弹窗内的可编辑行 { batch, testDate, releaseDate }
  let batchTimes = {};      // 已落盘的配置 { '2609批次': { testDate, releaseDate } }

  /** 页面注入的依赖：{ toast, setLoading, batchWindow, observedBatches, refreshPriority } */
  let deps = {};

  function init(injected) { deps = injected || {}; }

  function getBatchTimes() { return batchTimes; }

  /** 把批次时间配置注入优先级计算（设了日期 → 该批次截止日以所设日期为准） */
  function applyToPriority() {
    if (window.Priority && typeof window.Priority.setBatchTimes === 'function') {
      window.Priority.setBatchTimes(batchTimes);
    }
  }

  /**
   * 读取批次时间配置（不走 ITAMP 后端）。三个来源按「**有数据的**优先」取，
   * 而不是「第一个成功就当准」：
   *   1) 代理的本地端点 GET /local/batch-times（可写回文件，开发态首选）
   *   2) 静态文件 config/batch-times.json（手改即可生效；静态部署时走这条）
   *   3) localStorage（无代理、无文件时的兜底）
   * ⚠️ 静态部署时随包发的 config/batch-times.json 是**空的**：按「第一个成功」取会让它
   *    永远盖住 localStorage 里用户真正保存过的批次 —— 表现就是「刚保存的行 / 独立批次，
   *    重开弹窗就没了」。所以这里按顺序读，只有拿到条目才采用。
   */
  async function load() {
    const pick = (obj) => (obj && typeof obj.batchTimes === 'object' && obj.batchTimes) || null;
    const hasKeys = (m) => !!m && Object.keys(m).length > 0;

    let fromFile = null;
    try {
      const r = await fetch('local/batch-times', { headers: { Accept: 'application/json' } });
      if (r.ok) fromFile = pick((await r.json()).data);
    } catch (_) { /* 代理端点不可用，继续降级 */ }
    if (!fromFile) {
      try {
        const r2 = await fetch('config/batch-times.json', { cache: 'no-store' });
        if (r2.ok) fromFile = pick(await r2.json());
      } catch (_) { /* 文件不存在，继续降级 */ }
    }

    let fromLocal = null;
    try { fromLocal = JSON.parse(localStorage.getItem('itamp.batchTimes') || 'null'); } catch (_) { /* 存坏了当没存过 */ }

    // 文件/端点有内容就用它；是空的（静态部署那份空模板）→ 退回 localStorage。
    // 保存时两边都会写（见 persist），所以正常路径下两者内容一致。
    batchTimes = (fromFile && typeof fromFile === 'object') ? fromFile : {};
    if (!hasKeys(batchTimes) && fromLocal && typeof fromLocal === 'object') batchTimes = fromLocal;

    if (deps.refreshPriority) deps.refreshPriority();
  }

  /**
   * 保存批次时间。**localStorage 先镜像一份**（静态部署下它是唯一存储），
   * 再尽力写回代理端点 → config/batch-times.json。返回 { ok, where|error }
   */
  async function persist(map) {
    // 先落地到 localStorage：即使后面写文件失败，用户填的东西也不会丢
    try { localStorage.setItem('itamp.batchTimes', JSON.stringify(map)); } catch (_) { /* 隐私模式等，忽略 */ }

    try {
      const r = await fetch('local/batch-times', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchTimes: map }),
      });
      if (r.ok) return { ok: true, where: 'config/batch-times.json' };
      const j = await r.json().catch(() => ({}));
      // 端点存在但写失败（权限/磁盘等）：不要谎报「写进了文件」，但数据已在 localStorage 里，
      // 明确告诉用户落在哪，别让他以为白填了。
      return { ok: true, where: 'localStorage（配置文件写入失败：' + ((j && j.msg) || ('HTTP ' + r.status)) + '）' };
    } catch (_) { /* 无代理端点 → 就用 localStorage */ }
    return { ok: true, where: 'localStorage' };
  }

  /** 弹窗内已创建的日期选择器实例。重渲染前必须先 destroy：
      createDatePicker 会在 document 上挂 click / keydown 监听，直接覆盖 innerHTML
      会把监听留在 document 上（旧 input 成了游离节点，越点越卡）。 */
  let datePickers = [];

  /**
   * 该批次的「默认」功测 / 上线时间（按批次月推算，只看规则不看已保存配置）。
   * 口径的唯一来源是 `priority.js` 的 defaultDeadlines()（功测 = 批次月 −1 的 15 日、
   * 上线 = 批次月 15 日），弹窗只负责把它显示出来，不自己算 —— 避免两处规则各算一套。
   */
  function defaultDatesOf(batch) {
    const P = window.Priority;
    if (P && typeof P.defaultDeadlines === 'function') return P.defaultDeadlines(batch);
    return { testDate: '', releaseDate: '' };
  }

  /** 一个日期格：输入框 + 该批次的默认口径提示（没设过时给用户一个参照，不预填值） */
  function dateCell(item, idx, field) {
    const def = defaultDatesOf(item.batch)[field];
    const tip = def
      ? `默认 ${def}（按批次月推算：功能测试 = 批次月 −1 的 15 日，上线 = 批次月 15 日）`
      : '该批次解析不出年月，默认时间无法推算';
    return `<td><input type="text" class="batch-time-date" data-idx="${idx}" data-field="${field}"
                   value="${esc(item[field])}" placeholder="选择日期" readonly>
        <span class="bt-default" title="${esc(tip)}">${def ? '默认 ' + esc(def) : '默认 —'}</span></td>`;
  }

  function renderList() {
    const tbody = $('#batchTimeList');
    datePickers.forEach((dp) => { if (dp && typeof dp.destroy === 'function') dp.destroy(); });
    datePickers = [];

    tbody.innerHTML = batchTimeData.map((item, idx) => `<tr>
        <td class="batch-label">${esc(item.batch)}</td>
        ${dateCell(item, idx, 'testDate')}
        ${dateCell(item, idx, 'releaseDate')}
      </tr>`).join('');

    const inputs = Array.from(tbody.querySelectorAll('input.batch-time-date'));

    // 日期统一走全站同款 createDatePicker（js/ui/date-picker.js + theme.css 的 .dp-* ）：
    // 精确到日，与筛选区、任务单页同一个控件。
    // 组件缺失（脚本顺序错 / 静态裁剪）时降级为可直接输入的文本框，功能不丢。
    if (typeof window.createDatePicker === 'function') {
      inputs.forEach((inputEl) => {
        const dp = window.createDatePicker(inputEl);
        if (dp) datePickers.push(dp);
      });
    } else {
      inputs.forEach((inputEl) => { inputEl.readOnly = false; });
    }

    // 选中日期时组件会向原始 input 派发冒泡的 change —— 这里只把值记回 batchTimeData，
    // 不触发任何接口（落盘统一在 save() 做）。
    inputs.forEach((input) => {
      input.addEventListener('change', () => {
        const idx = Number(input.dataset.idx);
        const field = input.dataset.field;
        if (batchTimeData[idx]) batchTimeData[idx][field] = input.value;
      });
    });
  }

  /** 打开弹窗：窗口批次 + 结果里出现的批次 + 已保存的批次，回填已保存的日期 */
  function open() {
    const batchWindow = (typeof deps.batchWindow === 'function' ? deps.batchWindow() : []) || [];
    const observed = (typeof deps.observedBatches === 'function' ? deps.observedBatches() : []) || [];
    const batches = Array.from(new Set([...batchWindow, ...observed, ...Object.keys(batchTimes)]));

    batchTimeData = batches.map((b) => {
      const saved = batchTimes[b] || {};
      // 只回填已保存的值；没设过的行留空，避免「一保存就把默认值全写进配置」
      return { batch: b, testDate: saved.testDate || '', releaseDate: saved.releaseDate || '' };
    });
    renderList();
    $('#batchTimeOverlay').classList.add('show');
    if (window.DialogUtils && window.DialogUtils.lockScroll) window.DialogUtils.lockScroll();
    $('#batchTimeDialog').focus();
  }

  function close() {
    $('#batchTimeOverlay').classList.remove('show');
    if (window.DialogUtils && window.DialogUtils.unlockScroll) window.DialogUtils.unlockScroll();
    batchTimeData = [];
  }

  /**
   * 基线状态转换规则：设置日期后，该批次下所有订阅关系按以下规则自动升级 status。
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
   * 保存：把弹窗里填的日期写入本地配置（不走 ITAMP 后端）。
   *   1. 校验有修改的批次  2. 预演基线转换并确认  3. 合并落盘
   * 只写「相对已保存配置有变化」的行 —— 否则整张表都会被写进配置。
   */
  async function save() {
    const toast = deps.toast || (() => {});
    const setLoading = deps.setLoading || (() => {});
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
        close();
        return;
      }

      // ── 预演基线状态转换（仅用于展示给用户看）──
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

      // ── 合并进配置并落盘（日期原样保存，不做「15 号」之类的取整）──
      const next = Object.assign({}, batchTimes);
      changed.forEach((it) => {
        next[it.batch] = { testDate: it.testDate || '', releaseDate: it.releaseDate || '' };
      });
      const savedRes = await persist(next);
      if (!savedRes.ok) {
        toast(`⚠️ 保存失败：${savedRes.error}`, 3500);
        return;
      }
      batchTimes = next;
      toast(`✅ 已保存 ${changed.length} 个批次的日期（${savedRes.where}）`, 2600);
      close();
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
  });
})();
