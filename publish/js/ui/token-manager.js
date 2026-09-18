/**
 * Token 管理 — 页面上直接更改代理 token，无需手动编辑 .env
 *
 * 用法：
 *   TokenManager.init()   // 在页面加载后调用一次
 */
(function () {
  'use strict';

  var currentPreview = '(未配置)';
  var currentHasToken = false;

  function loadStatus() {
    return fetch('/admin/token/status').then(function (r) { return r.json(); }).then(function (data) {
      if (data.code === 200) {
        currentPreview = data.tokenPreview;
        currentHasToken = data.hasToken;
      }
    }).catch(function () {});
  }

  function applyToken() {
    var input = document.getElementById('tm-token-input');
    if (!input) return;
    var token = (input.value || '').trim();
    if (!token) {
      input.style.borderColor = 'var(--red-c)';
      input.focus();
      return;
    }
    input.style.borderColor = '';
    var saveToEnv = document.getElementById('tm-save-env').checked;

    fetch('/admin/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token, saveToEnv: saveToEnv }),
    }).then(function (r) { return r.json(); }).then(function (data) {
      if (data.code === 200) {
        loadStatus();
        if (typeof window.toast === 'function') {
          window.toast('Token 已更新' + (saveToEnv ? ' 并写入 .env' : ''), 2000, 'success');
        }
      } else {
        if (typeof window.toast === 'function') window.toast('更新失败：' + data.msg, 2500, 'warn');
      }
    }).catch(function () {
      if (typeof window.toast === 'function') window.toast('请求失败', 2500, 'warn');
    });
  }

  window.TokenManager = {
    init: function () {
      var btn = document.getElementById('btnTokenManager');
      if (!btn) return;
      btn.addEventListener('click', function () {
        loadStatus();
        setTimeout(function () {
          DialogUtils.openUtilDialog({
            title: 'Token 管理',
            buildBody: function (body) {
              // 当前状态
              var statusDiv = document.createElement('div');
              statusDiv.className = 'form-group';
              statusDiv.style.cssText = 'margin-bottom:var(--sp2);padding:10px 12px;background:var(--surface-1);border-radius:var(--r-md);font-size:var(--fs-sm);color:var(--muted);';
              statusDiv.id = 'tm-status';
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
              group.appendChild(label);
              group.appendChild(input);
              body.appendChild(group);

              // 选项
              var optDiv = document.createElement('div');
              optDiv.style.cssText = 'margin-bottom:var(--sp2);';
              var checkbox = document.createElement('label');
              checkbox.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;font-size:var(--fs-md);color:var(--on-surface);';
              checkbox.innerHTML = '<input type="checkbox" id="tm-save-env" checked style="accent-color:var(--primary);width:18px;height:18px;">';
              checkbox.innerHTML += '<span>覆盖 .env 文件（持久生效）</span>';
              optDiv.appendChild(checkbox);
              body.appendChild(optDiv);

              // 更新状态显示
              setTimeout(function () {
                var el = document.getElementById('tm-status');
                if (el) {
                  el.innerHTML = '当前：<code style="background:var(--surface-2);padding:2px 6px;border-radius:4px;font-size:var(--fs-xs);font-family:monospace;">' + currentPreview + '</code>' +
                    (currentHasToken ? ' <span style="color:var(--success);">● 已配置</span>' : ' <span style="color:var(--red-c);">○ 未配置</span>');
                }
              }, 0);
            },
            footButtons: [
              { text: '取 消', cls: 'outlined btn-sm', value: null },
              { text: '确 认', cls: 'filled btn-sm', getValue: function () { applyToken(); return null; } },
            ],
          });
        }, 50);
      });
    },
  };
})();
