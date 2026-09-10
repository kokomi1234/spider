/**
 * 工具侧接口层（window.ToolApi）——服务详情 / 订阅评委 / 历史 / 操作记录 / 性能
 *
 * ── 数据来源 ────────────────────────────────────────────────
 * 抓包文件 `har/订阅.json`（Postman/apifox 形态的集合，2026-09-08）与
 * `output/openapi.json`（由 har2doc.py 从抓包生成）。基础域名
 * http://itamp.bocsys.cn，本地由 proxy.js 转发（前端发完整后端路径）。
 *
 * 抓包确认的接口（16 个）：
 *   评委信息            → POST /itamp-tool/publish/getJudgeInfo?n=xx
 *                         body { compNum, principal, callerComponent }
 *   订阅评委信息        → POST /itamp-tool/publish/subscriptionReview
 *                         body { publishId, prodSysServeNoList, judgeInfoList }
 *   下拉数据            → POST /itamp-tool/publish/getDropDownList?sysServeNo=xx&n=xx
 *   批次信息            → POST /itamp-tool/datadict/codeValueList（无 body）
 *   文档服务编号        → POST /itamp-tool/publish/getDocSysServeNoList
 *                         body { docInstIdList }，返回 sysServeNoList[{label,value,shortEn}]
 *   文档/文本数据       → POST /itamp-tool/publish/getTextData  body { assemblyNo }
 *   产品批次列表        → POST /itamp-tool/publish/getInformationProdBatch  body { compNum }
 *   服务编码列表        → POST /itamp-tool/publish/getInformationServerCoding body { compNum }
 *   历史记录            → POST /itamp-tool/publish/getHistory   body { dataId, pageNum, pageSize, delFlg }
 *   历史详情            → POST /itamp-tool/publish/getHistoryDetail body { informationId, createTime, publishId }
 *   基础版本            → POST /itamp-tool/publish/getInfoBaseVersion body { pageNum, pageSize, informationId, type }
 *   发布列表            → POST /itamp-tool/publish/getPublishList body { callerComponent, operationType, pageNum, pageSize, status, publishId }
 *   操作记录            → POST /itamp-tool/operation/getOperationRecordList body { operationType, pageNum, pageSize, publishId }
 *   子操作记录          → POST /itamp-tool/operation/getSubOperationRecordList body { operationType, pageNum, pageSize, subscriptionId }
 *   性能数据            → POST /itamp-tool/performanceCapacity/getData body { subscriptionId }
 *   性能操作数据        → POST /itamp-tool/performanceCapacity/getPerformanceOperationData
 *                         body { pageNum, pageSize, subscriptionId }
 *   订阅关系查询        → POST /itamp-tool/publish/getSubscriptionPublishHistoryList?n=xx
 *                         body 见 fetchSubscriptionPublishHistory（服务订阅关系查询.har）
 *   调用方服务编号      → POST /itamp-tool/publish/getProdSysServeNoList?callerComponent=xx&n=xx
 *                         无 body，返回 [{label, value, shortEn}]
 *
 * 注意：openapi.json 只记录了请求体结构，多数接口没有保存响应样本，
 * 适配函数统一按「{ code, msg, data | rows }」的通用形态做防御式解析。
 * 某接口真实响应有出入时，在对应 adapt 函数里改，调用方不用动。
 *
 * 导出订阅关系（exportSubscriptionPublishHistoryList）目前**没有抓包**，
 * 按项目铁律只留空 endpoint：未配置时前端不发起任何网络请求，直接走本地 CSV。
 *
 * 约定：所有方法都不抛异常，失败一律返回 { ok:false, error }。
 */
