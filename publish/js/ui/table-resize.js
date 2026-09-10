/**
 * 表格列宽拖拽（window.createTableResizer）
 *
 * ── 为什么需要它 ──────────────────────────────────────
 * 服务订阅关系页有 24 列（总宽 3800+px），固定列宽在某些查询下不够用
 * （比如部门名、服务中文名被压成省略号）。这里给表头加一条可拖拽的
 * 分隔条：拖右边框改列宽，双击恢复默认，列宽记在 localStorage。
 *
 * ── 与固定列的关系 ────────────────────────────────────
 * 拖拽后表格总宽变了，`table.style.width / minWidth` 会同步成列宽之和，
 * 所以横向滚动区跟着变；左侧固定列（复选框 55px、优先级列 left:55px）
 * 的偏移不受影响——被跳过的列（默认第一列）宽度始终是原值。
 *
 * ── 对外 API ──────────────────────────────────────────
 * createTableResizer(tableEl, {
 *   minWidth: 60,                    // 单列最小宽度
 *   skipFirst: true,                 // 第一列（复选框）不给把手
 *   storageKey: 'subq.colWidths',    // 记到 localStorage（留空则不记）
 *   onChange(widths, total) {},
 *   onReset(index) {},
 * }) → { reset(), getWidths() } | null
 */
(function () {
  'use strict';

  function createTableResizer(table, opts) {
    if (!table) return null;
    const options = opts || {};
    const MIN = Number(options.minWidth) || 60;
    const SKIP_FIRST = options.skipFirst !== false;
    const STORAGE_KEY = options.storageKey || '';

    const cols = Array.from(table.querySelectorAll('colgroup > col'));
    const ths = Array.from(table.querySelectorAll('thead > tr > th'));
    if (!cols.length || cols.length !== ths.length) return null;   // 结构不符就别硬来

    // <colgroup> 里写死的宽度就是默认值（HTML 静态值，不受运行期改动影响）
    const defaults = cols.map((c) => Math.round(c.getBoundingClientRect().width) || 100);
    let widths = defaults.slice();

    function total() { return widths.reduce((a, b) => a + b, 0); }

    function apply() {
      widths.forEach((w, i) => { cols[i].style.width = w + 'px'; });
      const sum = total();
      table.style.width = sum + 'px';
      table.style.minWidth = sum + 'px';
      if (typeof options.onChange === 'function') options.onChange(widths.slice(), sum);
    }

    function load() {
      if (!STORAGE_KEY) return;
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
        // 注意：下限不能直接沿用 MIN —— 被跳过的列（复选框列 55px）本来就比 MIN 小
        const ok = Array.isArray(saved)
          && saved.length === widths.length
          && saved.every((n) => typeof n === 'number' && n >= 20 && n < 4000);
        if (ok) widths = saved.slice();
      } catch (_) { /* 存坏了就当没存过 */ }
    }

    function save() {
      if (!STORAGE_KEY) return;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(widths)); } catch (_) { /* ignore */ }
    }

    function attachHandles() {
      ths.forEach((th, i) => {
        if (SKIP_FIRST && i === 0) return;
        if (th.querySelector('.col-resizer')) return;

        const handle = document.createElement('span');
        handle.className = 'col-resizer';
        handle.dataset.col = String(i);
        handle.title = '拖动调整列宽，双击恢复默认';
        handle.setAttribute('aria-hidden', 'true');
        th.appendChild(handle);

        handle.addEventListener('mousedown', (e) => {
          if (e.button !== 0) return;
          e.preventDefault();       // 别让 th 的选择/排序逻辑掺和进来
          e.stopPropagation();
          const startX = e.clientX;
          const startW = widths[i];
          handle.classList.add('is-active');
          document.body.classList.add('is-resizing');

          const onMove = (ev) => {
            const next = Math.max(MIN, Math.round(startW + (ev.clientX - startX)));
            if (next === widths[i]) return;
            widths[i] = next;
            apply();
          };
          const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            handle.classList.remove('is-active');
            document.body.classList.remove('is-resizing');
            save();
          };
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        });

        // 拖动过程会产生 click，别让它冒泡成表头排序
        handle.addEventListener('click', (e) => e.stopPropagation());
        handle.addEventListener('dblclick', (e) => {
          e.preventDefault();
          e.stopPropagation();
          widths[i] = defaults[i];
          apply();
          save();
          if (typeof options.onReset === 'function') options.onReset(i);
        });
      });
    }

    load();
    apply();
    attachHandles();

    return {
      getWidths() { return widths.slice(); },
      reset() {
        widths = defaults.slice();
        apply();
        save();
      },
      defaults: defaults.slice(),
    };
  }

  if (typeof window !== 'undefined') {
    window.createTableResizer = createTableResizer;
  }
})();
