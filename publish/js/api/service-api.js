/**
 * 服务详情 / 订阅 的后端接入预留层
 *
 * ── 为什么是「预留」而不是直接写接口 ──────────────────────────
 * 项目约定：没有抓包就不要写接口代码。
 * 服务详情、订阅这两个能力的后端接口尚未抓包确认，所以本文件
 * 不写死任何真实路径与字段，只把「调用点」和「降级路径」先铺好。
 *
 * ── 当前行为（endpoint 全为空时） ────────────────────────────
 * 所有方法都立刻返回 { ok: true, local: true }，不发任何网络请求。
 * 调用方继续用本地数据 —— 详情展示当前行、订阅存 localStorage，
 * 与接入本层之前的行为完全一致。
 *
 * ── 抓包确认后怎么接 ──────────────────────────────────────────
 * 1. 在 runtime-config.js（或部署时注入的 window.__APP_CONFIG__）里
 *    填上真实路径，例如：
 *      endpoints: {
 *        serviceDetail:  '/itamp-tool/publish/getServiceDetail',
 *        subscribeAdd:   '/itamp-tool/publish/subscribe',
 *        subscribeRemove:'/itamp-tool/publish/unsubscribe',
 *        subscribeList:  '/itamp-tool/publish/getSubscribeList',
 *      }
 * 2. 按抓到的实际报文，补齐下面对应的 buildXxxBody / adaptXxx 函数。
 * 3. 业务代码（index.js / subscribe-ui.js）不需要再改。
 *
 * 约定：所有方法都不抛异常，失败一律返回 { ok: false, error }，
 *       由调用方决定是提示还是降级，避免一处接口挂掉整页白屏。
 */