(function () {
  'use strict';

  const CONFIG = (typeof window !== 'undefined' && window.__APP_CONFIG__) || {};

  /** 抓包确认的接口路径（留空 = 关闭该能力） */
  const ENDPOINTS = Object.assign(
    {
      judgeInfo:        '/itamp-tool/publish/getJudgeInfo',
      subscriptionReview: '/itamp-tool/publish/subscriptionReview',
      dropDownList:     '/itamp-tool/publish/getDropDownList',
      codeValueList:    '/itamp-tool/datadict/codeValueList',
      docSysServeNoList: '/itamp-tool/publish/getDocSysServeNoList',
      textData:         '/itamp-tool/publish/getTextData',
      infoProdBatch:    '/itamp-tool/publish/getInformationProdBatch',
      infoServerCoding: '/itamp-tool/publish/getInformationServerCoding',
      history:          '/itamp-tool/publish/getHistory',
      historyDetail:    '/itamp-tool/publish/getHistoryDetail',
      infoBaseVersion:  '/itamp-tool/publish/getInfoBaseVersion',
      publishList:      '/itamp-tool/publish/getPublishList',
      operationRecordList: '/itamp-tool/operation/getOperationRecordList',
      subOperationRecordList: '/itamp-tool/operation/getSubOperationRecordList',
      perfData:         '/itamp-tool/performanceCapacity/getData',
      perfOperationData: '/itamp-tool/performanceCapacity/getPerformanceOperationData',
      // ── 服务订阅关系查询页（服务订阅关系查询.har，2026-09-10）──
      subscriptionHistory: '/itamp-tool/publish/getSubscriptionPublishHistoryList',
      prodSysServeNo:     '/itamp-tool/publish/getProdSysServeNoList',
      // 导出接口没有抓包，留空 = 关闭；配置后才会真的发请求
      subscriptionExport: '',
    },
    CONFIG.toolEndpoints || {}
  );

  const METHODS = Object.assign(
    {
      judgeInfo:        'POST',
      subscriptionReview: 'POST',
      dropDownList:     'POST',
      codeValueList:    'POST',
      docSysServeNoList: 'POST',
      textData:         'POST',
      infoProdBatch:    'POST',
      infoServerCoding: 'POST',
      history:          'POST',
      historyDetail:    'POST',
      infoBaseVersion:  'POST',
      publishList:      'POST',
      operationRecordList: 'POST',
      subOperationRecordList: 'POST',
      perfData:         'POST',
      perfOperationData: 'POST',
      subscriptionHistory: 'POST',
      prodSysServeNo:     'POST',
      subscriptionExport: 'POST',
    },
    CONFIG.toolEndpointMethods || {}
  );

  function isEnabled(name) {
    return Boolean(ENDPOINTS[name]);
  }

  /** 防缓存随机数：抓包里部分请求带 ?n=0.xxx */
  function cacheBuster() {
    return Math.random().toString().slice(2);
  }

  /** 统一解析响应：非 2xx / 非 JSON / 业务码非 0|200 都算失败 */
  async function request(name, body, query) {
    const resp = await window.API.call(ENDPOINTS[name], {
      method: METHODS[name] || 'POST',
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

    if (json.code != null) {
      const bizCode = Number(json.code);
      if (bizCode !== 0 && bizCode !== 200) {
        throw new Error(json.msg || json.message || `业务错误：代码 ${json.code}`);
      }
    }
    return json;
  }

  /** 防御式取数组：兼容 data 直接是数组 / data.rows / 顶层 rows */
  function pickArray(json) {
    if (!json) return [];
    if (Array.isArray(json.data)) return json.data;
    if (json.data && Array.isArray(json.data.rows)) return json.data.rows;
    if (Array.isArray(json.rows)) return json.rows;
    return [];
  }

  // ── 评委信息（订阅弹窗用）────────────────────────────────

  /**
   * 拉取评委信息。
   * body 与抓包一致：{ compNum: 'E00301', principal: '', callerComponent: 'E00406' }
   * @param {object} p { compNum 提供方组件编号, principal 负责人(可为空), callerComponent 调用方编号 }
   */
  async function fetchJudgeInfo(p) {
    if (!isEnabled('judgeInfo')) return { ok: true, local: true, list: [] };
    if (!window.API || typeof window.API.call !== 'function') {
      return { ok: false, list: [], error: 'API 客户端未就绪' };
    }
    try {
      const json = await request('judgeInfo', {
        compNum:        (p && p.compNum) || '',
        principal:      (p && p.principal) || '',
        callerComponent: (p && p.callerComponent) || '',
      }, { n: cacheBuster() });
      return { ok: true, local: false, list: pickArray(json) };
    } catch (e) {
      return { ok: false, list: [], error: e.message || String(e) };
    }
  }

  /**
   * 提交订阅评委信息。
   * body 与抓包一致：
   * { publishId, prodSysServeNoList:['E00406TO1197'],
   *   judgeInfoList:[{ judgeName, judgeUserId, judgeDeptName, involvedProduct:'', judgeRoleName }] }
   */
  async function submitSubscriptionReview(p) {
    if (!isEnabled('subscriptionReview')) return { ok: true, local: true };
    if (!window.API || typeof window.API.call !== 'function') {
      return { ok: false, error: 'API 客户端未就绪' };
    }
    try {
      await request('subscriptionReview', {
        publishId:         (p && p.publishId) || '',
        prodSysServeNoList: (p && p.prodSysServeNoList) || [],
        judgeInfoList:     (p && p.judgeInfoList) || [],
      });
      return { ok: true, local: false };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  }

  // ── 下拉数据 / 字典 ──────────────────────────────────────

  /** 下拉数据：POST getDropDownList?sysServeNo=E00301TO1198&n=xx（无 body） */
  async function fetchDropDownList(sysServeNo) {
    if (!isEnabled('dropDownList')) return { ok: true, local: true, data: null };
    if (!window.API || typeof window.API.call !== 'function') {
      return { ok: false, data: null, error: 'API 客户端未就绪' };
    }
    try {
      const json = await request('dropDownList', undefined, {
        sysServeNo: String(sysServeNo || ''),
        n: cacheBuster(),
      });
      return { ok: true, local: false, data: (json && json.data) || null };
    } catch (e) {
      return { ok: false, data: null, error: e.message || String(e) };
    }
  }

  /** 批次信息（数据字典码值）：POST /itamp-tool/datadict/codeValueList，无 body */
  async function fetchCodeValueList() {
    if (!isEnabled('codeValueList')) return { ok: true, local: true, list: [] };
    if (!window.API || typeof window.API.call !== 'function') {
      return { ok: false, list: [], error: 'API 客户端未就绪' };
    }
    try {
      const json = await request('codeValueList', undefined, { n: cacheBuster() });
      return { ok: true, local: false, list: pickArray(json) };
    } catch (e) {
      return { ok: false, list: [], error: e.message || String(e) };
    }
  }

  // ── 文档相关 ─────────────────────────────────────────────

  /**
   * 调用方应用系统服务编号查询（选完关联文档后联动）。
   * body: { docInstIdList: ['b87c5270-...'] }
   * 响应 data.sysServeNoList: [{ label, value, shortEn }]（openapi 描述确认）
   */
  async function fetchDocSysServeNoList(docInstIdList) {
    if (!isEnabled('docSysServeNoList')) return { ok: true, local: true, list: [] };
    if (!window.API || typeof window.API.call !== 'function') {
      return { ok: false, list: [], error: 'API 客户端未就绪' };
    }
    try {
      const json = await request('docSysServeNoList', {
        docInstIdList: Array.isArray(docInstIdList) ? docInstIdList : [],
      });
      const data = (json && json.data) || {};
      const arr = Array.isArray(data.sysServeNoList)
        ? data.sysServeNoList
        : (Array.isArray(data) ? data : []);
      return { ok: true, local: false, list: arr };
    } catch (e) {
      return { ok: false, list: [], error: e.message || String(e) };
    }
  }

  /** 文档/文本数据：body { assemblyNo }（如 E00301） */
  async function fetchTextData(assemblyNo) {
    if (!isEnabled('textData')) return { ok: true, local: true, data: null };
    if (!window.API || typeof window.API.call !== 'function') {
      return { ok: false, data: null, error: 'API 客户端未就绪' };
    }
    try {
      const json = await request('textData', { assemblyNo: String(assemblyNo || '') });
      return { ok: true, local: false, data: (json && json.data) || null };
    } catch (e) {
      return { ok: false, data: null, error: e.message || String(e) };
    }
  }

  // ── 信息维护类（按组件编号取下拉数据源）─────────────────

  /** 组件下所有产品批次的系统服务号列表：body { compNum }，返回 sysServeNoList[{label,value,shortEn}] */
  async function fetchInformationProdBatch(compNum) {
    if (!isEnabled('infoProdBatch')) return { ok: true, local: true, list: [] };
    if (!window.API || typeof window.API.call !== 'function') {
      return { ok: false, list: [], error: 'API 客户端未就绪' };
    }
    try {
      const json = await request('infoProdBatch', { compNum: String(compNum || '') });
      const data = (json && json.data) || {};
      const arr = Array.isArray(data.sysServeNoList) ? data.sysServeNoList : pickArray(json);
      return { ok: true, local: false, list: arr };
    } catch (e) {
      return { ok: false, list: [], error: e.message || String(e) };
    }
  }

  /** 组件下所有服务的编码列表：body { compNum } */
  async function fetchInformationServerCoding(compNum) {
    if (!isEnabled('infoServerCoding')) return { ok: true, local: true, list: [] };
    if (!window.API || typeof window.API.call !== 'function') {
      return { ok: false, list: [], error: 'API 客户端未就绪' };
    }
    try {
      const json = await request('infoServerCoding', { compNum: String(compNum || '') });
      return { ok: true, local: false, list: pickArray(json) };
    } catch (e) {
      return { ok: false, list: [], error: e.message || String(e) };
    }
  }

  // ── 历史版本 / 发布 / 操作记录 / 性能 ────────────────────

  /** 历史记录：body { dataId, pageNum, pageSize, delFlg } */
  async function fetchHistory(p) {
    if (!isEnabled('history')) return { ok: true, local: true, total: 0, rows: [] };
    if (!window.API || typeof window.API.call !== 'function') {
      return { ok: false, total: 0, rows: [], error: 'API 客户端未就绪' };
    }
    try {
      const q = p || {};
      const json = await request('history', {
        dataId:   q.dataId || '',
        pageNum:  Number(q.pageNum) || 1,
        pageSize: Number(q.pageSize) || 10,
        delFlg:   q.delFlg != null ? String(q.delFlg) : '0',
      });
      const rows = pickArray(json);
      const total = Number((json && (json.total ?? (json.data && json.data.total))) || rows.length);
      return { ok: true, local: false, total, rows };
    } catch (e) {
      return { ok: false, total: 0, rows: [], error: e.message || String(e) };
    }
  }

  /** 历史详情：body { informationId, createTime, publishId } */
  async function fetchHistoryDetail(p) {
    if (!isEnabled('historyDetail')) return { ok: true, local: true, data: null };
    if (!window.API || typeof window.API.call !== 'function') {
      return { ok: false, data: null, error: 'API 客户端未就绪' };
    }
    try {
      const json = await request('historyDetail', {
        informationId: (p && p.informationId) || '',
        createTime:    (p && p.createTime) || '',
        publishId:     (p && p.publishId) || '',
      });
      return { ok: true, local: false, data: (json && json.data) || null };
    } catch (e) {
      return { ok: false, data: null, error: e.message || String(e) };
    }
  }

  /** 基础版本：body { pageNum, pageSize, informationId, type } */
  async function fetchInfoBaseVersion(p) {
    if (!isEnabled('infoBaseVersion')) return { ok: true, local: true, total: 0, rows: [] };
    if (!window.API || typeof window.API.call !== 'function') {
      return { ok: false, total: 0, rows: [], error: 'API 客户端未就绪' };
    }
    try {
      const q = p || {};
      const json = await request('infoBaseVersion', {
        pageNum:       Number(q.pageNum) || 1,
        pageSize:      Number(q.pageSize) || 10,
        informationId: q.informationId || '',
        type:          q.type != null ? String(q.type) : '',
      });
      const rows = pickArray(json);
      const total = Number((json && (json.total ?? (json.data && json.data.total))) || rows.length);
      return { ok: true, local: false, total, rows };
    } catch (e) {
      return { ok: false, total: 0, rows: [], error: e.message || String(e) };
    }
  }

  /** 发布列表：body { callerComponent, operationType, pageNum, pageSize, status, publishId } */
  async function fetchPublishList(p) {
    if (!isEnabled('publishList')) return { ok: true, local: true, total: 0, rows: [] };
    if (!window.API || typeof window.API.call !== 'function') {
      return { ok: false, total: 0, rows: [], error: 'API 客户端未就绪' };
    }
    try {
      const q = p || {};
      const json = await request('publishList', {
        callerComponent: q.callerComponent || '',
        operationType:   q.operationType || '',
        pageNum:         Number(q.pageNum) || 1,
        pageSize:        Number(q.pageSize) || 10,
        status:          q.status != null ? String(q.status) : '',
        publishId:       q.publishId || '',
      });
      const rows = pickArray(json);
      const total = Number((json && (json.total ?? (json.data && json.data.total))) || rows.length);
      return { ok: true, local: false, total, rows };
    } catch (e) {
      return { ok: false, total: 0, rows: [], error: e.message || String(e) };
    }
  }

  /** 操作记录：body { operationType, pageNum, pageSize, publishId } */
  async function fetchOperationRecordList(p) {
    if (!isEnabled('operationRecordList')) return { ok: true, local: true, total: 0, rows: [] };
    if (!window.API || typeof window.API.call !== 'function') {
      return { ok: false, total: 0, rows: [], error: 'API 客户端未就绪' };
    }
    try {
      const q = p || {};
      const json = await request('operationRecordList', {
        operationType: q.operationType || '',
        pageNum:       Number(q.pageNum) || 1,
        pageSize:      Number(q.pageSize) || 10,
        publishId:     q.publishId || '',
      });
      const rows = pickArray(json);
      const total = Number((json && (json.total ?? (json.data && json.data.total))) || rows.length);
      return { ok: true, local: false, total, rows };
    } catch (e) {
      return { ok: false, total: 0, rows: [], error: e.message || String(e) };
    }
  }

  /** 子操作记录：body { operationType, pageNum, pageSize, subscriptionId } */
  async function fetchSubOperationRecordList(p) {
    if (!isEnabled('subOperationRecordList')) return { ok: true, local: true, total: 0, rows: [] };
    if (!window.API || typeof window.API.call !== 'function') {
      return { ok: false, total: 0, rows: [], error: 'API 客户端未就绪' };
    }
    try {
      const q = p || {};
      const json = await request('subOperationRecordList', {
        operationType:  q.operationType || '',
        pageNum:        Number(q.pageNum) || 1,
        pageSize:       Number(q.pageSize) || 10,
        subscriptionId: q.subscriptionId || '',
      });
      const rows = pickArray(json);
      const total = Number((json && (json.total ?? (json.data && json.data.total))) || rows.length);
      return { ok: true, local: false, total, rows };
    } catch (e) {
      return { ok: false, total: 0, rows: [], error: e.message || String(e) };
    }
  }

  /** 性能数据：body { subscriptionId } */
  async function fetchPerformanceData(subscriptionId) {
    if (!isEnabled('perfData')) return { ok: true, local: true, data: null };
    if (!window.API || typeof window.API.call !== 'function') {
      return { ok: false, data: null, error: 'API 客户端未就绪' };
    }
    try {
      const json = await request('perfData', { subscriptionId: String(subscriptionId || '') });
      return { ok: true, local: false, data: (json && json.data) || null };
    } catch (e) {
      return { ok: false, data: null, error: e.message || String(e) };
    }
  }

  /** 性能操作数据：body { pageNum, pageSize, subscriptionId } */
  async function fetchPerformanceOperationData(subscriptionId, pageNum, pageSize) {
    if (!isEnabled('perfOperationData')) return { ok: true, local: true, total: 0, rows: [] };
    if (!window.API || typeof window.API.call !== 'function') {
      return { ok: false, total: 0, rows: [], error: 'API 客户端未就绪' };
    }
    try {
      const json = await request('perfOperationData', {
        pageNum:        Number(pageNum) || 1,
        pageSize:       Number(pageSize) || 10,
        subscriptionId: String(subscriptionId || ''),
      });
      const rows = pickArray(json);
      const total = Number((json && (json.total ?? (json.data && json.data.total))) || rows.length);
      return { ok: true, local: false, total, rows };
    } catch (e) {
      return { ok: false, total: 0, rows: [], error: e.message || String(e) };
    }
  }

  // ── 服务订阅关系查询（服务订阅关系查询.har）──────────────

  /**
   * 订阅关系查询列表。
   *
   * 请求体与抓包逐字段一致（19 个字段，一个不多一个不少）：
   * {"putBatch":"","compNum":"","useNum":"E00406","providerServiceNameAndId":"",
   *  "pageSize":10,"pageNum":1,"prodBatch":"","prodSysServeNo":"","subscriberId":"",
   *  "subscriberName":"","isSendOutsideSystem":"","status":"","serverCodingList":[],
   *  "sysServeNoList":[],"prodDeptId":"","deptId":"","prodSysServeNoList":[],
   *  "batch":"","callerComponent":"E00406"}
   *
   * 抓包里的两个事实：
   *   · prodBatch 传的是「2611批次」这种带后缀的 label，不是 "2611"
   *     （同源的 getPublishDataList 抓包里 batch 也是 "2609批次"）
   *   · useNum 与 callerComponent 三次抓包里始终相等
   *
   * 响应：{ code, msg, data:{ total, rows, code, msg, pageNum, pageSize, pageTotals } }
   *
   * @param {object} p 页面筛选条件（缺字段按抓包默认值补空）
   * @returns {Promise<{ok:boolean, total:number, rows:Array, local?:boolean, error?:string}>}
   */
  async function fetchSubscriptionPublishHistory(p) {
    if (!isEnabled('subscriptionHistory')) return { ok: true, local: true, total: 0, rows: [] };
    if (!window.API || typeof window.API.call !== 'function') {
      return { ok: false, total: 0, rows: [], error: 'API 客户端未就绪' };
    }
    const q = p || {};
    const arr = (v) => (Array.isArray(v) ? v : (v ? [v] : []));
    try {
      const json = await request('subscriptionHistory', {
        putBatch:                  q.putBatch || '',
        compNum:                   q.compNum || '',
        useNum:                    q.useNum || '',
        providerServiceNameAndId:  q.providerServiceNameAndId || '',
        pageSize:                  Number(q.pageSize) || 10,
        pageNum:                   Number(q.pageNum) || 1,
        prodBatch:                 q.prodBatch || '',
        prodSysServeNo:            q.prodSysServeNo || '',
        subscriberId:              q.subscriberId || '',
        subscriberName:            q.subscriberName || '',
        isSendOutsideSystem:       q.isSendOutsideSystem || '',
        status:                    q.status || '',
        serverCodingList:          arr(q.serverCodingList),
        sysServeNoList:            arr(q.sysServeNoList),
        prodDeptId:                q.prodDeptId || '',
        deptId:                    q.deptId || '',
        prodSysServeNoList:        arr(q.prodSysServeNoList),
        batch:                     q.batch || '',
        callerComponent:           q.callerComponent || '',
      }, { n: cacheBuster() });

      const data = (json && json.data) || {};
      const rows = Array.isArray(data.rows) ? data.rows : [];
      const total = Number(data.total ?? json.total ?? rows.length) || 0;
      return { ok: true, local: false, total, rows };
    } catch (e) {
      return { ok: false, total: 0, rows: [], error: e.message || String(e) };
    }
  }

  /**
   * 调用方应用系统服务编号下拉。
   * POST /itamp-tool/publish/getProdSysServeNoList?callerComponent=E00406&n=xx
   * 抓包里**没有请求体**，callerComponent 走 query string。
   * 响应 data 直接是数组：[{ label:'E00406TO1198', value:'E00406TO1198', shortEn:null }]
   */
  async function fetchProdSysServeNoList(callerComponent) {
    if (!isEnabled('prodSysServeNo')) return { ok: true, local: true, list: [] };
    if (!window.API || typeof window.API.call !== 'function') {
      return { ok: false, list: [], error: 'API 客户端未就绪' };
    }
    try {
      const json = await request('prodSysServeNo', undefined, {
        callerComponent: String(callerComponent || ''),
        n: cacheBuster(),
      });
      return { ok: true, local: false, list: pickArray(json) };
    } catch (e) {
      return { ok: false, list: [], error: e.message || String(e) };
    }
  }

  /**
   * 导出订阅关系（预留）。
   *
   * ⚠️ 该接口**没有抓包**，路径/参数都未经确认，所以默认 endpoint 为空：
   *    · 未配置 → 返回 { ok:false, notConfigured:true }，前端改走本地 CSV，不发任何请求
   *    · 抓包确认后在 __APP_CONFIG__.toolEndpoints.subscriptionExport 填上路径即可
   *
   * @returns {Promise<{ok:boolean, notConfigured?:boolean, filename?:string, error?:string}>}
   *          成功时直接触发浏览器下载（后端返回文件流）
   */
  async function exportSubscriptionPublishHistory(body) {
    if (!isEnabled('subscriptionExport')) {
      return { ok: false, notConfigured: true, error: '导出接口未接入（缺抓包）' };
    }
    if (!window.API || typeof window.API.call !== 'function') {
      return { ok: false, error: 'API 客户端未就绪' };
    }
    try {
      const resp = await window.API.call(ENDPOINTS.subscriptionExport, {
        method: METHODS.subscriptionExport || 'POST',
        body: body || {},
        query: { n: cacheBuster() },
      });
      if (!resp.ok) {
        let detail = '';
        try { detail = (await resp.text()).slice(0, 200); } catch (_) { /* ignore */ }
        throw new Error(`HTTP ${resp.status} ${detail}`.trim());
      }
      const blob = await resp.blob();
      const disposition = resp.headers.get('content-disposition') || '';
      const matched = /filename[^;=\n]*=((['"])(.*?)\2|([^;\n]*))/.exec(disposition);
      const filename = matched
        ? decodeURIComponent((matched[3] || matched[4] || '').trim())
        : `服务订阅关系_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.xlsx`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return { ok: true, filename };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  }

  if (typeof window !== 'undefined') {
    window.ToolApi = {
      endpoints: ENDPOINTS,
      isEnabled,
      fetchJudgeInfo,
      submitSubscriptionReview,
      fetchDropDownList,
      fetchCodeValueList,
      fetchDocSysServeNoList,
      fetchTextData,
      fetchInformationProdBatch,
      fetchInformationServerCoding,
      fetchHistory,
      fetchHistoryDetail,
      fetchInfoBaseVersion,
      fetchPublishList,
      fetchOperationRecordList,
      fetchSubOperationRecordList,
      fetchPerformanceData,
      fetchPerformanceOperationData,
      fetchSubscriptionPublishHistory,
      fetchProdSysServeNoList,
      exportSubscriptionPublishHistory,
    };
  }
})();
