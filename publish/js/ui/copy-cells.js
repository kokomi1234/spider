'use strict';
/**
 * 结果表「可复制单元格」的共用实现：点击复制 + 整张表只占一个 Tab 停靠点 + 方向键漫游。
 *
 * 原来这套只长在 `js/page/subscription-view.js` 里（清单 B9）。发布页与任务单页没有它，
 * 那两页被列宽截断的格子只能靠 `title` 悬停看全文 —— 既和 `memory.md` §1「不写悬停提示」冲突，
 * 又意味着"要复制一个长编码就得先把它认全"。2026-09-23 按用户指定的做法统一三页：
 * **数据格折到 2 行 + 点击（或回车）复制**，悬停提示随之删掉。
 *
 * 为什么用漫游而不是给每格加 tabindex：订阅页 22 列 × 10 行 = 220 格，
 * 逐个进 Tab 顺序的话光穿过这张表就要按 220 次，比没有还糟。
 *
 * 依赖：`window.toast`（提示，可缺）、`document.execCommand` 兜底。
 * ⚠️ 内网是 **HTTP 非安全上下文**，`navigator.clipboard` 在那里是 undefined ——
 * 直接 `.then()` 会在同步阶段就抛、连兜底都走不到（订阅导出按钮踩过，见 subscribe-ui.js）。
 * 所以这里的顺序是：能拿到 clipboard 就 Promise 并用 catch 兜底，否则直接兜底。
 */
(function () {
  /** 当前漫游到的格子下标（同一时刻页面上只有一张结果表，重建表格时归零） */
  let roi = 0;

  function cellsOf(bodyEl) {
    if (!bodyEl || !bodyEl.querySelectorAll) return [];
    return Array.prototype.slice.call(bodyEl.querySelectorAll('.copy-cell'));
  }

  /** 把 tabindex 与焦点样式只留给当前格，其余格子移出 Tab 顺序 */
  function paintRoi(bodyEl, idx) {
    const list = cellsOf(bodyEl);
    if (!list.length) return;
    roi = Math.min(Math.max(0, idx), list.length - 1);
    list.forEach((el, i) => {
      const on = i === roi;
      el.tabIndex = on ? 0 : -1;
      if (el.classList) el.classList.toggle('is-copy-focus', on);
    });
  }

  /** 复制成功/失败的提示：有 toast 就用它，没有就安静（冒烟环境、单测环境） */
  function say(msg, type) {
    if (typeof window.toast === 'function') { try { window.toast(msg, 1500, type); } catch (_) { /* 提示失败不影响复制 */ } }
  }

  function legacyCopy(text, okMsg) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) say(okMsg || '✅ 已复制到剪贴板', 'success');
      else say('复制失败，请手动选中复制', 'error');
    } catch (_) {
      say('复制失败，请手动选中复制', 'error');
    }
  }

  /** 复制一段文本到剪贴板（HTTP 下自动走 execCommand 兜底） */
  function copyText(text, okMsg) {
    const raw = String(text == null ? '' : text);
    if (!raw) return;
    const nav = (typeof window !== 'undefined' && window.navigator)
      || (typeof navigator !== 'undefined' ? navigator : null);   // 走 window 与仓库其他模块一致，也才能在单测里注入
    if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
      try {
        nav.clipboard.writeText(raw).then(() => say(okMsg || '✅ 已复制到剪贴板', 'success'))
          .catch(() => legacyCopy(raw, okMsg));
        return;
      } catch (_) { /* 非安全上下文里可能同步抛：落到下面的兜底 */ }
    }
    legacyCopy(raw, okMsg);
  }

  /**
   * 给一张表装上「点击复制 + 键盘漫游」。可以重复调用：监听只挂一次（dataset 标记），
   * 但每次重渲染都会把漫游归零到第一格 —— 单元格每次都是新建的 DOM。
   * @param {HTMLElement} bodyEl tbody / 容器
   * @param {{onCopy?: function}} [opts] 自定义复制动作（不传就走 copyText）
   */
  function bind(bodyEl, opts) {
    if (!bodyEl || typeof bodyEl.addEventListener !== 'function') return;
    const o = opts || {};
    if (!bodyEl.dataset) bodyEl.dataset = {};
    bodyEl.__copyHandler = typeof o.onCopy === 'function' ? o.onCopy : null;

    if (bodyEl.dataset.copyCellsBound !== '1') {
      bodyEl.dataset.copyCellsBound = '1';
      // 事件委托：格子每次渲染都是新节点，不能逐个绑、也不该记旧引用
      bodyEl.addEventListener('click', (e) => {
        const td = e.target && e.target.closest ? e.target.closest('.copy-cell') : null;
        if (!td) return;
        e.stopPropagation();                       // 别顺带触发行点击（详情弹窗）
        const text = td.dataset && td.dataset.copy;
        if (!text) return;
        if (bodyEl.__copyHandler) bodyEl.__copyHandler(text);
        else copyText(text);
      });
      bodyEl.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') return;               // Tab 交给浏览器正常走
        const cells = cellsOf(bodyEl);
        if (!cells.length) return;
        const tgt = e.target && e.target.closest ? e.target.closest('.copy-cell') : null;
        const cur = cells.indexOf(tgt);
        if (cur < 0) return;                       // 焦点不在可复制格里，交给别人处理

        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();                     // 别被外层「回车即查询」的快捷键接手
          const text = cells[cur].dataset && cells[cur].dataset.copy;
          if (!text) return;
          if (bodyEl.__copyHandler) bodyEl.__copyHandler(text);
          else copyText(text);
          return;
        }
        const row = cells[cur].parentElement;
        const perRow = (row && row.querySelectorAll)
          ? row.querySelectorAll('.copy-cell').length : 0;
        const stepMap = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: perRow, ArrowUp: -perRow };
        const step = stepMap[e.key];
        if (!step || !perRow) return;
        e.preventDefault();
        e.stopPropagation();

        const rowStart = Math.floor(cur / perRow) * perRow;
        const next = cur + step;
        // 左右不跨行（横向滚动位置不该被方向键打乱）、上下不越出整张表
        if (step === 1 || step === -1) {
          if (next < rowStart || next >= rowStart + perRow) return;
        } else if (next < 0 || next >= cells.length) {
          return;
        }
        roi = next;
        paintRoi(bodyEl, next);
        if (typeof cells[next].focus === 'function') cells[next].focus();
      });
    }
    paintRoi(bodyEl, 0);
  }

  window.CopyCells = { bind, paintRoi, cellsOf, copyText };
})();
