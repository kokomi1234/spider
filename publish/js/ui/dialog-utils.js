/**
 * 弹窗通用行为：滚动锁定 + 标题栏拖拽
 *
 * ── 为什么抽出来 ──────────────────────────────────────
 * 这两件事跟「订阅」业务无关，任何弹窗（订阅弹窗、文档子弹窗、
 * 服务详情弹窗）都要用。放业务模块里会各写一遍，还容易漏掉某层，
 * 所以单独成文件，对外只暴露 4 个函数。
 *
 * ── 对外 ──────────────────────────────────────────────
 *   DialogUtils.lockScroll()              打开弹窗时调用（内部计数，嵌套只锁一次）
 *   DialogUtils.unlockScroll()            关闭弹窗时调用（计数归零才真正解锁）
 *   DialogUtils.forceUnlockAll()         兜底：关闭最外层弹窗时一次性解锁
 *   DialogUtils.makeDraggable(dialog, handle)  让标题栏可以拖动整个弹窗
 *   DialogUtils.openUtilDialog(cfg)       通用弹窗骨架（promptText / confirmBox 都基于它）
 *   DialogUtils.promptText(opts)          替代 window.prompt
 *   DialogUtils.confirmBox(opts)          替代 window.confirm
 *
 * ── 滚动锁定的做法 ────────────────────────────────────
 * CSS 侧只有一条 `body.dialog-open { overflow: hidden }`（在 theme.css）。
 * JS 侧维护一个计数器：
 *   订阅弹窗打开 → 计数 1 → 锁
 *   再开文档子弹窗 → 计数 2 → 已经锁了，什么都不做（这就是「始终只锁一次」）
 *   关文档子弹窗 → 计数 1 → 还锁着
 *   关订阅弹窗 → 计数 0 → 解锁
 * 页面自带 `html { scrollbar-gutter: stable }`，滚动条槽位常驻，
 * 所以不用补 padding-right，也没有「锁定瞬间横向抖一下」的问题。
 *
 * ── 拖拽的做法 ────────────────────────────────────────
 * 弹窗默认由 `.overlay` 的 flex 居中。第一次按下标题栏时，把它切成
 * absolute + left/top（位置取当前居中后的坐标），之后跟着指针走。
 * 好处是没拖过的时候完全不动 CSS 结构，拖过的下次打开由调用方
 * reset() 复位回居中。
 */
