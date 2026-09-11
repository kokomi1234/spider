/**
 * 跳转到 ITAMP「服务搜索查看」页面（/asserInstruments/serviceSearchView）并携带筛选参数。
 *
 * ⚠️ 现状与边界（务必知晓）：
 *   目标页是 Vue 单页（`analysis/output/ITAMP接口总览.md`：登录后跳
 *   `serviceSearchView?sessionid=...&statuscode=10000`），**会读 URL query**；
 *   但「表单字段能不能靠 query 预填、预填后是否自动查询」尚未在真实环境确认。
 *   这里按目标页表单字段名拼参数，属于尽力而为：目标页认就省事，不认则跳过去手动填。
 *
 * 目标页表单字段名（来源：2026-09-11 抓包 getSubscriptionPublishHistoryList，
 * Referer = /asserInstruments/serviceSearchView，请求体字段即表单字段）：
 *   单值：compNum / putBatch / providerServiceNameAndId / useNum / prodBatch /
 *         prodSysServeNo / subscriberId / subscriberName / isSendOutsideSystem /
 *         status / deptId / prodDeptId / callerComponent / batch
 *   多值：sysServeNoList / serverCodingList / prodSysServeNoList（URL 里逗号拼接）
 *
 * 用法：
 *   window.AppNavigator.openServiceSearch({ compNum: 'E00301',
 *                                           providerServiceNameAndId: '全球汇划账户列表查询' });
 *   window.AppNavigator.buildUrl({ ... });   // 只拿 URL（便于自动化验证）
 */
(function () {
  'use strict';

  const TARGET_URL = 'https://itamp.bocsys.cn/asserInstruments/serviceSearchView';

  /** 目标页的「数组型」表单字段：URL query 里用逗号拼接 */
  const ARRAY_FIELDS = ['sysServeNoList', 'serverCodingList', 'prodSysServeNoList'];

  /** 把参数对象拼成目标页 URL（空值 / 空数组自动跳过；数组按逗号拼接） */
  function buildUrl(params) {
    const url = new URL(TARGET_URL);
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value == null) return;
      let str;
      if (Array.isArray(value)) str = value.filter((v) => v != null && String(v).trim() !== '').join(',');
      else str = String(value).trim();
      if (str !== '') url.searchParams.set(key, str);
    });
    return url.toString();
  }

  /**
   * 打开服务搜索查看页面。
   * @param {Object}  [params]        预填充的表单参数（用目标页字段名，见上方说明）
   * @param {boolean} [newWindow=true] true=新窗口打开；false=当前窗口跳转
   * @returns {string} 实际打开的 URL（便于调用方日志 / 测试断言）
   */
  function openServiceSearch(params, newWindow) {
    const url = buildUrl(params);
    const useNew = newWindow !== false;
    if (useNew) window.open(url, '_blank', 'noopener');
    else window.location.href = url;
    return url;
  }

  window.AppNavigator = window.AppNavigator || {};
  window.AppNavigator.TARGET_URL = TARGET_URL;
  window.AppNavigator.ARRAY_FIELDS = ARRAY_FIELDS;
  window.AppNavigator.buildUrl = buildUrl;
  window.AppNavigator.openServiceSearch = openServiceSearch;
})();
