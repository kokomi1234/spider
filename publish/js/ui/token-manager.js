/**
 * Token 管理 — 页面上直接更改代理 token，无需手动编辑 .env
 *
 * 用法：
 *   TokenManager.init()   // 在页面加载后调用一次（index.js 启动时已调用）
 *
 * 依赖一律在调用时才取值（顶层捕获会在脚本排在后面时永久退化）：
 *   DialogUtils.openUtilDialog  通用弹窗骨架（js/ui/dialog-utils.js）
 *   window.toast                提示条（js/ui/toast.js）
 *
 * 后端（proxy.js）：
 *   GET  /admin/token/status → { code:200, hasToken, tokenPreview, envPath }
 *   POST /admin/token        body { token, saveToEnv } → { code:200, msg, saved }
 */
(function () {
  'use strict';

  // 未拉到状态时的占位文案。这里刻意不用「顶层变量取大写常量」的写法：
  // module-order.test.js 的静态扫描会把大写标识符当成跨模块依赖捕获而报违规。
  var NOT_SET = '(未配置)';
  var currentPreview = null;      // null = 还没拉到状态
  var currentHasToken = false;
  var currentEnvPath = '';

  function toast(msg, ms, type) {
    if (typeof window.toast === 'function') window.toast(msg, ms, type);
  }

  /**
   * 管理端点 URL：代理设了 PROXY_ADMIN_TOKEN 时，页面通常是带 ?token= 打开的，
   * 把这个值透传过去；页面没带就保持原样（默认不鉴权，行为不变）。
   */
  function adminUrl(path) {
    try {
      var t = new URLSearchParams(window.location.search).get('token');
      return t ? path + '?token=' + encodeURIComponent(t) : path;
    } catch (e) {
      return path;
    }
  }

  /** 拉一次当前状态；失败不抛，留给调用方决定怎么显示 */
  function loadStatus() {
    return fetch(adminUrl('/admin/token/status'))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || data.code !== 200) return false;
        currentPreview = data.tokenPreview || NOT_SET;
        currentHasToken = !!data.hasToken;
        currentEnvPath = data.envPath || '';
        return true;
      })
      .catch(function () { return false; });
  }

  /** 把「当前 token 预览 + 是否已配置」画进状态区（用 textContent，不拼 HTML） */
  function renderStatus(el, failed) {
    if (!el) return;
    el.textContent = '';

    if (failed) {
      el.textContent = '⚠️ 状态获取失败（代理未启动或 /admin/token/status 不可达）';
      return;
    }

    var label = document.createElement('span');
    label.textContent = '当前：';

    var code = document.createElement('code');
    code.style.cssText = 'padding:2px 6px;background:var(--surface-2);border-radius:4px;font-size:var(--fs-xs);font-family:monospace;';
    code.textContent = currentPreview || NOT_SET;

    var state = document.createElement('span');
    state.textContent = currentHasToken ? ' ● 已配置' : ' ○ 未配置';
    state.style.color = currentHasToken ? 'var(--success)' : 'var(--red-c)';

    el.appendChild(label);
    el.appendChild(code);
    el.appendChild(state);

    if (currentEnvPath) {
      var path = document.createElement('div');
      path.style.cssText = 'margin-top:6px;font-size:var(--fs-xs);opacity:.75;';
      path.textContent = '写入位置：' + currentEnvPath;
      el.appendChild(path);
    }
  }

  /** 提交新 token；返回 Promise<boolean> 便于调用方决定后续动作 */
  function applyToken() {
    var input = document.getElementById('tm-token-input');
    var saveEl = document.getElementById('tm-save-env');
    if (!input) return Promise.resolve(false);

    var token = String(input.value || '').trim();
    if (!token) return Promise.resolve(false);
    // 勾选框取不到时按界面默认（勾选）处理，避免误判成「不落盘」
    var saveToEnv = saveEl ? !!saveEl.checked : true;

    return fetch(adminUrl('/admin/token'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token, saveToEnv: saveToEnv }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || data.code !== 200) {
          toast('更新失败：' + ((data && data.msg) || '未知错误'), 2500, 'warn');
          return false;
        }
        toast('Token 已更新' + (saveToEnv ? ' 并写入 .env' : '（仅当次有效）'), 2000, 'success');
        // 用服务端返回的真值刷新缓存，下次打开弹窗直接是最新的
        return loadStatus();
      })
      .catch(function () {
        toast('请求失败：代理未启动或 /admin/token 不可达', 2500, 'warn');
        return false;
      });
  }

  function openDialog() {
    var DU = window.DialogUtils;
    if (!DU || typeof DU.openUtilDialog !== 'function') return;

    var statusEl = null;

    DU.openUtilDialog({
      title: 'Token 管理',
      // 先开弹窗再拉状态：不用等网络，也不靠 setTimeout 猜请求什么时候回来
      onReady: function (ctx) {
        statusEl = ctx.body.querySelector('#tm-status');
        loadStatus().then(function (ok) { renderStatus(statusEl, !ok); });
      },
      buildBody: function (body) {
        // 当前状态
        var statusDiv = document.createElement('div');
        statusDiv.className = 'form-group';
        statusDiv.id = 'tm-status';
        statusDiv.style.cssText = 'margin-bottom:var(--sp2);padding:10px 12px;background:var(--surface-1);border-radius:var(--r-md);font-size:var(--fs-sm);color:var(--muted);';
        statusDiv.textContent = '加载中...';
        body.appendChild(statusDiv);

        // Token 输入
        var group = document.createElement('div');
        group.className = 'form-group';
        group.style.marginBottom = 'var(--sp2)';
        var label = document.createElement('label');
        label.textContent = '新 Token';
        var input = document.createElement('input');
        input.type = 'text';
        input.id = 'tm-token-input';
        input.placeholder = '粘贴新的 PROXY_TOKEN 值';
        // token 是一长串机器字符，拼写检查会在整串下画红波浪线
        input.spellcheck = false;
        input.setAttribute('autocomplete', 'off');
        group.appendChild(label);
        group.appendChild(input);
        body.appendChild(group);

        // 选项
        var optDiv = document.createElement('div');
        optDiv.style.cssText = 'margin-bottom:var(--sp2);';
        var checkbox = document.createElement('label');
        checkbox.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;font-size:var(--fs-md);color:var(--on-surface);';
        // 用 createElement 而不是 innerHTML 拼：这样勾选项在 DOM 里是真实节点，
        // 提交时 getElementById('tm-save-env').checked 才拿得到（测试也能覆盖到）。
        var box = document.createElement('input');
        box.type = 'checkbox';
        box.id = 'tm-save-env';
        box.checked = true;
        box.style.cssText = 'accent-color:var(--primary);width:18px;height:18px;';
        var boxLabel = document.createElement('span');
        boxLabel.textContent = '覆盖 .env 文件（持久生效）';
        checkbox.appendChild(box);
        checkbox.appendChild(boxLabel);
        optDiv.appendChild(checkbox);
        body.appendChild(optDiv);

        // 说明
        var tip = document.createElement('div');
        tip.style.cssText = 'font-size:var(--fs-xs);color:var(--muted);line-height:1.6;';
        tip.innerHTML = '不勾选则只在当前代理进程里生效，重启后回到 .env 里的值。<br>'
          + '改完立即生效，无需重启代理（.env 由代理监听 mtime 自动重载）。';
        body.appendChild(tip);
      },
      footButtons: [
        { text: '取 消', cls: 'outlined btn-sm', value: null },
        {
          text: '确 认',
          cls: 'filled btn-sm',
          // 校验交给 validate：非空才继续，否则就地提示且弹窗不关闭
          validate: function () {
            var input = document.getElementById('tm-token-input');
            if (input && !String(input.value || '').trim()) return '请输入新的 Token';
            return '';
          },
          getValue: function () {
            applyToken().then(function () {
              // 弹窗已关闭，刷新模块内缓存即可（下次打开就是最新值）
            });
            return null;
          },
        },
      ],
    });
  }

  window.TokenManager = {
    init: function () {
      var btn = document.getElementById('btnTokenManager');
      if (!btn) return;
      btn.addEventListener('click', openDialog);
    },
    // 暴露给测试 / 其他页面复用
    openDialog: openDialog,
    loadStatus: loadStatus,
    // （已删）getState：全库零引用（无测试/页面调用 TokenManager.getState）
  };
})();
