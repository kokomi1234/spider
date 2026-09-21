/**
 * 首页字典下拉的加载与组件创建（从 index.js 拆出来的那一大段）。
 *
 * 职责只有一件：取数据 → 建下拉 → 把实例交回调用方。**不碰查询、渲染、分页**。
 * 以前这段 250 多行混在 index.js 的 IIFE 里，和查询/渲染共用一堆闭包变量，
 * 既撑大了文件，也让「改个下拉」需要在 1600 行里翻。
 *
 * 用法（index.js）：
 *   const b = await window.DictSelects.initBatchList(makeSelect);
 *   if (b && b.instance) batchSelectInstance = b.instance;   // 赋值在 index.js，setter 照常生效
 *
 * makeSelect 由调用方传入（内部会登记到 selectInstances 供「重置」逐个 clear）。
 */
(function () {
  'use strict';

  // 跨模块依赖一律**调用时再取**：若在 IIFE 顶层捕获（const notify = window.toast），
  // 一旦 toast.js / debug.js 排到本文件之后，提示与日志会永久退化成空操作且不报错。
  const log = (...a) => (window.debugLog || (() => {}))(...a);
  const notify = (...a) => (window.toast || (() => {}))(...a);
  const $ = (sel) => document.querySelector(sel);

  /** 加载失败时的常用批次兜底（与原来写死在页面里的那份一致） */
  const COMMON_BATCHES = [
    { label: '2606批次', value: '2606' },
    { label: '26年8月独立', value: '268dl' },
    { label: '2404批次', value: '2404' },
    { label: '2401批次', value: '332' },
    { label: '2608批次', value: '2608' },
    { label: '2607批次', value: '2607' },
    { label: '2402批次', value: '350' },
    { label: '2511批次', value: '2511' },
    { label: '2412批次', value: '2412' },
    { label: '2605批次', value: '2605' },
    { label: '24年3月独立', value: '340' },
  ];

  /** 用普通 <option> 填充原生 select（searchable-select 不可用时的降级） */
  function fillNativeSelect(el, options, firstLabel, disableFirst) {
    el.innerHTML = '';
    const head = document.createElement('option');
    head.value = '';
    head.textContent = firstLabel;
    head.disabled = !!disableFirst;
    el.appendChild(head);
    options.forEach((o) => {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      el.appendChild(opt);
    });
  }

  /** 批次下拉（数据源：window.loadBatchList，来自 js/data/batch-data.js） */
  async function initBatchList(makeSelect) {
    const el = $('#f_prodBatch');
    if (!el) { console.warn('找不到批次选择器 #f_prodBatch'); return null; }

    let batches = [];
    try {
      if (typeof window.loadBatchList !== 'function') {
        throw new Error('batch-data.js 未加载或执行失败');
      }
      log('🔄 开始加载批次列表...');
      batches = await window.loadBatchList();
      log(`✅ 批次列表加载完成: 共 ${batches.length} 个批次`);

      const inst = makeSelect ? makeSelect(el, batches) : null;
      if (inst) {
        log('✅ 批次下拉搜索组件初始化完成');
        return { instance: inst, options: batches };
      }
      // 组件不可用 → 降级成原生 select
      fillNativeSelect(el, batches, '（全部）', false);
      log('⚠️ 使用降级方案：普通下拉列表');
      return { instance: null, options: batches };
    } catch (err) {
      console.error('批次列表加载失败:', err);
      fillNativeSelect(el, COMMON_BATCHES, '加载失败，请选择', true);
      notify('⚠️ 批次列表加载失败，已填充常用批次', 4500, 'warn');
      return { instance: null, options: [] };
    }
  }

  /** 部门下拉（数据源：window.loadDepartmentList，来自 js/data/department-data.js） */
  async function initDepartmentList(makeSelect, deptsToOptions) {
    const el = $('#f_deptName');
    if (!el) { console.warn('找不到部门输入框 #f_deptName'); return null; }

    try {
      if (typeof window.loadDepartmentList !== 'function') {
        throw new Error('department-data.js 未加载或执行失败');
      }
      log('🔄 开始加载部门列表...');
      const depts = await window.loadDepartmentList();
      log(`✅ 部门列表加载完成: 共 ${depts.length} 个部门`);
      const options = deptsToOptions ? deptsToOptions(depts) : depts;

      const inst = makeSelect ? makeSelect(el, options) : null;
      if (inst) { log('✅ 部门下拉搜索组件初始化完成'); return { instance: inst, options }; }
      log('⚠️ 使用降级方案：部门仅支持手动输入');
      return { instance: null, options };
    } catch (err) {
      console.error('部门列表加载失败:', err);
      notify('⚠️ 部门列表加载失败，可手动输入部门名称筛选', 4500, 'warn');
      return { instance: null, options: [] };
    }
  }

  /** 提供方系统下拉，并默认选中 E00301（数据源：window.loadProviderList） */
  async function initProviderList(makeSelect) {
    const el = $('#f_provideSystemNumber');
    if (!el) { console.warn('找不到提供方系统选择器 #f_provideSystemNumber'); return null; }

    try {
      if (typeof window.loadProviderList !== 'function') {
        throw new Error('provider-data.js 未加载或执行失败');
      }
      log('🔄 开始加载提供方系统列表...');
      const providers = await window.loadProviderList();
      log(`✅ 提供方系统列表加载完成: 共 ${providers.length} 个系统`);

      const inst = makeSelect ? makeSelect(el, providers) : null;
      if (inst) {
        log('✅ 提供方系统下拉搜索组件初始化完成');
        try {
          inst.setValue('E00301');   // 互联网金融服务平台-BOCNET-G-IFS
          log('✅ 已默认选中 E00301（互联网金融服务平台）');
        } catch (_) {
          console.warn('默认选中 E00301 失败，列表可能不包含该系统');
        }
        return { instance: inst, options: providers };
      }
      fillNativeSelect(el, providers, '（全部）', false);
      el.value = 'E00301';
      return { instance: null, options: providers };
    } catch (err) {
      console.error('提供方系统列表加载失败:', err);
      fillNativeSelect(el, [], '加载失败，请手动输入', true);
      notify('⚠️ 提供方系统列表加载失败，可手动输入编号筛选', 4500, 'warn');
      return { instance: null, options: [] };
    }
  }

  /**
   * 选项固定（或禁用）的几个控件：CHECKOUT/IN 状态、是否发送行外系统、服务状态、变更时间。
   * @returns {{checkout: object|null, changeTime: object|null}}
   */
  function initStaticSelects(makeSelect) {
    const out = { checkout: null, changeTime: null };

    // 2026-09-21 用户要求：改成**可选**（原先「后端无对应筛选字段」所以禁用）。
    // 取值由用户直接告知（不需要抓包）：CHECKOUT / CHECKIN，不是 IN。
    // 「全部」= 空串 = 不下发（见 publish.js 的 collectApiBody）。
    // 「选具体值才下发」是为了不动 API_BODY_DEFAULTS 那 17 个字段的契约：
    // 本地代理的缓存 key = sha1(method+path+query+body)，多一个字段会让
    // publish/cache/ 里已录制的条目全部失效。
    // ⚠️ 参数名 checkOutInStatus 仍**没有抓包实证** —— 2026-09-21 用户给的
    // temp.har 里 getPublishDataList 的请求体就是那 17 个字段、不含本项，
    // 也没有对应的字典接口。按字段名直译，将来有实证再修。
    const checkoutEl = $('#f_checkoutInStatus');
    if (checkoutEl && makeSelect) {
      out.checkout = makeSelect(checkoutEl, [
        { value: '', label: '全部' },
        { value: 'CHECKOUT', label: 'CHECKOUT' },
        { value: 'CHECKIN', label: 'CHECKIN' },
      ], { disabled: false });
      if (out.checkout) out.checkout.setValue('');   // 默认「全部」
      log('✅ CHECKOUT/IN 状态下拉已初始化（全部 / CHECKOUT / CHECKIN）');
    }

    ['#f_sendOutSide', '#f_serviceStatus'].forEach((sel) => {
      const el = $(sel);
      if (el && makeSelect) makeSelect(el, [], { disabled: false });
    });
    log('✅ 是否发送行外系统 / 服务状态下拉已统一为 input 风格');

    // 变更时间：原始 input 仍是唯一值来源，日期面板只是输入辅助
    const timeEl = $('#f_changeTime');
    if (timeEl && typeof window.createDatePicker === 'function') {
      out.changeTime = window.createDatePicker(timeEl);
      log('✅ 变更时间日期选择器已初始化（日历弹层）');
    }
    return out;
  }

  window.DictSelects = { initBatchList, initDepartmentList, initProviderList, initStaticSelects };
})();
