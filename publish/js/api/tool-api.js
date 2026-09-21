/**
 * 工具侧接口层（window.ToolApi）——服务详情 / 订阅评委 / 历史 / 操作记录 / 性能
 *
 * ── 数据来源 ────────────────────────────────────────────────
 * 抓包文件 `har/订阅.json`（Postman/apifox 形态的集合，2026-09-08）与
 * `output/openapi.json`（由 har2doc.py 从抓包生成）。基础域名
 * http://itamp.bocsys.cn，本地由 proxy.js 转发（前端发完整后端路径）。
 *
 * 抓包确认的接口（20 个，**0 个留空**）：
 *   计数口径 = 下面 ENDPOINTS 对象的键数（20 个键 = 20 条路径，全部已配置；
 *   留空 = 关闭该能力，当前一条都没有）。标题原来写「16 个」是陈旧计数——
 *   订阅页那两条接口补进 ENDPOINTS 时没同步，下面的清单也一直漏列
 *   getPublishDataList（现在补齐，逐条对上 20 个键）。
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
 *                         ⚠️ 响应是三层嵌套（data.data.sysServeNoList），见该函数说明
 *   发布数据列表        → POST /itamp-tool/publish/getPublishDataList
 *                         body 见 js/page/publish.js 的 FIELDS；
 *                         ⚠️ 响应的 batch 字段恒为空，批次要看 sheetProductBatch
 *   服务编码列表        → POST /itamp-tool/publish/getInformationServerCoding body { compNum }
 *   历史记录            → POST /itamp-tool/publish/getHistory   body { dataId, pageNum, pageSize, delFlg }
 *   历史详情            → POST /itamp-tool/publish/getHistoryDetail body { informationId, createTime, publishId }
 *   基础版本            → POST /itamp-tool/publish/getInfoBaseVersion body { pageNum, pageSize, informationId, type }
 *   发布列表            → POST /itamp-tool/publish/getPublishList body { callerComponent, operationType, pageNum, pageSize, status, publishId }
 *   操作记录            → POST /itamp-tool/operation/getOperationRecordList body { operationType, pageNum, pageSize, publishId }
 *   子操作记录          → POST /itamp-tool/operation/getSubOperationRecordList body { operationType, pageNum, pageSize, subscriptionId }
 *   接口明细            → POST /itamp-tool/intfcMgmt/serviceChildList body { dataId, sysServeNo }
 *                         一次返回 5 个 tab：childReqList / childRespList /
 *                         revisionList / interfaceModifyList / deployList
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
      publishDataList:  '/itamp-tool/publish/getPublishDataList',
      infoServerCoding: '/itamp-tool/publish/getInformationServerCoding',
      history:          '/itamp-tool/publish/getHistory',
      historyDetail:    '/itamp-tool/publish/getHistoryDetail',
      infoBaseVersion:  '/itamp-tool/publish/getInfoBaseVersion',
      publishList:      '/itamp-tool/publish/getPublishList',
      operationRecordList: '/itamp-tool/operation/getOperationRecordList',
      subOperationRecordList: '/itamp-tool/operation/getSubOperationRecordList',
      // ── 接口明细弹窗（操作记录和接口明细.har，2026-09-21）──
      // 一次返回 5 个 tab 的全部数据：
      //   data.childReqList(请求报文) / childRespList(响应报文) /
      //   revisionList(文档级修订) / interfaceModifyList(接口级修订) / deployList(应用系统服务部署)
      serviceChildList: '/itamp-tool/intfcMgmt/serviceChildList',
      perfData:         '/itamp-tool/performanceCapacity/getData',
      perfOperationData: '/itamp-tool/performanceCapacity/getPerformanceOperationData',
      // ── 服务订阅关系查询页（服务订阅关系查询.har，2026-09-10）──
      subscriptionHistory: '/itamp-tool/publish/getSubscriptionPublishHistoryList',
      prodSysServeNo:     '/itamp-tool/publish/getProdSysServeNoList',
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
      publishDataList:  'POST',
      infoServerCoding: 'POST',
      history:          'POST',
      historyDetail:    'POST',
      infoBaseVersion:  'POST',
      publishList:      'POST',
      operationRecordList: 'POST',
      subOperationRecordList: 'POST',
      serviceChildList: 'POST',
      perfData:         'POST',
      perfOperationData: 'POST',
      subscriptionHistory: 'POST',
      prodSysServeNo:     'POST',
    },
    CONFIG.toolEndpointMethods || {}
  );

  // 协议层（endpoint → 请求 → 业务码校验 → 统一错误文案）收在 js/core/api-client.js，
  // tool / service / task / user 四个接口模块共用一份实现，不再各写一遍。
  // 请求器**延迟创建**（首次调用时才取 window.API.createRequester）。
  // 为什么不在 IIFE 顶层就建：那样本模块就变成「顺序敏感」——api-client.js 一旦排到
  // 本文件之后，请求层会永久降级成下面那个抛错的兜底，不报错、只静默失败。
  // 延迟后脚本顺序怎么排都不影响（回归见 tests/module-order.test.js）。
  let REQ = null;
  function requester() {
    if (!REQ && window.API && typeof window.API.createRequester === 'function') {
      REQ = window.API.createRequester({ endpoints: ENDPOINTS, methods: METHODS });
    }
    return REQ;
  }
  /** 端点是否已配置（未配置 = 该能力关闭，调用方走本地兜底，不发请求） */
  function isEnabled(name) {
    const req = requester();
    return req ? req.isEnabled(name) : Boolean(ENDPOINTS[name]);
  }
  // 第 4 个参数透传给传输层（signal 取消 / timeout 覆盖默认超时）。
  // 以前只转发 3 个参数：api-client 上加了 opts 也没用，别的模块照样传不下去
  // —— 协议层只有一份实现，转发口径要一致（导出那种长任务将来也要能中止）。
  function request(name, body, query, opts) {
    const req = requester();
    if (!req) {
      throw new Error(`请求层未就绪：core/api-client.js 未加载（缺少 createRequester，请求 ${name}）`);
    }
    return req.request(name, body, query, opts);
  }

  /** 防缓存随机数：抓包里部分请求带 ?n=0.xxx */
  function cacheBuster() {
    return Math.random().toString().slice(2);
  }

  /**
   * 服务发布数据查询（首页主接口）。
   *
   * body 的 17 个字段口径见 js/page/publish.js 的 FIELDS（抓包确认过，别加减字段）。
   *
   * 为什么返回原始 Response、不在这里解析：响应形态识别与「宽松回放」标记都在
   * js/core/publish-response.js 的 parse()（它要读 X-Cache-Match 响应头），
   * 这一层只负责「端点从哪来 + 是否已配置 + 带不带 signal」。
   * 页面原先自己拼 '/itamp-tool/publish/getPublishDataList' 调 window.API.call，
   * 端点既不能集中配置、也不能整块关闭。
   *
   * @param {object} body 请求体（含 pageNum / pageSize）
   * @param {{signal?:AbortSignal}} [opts]
   * @returns {Promise<Response>}
   */
  async function fetchPublishDataList(body, opts) {
    if (!isEnabled('publishDataList')) {
      // 未配置 = 该能力关闭：按项目铁律，一个请求都不发
      throw new Error('接口未配置：publishDataList（缺抓包时不发请求）');
    }
    if (!window.API || typeof window.API.call !== 'function') {
      throw new Error('API 客户端未就绪');
    }
    return window.API.call(ENDPOINTS.publishDataList, {
      method: METHODS.publishDataList || 'POST',
      body: body || {},
      ...(opts && opts.signal ? { signal: opts.signal } : {}),
    });
  }

  /** 防御式取数组：兼容 data 直接是数组 / data.rows / 顶层 rows */
  function pickArray(json) {
    if (!json) return [];
    if (Array.isArray(json.data)) return json.data;
    if (json.data && Array.isArray(json.data.rows)) return json.data.rows;
    if (Array.isArray(json.rows)) return json.rows;
    return [];
  }

  /**
   * 从可能多层嵌套的响应里挖出 sysServeNoList（取不到就返回 []）。
   * `getInformationProdBatch` 是「D 型」三层嵌套（见 analysis/output/ITAMP接口总览.md）：
   *   { code, msg, data: { code, msg, data: { sysServeNoList: [{ label, value, shortEn }] } } }
   * 只解一层 data 会**永远**拿到空数组（多选下拉一直是空的），所以按层往里探。
   */
  function pickSysServeNoList(json) {
    let node = json;
    for (let depth = 0; depth < 3 && node && typeof node === 'object'; depth += 1) {
      if (Array.isArray(node)) return node;                 // 万一直接给了数组
      if (Array.isArray(node.sysServeNoList)) return node.sysServeNoList;
      node = node.data;
    }
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

  /**
   * 组件下所有产品批次的系统服务号列表（即订阅页「提供方应用系统服务编号」多选的数据源）。
   * body { compNum }，响应形状见 pickSysServeNoList：**三层嵌套**的 D 型特例。
   * 响应样本：`publish/cache/` 里 path=getInformationProdBatch 那条（368KB，E00301 下 1000+ 个编号）。
   */
  async function fetchInformationProdBatch(compNum) {
    if (!isEnabled('infoProdBatch')) return { ok: true, local: true, list: [] };
    if (!window.API || typeof window.API.call !== 'function') {
      return { ok: false, list: [], error: 'API 客户端未就绪' };
    }
    try {
      const json = await request('infoProdBatch', { compNum: String(compNum || '') });
      return { ok: true, local: false, list: pickSysServeNoList(json) };
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

  /**
   * 接口明细（发布查询页结果行的「接口明细」弹窗）。
   * body 与抓包一致：{ dataId, sysServeNo }
   *   dataId    = 发布行的 publishId（抓包里两个接口传的是同一个 UUID）
   *   sysServeNo = 发布行的 sysServeNo 原值
   *
   * ⚠️⚠️ **sysServeNo 的形态没有证实，这条最该先验**（2026-09-21 复核时发现的）：
   *   抓包里 serviceChildList 收到的是 **`E00306MG0001-queryPreviousTransaction`** ——
   *   **带短横线、后半段是个方法名**；而发布列表 35 行真实数据的 `sysServeNo` **全部是纯编号**
   *   （`E00301TO1200` 这种，无短横线）。两边**不是同一种形态**，而这份 HAR 里**没有发布列表那次
   *   请求**，无法把「某一行」与「随后的 body」对上，所以**判定不了该传什么**。
   *   两种可能都成立：①后端要「编号-接口编码」拼接（那行该拼 `E00301TO1200-ObsSDTotalTransQuotaQry`）；
   *   ②那个服务的 sysServeNo 本身就带后缀（那原值就是对的）。
   *   当前实现按「原值」传 —— **若形态错了，表现是打开弹窗后整表为空或拿到别的服务的数据，
   *   且不会报错**（离线回放还会被宽松匹配掩盖成"看起来对了"）。
   *   定案只差一次抓包：**同一次会话里先查发布列表、再点开那一行的「接口明细」**，
   *   两个请求一起抓，看 body 里的值与行里的哪个字段相等。
   *
   * 一次返回 5 个 tab 的数据，键名来自 `操作记录和接口明细.har`：
   *   data.childReqList       → 请求报文（messageType '1'）
   *   data.childRespList      → 响应报文（messageType '2'）
   *   data.revisionList       → 文档级修订记录（该次抓包里是空数组）
   *   data.interfaceModifyList → 接口级修订记录
   *   data.deployList         → 应用系统服务部署
   * 五个键一律补成数组：调用方不必再判 undefined，也能区分「确实没有」与「没拿到」。
   */
  async function fetchServiceChildList(p) {
    if (!isEnabled('serviceChildList')) return { ok: true, local: true, lists: null };
    if (!window.API || typeof window.API.call !== 'function') {
      return { ok: false, lists: null, error: 'API 客户端未就绪' };
    }
    try {
      const q = p || {};
      const json = await request('serviceChildList', {
        dataId:     q.dataId || '',
        sysServeNo: q.sysServeNo || '',
      });
      const data = (json && json.data) || {};
      const arr = (v) => (Array.isArray(v) ? v : []);
      return {
        ok: true,
        local: false,
        lists: {
          childReqList:        arr(data.childReqList),
          childRespList:       arr(data.childRespList),
          revisionList:        arr(data.revisionList),
          interfaceModifyList: arr(data.interfaceModifyList),
          deployList:          arr(data.deployList),
        },
      };
    } catch (e) {
      return { ok: false, lists: null, error: e.message || String(e) };
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
      fetchPublishDataList,
      fetchInformationProdBatch,
      fetchInformationServerCoding,
      fetchHistory,
      fetchHistoryDetail,
      fetchInfoBaseVersion,
      fetchPublishList,
      fetchOperationRecordList,
      fetchSubOperationRecordList,
      fetchServiceChildList,
      fetchPerformanceData,
      fetchPerformanceOperationData,
      fetchSubscriptionPublishHistory,
      fetchProdSysServeNoList,
    };
  }
})();
