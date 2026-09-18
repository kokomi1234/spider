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
  function request(name, body, query) {
    const req = requester();
    if (!req) {
      throw new Error(`请求层未就绪：core/api-client.js 未加载（缺少 createRequester，请求 ${name}）`);
    }
    return req.request(name, body, query);
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
    // 真实成功报文（analysis/har/订阅.json 两次）里每条文档是 6 个字段：
    //   { batchNum, docName, docNo, label, templateCode, docInstId }
    // 所以优先用弹窗传来的完整明细；只有「只有 id + 名称」的旧调用方式时才降级。
    const relDocDetails = (form && Array.isArray(form.relDocDetails)) ? form.relDocDetails : [];
    const relDocIds = (form && form.relDocIds) ? String(form.relDocIds).split(',').filter(Boolean) : [];
    const relDocNames = (form && form.relDocNames) ? String(form.relDocNames).split('、').filter(Boolean) : [];

    let documents;
    if (relDocDetails.length > 0) {
      documents = relDocDetails
        .filter((d) => d && d.docInstId)
        .map((d) => ({
          docInstId:    d.docInstId,
          docNo:        d.docNo || '',
          docName:      d.docName || '',
          batchNum:     d.batchNum || '',
          label:        d.label || '',
          templateCode: d.templateCode || '',
        }));
    } else if (relDocIds.length > 0) {
      documents = relDocIds.map((id, i) => ({
        docInstId: id,
        docNo: '',
        docName: relDocNames[i] || '',
        batchNum: '',
        label: '',
        templateCode: '',
      }));
    } else {
      // ⚠️ 这里原本写死了一条 HAR 抓包里的样例文档（docInstId b87c5270-…），
      // 只要用户没选关联文档，就会把这条别人的文档一起提交到生产库。
      // 没有关联文档就发空数组 —— 宁可让后端报「文档必填」，也不能写脏数据。
      documents = [];
    }

    // ── publishSubcription: 订阅详细信息 ──
    // 基于 HAR 抓包的完整对象，填入表单数据和当前行数据
    const pubSub = {
      // 基础标识
      id:                         null,
      publishId:                null,
      provideComponentName:     null,
      batch:                    null,
      sheetProductBatch:        row.sheetProductBatch || null,
      serviceStatus:            null,
      provideSystemNumber:      null,
      serviceId:                null,
      serviceFunctionDescription: '',
      serviceType:              null,
      serviceNumber:            null,
      serviceName:              '',
      serviceVersion:           null,
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
      sysType:                  row.sysType || null,
      sysServeEnName:           null,
      serveTyep:                row.serveTyep || row.serveTyep === '' ? row.serveTyep : (row.serviceType || null),
      targetServeNo:            null,
      serverVsn:                  row.serverVsn || row.serverVersion || null,
      serverCoding:             serverCoding || '',
      serverMode:               '',
      prodBatch:                null,
      serverNo:                 null,
      isSend:                   '',
      isSendOutsideSystem:      '',
      version:                  null,
      tag:                      '',
      productBatch:             null,
      productNo:                null,
      productName:                null,
      isMember:                   null,
      // ⚠️ 以下三个是**协议常量**（不是实体数据），值来自抓包样例，尚未在真实环境复核
      //   · isChecked '1' / isDelete '1' 很可能是后端约定的「有效」标志，与字段名直觉相反
      //   · reviewStatus '03' 是新建订阅该用的档位还是后端自算，需一次成功订阅的抓包确认
      //   在确认前保持原值：改错会直接打断能用的订阅写入；确认后按后端要求收敛
      isChecked:                '1',
      pubVersion:               null,
      subscriberTechNum:          null,
      publishSubcriptionId:     null,
      offerServerState:         row.offerServerState || null,
      effectiveTime:            null,
      offlineTime:              null,
      versionBatch:             null,
      versionServerNo:          null,
      offerVersionBatch:        null,
      offerVersionServerNo:     null,
      offerEffectiveTime:       row.offerEffectiveTime || null,
      offerOfflineTime:         '',
      gatewayCode:              '',
      context:                  '',
      isOperation:              null,
      prodSysServeNo:           '',
      prodSysServeNoList:       [],
      prodServiceType:          '',
      prodMCISCode:             '',
      prodIPSCode:              '',
      prodBatchList:            row.prodBatchList || row.prodBatch || null,
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
      prodTPSPeak:              row.prodTPSPeak
        || (form && form.perfPeak && form.perfPeak.tps ? String(form.perfPeak.tps) : null),
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
      assemblyNo:               null,
      assemblyName:             null,
      principal:                '',
      principalName:            null,
      deptId:                   null,
      deptName:                 null,
      // 弹窗没有「是否做副本」输入项；两次真实成功报文里都是「否」，按业务默认值填
      isBackup:                 row.isBackup || '否',
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

    // prodSysServeNoList: 调用方视角的服务编号 = 调用方系统编号 + provider sysServeNo 尾部序号
    //   例: "E00301TO1197" → 序号 TO1197，拼上调用方 E00406 → "E00406TO1197"
    //   优先用表单里用户确认过的 callerServiceNo（订阅弹窗选完调用方系统后已自动填入）
    const formCallerSvc = (form && form.callerServiceNo) ? String(form.callerServiceNo).trim() : '';
    if (formCallerSvc) {
      pubSub.prodSysServeNoList = [formCallerSvc];
    } else {
      const callerComp = pubSub.callerComponent || '';
      if (providerSysServeNo && callerComp) {
        const seqMatch = providerSysServeNo.match(/(TO\d+)$/);
        pubSub.prodSysServeNoList = seqMatch ? [callerComp + seqMatch[1]] : [];
      } else {
        pubSub.prodSysServeNoList = [];
      }
    }

    // 任务编号（弹窗里必填）：原来填了**从不进报文**（下面 serverNo / prodTaskNo 只取 row）。
    // 口径：行数据里 serverNo / taskNo 有值仍以行为准（真实报文里这两项 = 服务编号
    // M-202607-11289，不是用户手填的那个），行里没有才用表单值兜底 —— 否则用户填了等于没填。
    const formTaskNo = (form && form.taskNo != null) ? String(form.taskNo).trim() : '';

    // 用 row / form 数据填充关键字段
    pubSub.id                         = row.id || null;
    pubSub.publishId                  = row.publishId || null;
    // ⚠️ 下面这些原来是抓包样例里的具体实体值：E00301 / K4229 /
    // 「中国银行软件中心（深圳）开发三部」/ 2611批次 / BOCNET-G-IFS_V01.1M_B45。
    // 行数据完整时会被 row 覆盖，但「只传服务编码」的路径（subscribe-ui 手动订阅）
    // 拿不到 row，就会把这批样例数据原样提交到生产库。
    // 改为 null —— 字段缺失让后端报错，远好于写进去一条张冠李戴的订阅。
    pubSub.provideComponentName       = row.provideComponentName || row.assemblyName || null;
    pubSub.provideSystemNumber        = row.provideSystemNumber || row.assemblyNo || null;
    pubSub.serviceId                  = providerSysServeNo || null;
    pubSub.serviceType                = row.serviceType || null;
    pubSub.serviceVersion             = row.serviceVersion || 'V1';
    pubSub.documentName               = row.documentName || null;
    pubSub.documentNumber             = row.documentNumber || null;
    pubSub.subscriberComponentName    = row.subscriberComponentName || '';
    pubSub.serverNo                   = row.serverNo || row.taskNo || formTaskNo || null;
    pubSub.version                    = row.version || null;
    pubSub.prodBatch                  = row.prodBatch || null;
    // prodBatchList：行数据里这个字段恒为空（40/40 样本），而降级用的 offerVersionBatch 也是空的。
    // 两次真实成功报文里 prodBatchList 都等于 prodBatch（订阅的来源批次），所以按这个口径补，
    // 而不是发 null 让后端去猜。
    pubSub.prodBatchList              = row.prodBatchList || row.prodBatch || null;
    // prodTaskNo：行里为空，两次真实报文里它都等于 serverNo（服务编号 M-YYYYMM-xxxxx）；
    // 行与 serverNo 都拿不到时才退回表单里的任务编号
    pubSub.prodTaskNo                 = row.prodTaskNo || row.taskNo || row.serverNo || formTaskNo || null;
    pubSub.assemblyNo                 = row.assemblyNo || row.provideSystemNumber || null;
    pubSub.assemblyName               = row.assemblyName || row.provideComponentName || null;
    pubSub.deptId                     = row.deptId || null;
    pubSub.deptName                   = row.deptName || null;

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
  async function subscribe(rowOrCode) {
    if (!isEnabled('subscribeAdd') || !rowOrCode) {
      return { ok: true, local: true };
    }
    if (!window.API || typeof window.API.call !== 'function') {
      return { ok: false, error: 'API 客户端未就绪' };
    }
    // 只传服务编码时拿不到行数据，sysServeNo / deptId / 批次 / 文档 等关键字段
    // 全部缺失，构造出的请求体只能靠兜底值 —— 那等于把样例数据写进生产库。
    // 这种情况只记本地、不发起远程写，并把原因回传给 UI。
    const isRow = rowOrCode && typeof rowOrCode === 'object';
    if (!isRow) {
      return {
        ok: true, local: true, remoteSkipped: true,
        reason: '仅记录到本地：手动输入的编码缺少服务明细，未同步到服务端。请从列表中选择该服务后再订阅。',
      };
    }
    try {
      await request('subscribeAdd', buildSubscribeBody(rowOrCode));
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

  /**
   * 取消订阅 = 删掉本机「已订阅」清单里的一条标记（订阅面板里的「删除」走这里）。
   *
   * **口径（2026-09-19 定，不要再当成待办）**：后端没有可用的订阅查询接口，
   * 「我订阅了哪些服务」只能本机维护（手动添加 / 批量导入），所以总的就是本地为准：
   *   · 取消订阅 = 删除本机标记，典型场景是「当初添加错了」；
   *   · 不发任何远程请求，服务端订阅关系不受影响（也不会被误改）；
   *   · 副作用要说清：换浏览器 / 清缓存会丢，靠「批量导出」备份。
   *
   * 为什么不用 `subscribeRemove` 端点：取消接口的请求体**没有抓包确认**，
   * 原实现复用 buildSubscribeBody（那是订阅的报文）语义完全反了 ——
   * 按项目铁律（没抓包不臆造字段），这里不猜，保持纯本地。真要接远端，
   * 得先拿到一次取消订阅的抓包再写 buildUnsubscribeBody。
   */
  async function unsubscribe(serverCoding) {
    // 端点即便配了也不走：见上面口径说明（本地为准，且取消报文未抓过包）
    if (!serverCoding) {
      return { ok: true, local: true };
    }
    return {
      ok: true, local: true, remoteSkipped: true,
      reason: '本机清单里已移除；服务端的订阅关系不受影响。',
    };
  }

  /**
   * 拉取服务端订阅列表（**目前不可能接到**，保留只为将来留个位置）。
   *
   * 现状与口径（2026-09-19）：后端**没有**「查询我订阅了哪些服务」的接口 ——
   * 右上角那个「已订阅 (N)」是本机 localStorage 里的清单（手动添加 / 批量导入），
   * 不是服务端返回的。因此这里保持**零调用**，也不存在「用服务端校正本地缓存」的前提；
   * 哪天真出现了查询接口，且拿到了抓包，才轮到它上场（届时顺手把 `subscribeList`
   * 端点补进 ENDPOINTS）。
   *
   * 副作用提醒写在 UI 上：换浏览器 / 清缓存清单会丢，用「批量导出」备份。
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
