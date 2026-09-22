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
  // ── 2026-09-22：token 按人 ──────────────────────────────
  // 弹窗现在有两种语义：管理员改的是**全局 token**（.env 那个，运维工具每天刷新）；
  // 普通用户录的是**自己的 token**（存代理的 token 库，绑到他的工号）。
  var currentMine = null;      // { has, preview, issuedAt, expired } —— 我自己那条
  var currentSource = '';      // 'user' = 本次用我的；'admin' = 回落管理员
  var currentReason = '';
  var currentExpiryHour = 5;
  var adminKeyCache = '4711510';
  // 清除自己的 token 之后要就地刷新弹窗，所以把这两个引用留住（onReady 里赋值）
  var statusElRef = null;
  var ctxRef = null;

  /** 当前登录用户（决定这次改的是谁的 token） */
  function meNow() {
    try {
      var u = (typeof window !== 'undefined' && window.CurrentUser) ? window.CurrentUser.get() : null;
      return u || null;
    } catch (_) { return null; }
  }
  /** 当前用户键（工号优先、姓名兜底）；未登录返回空串 */
  function meKey() {
    var u = meNow();
    return String((u && (u.userId || u.userName)) || '').trim();
  }
  function isAdminNow() {
    var k = meKey();
    return !!k && k === adminKeyCache;
  }
  /** 带身份的请求头：代理靠它决定用谁的 token */
  function apiHeaders() {
    var k = meKey();
    var h = { 'Content-Type': 'application/json' };
    if (k) h['x-user-key'] = k;
    return h;
  }

  function toast(msg, ms, type) {
    if (typeof window.toast === 'function') window.toast(msg, ms, type);
  }

  /**
   * 管理端点 URL：URL 上带 `?token=` 时透传过去（方便运维临时指定），页面没带就保持原样。
   * 注意代理侧**不鉴权**——`PROXY_ADMIN_TOKEN` 那层校验已于 2026-09-20 整体删除，
   * 这里的 ?token= 只是可选的传参便利，不是鉴权开关。
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
    // 只拉**代理侧**的状态（管理员 token / .env 位置 / 管理员工号）。
    // 本机 token 的状态不从这里来 —— 它就在 localStorage 里，直接读（见 localStatus）。
    return fetch(adminUrl('/admin/token/status'), { headers: { 'Content-Type': 'application/json' }, cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || data.code !== 200) return false;
        currentPreview = data.tokenPreview || NOT_SET;
        currentHasToken = !!data.hasToken;
        // envPath 照旧接住（它是接口契约的一部分），但**刻意不往界面上渲染** ——
        // 那是本机绝对路径、属于实现细节，原因见 renderStatus 里的注释。
        currentEnvPath = data.envPath || '';
        currentExpiryHour = Number(data.expiryHour) || 5;
        if (data.adminUserId) {
          adminKeyCache = String(data.adminUserId);
          // 让 api-client 也用同一份「谁是管理员」——前端判源要用它
          if (window.API && typeof window.API.setAdminUserId === 'function') {
            window.API.setAdminUserId(data.adminUserId);
          }
        }
        return true;
      })
      .catch(function () { return false; });
  }

  /** 本机 token 的状态（localStorage；模块没加载时当成"没有"） */
  function localStatus() {
    try {
      if (window.UserToken && typeof window.UserToken.status === 'function') return window.UserToken.status();
    } catch (_) { /* 读坏了就当没有 */ }
    return { has: false, expired: false, preview: '', ownerKey: '', ownerName: '' };
  }

  /** 把「当前 token 预览 + 是否已配置」画进状态区（用 textContent，不拼 HTML） */
  function renderStatus(el, failed) {
    if (!el) return;
    el.textContent = '';

    if (failed) {
      el.textContent = '⚠️ 读不到代理状态（代理未启动？）';
      return;
    }

    var mine = localStatus();
    var admin = isAdminNow();

    // 第一行：管理员 token（.env 那个，兜底用）
    var line1 = document.createElement('div');
    line1.textContent = '管理员 token：' + (currentPreview || NOT_SET) + (currentHasToken ? '  ●' : '  ○');
    el.appendChild(line1);

    // 第二行：本机 token（2026-09-22 起 token 只存本机、不上传）
    var line2 = document.createElement('div');
    line2.style.marginTop = '6px';
    if (mine.has && mine.expired) {
      line2.textContent = '本机 token：已过期（每天 ' + currentExpiryHour + ':00 失效），请重新录入';
    } else if (mine.has) {
      line2.textContent = '本机 token：' + mine.preview + '（' + (mine.ownerName || '未记名') + '）';
    } else if (admin) {
      line2.textContent = '本机 token：未录入（你是管理员，用上面那个）';
    } else {
      line2.textContent = '本机 token：未录入 → 查询用管理员 token（只有查询权限）';
    }
    el.appendChild(line2);

    // 2026-09-21 用户拍板：这里原来还会渲染一行「写入位置：<本机绝对路径>」。
    // 那暴露的是后端实现（token 落在哪个文件、本机的目录结构），对使用者没用 —— 删掉。
    // 需要知道落盘位置的场景是排查故障，看 proxy.js 的启动日志就行。
  }

  /** 提交新 token；返回 Promise<boolean> 便于调用方决定后续动作 */
  function applyToken() {
    var input = document.getElementById('tm-token-input');
    var saveEl = document.getElementById('tm-save-env');
    if (!input) return Promise.resolve(false);

    var token = String(input.value || '').trim();
    if (!token) return Promise.resolve(false);

    // 普通用户（**包括没登录的**）：只存本机、不上传 —— 2026-09-22 用户拍板。
    // 有的同事 token 权限较高，不愿交给后端；代理因此完全不需要存用户凭证。
    if (!isAdminNow()) {
      var UT = window.UserToken;
      if (!UT || typeof UT.set !== 'function') {
        toast('本机 token 模块未加载，无法保存', 2800, 'warn');
        return Promise.resolve(false);
      }
      var r = UT.set(token, meNow());
      if (!r.ok) {
        toast(r.error || '保存失败', 2800, 'warn');
        return Promise.resolve(false);
      }
      toast('已存在本机：查询将用它（每天 ' + currentExpiryHour + ':00 失效）', 3200, 'success');
      if (window.API && typeof window.API.notifyTokenSource === 'function') window.API.notifyTokenSource();
      renderStatus(statusElRef, false);
      applyIdentityChrome(ctxRef);
      return Promise.resolve(true);
    }

    // 管理员：改的是**全局** token（其他人没录入时兜底用它），可写回 .env
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
        toast('管理员 token 已更新' + (saveToEnv ? '（已写入 .env）' : '（仅当次有效）'), 2200, 'success');
        return loadStatus().then(function (ok) {
          renderStatus(statusElRef, !ok);
          applyIdentityChrome(ctxRef);
          return true;
        });
      })
      .catch(function () {
        toast('请求失败：代理未启动或 /admin/token 不可达', 2500, 'warn');
        return false;
      });
  }

  /**
   * 按身份把弹窗调成对应语义（2026-09-22）。
   * 为什么放在 status 回来之后：管理员工号是代理从 .env 读的，只有拿到 status 才知道
   * 「当前这个人算不算管理员」—— 提前按本地默认值渲染，遇到改过 ADMIN_USER_ID 的部署会标错。
   */
  function applyIdentityChrome(ctx) {
    if (!ctx) return;
    var admin = isAdminNow();
    var mine = localStatus();

    var h2 = ctx.overlay ? ctx.overlay.querySelector('.sub-head h2') : null;
    if (h2) h2.textContent = admin ? '管理员 Token' : '本机 Token';

    var label = ctx.body.querySelector('#tm-token-label');
    if (label) label.textContent = admin ? '管理员 Token' : '本机 Token';

    var input = ctx.body.querySelector('#tm-token-input');
    if (input) input.placeholder = admin ? '粘贴管理员 token' : '粘贴你的 token';

    // 「覆盖 .env」只对管理员成立：本机 token 存在浏览器里，不碰 .env
    var box = ctx.body.querySelector('#tm-save-env');
    var boxWrap = box && box.closest ? box.closest('label') : null;
    if (boxWrap) boxWrap.style.display = admin ? '' : 'none';

    // 「清除本机 token」：录过才显示（没录过没什么可清的）
    var clearWrap = ctx.body.querySelector('#tm-clear-wrap');
    if (clearWrap) clearWrap.hidden = !mine.has;

    // 一句说明就够（2026-09-22 用户：「提示文字太多了」）
    var hint = ctx.body.querySelector('#tm-role-hint');
    if (hint) {
      hint.textContent = admin
        ? '全局 token：其他人没录入自己的时兜底用它。'
        : '只存在这台机器上，不会上传。';
      hint.hidden = false;
    }
  }

  /**
   * 把自己的 token 撤掉（2026-09-22）：回到「回落管理员 token」的状态。
   * 用户要求走同一个「🔑 Token」弹窗 —— 在哪儿录入，就在哪儿撤销，不另开入口。
   */
  function clearMyToken() {
    var DU = window.DialogUtils;
    var UT = window.UserToken;
    if (!UT || typeof UT.clear !== 'function' || !UT.status().has) return Promise.resolve(false);

    var ask = (DU && typeof DU.confirmBox === 'function')
      ? DU.confirmBox({
        title: '清除本机 token？',
        message: '清除后查询会用管理员 token（只有查询权限），直到你重新录入。',
        okText: '清 除',
        danger: true,
      })
      : Promise.resolve(true);   // 拿不到确认组件时直接执行：这是本机可逆操作

    return ask.then(function (yes) {
      if (!yes) return false;
      var r = UT.clear();
      if (!r.ok) {
        toast(r.error || '清除失败', 2500, 'warn');
        return false;
      }
      toast('已清除本机 token', 2200, 'success');
      if (window.API && typeof window.API.notifyTokenSource === 'function') window.API.notifyTokenSource();
      renderStatus(statusElRef, false);
      applyIdentityChrome(ctxRef);
      return true;
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
        statusElRef = ctx.body.querySelector('#tm-status');
        ctxRef = ctx;
        statusEl = statusElRef;
        loadStatus().then(function (ok) {
          renderStatus(statusEl, !ok);
          applyIdentityChrome(ctx);   // 管理员工号来自 status，得等它回来才能定文案
        });
      },
      buildBody: function (body) {
        // 当前状态
        var statusDiv = document.createElement('div');
        statusDiv.className = 'form-group';
        statusDiv.id = 'tm-status';
        statusDiv.style.cssText = 'margin-bottom:var(--sp2);padding:10px 12px;background:var(--surface-1);border-radius:var(--r-md);font-size:var(--fs-sm);color:var(--muted);';
        statusDiv.textContent = '加载中...';
        body.appendChild(statusDiv);

        // 身份说明（2026-09-22）：这里改的到底是「我的 token」还是「管理员 token」——
        // 管理员工号要等 status 回来才知道，所以先占位，交给 applyIdentityChrome 填。
        var roleHint = document.createElement('div');
        roleHint.id = 'tm-role-hint';
        roleHint.hidden = true;
        roleHint.style.cssText = 'margin:-6px 0 var(--sp2);font-size:var(--fs-xs);color:var(--muted);line-height:1.6;';
        body.appendChild(roleHint);

        // Token 输入
        var group = document.createElement('div');
        group.className = 'form-group';
        group.style.marginBottom = 'var(--sp2)';
        var label = document.createElement('label');
        label.id = 'tm-token-label';
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

        // 2026-09-21 用户拍板：这里原本还有两行说明 ——
        //   「不勾选则只在当前代理进程里生效，重启后回到 .env 里的值。」
        //   「改完立即生效，无需重启代理（.env 由代理监听 mtime 自动重载）。」
        // 那是在把后端实现（代理进程、.env 落盘、文件监听）讲给使用者听，界面上没必要，
        // 记在这里就够了。勾选框自己的 label「覆盖 .env 文件（持久生效）」已经表达了
        // 用户需要知道的那点区别：勾上 = 写文件、重启后还在。

        // 「清除我的 token」（2026-09-22）：在哪儿录入就在哪儿撤销。
        // 只在「本人确实录过」时出现，显隐由 applyIdentityChrome 控制 ——
        // 它要等 status 回来才知道录没录过。
        var clearWrap = document.createElement('div');
        clearWrap.id = 'tm-clear-wrap';
        clearWrap.hidden = true;
        clearWrap.style.cssText = 'margin-bottom:var(--sp2);';
        var clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.id = 'tm-clear-mine';
        clearBtn.className = 'outlined btn-sm';
        clearBtn.textContent = '清除我的 token';
        // 用 createElement + addEventListener（与勾选框同一手法）：测试里能真点到
        clearBtn.addEventListener('click', clearMyToken);
        clearWrap.appendChild(clearBtn);
        body.appendChild(clearWrap);
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
