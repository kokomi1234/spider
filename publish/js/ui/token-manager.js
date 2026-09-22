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
    return fetch(adminUrl('/admin/token/status'), { headers: apiHeaders(), cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || data.code !== 200) return false;
        currentPreview = data.tokenPreview || NOT_SET;
        currentHasToken = !!data.hasToken;
        // envPath 照旧接住（它是接口契约的一部分），但**刻意不往界面上渲染** ——
        // 那是本机绝对路径、属于实现细节，原因见 renderStatus 里的注释。
        currentEnvPath = data.envPath || '';
        // 2026-09-22 新增：我自己那条的状态 + 本次实际会用谁的 token（代理算好的，
        // 与转发时同一套判定 —— 弹窗说的和实际用的必须一致）
        currentMine = data.mine || { has: false };
        currentSource = String(data.source || '');
        currentReason = String(data.reason || '');
        currentExpiryHour = Number(data.expiryHour) || 5;
        if (data.adminUserId) adminKeyCache = String(data.adminUserId);
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

    var k = meKey();
    var admin = isAdminNow();

    // 第一行：管理员 token（.env 那个）—— 全局口径，照旧显示
    var label = document.createElement('span');
    label.textContent = admin ? '管理员 token：' : '管理员 token（兜底用）：';

    var code = document.createElement('code');
    code.style.cssText = 'padding:2px 6px;background:var(--surface-2);border-radius:4px;font-size:var(--fs-xs);font-family:monospace;';
    code.textContent = currentPreview || NOT_SET;

    var state = document.createElement('span');
    state.textContent = currentHasToken ? ' ● 已配置' : ' ○ 未配置';
    state.style.color = currentHasToken ? 'var(--success)' : 'var(--red-c)';

    el.appendChild(label);
    el.appendChild(code);
    el.appendChild(state);

    // 第二行（2026-09-22）：我自己那条 + 本次实际会用谁的。
    // 用 resolveToken 的结论（status 回传的 source）而不是前端自己猜 ——
    // 弹窗说的和实际用的必须一致，否则"明明录了却还在用管理员的"这种问题无从排查。
    var line2 = document.createElement('div');
    line2.style.cssText = 'margin-top:6px;';
    if (!k) {
      line2.textContent = '未设置「当前用户」：本次请求都用管理员 token（只有查询权限），录入自己的 token 前请先在首页设好身份。';
    } else {
      var mineTxt;
      if (!currentMine || !currentMine.has) mineTxt = '未录入';
      else if (currentMine.expired) mineTxt = '已过期（每天 ' + currentExpiryHour + ':00 失效，需重新录入）';
      else mineTxt = '已录入 ' + (currentMine.preview || '');
      var using;
      if (currentSource === 'user') using = '本人在用（可订阅等写操作）';
      else if (currentSource === 'admin') using = '管理员本人（就是上面这个全局 token，全套操作）';
      else using = '回落到管理员 token' + (currentReason ? '（' + currentReason + '）' : '') + '：只有查询权限';
      line2.textContent = '我的 token：' + mineTxt + '　·　本次用：' + using;
    }
    if (currentSource === 'fallback' && k) line2.style.color = 'var(--muted)';
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
    // 勾选框取不到时按界面默认（勾选）处理，避免误判成「不落盘」
    var saveToEnv = saveEl ? !!saveEl.checked : true;

    // 2026-09-22：没设「当前用户」就不能改 —— 没有身份既绑不了「我的 token」，
    // 更不该让他改到**全局**的管理员 token（那会影响所有人）。
    if (!meKey()) {
      toast('请先在首页设置「当前用户」，再回来录入你自己的 token', 3200, 'warn');
      return Promise.resolve(false);
    }

    // 2026-09-22：按身份决定这次改的是谁的 token。
    // 管理员 → 全局 token（可写 .env，由运维工具持续刷新）；
    // 普通用户 → **他自己的**（存代理的 token 库、绑到他的工号；不写 .env）。
    var k = meKey();
    var admin = isAdminNow();
    var me = meNow();
    var payload = { token: token, saveToEnv: admin ? saveToEnv : false };
    if (k && !admin) {
      payload.userKey = k;
      payload.userName = (me && me.userName) || '';
    }

    return fetch(adminUrl('/admin/token'), {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify(payload),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || data.code !== 200) {
          toast('更新失败：' + ((data && data.msg) || '未知错误'), 2500, 'warn');
          return false;
        }
        if (admin) {
          toast('管理员 token 已更新' + (saveToEnv ? ' 并写入 .env' : '（仅当次有效）'), 2000, 'success');
        } else {
          toast('已录入你自己的 token：后续查询将用它；每天 ' + currentExpiryHour + ':00 失效，重录即可', 3600, 'success');
        }
        // 用服务端返回的真值刷新缓存，下次打开弹窗直接是最新的
        return loadStatus();
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
    var k = meKey();
    var admin = isAdminNow();

    var h2 = ctx.overlay ? ctx.overlay.querySelector('.sub-head h2') : null;
    if (h2) h2.textContent = admin ? '管理员 Token' : (k ? '我的 Token' : 'Token');

    var label = ctx.body.querySelector('#tm-token-label');
    if (label) label.textContent = admin ? '管理员 Token' : '我的 Token';

    var input = ctx.body.querySelector('#tm-token-input');
    if (input) input.placeholder = admin ? '粘贴管理员（PROXY_TOKEN）的值' : '粘贴你自己在内网取的 token';

    // 「覆盖 .env」只对管理员成立：普通用户的 token 存在代理的 token 库里，不碰 .env
    var box = ctx.body.querySelector('#tm-save-env');
    var boxWrap = box && box.closest ? box.closest('label') : null;
    if (boxWrap) boxWrap.style.display = admin ? '' : 'none';

    // 「清除我的 token」：只有"本人身份 + 确实录过"才显示（没录过没什么可清的）
    var clearWrap = ctx.body.querySelector('#tm-clear-wrap');
    if (clearWrap) clearWrap.hidden = !(k && !admin && currentMine && currentMine.has);

    var hint = ctx.body.querySelector('#tm-role-hint');
    if (hint) {
      if (admin) {
        hint.textContent = '你是管理员：这里改的是**全局** token（其他人没录入自己的 token 时兜底用它），'
          + '可勾选写入 .env —— 平时由你的运维工具自动刷新，手改一般只在排查问题时。';
      } else if (k) {
        hint.textContent = '录入你自己的 token 后，你的查询就用它（订阅等写操作也能用）；'
          + '它每天 ' + currentExpiryHour + ':00 失效，失效后会自动回落到管理员 token（只剩查询权限），重录即可。';
      } else {
        hint.textContent = '还没设置「当前用户」：请先回首页设好身份，再回来录入你自己的 token。'
          + '在那之前，所有请求都用管理员 token（只有查询权限）。';
      }
      hint.hidden = false;
    }
  }

  /**
   * 把自己的 token 撤掉（2026-09-22）：回到「回落管理员 token」的状态。
   * 用户要求走同一个「🔑 Token」弹窗 —— 在哪儿录入，就在哪儿撤销，不另开入口。
   */
  function clearMyToken() {
    var DU = window.DialogUtils;
    var k = meKey();
    // 管理员那条在 .env 里，不从这里清（他的 token 由运维工具维护）
    if (!k || isAdminNow()) return Promise.resolve(false);

    var ask = (DU && typeof DU.confirmBox === 'function')
      ? DU.confirmBox({
        title: '清除我的 token？',
        message: '清除后你的查询会回落到管理员 token（只剩查询权限，订阅会被禁），直到你重新录入自己的。',
        okText: '清 除',
        danger: true,
      })
      : Promise.resolve(true);   // 拿不到确认组件时直接执行：这是可逆操作，不值得卡住

    return ask.then(function (yes) {
      if (!yes) return false;
      return fetch(adminUrl('/admin/token'), {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({ userKey: k, remove: true }),
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (!data || data.code !== 200) {
            toast('清除失败：' + ((data && data.msg) || '未知错误'), 2500, 'warn');
            return false;
          }
          toast('已清除：查询会回落到管理员 token（只有查询权限）', 3200, 'success');
          // 就地刷新：状态区与「清除」按钮的显隐都要跟着变
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
