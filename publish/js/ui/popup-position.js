/**
 * 统一弹出层定位（searchable-select / multi-select 共用）
 *
 * 背景：这两个下拉面板原先都是「容器内 position:absolute」，
 * 处在弹窗主体这类 overflow:auto 的滚动容器里时会被 overflow 裁掉，
 * 贴近视口底部时几乎看不见（实测 288px 面板只剩 4% 可见）。
 *
 * 这里照搬 js/ui/date-picker.js 的策略：
 *   ① 锚点有可滚动祖先 → 面板升到 body + position:fixed（逃离 overflow 裁剪）；
 *   ② 下方放不下 → 先自动滚动容器腾地方；
 *   ③ 仍放不下才翻到上方或压 max-height。
 *
 * 对外契约（样式在 theme.css）：
 *   · .is-dropup 加在 wrapper 上（翻到锚点上方）；
 *   · .is-floating 加在面板上（挂到 body、视口定位）。
 * 注意：所有 window.* 引用一律延迟到函数体内取，避免脚本顺序敏感。
 */
(function () {
  'use strict';

  /**
   * 向上找第一个「会把面板裁掉」的祖先盒子；没有则返回 null。
   * 命中它，面板就升到 body + fixed 逃离裁剪。
   *
   * 判定条件：`overflow-x` 或 `overflow-y` **不是 visible**。
   *
   * 2026-09-21 改（原实现有两个漏洞，实测导致面板仍被裁 32~57px）：
   *   ① 原条件只认 `auto|scroll` —— 但 `.op-record-body` / `.intf-body` 是
   *      `overflow:hidden`，它**比 auto 裁得更死**，却被整条跳过 → 操作记录弹窗的
   *      筛选下拉底部被裁，最后 1~2 个选项看不见。
   *   ② 原条件还要求 `scrollHeight > clientHeight + 1`（"确有溢出"）—— 但
   *      `overflow:auto` 的盒子**无论当前滚不滚动都会裁掉超出 padding box 的
   *      绝对定位子元素**；文档弹窗列表为空时 `.doc-body` 不溢出 → 不判定 →
   *      筛选下拉仍被裁 ≈54px。
   *   现在改成「非 visible 即命中」。`visible`（默认值）不裁剪，所以普通文档流里的
   *   下拉不受影响、不会平白升到 body。
   */
  function scrollParentOf(el) {
    let node = el ? el.parentElement : null;
    while (node && node !== document.body && node !== document.documentElement) {
      const style = window.getComputedStyle(node);
      const oy = style.overflowY || '';
      const ox = style.overflowX || '';
      const clips = (oy && oy !== 'visible') || (ox && ox !== 'visible');
      if (clips) return node;
      node = node.parentElement;
    }
    return null;
  }

  /**
   * 清掉上一轮定位残留的内联样式，并把（可能已被升到 body 的）面板移回 wrapper。
   * 每次 place() 都先 reset，避免旧的内联 left/top/maxHeight 串味。
   */
  function reset(panelEl, wrapper) {
    panelEl.classList.remove('is-floating');
    if (wrapper) wrapper.classList.remove('is-dropup');
    panelEl.style.position = '';
    panelEl.style.left = '';
    panelEl.style.width = '';
    panelEl.style.top = '';
    panelEl.style.bottom = '';
    panelEl.style.maxHeight = '';
    // 关键：searchable-select 的可见性靠「.is-open 容器 > 面板」的 CSS 后代选择器，
    // 面板一旦升到 body 就脱离该选择器、会被基类的 display:none 压住。浮动时显式给 display:block，
    // 关闭时清掉（复位后回到容器，由 is-open / .show 类重新控制可见性）。
    panelEl.style.display = '';
    // 升到 body 的面板要在关闭时还回 wrapper，恢复纯 CSS 定位
    if (panelEl.parentNode === document.body && wrapper) {
      wrapper.appendChild(panelEl);
    }
  }

  /**
   * 给下拉面板定位（详见文件头说明）。
   * @param {HTMLElement} anchorEl 定位基准（可见输入框）
   * @param {HTMLElement} panelEl  下拉面板
   * @param {object} opts { wrapper, gap=4, fallbackHeight=288, minHeight=160 }
   */
  function place(anchorEl, panelEl, opts) {
    opts = opts || {};
    const wrapper = opts.wrapper;
    const gap = opts.gap != null ? opts.gap : 4;
    const fallbackHeight = opts.fallbackHeight != null ? opts.fallbackHeight : 288;
    const minHeight = opts.minHeight != null ? opts.minHeight : 160;

    reset(panelEl, wrapper);

    // 面板必须先可见（调用方在 display:block 之后才 place），offsetHeight 才量得到
    const natural = panelEl.offsetHeight || fallbackHeight;
    const container = scrollParentOf(anchorEl);
    let rect = anchorEl.getBoundingClientRect();

    // ① 先腾地方：把滚动容器 / 页面往下滚，让面板能完整落在锚点下方。
    //    约束：滚到容器底部就停、且锚点顶部至少留 8px（别把它滚出屏幕上方）。
    if (container) {
      const containerRect = container.getBoundingClientRect();
      const limit = Math.min(window.innerHeight || 0, containerRect.bottom);
      if (limit - rect.bottom - gap < natural) {
        const need = rect.bottom + gap + natural - limit;
        const room = Math.max(0, container.scrollHeight - container.clientHeight - container.scrollTop);
        const delta = Math.min(need, room, Math.max(0, rect.top - 8));
        if (delta > 0) {
          container.scrollTop += delta;
          rect = anchorEl.getBoundingClientRect();   // 滚完重新取锚点位置
        }
      }
    } else {
      const limit = window.innerHeight || 0;
      if (limit - rect.bottom - gap < natural) {
        const need = rect.bottom + gap + natural - limit;
        const scroller = document.scrollingElement || document.documentElement;
        const room = Math.max(0, scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop);
        const delta = Math.min(need, room, Math.max(0, rect.top - 8));
        if (delta > 0) {
          scroller.scrollTop += delta;
          rect = anchorEl.getBoundingClientRect();
        }
      }
    }

    // ② 浮动（容器里）vs 文档流（普通）：决定坐标基准与方向
    const floating = !!container;
    let bounds;
    if (floating) {
      const containerRect = container.getBoundingClientRect();
      // 面板只能落在「容器可视区」里，超出部分仍然会被裁；所以可用空间以容器可视区为界
      bounds = {
        top: Math.max(0, containerRect.top),
        bottom: Math.min(window.innerHeight || 0, containerRect.bottom),
      };
    } else {
      bounds = { top: 0, bottom: window.innerHeight || 0 };
    }

    const spaceBelow = bounds.bottom - rect.bottom - gap;
    const spaceAbove = rect.top - bounds.top - gap;
    // 下方放不下且上方空间更大 → 翻到上方（否则保持在下方并压 max-height）
    const dropup = natural > spaceBelow && spaceAbove > spaceBelow;
    if (wrapper) wrapper.classList.toggle('is-dropup', dropup);

    if (floating) {
      if (panelEl.parentNode !== document.body) document.body.appendChild(panelEl);
      panelEl.classList.add('is-floating');
      // 见 reset() 注释：升到 body 后脱离 is-open 后代选择器，必须显式给 display
      panelEl.style.display = 'block';
      const vw = window.innerWidth || 0;
      // left 夹紧到视口内；width 跟输入框一致，浮动时原本的 left:0;right:0 会失效
      const left = Math.min(Math.max(rect.left, 8), Math.max(8, vw - rect.width - 8));
      panelEl.style.left = Math.round(left) + 'px';
      panelEl.style.width = Math.round(rect.width) + 'px';
      panelEl.style.top = dropup ? 'auto' : Math.round(rect.bottom + gap) + 'px';
      panelEl.style.bottom = dropup ? Math.round((window.innerHeight || 0) - rect.top + gap) + 'px' : 'auto';
    }
    // 非浮动：保持面板在 wrapper 内、靠 CSS 绝对定位（.is-dropup 由 theme.css 处理翻上），
    // 这里不写 left/top/width，避免覆盖 CSS。

    const room = Math.max(spaceBelow, spaceAbove);
    if (natural > room) panelEl.style.maxHeight = Math.max(minHeight, room) + 'px';
  }

  if (typeof window !== 'undefined') {
    // 显式导出，禁止新增 window._私有桥
    window.PopupPosition = Object.freeze({ place, reset, scrollParentOf });
  }
})();
