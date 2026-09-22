/**
 * 服务详情弹窗（从 index.js 拆出来）。
 *
 * 只依赖：#detailOverlay / #detailTitle / #detailBody / #detailStatus 四个节点，
 * 加上 window.ServiceApi.fetchServiceDetail 与 window.DialogUtils。
 * **不碰查询 / 渲染 / 分页 / 订阅筛选的任何状态** —— 这也是它能干净拆出来的原因。
 *
 * 用法：window.DetailDialog.open(row) / .close()
 * 以前用 alert 把整行 JSON 拍在脸上：字段一多就顶出屏幕，还没法复制；
 * 现在是弹窗 + 键值表，滚动和复制都正常。
 */
(function () {
  'use strict';

  // esc 调用时才取 window.Fmt（顶层捕获会在 format.js 排后时永久退化）。
  // 这里的兜底不再是「弱转义」：原来写成 String(x ?? '') 等于零转义，
  // format.js 一旦没加载，innerHTML 的 XSS 防护就静默失效了。字符集与 Fmt.esc 一致。
  const esc = (v) => ((window.Fmt && window.Fmt.esc) || ((x) => String(x ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')))(v);

  const overlay = document.getElementById('detailOverlay');
  const titleEl = document.getElementById('detailTitle');
  const bodyEl = document.getElementById('detailBody');
  const statusEl = document.getElementById('detailStatus');

  let returnFocus = null;
  let seq = 0;   // 防止「上一次详情的接口比下一次慢返回」覆盖新内容
  let dragHandle = null;   // 标题栏拖动（只绑一次；每次 open 都要复位到居中）

  function close() {
    if (!overlay) return;
    overlay.classList.remove('show');
    // 详情弹窗里不会再开子层，这里直接一次性解锁（js/ui/dialog-utils.js）
    if (window.DialogUtils) window.DialogUtils.forceUnlockAll();
    if (returnFocus && typeof returnFocus.focus === 'function') returnFocus.focus();
    returnFocus = null;
  }

  function setStatus(state, msg) {
    if (!statusEl) return;
    statusEl.className = 'detail-status' + (state ? ' is-' + state : '');
    statusEl.textContent = msg || '';
    statusEl.hidden = !state;
  }

  function renderFields(data) {
    if (!bodyEl) return;
    const entries = Object.entries(data || {}).filter(
      ([, v]) => v != null && v !== '' && v !== '-'
    );
    bodyEl.innerHTML = entries.length
      ? entries.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')
      : '<div class="empty">该服务没有可展示的字段</div>';
  }

  /** 打开详情：先渲染本地行数据，接口回来后再补/覆盖 */
  async function open(row) {
    if (!row || !overlay) return;
    const mySeq = ++seq;

    returnFocus = document.activeElement;
    if (titleEl) titleEl.textContent = row.serviceName || row.serverCoding || '服务详情';
    setStatus('loading', '正在加载详情…');
    renderFields(row);
    overlay.classList.add('show');
    if (window.DialogUtils) {
      window.DialogUtils.lockScroll();
      // 标题栏可拖动（2026-09-23）：这个弹窗是旧结构（没有 .sub-head，✕ 是绝对定位的），
      // 之前压根没接 makeDraggable —— 它挡住结果表时只能关掉重开。
      // 把手用 <h2 id="detailTitle">：块级、占满整行，语义上就是标题栏；
      // 弹窗内的按钮/输入框由 makeDraggable 自己排除，不会误拖。
      if (!dragHandle) {
        dragHandle = window.DialogUtils.makeDraggable(
          document.getElementById('detailDialog'), titleEl,
        );
      }
      // 每次打开都回到居中：上次拖到哪不该影响下一次（与 op-record / subscribe-dialog 同口径）
      if (dragHandle && dragHandle.reset) dragHandle.reset();
    }
    const btn = document.getElementById('btnDetailClose');
    if (btn) btn.focus();

    // 详情后端接口（service-api.js）未配置时，fetchServiceDetail 原样返回本地数据，不发请求
    const remote = window.ServiceApi
      ? await window.ServiceApi.fetchServiceDetail(row)
      : { ok: true, local: true, data: null };
    if (mySeq !== seq) return;   // 期间用户已点开别的服务，丢弃这次结果

    if (remote && remote.ok && remote.data) {
      renderFields(Object.assign({}, row, remote.data));
      setStatus('');             // 后端成功：不额外提示
    } else if (remote && !remote.ok) {
      // 接口失败：保留本地行数据，并提示用户
      setStatus('error', '详情接口暂不可用，已显示列表中已有的字段');
    } else {
      setStatus('');
    }
  }

  // 关闭入口：底部「关 闭」、右上角 ✕
  document.addEventListener('click', (e) => {
    const id = e.target && e.target.id;
    if (id === 'btnDetailClose' || id === 'btnDetailCloseX') close();
  });
  // 点遮罩空白处关闭（统一实现见 dialog-utils.js：它还会挡掉
  // 「在弹窗里按下、把指针滑到遮罩上松开」被误判成点遮罩的情况）
  if (window.DialogUtils) window.DialogUtils.bindBackdropDismiss(overlay, close);

  window.DetailDialog = { open, close };
})();
