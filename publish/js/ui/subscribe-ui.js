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

  const debugLog = window.debugLog || (() => {});

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
      
      <!-- 统计 -->
      <div class="stats" style="margin-bottom:16px;">
        <div class="stat info">
          <div class="lbl">已订阅数量</div>
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

    // 点击遮罩关闭
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeDialog();
    });
  }

  /** 打开弹窗 */
  function openDialog() {
    updateCount();
    renderSubList();
    overlay.style.display = 'flex';
    overlay.classList.add('show');
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
      container.innerHTML = '<div style="text-align:center;color:var(--muted);padding:32px 0;">暂无已订阅服务</div>';
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
        btn.disabled = true; btn.textContent = '移除中…';
        // 预留层（service-api.js）未配置 subscribeRemove 时，unsubscribe 直接返回本地模式
        const res = window.ServiceApi ? await window.ServiceApi.unsubscribe(code) : { ok: true, local: true };
        if (!res.ok) {
          btn.disabled = false; btn.textContent = '删除';
          showToast(`⚠️ 移除失败：${res.error || '未知错误'}`);
          return;
        }
        window.SubscribeManager.remove(code);
        updateCount();
        renderSubList();
        // remoteSkipped：只改了本地，服务端并未收到请求。必须说清楚，
        // 否则用户会以为服务端也一起删掉了。
        showToast(res.remoteSkipped ? `⚠️ ${res.reason || '仅本地移除，未同步服务端'}` : `已移除: ${code}`,
                  res.remoteSkipped ? 4000 : 2500, res.remoteSkipped ? 'warn' : 'info');
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

  /** 导出已订阅服务 */
  function exportServices() {
    const text = window.SubscribeManager.export();
    if (!text) {
      showToast('⚠️ 暂无可导出的服务');
      return;
    }

    // 复制到剪贴板
    navigator.clipboard.writeText(text).then(() => {
      showToast('✅ 已复制到剪贴板');
    }).catch(() => {
      // 降级方案
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      showToast('✅ 已复制到剪贴板');
    });
  }

  /** 确认清空 */
  async function confirmClear() {
    const ok = (window.DialogUtils && typeof window.DialogUtils.confirmBox === 'function')
      ? await window.DialogUtils.confirmBox({
        title: '清空已订阅服务',
        message: '确定要清空所有已订阅服务吗？此操作不可恢复。',
        okText: '清 空',
        danger: true,
      })
      : window.confirm('确定要清空所有已订阅服务吗？此操作不可恢复。');
    if (!ok) return;
    try {
      window.SubscribeManager.clear();
      updateCount();
      renderSubList();
      showToast('🗑️ 已清空所有已订阅服务', 2000, 'info');
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
    if (typeof window._showToast === 'function') {
      window._showToast(msg, duration, type);
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