(function () {
  'use strict';

  const CONFIG = (typeof window !== 'undefined' && window.__APP_CONFIG__) || {};

  /**
   * 接口路径表。留空即关闭对应能力。
   * 注意：path 必须是完整后端路径（含模块），与 api-client.js 的约定一致。
   *
   * 抓包确认（2026-09-08）：
   *   订阅 → POST /itamp-tool/publish/setSubcription
   *   评委信息 → POST /itamp-tool/publish/subscriptionReview
   *   响应格式 → { code: 0|500, msg: '...' }
   */
  const ENDPOINTS = Object.assign(
    {
      serviceDetail:   '',
      subscribeAdd:    '/itamp-tool/publish/setSubcription',
      subscribeRemove: '',
      subscribeList:   '',
    },
    CONFIG.endpoints || {}
  );

  /** 各接口的 HTTP 方法，抓包后按实际情况调整 */
  const METHODS = Object.assign(
    {
      serviceDetail:   'POST',
      subscribeAdd:    'POST',
      subscribeRemove: 'POST',
      subscribeList:   'POST',
    },
    CONFIG.endpointMethods || {}
  );

  /** 该能力是否已接入后端（配置了路径才算接入） */
  function isEnabled(name) {
    return Boolean(ENDPOINTS[name]);
  }

  /** 统一解析响应：非 2xx / 非 JSON / 业务码非 0|200 都算失败 */
  async function request(name, body) {
    const resp = await window.API.call(ENDPOINTS[name], {
      method: METHODS[name] || 'POST',
      body,
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

    const bizCode = Number(json.code);
    if (json.code != null && bizCode !== 0 && bizCode !== 200) {
      throw new Error(json.msg || json.message || `业务错误：代码 ${json.code}`);
    }
    return json;
  }

  // ── 服务详情 ────────────────────────────────────────────────

  /**
   * 请求体：定位一条服务用哪个字段，抓包前不确定，
   * 先把候选主键都带上，接口确认后裁剪到只剩真实需要的字段。
   * TODO(抓包后)：按实际报文确认主键字段并删除多余项。
   */
  function buildDetailBody(row) {
    return {
      serviceId:     row.serviceId     ?? null,
      serverCoding:  row.serverCoding  ?? null,
      serviceNumber: row.serviceNumber ?? null,
      sysServeNo:    row.sysServeNo    ?? null,
      prodBatch:     row.prodBatch     ?? null,
    };
  }

  /**
   * 响应适配：把后端报文转成「可直接渲染的扁平键值对」。
   * TODO(抓包后)：如果后端返回的是嵌套结构或有字段名差异，在这里做映射/改名。
   * 默认兼容三种常见形态：{ data } / { body } / 直接是对象。
   */
  function adaptDetail(json) {
    const data = json && (json.data || json.body || json);
    if (!data || typeof data !== 'object') return null;
    // 后端若返回数组（详情列表），取第一条
    return Array.isArray(data) ? (data[0] || null) : data;
  }

  /**
   * 拉取服务详情。
   * @param {object} row 列表里的原始行数据
   * @returns {Promise<{ok:boolean, local?:boolean, data?:object|null, error?:string}>}
   *          ok=true 且 data=null 表示「未接接口，请用本地行数据」
   */
  async function fetchServiceDetail(row) {
    if (!isEnabled('serviceDetail') || !row) {
      return { ok: true, local: true, data: null };
    }
    if (!window.API || typeof window.API.call !== 'function') {
      return { ok: false, error: 'API 客户端未就绪' };
    }
    try {
      const json = await request('serviceDetail', buildDetailBody(row));
      return { ok: true, local: false, data: adaptDetail(json) };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  }

  // ── 订阅 ────────────────────────────────────────────────────

  /**
   * 构建 setSubcription 请求体。
   *
   * 接口: POST /itamp-tool/publish/setSubcription
   * 请求体: { documents: [...], publishSubcription: {...} }
   *
   * @param {string|object} rowOrCode  行数据对象 或 服务编码字符串
   * @param {object} form              订阅弹窗 collectForm() 的结果
   * @returns {object}                 完整的请求体
   */
  function buildSubscribeBody(rowOrCode, form) {
    // 兼容两种调用方式:
    //   buildSubscribeBody(rowData, form)       ← subscribeWithForm 走这里
    //   buildSubscribeBody(serverCoding, null)  ← subscribe / unsubscribe 走这里
    const isRow = rowOrCode && typeof rowOrCode === 'object';
    const row   = isRow ? rowOrCode : {};
    // serverCoding 优先取形参位置的字符串；若传入的是 row 则从 row 中提取
    let serverCoding = isRow ? (row.serverCoding || row.sysServeNo || '') : String(rowOrCode || '');

    // ── documents: 关联文档列表 ──
    const relDocIds = (form && form.relDocIds) ? String(form.relDocIds).split(',').filter(Boolean) : [];
    const relDocNames = (form && form.relDocNames) ? String(form.relDocNames).split('、').filter(Boolean) : [];

    let documents;
    if (relDocIds.length > 0) {
      documents = relDocIds.map((id, i) => ({
        docInstId: id,
        docNo: '',
        docName: relDocNames[i] || '',
        batchNum: '',
        label: '',
        templateCode: '',
      }));
    } else {
      // 默认文档（HAR 抓包的 "重复订阅" 参数）
      documents = [
        {
          batchNum:     '2611',
          docName:      '系统细化设计说明书_网上银行服务前端-海外个人手机银行客户端',
          docNo:        'BOCNETC-O-MAPSN_CD_84',
          label:        'BOCNETC-O-MAPSN_CD_84-系统细化设计说明书_网上银行服务前端-海外个人手机银行客户端',
          templateCode: '16',
          docInstId:    'b87c5270-eff5-4755-9cc5-9ae2161a0d5b',
        },
      ];
    }

    // ── publishSubcription: 订阅详细信息 ──
    // 基于 HAR 抓包的完整对象，填入表单数据和当前行数据
    const pubSub = {
      // 基础标识
      id:                         null,
      publishId:                null,
      provideComponentName:     '互联网金融服务平台',
      batch:                    null,
      sheetProductBatch:        '2611批次',
      serviceStatus:            null,
      provideSystemNumber:      'E00301',
      serviceId:                null,
      serviceFunctionDescription: '',
      serviceType:              '联机服务',
      serviceNumber:            null,
      serviceName:              '',
      serviceVersion:           'V1',
      interfaceCode:            null,
      documentName:             null,
      documentNumber:           null,
      docInstId:                null,
      docNo:                    null,
      subscriberComponentName:  '',
      subscriberSubsystem:      null,
      callerComponent:          form && form.callerSystem || '',
      subscriberStatus:         null,
      status:                   null,
      projId:                   null,
      remark:                   form && form.remark || '',
      subscriberId:             null,
      updater:                  null,
      creater:                  null,
      createTime:               null,
      updateTime:               null,
      sysEnName:                null,
      sysServeNo:               null,
      sysType:                  '联机服务',
      sysServeEnName:           null,
      serveTyep:                '对外服务',
      targetServeNo:            null,
      serverVsn:                  'V1',
      serverCoding:             serverCoding || '',
      serverMode:               '',
      prodBatch:                '2611批次',
      serverNo:                 null,
      isSend:                   '',
      isSendOutsideSystem:      '',
      version:                  'BOCNET-G-IFS_V01.1M_B45',
      tag:                      '',
      productBatch:             null,
      productNo:                null,
      productName:                null,
      isMember:                   null,
      isChecked:                '1',
      pubVersion:               null,
      subscriberTechNum:          null,
      publishSubcriptionId:     null,
      offerServerState:         '功能测试基线',
      effectiveTime:            null,
      offlineTime:              null,
      versionBatch:             null,
      versionServerNo:          null,
      offerVersionBatch:        null,
      offerVersionServerNo:     null,
      offerEffectiveTime:       '2026-09-04',
      offerOfflineTime:         '',
      gatewayCode:              '',
      context:                  '',
      isOperation:              null,
      prodSysServeNo:           '',
      prodSysServeNoList:       [],
      prodServiceType:          '',
      prodMCISCode:             '',
      prodIPSCode:              '',
      prodBatchList:            '2611批次',
      prodTaskNo:               null,
      prodMessageInfo:          '',
      prodTopicName:            '',
      prodIsResourceOwner:      '',
      prodCommunicationType:    '',
      prodSubscriptionName:     '',
      prodIsBusinessIdempotent: '',
      prodNoIdempotentReason:   '',
      reviewStatus:             '03',
      isDelete:                 '1',
      performanceProdBatch:     null,
      performanceServerNo:      null,
      prodTPSNormal:            '',
      volumeNormal:             '',
      latencyNormal:            '',
      prodTPSPeak:              form && form.perfPeak && form.perfPeak.tps ? String(form.perfPeak.tps) : '5',
      volumePeak:               '',
      latencyPeak:              '',
      docInfo:                  null,
      messageInfo:              '',
      topicName:                '',
      communicationRole:        null,
      isResourceOwner:          '',
      communicationType:        '',
      subscriptionName:         '',
      isBusinessIdempotent:     null,
      noIdempotentReason:       null,
      prodReviewStatus:         null,
      reviewNo:                 null,
      isBranch:                 null,
      prodRemark:               '',
      assemblyNo:               'E00301',
      assemblyName:             '互联网金融服务平台',
      principal:                '',
      principalName:            null,
      deptId:                   'K4229',
      deptName:                 '中国银行软件中心（深圳）开发三部',
      isBackup:                 '否',
      backupInfo:               '',
      prodDeptId:               null,
      prodDeptName:             null,
      prodColonyCode:           '',
      colonyCode:               '',
      subscriberUserName:       null,
      implementationUnit:       '',
      prodImplementationUnit:   '',
    };

    // ── 填充关键字段 ──
    // sysServeNo: 提供者服务编号（如 E00301TO1197），优先用 row 中的值
    const providerSysServeNo = row.sysServeNo || row.serviceId || serverCoding;

    // prodSysServeNoList: 调用方视角的服务编号 = 把 provider 的 sysServeNo 前缀替换为 callerComponent
    //   例: "E00301TO1197".replace("E00301", "E00406") → "E00406TO1197"
    const callerComp = pubSub.callerComponent || '';
    if (providerSysServeNo && callerComp) {
      // 提取序号部分（TO1197），拼上 callerComponent
      const seqMatch = providerSysServeNo.match(/(TO\d+)$/);
      pubSub.prodSysServeNoList = seqMatch ? [callerComp + seqMatch[1]] : [callerComp + 'TO9999'];
    } else if (serverCoding) {
      // 兜底：如果没 callerComponent，尝试从 serverCoding 推断
      const fallbackCaller = pubSub.callerComponent || 'E00406';
      pubSub.prodSysServeNoList = [fallbackCaller + 'TO9999'];
    }

    // 用 row / form 数据填充关键字段
    pubSub.id                         = row.id || null;
    pubSub.publishId                  = row.publishId || null;
    pubSub.provideComponentName       = row.provideComponentName || row.assemblyName || '互联网金融服务平台';
    pubSub.provideSystemNumber        = row.provideSystemNumber || row.assemblyNo || 'E00301';
    pubSub.serviceId                  = providerSysServeNo || null;
    pubSub.serviceType                = row.serviceType || '联机服务';
    pubSub.serviceVersion             = row.serviceVersion || 'V1';
    pubSub.documentName               = row.documentName || null;
    pubSub.documentNumber             = row.documentNumber || null;
    pubSub.subscriberComponentName    = row.subscriberComponentName || '';
    pubSub.serverNo                   = row.serverNo || row.taskNo || null;
    pubSub.version                    = row.version || 'BOCNET-G-IFS_V01.1M_B45';
    pubSub.prodBatch                  = row.prodBatch || '2611批次';
    pubSub.prodTaskNo                 = row.prodTaskNo || row.taskNo || null;
    pubSub.assemblyNo                 = row.assemblyNo || row.provideSystemNumber || 'E00301';
    pubSub.assemblyName               = row.assemblyName || row.provideComponentName || '互联网金融服务平台';
    pubSub.deptId                     = row.deptId || 'K4229';
    pubSub.deptName                   = row.deptName || '中国银行软件中心（深圳）开发三部';

    // form 表单数据覆盖
    if (form) {
      pubSub.serviceName              = form.serviceCnName || '';
      pubSub.serviceFunctionDescription = form.serviceCnName || '';
      pubSub.remark                   = form.remark || '';
      pubSub.callerComponent          = form.callerSystem || pubSub.callerComponent;
    }

    // 核心标识字段：区分「提供者编号」和「接口编码」
    pubSub.sysServeNo           = providerSysServeNo || serverCoding;
    pubSub.serviceNumber        = providerSysServeNo || serverCoding;
    pubSub.targetServeNo        = providerSysServeNo || serverCoding;
    pubSub.interfaceCode        = serverCoding || '';
    pubSub.sysEnName            = serverCoding || '';
    pubSub.sysServeEnName       = serverCoding || '';
    pubSub.serverVsn            = 'V1';

    return { documents, publishSubcription: pubSub };
  }

  /**
   * 订阅一个服务。
   * @returns {Promise<{ok:boolean, local?:boolean, error?:string}>}
   *          ok=true 表示可以继续写本地订阅列表
   */
  async function subscribe(serverCoding) {
    if (!isEnabled('subscribeAdd') || !serverCoding) {
      return { ok: true, local: true };
    }
    if (!window.API || typeof window.API.call !== 'function') {
      return { ok: false, error: 'API 客户端未就绪' };
    }
    try {
      await request('subscribeAdd', buildSubscribeBody(serverCoding));
      return { ok: true, local: false };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  }

  /**
   * 带表单的订阅（订阅弹窗走这里）。
   *
   * 调用 setSubcription 接口，请求体结构:
   *   { documents: [...], publishSubcription: {...} }
   *
   * @param {string|object} rowOrCode 行数据对象 或 服务编码字符串；
   *        传整个 row 时 buildSubscribeBody 才能取到 sysServeNo / callerComponent 等字段
   * @param {object} form         订阅弹窗 collectForm() 的结果
   * @returns {Promise<{ok:boolean, local?:boolean, error?:string}>}
   */
  async function subscribeWithForm(rowOrCode, form) {
    if (!isEnabled('subscribeAdd') || !rowOrCode) {
      return { ok: true, local: true };
    }
    if (!window.API || typeof window.API.call !== 'function') {
      return { ok: false, error: 'API 客户端未就绪' };
    }
    try {
      // 传入完整 row 对象，让 buildSubscribeBody 能取到 sysServeNo 等字段
      const body = buildSubscribeBody(rowOrCode, form);
      await request('subscribeAdd', body);
      return { ok: true, local: false };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  }

  /** 取消订阅（订阅面板里的「删除」走这里） */
  async function unsubscribe(serverCoding) {
    if (!isEnabled('subscribeRemove') || !serverCoding) {
      return { ok: true, local: true };
    }
    if (!window.API || typeof window.API.call !== 'function') {
      return { ok: false, error: 'API 客户端未就绪' };
    }
    try {
      await request('subscribeRemove', buildSubscribeBody(serverCoding));
      return { ok: true, local: false };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  }

  /**
   * 拉取服务端订阅列表（预留）。
   * 接入后可用于「打开页面时用服务端列表校正本地缓存」，
   * 目前未在任何地方调用，等接口确定后再接。
   * @returns {Promise<{ok:boolean, local?:boolean, list?:string[], error?:string}>}
   */
  async function fetchSubscribeList() {
    if (!isEnabled('subscribeList')) {
      return { ok: true, local: true, list: null };
    }
    if (!window.API || typeof window.API.call !== 'function') {
      return { ok: false, error: 'API 客户端未就绪' };
    }
    try {
      const json = await request('subscribeList', {});
      const data = json && (json.data || json.body || json);
      const arr = Array.isArray(data) ? data : (data && Array.isArray(data.rows) ? data.rows : null);
      // TODO(抓包后)：确认列表项结构，取出服务编码字段
      const list = arr
        ? arr.map((it) => (typeof it === 'string' ? it : (it && (it.serverCoding || it.serviceCode || it.code)))).filter(Boolean)
        : null;
      return { ok: true, local: false, list };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  }

  if (typeof window !== 'undefined') {
    window.ServiceApi = {
      endpoints: ENDPOINTS,
      isEnabled,
      fetchServiceDetail,
      subscribe,
      subscribeWithForm,
      unsubscribe,
      fetchSubscribeList,
    };
  }
})();
