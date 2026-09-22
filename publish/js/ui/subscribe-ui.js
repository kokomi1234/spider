/**
 * 订阅管理面板 UI
 * 
 * 功能：
 * 1. 在页面顶部添加"已订阅服务"管理入口
 * 2. 弹窗展示已订阅列表，支持增删改查
 * 3. 支持批量导入/导出
 */

(() => {
  'use strict';

  // 调用时才取 window.debugLog（顶层捕获会在 debug.js 排后时静默变成空操作）
  const debugLog = (...a) => (window.debugLog || (() => {}))(...a);

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  /** HTML 转义：服务编码来自用户导入的文件，可能含 < > " ' 等字符，
   *  直接拼进 innerHTML 会截断 DOM（自伤 XSS / 显示错乱）。 */
  function esc(v) {
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ── DOM 引用 ────────────────────────────────────────
  let btnSubscribePanel;
  let overlay;
  let dialog;
  let dragHandle = null;   // 标题栏拖动（只绑一次；每次打开复位到居中）

  function init() {
    // 使用 HTML 中已存在的按钮
    btnSubscribePanel = $('#btnSubscribePanel');
    if (!btnSubscribePanel) {
      console.error('找不到 #btnSubscribePanel 按钮');
      return;
    }
    
    // 更新按钮初始文本
    updateCount();

    // 创建弹窗
    createDialog();

    // 绑定事件
    btnSubscribePanel.addEventListener('click', openDialog);
    
    debugLog('✅ 订阅管理 UI 初始化完成');
  }

  /** 创建弹窗结构 */
  function createDialog() {
    overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.style.display = 'none';

    dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.style.maxWidth = '600px';
    dialog.style.maxHeight = '80vh';
    dialog.style.overflowY = 'auto';

    dialog.innerHTML = `
      <h2 style="margin:0 0 16px 0;">已订阅服务管理</h2>
      <!-- 2026-09-21 用户要求删光提示文字：这段长说明改成一行事实标签。
           必须留「本机」两字 —— 远端查不到「我订阅了哪些服务」，不写清楚用户会当成服务端数据。 -->
      <p style="margin:0 0 16px 0;font-size:var(--fs-xs);color:var(--muted);">
        本机清单（<strong>非服务端订阅关系</strong>）
      </p>
      
      <!-- 统计 -->
      <div class="stats" style="margin-bottom:16px;">
        <div class="stat info">
          <div class="lbl">已订阅数量（本机）</div>
          <div class="val" id="subCount">0</div>
        </div>
      </div>

      <!-- 操作栏 -->
      <div class="toolbar" style="margin-bottom:16px;">
        <button class="outlined btn-sm" id="btnAdd">➕ 添加</button>
        <button class="outlined btn-sm" id="btnImport">📥 批量导入</button>
        <button class="outlined btn-sm" id="btnExport">📤 批量导出</button>
        <button class="outlined btn-sm danger" id="btnClear">🗑️ 清空</button>
      </div>

      <!-- 搜索框 -->
      <input type="text" id="subSearch" placeholder="搜索服务编码..." style="width:100%;margin-bottom:12px;padding:8px 12px;border-radius:var(--r-xs);border:1px solid var(--outline);">

      <!-- 列表容器 -->
      <div id="subList" style="display:flex;flex-direction:column;gap:8px;"></div>

      <!-- 底部关闭按钮 -->
      <div style="margin-top:16px;text-align:right;">
        <button class="outlined btn-sm" id="btnClose">关 闭</button>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // 绑定弹窗内事件
    $('#btnAdd').addEventListener('click', showAddForm);
    $('#btnImport').addEventListener('click', showImportForm);
    $('#btnExport').addEventListener('click', exportServices);
    $('#btnClear').addEventListener('click', confirmClear);
    $('#btnClose').addEventListener('click', closeDialog);
    $('#subSearch').addEventListener('input', renderSubList);

    // 点遮罩空白处关闭（统一实现见 dialog-utils.js：它还会挡掉
    // 「在弹窗里按下、把指针滑到遮罩上松开」被误判成点遮罩的情况）
    if (window.DialogUtils) {
      window.DialogUtils.bindBackdropDismiss(overlay, closeDialog);
      // 标题栏可拖动（2026-09-23）：这个面板没有 .sub-head，之前没接 makeDraggable，
      // 它挡住结果表时只能关掉重开。把手用标题 <h2>，面板内的按钮/输入框由 makeDraggable 排除。
      dragHandle = window.DialogUtils.makeDraggable(dialog, dialog.querySelector('h2'));
    }
  }

  /** 打开弹窗 */
  function openDialog() {
    updateCount();
    renderSubList();
    overlay.style.display = 'flex';
    overlay.classList.add('show');
    // 每次打开回到居中：上次拖到哪不该影响下一次（与订阅弹窗 / 操作记录弹窗同口径）
    if (dragHandle && dragHandle.reset) dragHandle.reset();
    $('#subSearch').value = '';
    $('#subSearch').focus();
  }

  /** 关闭弹窗 */
  function closeDialog() {
    overlay.classList.remove('show');
    setTimeout(() => {
      overlay.style.display = 'none';
    }, 200);
  }

  /** 更新计数显示 */
  function updateCount() {
    const count = window.SubscribeManager.count();
    btnSubscribePanel.textContent = `已订阅 (${count})`;
    // 悬停说明来源：后端查不到订阅关系，这个数字是本机清单的条数。
    // 不写会被当成服务端数据，清一次缓存就以为订阅丢了。
    const countEl = $('#subCount');
    if (countEl) countEl.textContent = count;
  }

  /** 渲染已订阅列表 */
  function renderSubList() {
    const list = window.SubscribeManager.getAll();
    const search = ($('#subSearch')?.value || '').toLowerCase();
    const filtered = search 
      ? list.filter(code => code.toLowerCase().includes(search))
      : list;

    const container = $('#subList');
    if (!container) return;

    if (!filtered.length) {
      // 「搜索无命中」与「一个都没订阅」是两种状态，原来共用一句「暂无已订阅服务」——
      // 用户已经订阅了 20 个服务、在搜索框里敲一个不存在的编码，会以为订阅数据全丢了。
      container.innerHTML = list.length
        ? `<div style="text-align:center;color:var(--muted);padding:32px 0;">没有匹配的已订阅服务（共 ${list.length} 个，可清空搜索框查看全部）</div>`
        : '<div style="text-align:center;color:var(--muted);padding:32px 0;">还没有订阅任何服务，可在结果表点「订阅」添加</div>';
      return;
    }

    container.innerHTML = filtered.map(code => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--surface-1);border-radius:var(--r-sm);">
        <code style="font-family:'Roboto Mono',monospace;font-size: var(--fs-md);">${esc(code)}</code>
        <button class="text-btn btn-xs danger" data-code="${esc(code)}" style="color:var(--on-red-c);">删除</button>
      </div>
    `).join('');

    // 绑定删除事件
    container.querySelectorAll('[data-code]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const code = btn.getAttribute('data-code');
        if (btn.disabled) return;
        // 二次确认：同一弹窗里「清空」有确认、单条删除却点即生效，破坏性相近却两套规则；
        // 行距只有 8px，误点直接发起移除，而删错的这一条除了重新搜索再加回来没有退路。
        const ok = (window.DialogUtils && typeof window.DialogUtils.confirmBox === 'function')
          ? await window.DialogUtils.confirmBox({
            title: '移除订阅标记',
            message: `确定不再标记 ${code} 为已订阅吗？\n\n这只是删掉本机清单里的一条标记（可能当初添加错了），不会改动服务端的订阅关系。`,
            okText: '移 除',
            danger: true,
          })
          : window.confirm(`确定移除本机「已订阅」标记（${code}）吗？\n\n只删本机这条标记，服务端不受影响。`);
        if (!ok) return;
        btn.disabled = true; btn.textContent = '移除中…';
        // 订阅标记的口径：本机为准（后端查不到订阅关系），所以这里本来就不发远程请求。
        const res = window.ServiceApi ? await window.ServiceApi.unsubscribe(code) : { ok: true, local: true };
        if (!res.ok) {
          btn.disabled = false; btn.textContent = '删除';
          showToast(`⚠️ 移除失败：${res.error || '未知错误'}`);
          return;
        }
        // local:true 是**设计如此**（订阅标记以本机为准），不是「同步失败」，
        // 所以文案要说清改了什么、没改什么：删的是本机清单里的一条标记。
        // 写成「未同步服务端」会让人以为这里漏实现了提交，进而反复重试。
        window.SubscribeManager.remove(code);
        updateCount();
        renderSubList();
        showToast(`已从本机清单移除：${code}（服务端的订阅关系没有变化）`, 2600, 'info');
      });
    });
  }

  /** 显示添加表单 */
  async function showAddForm() {
    // 走全站统一的自定义弹窗（原生 prompt 样式不一致，且自动化测试里会被静默 dismiss）
    const input = (window.DialogUtils && typeof window.DialogUtils.promptText === 'function')
      ? await window.DialogUtils.promptText({
        title: '添加订阅',
        label: '服务编码',
        placeholder: '请输入要订阅的服务编码',
        message: '输入服务编码后确认，将加入本地订阅列表。',
      })
      : null;
    if (!input) return;                      // 用户取消
    const trimmed = String(input).trim();
    if (!trimmed) return;

    if (window.SubscribeManager.isSubscribed(trimmed)) {
      showToast(`⚠️ 该服务已在订阅列表中`);
      return;
    }

    // 预留层未配置 subscribeAdd 时，subscribe 直接返回本地模式，行为与之前一致
    const res = window.ServiceApi ? await window.ServiceApi.subscribe(trimmed) : { ok: true, local: true };
    if (!res.ok) {
      showToast(`⚠️ 订阅失败：${res.error || '未知错误'}`);
      return;
    }
    window.SubscribeManager.add(trimmed);
    updateCount();
    renderSubList();
    // remoteSkipped：只写进本地列表，服务端没有这条订阅。必须说清楚。
    showToast(res.remoteSkipped ? `⚠️ ${res.reason || '仅本地记录，未同步服务端'}` : `✅ 已添加: ${trimmed}`,
              res.remoteSkipped ? 4000 : 2500, res.remoteSkipped ? 'warn' : 'info');
  }

  /** 显示批量导入表单 */
  function showImportForm() {
    // 创建一个临时的模态框用于导入
    const importDialog = document.createElement('div');
    importDialog.className = 'overlay show';
    importDialog.innerHTML = `
      <div class="dialog" style="max-width:500px;">
        <h2>📥 导入已订阅服务列表</h2>
        <p style="color:var(--on-variant);font-size: var(--fs-md);margin-bottom:16px;">
          请粘贴您的已订阅服务编码列表（每行一个，或用逗号/分号分隔）：<br>
          <small style="color:var(--muted);">示例：SRV-BOC-001\nSRV-BOC-002,SRV-BOC-003</small>
        </p>
        
        <textarea id="importText" placeholder="在此粘贴您的服务编码列表..." 
          style="width:100%;height:200px;padding:12px;border:1px solid var(--outline);border-radius:var(--r-xs);font-family:monospace;font-size: var(--fs-md);resize:vertical;"></textarea>
        
        <div style="margin-top:12px;display:flex;gap:8px;align-items:center;">
          <label for="importFile" class="outlined btn-sm" style="cursor:pointer;">
            📄 选择文件 (TXT/CSV)
          </label>
          <input type="file" id="importFile" accept=".txt,.csv,.text" style="display:none;">
          <span id="fileName" style="font-size: var(--fs-xs);color:var(--muted);"></span>
        </div>
        
        <div style="margin-top:16px;display:flex;justify-content:flex-end;gap:8px;">
          <button class="outlined btn-sm" id="btnCancelImport">取 消</button>
          <button class="filled btn-sm" id="btnConfirmImport">✅ 确认导入</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(importDialog);
    
    // 文件选择处理
    const fileInput = document.getElementById('importFile');
    const fileNameSpan = document.getElementById('fileName');
    
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      fileNameSpan.textContent = `已选择: ${file.name}`;
      
      const reader = new FileReader();
      reader.onload = (event) => {
        document.getElementById('importText').value = event.target.result;
      };
      reader.readAsText(file);
    });
    
    // 取消按钮
    document.getElementById('btnCancelImport').addEventListener('click', () => {
      document.body.removeChild(importDialog);
    });
    
    // 确认导入按钮
    document.getElementById('btnConfirmImport').addEventListener('click', () => {
      const text = document.getElementById('importText').value;
      if (!text.trim()) {
        showToast('⚠️ 请输入或选择要导入的服务编码', 2200, 'warn');
        return;
      }
      
      // 解析服务编码（支持换行、逗号、分号、制表符分隔）
      // 过滤：空行、纯注释行（#开头）、纯标题行
      const codings = text
        .split(/[\n,;\t]+/)
        .map(s => s.trim())
        .filter(s => {
          if (!s) return false;           // 空行
          if (s.startsWith('#')) return false;  // 注释行
          if (/^[\u4e00-\u9fff]+$/.test(s)) return false;  // 纯中文（标题等）
          return true;
        })
        .map(s => s.replace(/^"|"$/g, '')); // 去除引号
      
      const added = window.SubscribeManager.import(codings);
      updateCount();
      renderSubList();
      
      // 关闭弹窗
      document.body.removeChild(importDialog);
      
      showToast(`✅ 成功导入 ${added} 个服务（共 ${window.SubscribeManager.count()} 个）`);
    });
  }

  /**
   * 复制文本到剪贴板：优先 Clipboard API，失败/不可用则退回临时 textarea。
   * 原来这里直接 `navigator.clipboard.writeText(...)`：非安全上下文（HTTP 内网地址）下
   * `navigator.clipboard` 是 undefined，会在 `.then` 之前同步抛错 —— 既不进 catch、
   * 也走不到 execCommand 兜底，表现就是「点了批量导出什么都没发生」。
   * 实现与 subscription.js 的 copyToClipboard 同口径（已在 TODO 里登记要抽成公共函数）。
   */
  function copyText(text, okMsg) {
    const raw = String(text == null ? '' : text);
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = raw;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        showToast(okMsg);
      } catch (_) {
        showToast('⚠️ 复制失败，请手动复制');
      }
      document.body.removeChild(ta);
    };
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(raw).then(() => showToast(okMsg)).catch(fallback);
        return;
      }
    } catch (_) { /* 落到同步兜底 */ }
    fallback();
  }

  /** 导出已订阅服务 */
  function exportServices() {
    const text = window.SubscribeManager.export();
    if (!text) {
      showToast('⚠️ 暂无可导出的服务');
      return;
    }
    copyText(text, '✅ 已复制到剪贴板');
  }

  /** 确认清空 */
  async function confirmClear() {
    const ok = (window.DialogUtils && typeof window.DialogUtils.confirmBox === 'function')
      ? await window.DialogUtils.confirmBox({
        title: '清空本机已订阅清单',
        message: '确定要清空本机这份「已订阅」清单吗？\n\n清空后只是本机标记没了，服务端的订阅关系不变；清完可以用之前导出的文件重新导入，但本机这份清单本身不可恢复。',
        okText: '清 空',
        danger: true,
      })
      : window.confirm('确定要清空本机这份「已订阅」清单吗？\n\n只影响本机标记，服务端订阅关系不变，且本机清单不可恢复。');
    if (!ok) return;
    try {
      window.SubscribeManager.clear();
      updateCount();
      renderSubList();
      showToast('🗑️ 已清空本机订阅清单', 2000, 'info');
    } catch (e) {
      console.error('清空订阅列表失败:', e);
      showToast('❌ 清空失败: ' + e.message, 3000, 'error');
    }
  }

  /** Toast 提示（兼容 index.js 的全局 showToast） */
  function showToast(msg, duration = 2500, type = 'info') {
    // 如果 index.js 已定义 showToast，使用它的
    const notify = window.AppServices && window.AppServices.toast;
    if (typeof notify === 'function') {
      notify(msg, duration, type);
      return;
    }
    const toast = window.AppServices && window.AppServices.toast;
    if (typeof toast === 'function') {
      toast(msg, duration, type);
      return;
    }
    // 否则创建临时 toast
    const toastEl = document.getElementById('toast');
    if (toastEl) {
      toastEl.textContent = msg;
      toastEl.classList.add('show');
      setTimeout(() => toastEl.classList.remove('show'), duration);
    }
  }

  // 全局暴露
  window.SubscribeUI = { init, openDialog };

})();
