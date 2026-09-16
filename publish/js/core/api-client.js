/**
 * 统一前端请求客户端
 *
 * 所有后端调用都走这里，避免「每个接口写一遍 fetch + 拼路径 + 注入 token」。
 * 用法：
 *   const resp = await API.call('/itamp-tool/publish/getPublishDataList', {
 *     method: 'POST',
 *     body: { compNum: 'E00301', pageNum: 1, pageSize: 20 },
 *   });
 *   if (!resp.ok) throw ...
 *   const json = await resp.json();
 *
 * 注意：path 必须是【完整后端路径，含模块】，例如 /itamp-tool/publish/...、
 *       /itamp-comm/iam/...。代理会原样转发，不再做前缀转换。
 */
(function () {
  'use strict';

  const config = (typeof window !== 'undefined' && window.__APP_CONFIG__) || {};
  const BASE_URL = String(config.apiBase || 'http://localhost:3000').replace(/\/$/, '');
  // 仅开发环境兼容旧配置；生产模式不从浏览器配置读取 token。
  const TOKEN = config.mode === 'production' ? '' : String(config.token || '');

  /**
   * @param {string} path   完整后端路径（含模块），如 '/itamp-tool/publish/getOrgTreeList'
   * @param {object} [opts]
   * @param {string} [opts.method='GET']
   * @param {object} [opts.body]   请求体对象，自动 JSON.stringify
   * @param {object} [opts.query]   query 参数对象，自动拼成 ?a=b&c=d（空值忽略）
   * @param {object} [opts.headers] 额外请求头
   * @param {AbortSignal} [opts.signal] 调用方的中止信号（如「被新查询取代」）。
   *        传了它照样有 opts.timeout 兜底：两个信号是「或」的关系，谁先触发谁生效
   * @param {number} [opts.timeout] 超时毫秒数，默认 20000；<= 0 表示不限时
   * @param {number} [opts.retry] 失败后重试次数，默认 0（调用方主动中止的不重试）
   * @returns {Promise<Response>} 原样返回 fetch 的 Response，调用方自行判 resp.ok / resp.json()
   */
  const DEFAULT_TIMEOUT = 20000; // ms，与代理层 PROXY_TIMEOUT 对齐，避免网络异常时无限等待

  async function call(path, opts = {}) {
    const { method = 'GET', body, query, headers = {}, signal, timeout = DEFAULT_TIMEOUT, retry = 0 } = opts;

    let url = BASE_URL + path;
    if (query && typeof query === 'object') {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v != null && v !== '') q.set(k, String(v));
      }
      const qs = q.toString();
      if (qs) url += (url.includes('?') ? '&' : '?') + qs;
    }

    // 超时：调用方**传不传 signal 都要有时限兜底**。
    // 原来只在「没传 signal」时才挂超时，而查询路径全都传了 signal（它的用途是
    // 「被新查询/重置取代时中止」），于是后端一旦挂起，这次请求就永远不返回 ——
    // 全屏 loading 一直转，用户唯一出路是自己再点一次查询。
    // 做法：自建 controller 挂默认超时，再把调用方的 signal 接进来，谁先 abort 谁生效。
    let abortController = null;
    let timer = null;
    let onCallerAbort = null;
    if (timeout > 0 && typeof AbortController !== 'undefined') {
      abortController = new AbortController();
      timer = setTimeout(() => abortController.abort(), timeout);
      if (signal && typeof signal.addEventListener === 'function') {
        if (signal.aborted) {
          // 调用方在这之前就中止过了：直接把这次请求也作废
          abortController.abort();
        } else {
          onCallerAbort = () => abortController.abort();
          signal.addEventListener('abort', onCallerAbort);
        }
      }
    }

    const fetchOpts = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(TOKEN ? { 'token': TOKEN } : {}),
        ...headers,
      },
      ...(abortController ? { signal: abortController.signal } : (signal ? { signal } : {})),
    };
    if (body !== undefined) fetchOpts.body = JSON.stringify(body);

    try {
      return await fetch(url, fetchOpts);
    } catch (e) {
      // 调用方主动中止（发起新查询 / 重置表单）时不算失败：照实抛 AbortError，
      // 别谎报成「超时」—— 查询层靠 err.name === 'AbortError' / signal.aborted 判定中止。
      const callerAborted = !!(signal && signal.aborted);
      // 超时 / 网络错误：可选重试一次（默认不重试，避免意外放大请求量）；
      // 调用方已经取消的请求没有重试的意义。
      if (retry > 0 && !callerAborted) return call(path, { ...opts, retry: retry - 1 });
      if (callerAborted && e && e.name === 'AbortError') throw e;
      const isAbort = e && (e.name === 'AbortError' || (abortController && abortController.signal.aborted));
      if (isAbort) throw new Error(`请求超时（${timeout}ms 未响应）：${path}`);
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
      if (onCallerAbort && signal && typeof signal.removeEventListener === 'function') {
        signal.removeEventListener('abort', onCallerAbort);
      }
    }
  }

  /**
   * 订阅条件接口（提供方系统列表 + 批次列表 都来自同一次响应 data）。
   * 记忆化：同一页面会话内只真正发一次 HTTP，两个列表各自解析响应里的不同字段。
   * 失败则清空缓存，允许后续重试。
   */
  const SUBSCRIBE_PATH = '/itamp-tool/intfcMgmt/conditions/subscribe';
  let _subscribePayloadPromise = null;

  async function fetchSubscribePayload() {
    if (_subscribePayloadPromise) return _subscribePayloadPromise;

    const run = async () => {
      const n = Math.random().toString().slice(2);
      let resp;
      try {
        resp = await call(SUBSCRIBE_PATH, { method: 'POST', query: { n } });
      } catch (e) {
        throw new Error(
          `无法连接订阅条件接口（${SUBSCRIBE_PATH}）。请确认 API 网关或开发服务已启动\n` +
          `原始错误：${e.message}`
        );
      }
      if (!resp.ok) {
        let detail = '';
        try { detail = (await resp.text()).slice(0, 200); } catch (_) { /* ignore */ }
        throw new Error(`请求订阅条件接口失败：HTTP ${resp.status} ${detail}`);
      }
      let payload;
      try {
        payload = await resp.json();
      } catch (e) {
        throw new Error(`订阅条件接口返回的不是 JSON：${e.message}`);
      }
      return payload;
    };

    _subscribePayloadPromise = run();
    // 失败则清除缓存，避免 rejected promise 被永久复用导致无法重试
    _subscribePayloadPromise.catch(() => { _subscribePayloadPromise = null; });
    return _subscribePayloadPromise;
  }

  /**
   * 端点请求器工厂：各 api 模块（tool/service/task/user）共用同一套
   * 「按名字取 endpoint → 发请求 → 校验 HTTP 与业务码 → 统一错误文案」。
   *
   * 为什么收在这里：原先四个模块各写一份 request()，实现几乎逐字相同
   * （差别只在要不要带 query、body 是否 undefined），改一处会漏三处，
   * 错误文案也各说各话。这里只做「协议层」，端点清单仍留在各自模块。
   *
   * 约定（沿用项目既有铁律）：
   *   · 名字未配置（endpoint 为空）时 **直接抛错，不发任何请求** —— 抓包缺失的能力要显式关闭
   *   · 业务码只认 0 / 200（后端有整型 200 也有字符串 "200"）；无 code 的响应放行
   *   · 失败一律抛出 Error，由调用方收敛成 { ok:false, error }
   *
   * @param {{endpoints?:object, methods?:object}} cfg
   * @returns {{endpoints:object, methods:object, isEnabled:Function, request:Function}}
   */
  function createRequester(cfg) {
    const endpoints = (cfg && cfg.endpoints) || {};
    const methods = (cfg && cfg.methods) || {};

    function isEnabled(name) {
      return Boolean(endpoints[name]);
    }

    async function request(name, body, query) {
      if (!endpoints[name]) throw new Error(`接口未配置：${name}（缺抓包时不发请求）`);
      // 传输层**延迟取** window.API.call：便于测试替换，也符合项目「window.* 延迟到调用时取」
      // 的约定（在工厂里捕获 call 会让外面替换 API.call 失效）。
      const send = (typeof window !== 'undefined' && window.API && typeof window.API.call === 'function')
        ? window.API.call
        : call;
      const resp = await send(endpoints[name], {
        method: methods[name] || 'POST',
        ...(body !== undefined ? { body } : {}),
        ...(query ? { query } : {}),
      });

      if (!resp.ok) {
        let detail = '';
        try { detail = (await resp.text()).slice(0, 200); } catch (_) { /* ignore */ }
        throw new Error(`HTTP ${resp.status} ${detail}`.trim());
      }

      let json;
      try {
        json = await resp.json();
      } catch (e) {
        throw new Error(`接口返回的不是 JSON：${e.message}`);
      }

      // 列表类接口有的不带 code（只有 total/rows），所以只在有 code 时才校验
      if (json && json.code != null) {
        const bizCode = Number(json.code);
        if (bizCode !== 0 && bizCode !== 200) {
          throw new Error(json.msg || json.message || `业务错误：代码 ${json.code}`);
        }
      }
      return json;
    }

    return { endpoints, methods, isEnabled, request };
  }

  if (typeof window !== 'undefined') {
    window.API = {
      base: BASE_URL,
      call,
      fetchSubscribePayload,
      createRequester,
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { call };
  }
})();
