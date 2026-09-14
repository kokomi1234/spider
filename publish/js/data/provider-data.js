/**
 * 提供方系统列表动态加载
 *
 * ── 抓包依据：进入请求.har ──────────────────────────────
 *   POST http://itamp.bocsys.cn/itamp-tool/intfcMgmt/conditions/subscribe?n=xxx
 *   请求体：无
 *   响应：{"msg":"查询成功","code":"200","data":{
 *           "phyTechCompList":[
 *             {"label":"7×24值班管理系统-T-NCDMS","value":"T50157","shortEn":"T-NCDMS"}, ...],
 *           "physicalApplicationComponentList":[
 *             {"label":"400客服-知识库系统-BOCKB","value":"C20032","shortEn":"BOCKB"}, ...],
 *           "subSystemList":[
 *             {"label":"资产负债管理系统-ALMS","value":"E13300","shortEn":"ALMS"}, ...]}}
 *
 * 三个列表共 ~889 个提供方系统，需要合并去重。
 * label = 显示名称，value = 系统编号（如 T50157 / C20032 / E13300），shortEn = 简称
 */

(function () {
  'use strict';

  const debugLog = window.debugLog || (() => {});

  // 请求已收敛到 api-client.js 的 window.API.fetchSubscribePayload()：
  // 该接口与批次列表是同一个，整个页面只发一次 HTTP，这里只做解析。

  /**
   * 解析单个列表项为统一格式 [{label, value}]
   * label 拼接格式："编号-原始名称"，例如 "C20032-400客服-知识库系统-BOCKB"
   */
  function normalizeItem(it) {
    if (!it || it.value == null || !it.label || it.label === '') return null;
    const rawLabel = String(it.label);
    const value = String(it.value);
    // 拼接编号 + 原始名称
    const label = value + '-' + rawLabel;
    return { label, value };
  }

  /**
   * 解析响应中的三个列表，合并去重后按名称排序
   */
  function parseProviders(payload) {
    if (!payload || Number(payload.code) !== 200) {
      throw new Error(
        '提供方系统接口返回业务错误：code=' + (payload && payload.code) +
        ' msg=' + (payload && payload.msg)
      );
    }
    const data = payload.data;
    if (!data) {
      throw new Error('提供方系统接口响应缺少 data 字段');
    }

    // 三个列表可能都不存在或为空
    const lists = [
      data.phyTechCompList,
      data.physicalApplicationComponentList,
      data.subSystemList,
    ];

    const map = new Map();
    lists.forEach((list) => {
      if (!Array.isArray(list)) return;
      list.forEach((it) => {
        const item = normalizeItem(it);
        if (item && !map.has(item.value)) {
          map.set(item.value, item);
        }
      });
    });

    if (!map.size) {
      throw new Error('未从三个列表中解析出任何提供方系统');
    }

    const result = [...map.values()].sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
    return result;
  }

  /** 请求提供方系统列表（与批次共用同一次订阅条件接口响应，只发一次 HTTP） */
  async function loadProviderList() {
    debugLog('🔄 加载提供方系统列表（复用订阅条件接口，单次请求）...');
    const payload = await window.API.fetchSubscribePayload();
    const result = parseProviders(payload);
    debugLog(`✅ 提供方系统列表加载完成: 共 ${result.length} 个系统`);
    return result;
  }

  if (typeof window !== 'undefined') {
    window.loadProviderList = loadProviderList;
    window.parseProviderPayload = parseProviders;   // 便于在控制台拿真实响应试解析 / 单测直接断言
  }
})();