(function () {
  'use strict';

  // ═══════════════════════════════════════════════════
  // 滚动锁定
  // ═══════════════════════════════════════════════════

  let lockCount = 0;

  function lockScroll() {
    lockCount += 1;
    if (lockCount > 1) return;          // 已经锁了，嵌套层什么都不做
    // html 和 body 都加：不同浏览器页面滚动容器不一样，双保险
    document.documentElement.classList.add('dialog-open');
    document.body.classList.add('dialog-open');
  }

  function unlockScroll() {
    if (lockCount === 0) return;
    lockCount -= 1;
    if (lockCount > 0) return;          // 上层弹窗还开着，保持锁定
    releaseLock();
  }

  /** 不管计数器，直接解锁（关最外层弹窗 / 异常兜底用） */
  function forceUnlockAll() {
    if (lockCount === 0) return;
    lockCount = 0;
    releaseLock();
  }

  function releaseLock() {
    document.documentElement.classList.remove('dialog-open');
    document.body.classList.remove('dialog-open');
  }

  // ═══════════════════════════════════════════════════
  // 标题栏拖拽
  // ═══════════════════════════════════════════════════

  /** 拖到最接近边缘还要留一点点，免得标题栏被贴死在屏幕边上 */
  const EDGE_GAP = 4;

  /**
   * @param {HTMLElement} dialog 弹窗本体（.sub-dialog / .doc-dialog / .dialog）
   * @param {HTMLElement} handle 拖拽把手（一般是标题栏 .sub-head）
   * @returns {{reset: Function} | null}
   */
  function makeDraggable(dialog, handle) {
    if (!dialog || !handle) return null;

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let origin = null;   // 按下那一刻的 { left, top, w, h, ow, oh }

    /** 弹窗相对 overlay（也就是视口）的位置和尺寸 */
    function measure() {
      const overlay = dialog.parentElement;
      const d = dialog.getBoundingClientRect();
      const o = overlay ? overlay.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
      return {
        left: d.left - o.left,
        top: d.top - o.top,
        w: d.width,
        h: d.height,
        ow: o.width,
        oh: o.height,
      };
    }

    /** 夹在可视区内：左边/上边不小于 EDGE_GAP，右边/下边不超出 overlay */
    function clamp(left, top, box) {
      const maxLeft = Math.max(0, box.ow - box.w - EDGE_GAP);
      const maxTop = Math.max(0, box.oh - box.h - EDGE_GAP);
      return [
        Math.min(Math.max(left, EDGE_GAP), Math.max(EDGE_GAP, maxLeft)),
        Math.min(Math.max(top, EDGE_GAP), Math.max(EDGE_GAP, maxTop)),
      ];
    }

    /** 标题栏上的按钮/输入框不参与拖拽，否则关不掉、选不中 */
    function isInteractiveTarget(e) {
      const el = e.target;
      if (!el || !el.closest) return false;
      return Boolean(el.closest('button, input, select, textarea, a, [data-no-drag]'));
    }

    function onPointerDown(e) {
      if (e.button != null && e.button !== 0) return;   // 只响应左键
      if (isInteractiveTarget(e)) return;

      const box = measure();
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      origin = box;

      // 第一次拖动才脱离 flex 居中，之后一直用绝对定位
      if (dialog.style.position !== 'absolute') {
        dialog.style.position = 'absolute';
        dialog.style.margin = '0';
        dialog.classList.add('is-dragged');
      }
      const [l, t] = clamp(box.left, box.top, box);
      dialog.style.left = l + 'px';
      dialog.style.top = t + 'px';

      handle.classList.add('is-dragging');
      if (handle.setPointerCapture && e.pointerId != null) {
        try { handle.setPointerCapture(e.pointerId); } catch (_) { /* 部分浏览器不支持 */ }
      }
      e.preventDefault();   // 阻止拖拽时选中标题文字
    }

    function onPointerMove(e) {
      if (!dragging || !origin) return;
      const [l, t] = clamp(origin.left + (e.clientX - startX), origin.top + (e.clientY - startY), origin);
      dialog.style.left = l + 'px';
      dialog.style.top = t + 'px';
      e.preventDefault();
    }

    function endDrag(e) {
      if (!dragging) return;
      dragging = false;
      origin = null;
      handle.classList.remove('is-dragging');
      if (handle.releasePointerCapture && e && e.pointerId != null) {
        try { handle.releasePointerCapture(e.pointerId); } catch (_) { /* 已自动释放 */ }
      }
    }

    /** 回到 flex 居中（每次打开弹窗时调用） */
    function reset() {
      dragging = false;
      origin = null;
      dialog.style.position = '';
      dialog.style.left = '';
      dialog.style.top = '';
      dialog.style.margin = '';
      dialog.classList.remove('is-dragged');
      handle.classList.remove('is-dragging');
    }

    // 窗口变小后，已拖到右下角的弹窗会被截掉，resize 时夹回来
    function onResize() {
      if (dialog.style.position !== 'absolute') return;
      const box = measure();
      const [l, t] = clamp(box.left, box.top, box);
      dialog.style.left = l + 'px';
      dialog.style.top = t + 'px';
    }

    handle.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    window.addEventListener('resize', onResize);

    // 兜底：老 Safari 没有 Pointer Events 时用鼠标事件
    const noPointer = typeof window.PointerEvent === 'undefined';
    if (noPointer) {
      handle.addEventListener('mousedown', onPointerDown);
      window.addEventListener('mousemove', onPointerMove);
      window.addEventListener('mouseup', endDrag);
    }

    return { reset };
  }

  // ═══════════════════════════════════════════════════
  // 通用输入 / 确认弹窗（替代 window.prompt / window.confirm）
  // ═══════════════════════════════════════════════════
  // 为什么不用原生：① 样式与全站弹窗不一致，且没法加标题/多行说明；
  // ② 自动化测试里原生弹窗需要单独注册 dialog 处理器，否则会被静默 dismiss
  //    （prompt 返回 null、confirm 返回 false），表现成「点了没反应」。
  // 这里只复用 theme.css 既有的 .overlay / .sub-dialog / .form-group 等类，不新增视觉规范。

  /**
   * 通用弹窗骨架。
   * @param {{title:string, buildBody:Function, footButtons:Array, onReady?:Function}} cfg
   *   footButtons 每项：{ text, cls?, value|getValue, validate? }
   * @returns {{overlay:HTMLElement, body:HTMLElement, promise:Promise<any>}}
   *   取消（✕ / Esc / 点遮罩）一律 resolve(null)
   */
  function openUtilDialog(cfg) {
    const overlay = document.createElement('div');
    overlay.className = 'overlay sub-overlay dlg-util-overlay';
    overlay.setAttribute('role', 'presentation');

    const dialog = document.createElement('div');
    dialog.className = 'dialog sub-dialog dlg-util-dialog';
    // 纯文本确认框走单独一档宽度（见 theme.css 的 .dlg-util-dialog--confirm）：
    // 460px 是给有输入框的命名框 / Token 面板用的，一句话的确认框撑那么宽，
    // 视线得从按钮跳到屏幕中央一大块空白上（2026-09-22 复测 D-17）。
    if (cfg.extraCls) dialog.classList.add(cfg.extraCls);
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.tabIndex = -1;

    const head = document.createElement('div');
    head.className = 'sub-head';
    const h2 = document.createElement('h2');
    h2.textContent = cfg.title || '';
    head.appendChild(h2);

    const body = document.createElement('div');
    body.className = 'sub-body dlg-util-body';
    cfg.buildBody(body);

    const foot = document.createElement('div');
    foot.className = 'sub-foot';

    let resolveFn = () => {};
    const promise = new Promise((res) => { resolveFn = res; });
    let settled = false;

    function done(value) {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      unlockScroll();
      resolveFn(value);
    }

    (cfg.footButtons || []).forEach((btnCfg) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = btnCfg.cls || 'outlined btn-sm';
      btn.textContent = btnCfg.text;
      btn.addEventListener('click', () => {
        if (typeof btnCfg.validate === 'function') {
          const err = btnCfg.validate();
          if (err) {                          // validate 返回非空字符串 = 校验失败，就地提示
            if (typeof window.toast === 'function') window.toast('⚠️ ' + err, 2200, 'warn');
            return;
          }
        }
        done(typeof btnCfg.getValue === 'function' ? btnCfg.getValue() : btnCfg.value);
      });
      foot.appendChild(btn);
    });

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'sub-close';
    closeBtn.setAttribute('aria-label', '关闭');
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => done(null));
    head.appendChild(closeBtn);

    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); done(null); }
      // 输入框里按回车 = 点主按钮（与页面筛选区的手感一致）
      if (e.key === 'Enter' && e.target && e.target.tagName === 'INPUT') {
        e.preventDefault();
        const primary = foot.querySelector('.filled');
        if (primary) primary.click();
      }
    }

    // ⚠️ 双击的**第二次**点击不认作「点遮罩 = 取消」：用户双击「查 询」时，第一次点击同步把
    //   框弹出来、第二次正好落在遮罩上，于是变成「打开 → 立刻取消」，界面闪一下什么都没发生
    //   （2026-09-22 复测 D-12：手快的用户每天都在踩这条）。
    //   用 `detail`（浏览器给同一次连击的计数）而不是时间窗 —— 时间窗会把既有契约
    //   「点遮罩关闭」的单测挂死（假 DOM 里 click 是立刻发生的，实测少跑 215 条）。
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay && !(e.detail >= 2)) done(null);
    });
    document.addEventListener('keydown', onKey, true);

    dialog.append(head, body, foot);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));
    lockScroll();
    dialog.focus();
    if (typeof cfg.onReady === 'function') cfg.onReady({ overlay, body, dialog });

    return { overlay, body, promise };
  }

  /**
   * 自定义输入弹窗（替代 window.prompt）。
   * @param {{title?:string, label?:string, placeholder?:string, value?:string,
   *          message?:string, okText?:string}} opts
   * @returns {Promise<string|null>} 确认返回 trim 后的输入串；取消返回 null
   */
  function promptText(opts) {
    const o = opts || {};
    let inputEl = null;
    const dlg = openUtilDialog({
      title: o.title || '请输入',
      buildBody(body) {
        if (o.message) {
          const p = document.createElement('p');
          p.textContent = o.message;
          body.appendChild(p);
        }
        const group = document.createElement('div');
        group.className = 'form-group';
        const label = document.createElement('label');
        label.textContent = o.label || '';
        inputEl = document.createElement('input');
        inputEl.type = 'text';
        inputEl.placeholder = o.placeholder || '';
        inputEl.value = o.value || '';
        // 这里收的是查询名 / 服务编码一类业务串，别让拼写检查画红波浪线
        inputEl.spellcheck = false;
        inputEl.setAttribute('autocomplete', 'off');
        group.append(label, inputEl);
        body.appendChild(group);
      },
      onReady() { setTimeout(() => inputEl.focus(), 30); },
      footButtons: [
        { text: '取 消', cls: 'outlined btn-sm', value: null },
        {
          text: o.okText || '确 认',
          cls: 'filled btn-sm',
          getValue: () => String(inputEl.value || '').trim(),
          validate: () => (String(inputEl.value || '').trim() ? '' : '请输入内容'),
        },
      ],
    });
    return dlg.promise;
  }

  /**
   * 自定义确认弹窗（替代 window.confirm）。
   * @param {{title?:string, message?:string, okText?:string, danger?:boolean}} opts
   * @returns {Promise<boolean>} 确认 true；取消 / 关闭 false
   */
  function confirmBox(opts) {
    const o = opts || {};
    const dlg = openUtilDialog({
      title: o.title || '请确认',
      extraCls: 'dlg-util-dialog--confirm',
      buildBody(body) {
        const p = document.createElement('p');
        // 三个叫法都认：调用方写 `{ text }` / `{ body }` 时不该静默弹出空正文的确认框
        //（2026-09-22 复测 D-1 —— 首页的删除确认框就这么空了一整天）。
        p.textContent = o.message || o.text || o.body || '';
        body.appendChild(p);
      },
      footButtons: [
        { text: '取 消', cls: 'outlined btn-sm', value: false },
        { text: o.okText || '确 认', cls: o.danger ? 'filled btn-sm dlg-danger' : 'filled btn-sm', value: true },
      ],
    });
    return dlg.promise.then((v) => v === true);
  }

  // ═══════════════════════════════════════════════════

  if (typeof window !== 'undefined') {
    window.DialogUtils = {
      lockScroll,
      unlockScroll,
      forceUnlockAll,
      makeDraggable,
      openUtilDialog,
      promptText,
      confirmBox,
    };
  }
})();
