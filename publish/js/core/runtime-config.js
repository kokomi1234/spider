/*
 * 运行时环境配置
 *
 * 开发环境默认走本地 proxy；上线时不要改业务代码，部署前设置：
 *   window.__APP_CONFIG__ = {
 *     apiBase: '/api',
 *     mode: 'production'
 *   };
 *
 * 也可以直接在 index.html 之前引入一个同名配置文件覆盖默认值。
 */
(function () {
  'use strict';

  // apiBase 默认跟随当前页面地址（location.origin），这样：
  //   · 本机 http://localhost:3000 访问 → 请求发往 localhost:3000
  //   · 外部 http://<Mac的IP>:3000 访问 → 请求发往 <Mac的IP>:3000（同源，不再指向外部机器自己的 localhost）
  // 之前写死 'http://localhost:3000'，外部浏览器会把接口发到它自己机器上（没代理）→ 全部失败。
  const defaults = {
    mode: 'development',
    apiBase: (typeof location !== 'undefined' && location.origin) ? location.origin : 'http://localhost:3000',
    // 生产环境应由同源网关/后端注入认证，不在浏览器保存 token。
    token: '',
    // ── 详情 / 订阅 接口接入预留 ───────────────────────────────
    // 留空时走本地数据（详情用列表行、订阅用 localStorage），与未接入一致。
    // 抓包确认后填上真实路径即可，service-api.js 里的 build*/adapt* 按报文补全：
    //   endpoints: {
    //     serviceDetail:    '/itamp-tool/publish/getServiceDetail',
    //     subscribeAdd:     '/itamp-tool/publish/subscribe',
    //     subscribeRemove:  '/itamp-tool/publish/unsubscribe',
    //     subscribeList:    '/itamp-tool/publish/getSubscribeList',
    //   }
    // 需要的话还可指定各接口 HTTP 方法：
    //   endpointMethods: { serviceDetail: 'GET', subscribeAdd: 'POST', ... }
    endpoints: {},
    endpointMethods: {},
  };

  const existing = window.__APP_CONFIG__ || {};
  window.__APP_CONFIG__ = { ...defaults, ...existing };
})();
