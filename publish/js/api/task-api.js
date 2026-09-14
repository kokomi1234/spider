/**
 * 任务单查询 的接口层
 *
 * ── 数据来源 ────────────────────────────────────────────────
 * 全部来自抓包文件 `任务单查询.har`（2026-09-08），对应
 * `任务单查询接口文档.md`。路径与字段都是报文里真实存在的，
 * 没有臆造。基础域名 https://itamp.bocsys.cn，本地由 proxy.js
 * 转发（前端只发完整后端路径）。
 *
 * ── 与 service-api.js 的关系 ────────────────────────────────
 * 同一套写法：ENDPOINTS + METHODS + isEnabled + request + build/adapt。
 * 区别是本文件所有接口都已抓包确认，默认就是开启的（不再走本地兜底）；
 * 想临时关掉某个能力，在 window.__APP_CONFIG__.taskEndpoints 里把
 * 对应路径置空即可，页面会降级为空数据而不是报错。
 *
 * 约定：所有方法都不抛异常，失败一律返回 { ok:false, error }。
 */
(function () {
  'use strict';

  const CONFIG = (typeof window !== 'undefined' && window.__APP_CONFIG__) || {};

  /** 抓包确认的接口路径（留空 = 关闭该能力，页面降级为空数据） */
  const ENDPOINTS = Object.assign(
    {
      // 任务单列表（也是任务单编号/名称等下拉选项的数据源）
      taskList:      '/itamp-ems/productiontasks/taskmanagement/produceTaskFormSelect/taskFormSelectList',
      // 抄送人部门列表 → 牵头部门下拉
      deptList:      '/itamp-ems/productiontasks/sysset/emailCopyPeople/selectDeptList',
      // 当前用户信息 → 默认牵头部门（本人所在团队）
      userInfo:      '/itamp-comm/iam/getUserInfo',
      // 任务分类 → taskClassifyList 多选
      taskCategory:  '/itamp-ems/productiontasks/scheduling/scheduleSuggestionFilling/selectTaskCategoryList',
      // 生产批次名称 → schedulingAgreeBatchList 多选
      batchNames:    '/itamp-ems/productiontasks/sysset/productionBatch/queryBatchNameList',
      // 系统/项目分类参数（同一接口，靠 paramType 区分）
      parameterList: '/itamp-ems/productiontasks/sysset/parameter/queryParameterList',
      // 待办事项
      todoList:      '/itamp-comm/bpm/todo/list',
    },
    CONFIG.taskEndpoints || {}
  );

  const METHODS = Object.assign(
    {
      taskList:      'POST',
      deptList:      'POST',
      userInfo:      'GET',
      taskCategory:  'POST',
      batchNames:    'POST',
      parameterList: 'POST',
      todoList:      'GET',
    },
    CONFIG.taskEndpointMethods || {}
  );

  // 协议层（endpoint → 请求 → 业务码校验 → 统一错误文案）收在 js/core/api-client.js，
  // tool / service / task / user 四个接口模块共用一份实现，不再各写一遍。
  const REQ = (window.API && typeof window.API.createRequester === 'function')
    ? window.API.createRequester({ endpoints: ENDPOINTS, methods: METHODS })
    : null;
  /** 端点是否已配置（未配置 = 该能力关闭，调用方走本地兜底，不发请求） */
  const isEnabled = REQ ? REQ.isEnabled : (name) => Boolean(ENDPOINTS[name]);
  const request = REQ ? REQ.request : (name) => {
    throw new Error(`请求层未就绪：请确认 core/api-client.js 在本模块之前加载（缺少 createRequester，请求 ${name}）`);
  };

  // ── 任务单列表 ────────────────────────────────────────────

  /**
   * 组装 taskFormSelectList 请求体。
   *
   * 字段名与抓包报文完全一致（含 `taskClassifyList` / `schedulingAgreeBatchList`
   * 这两个数组字段，以及成对的 `xxxDate` 数组 + `xxxDateStart/End` 字符串）。
   * 未出现在筛选区的字段一律发空值，保持与抓包一致，避免后端行为漂移。
   */
  function buildTaskListBody(cond, pageNum, pageSize) {
    const c = cond || {};
    return {
      pageSize:                 Number(pageSize) || 20,
      pageNum:                  Number(pageNum) || 1,
      taskPerformStatue:        c.taskPerformStatue || '',
      taskApplicationTaskNo:    c.taskApplicationTaskNo || '',
      taskApplicationTaskType:  c.taskApplicationTaskType || '',
      taskApplicationTaskName:  c.taskApplicationTaskName || '',
      softCenterDemandNo:       c.softCenterDemandNo || '',
      leadDept:                 c.leadDept || '',
      leadProduct:              c.leadProduct || '',
      relationProducts:         c.relationProducts || '',
      schedulingAgreeBatchList: c.schedulingAgreeBatchList || [],
      tieVersion:               c.tieVersion || '',
      ifSecurityHole:           c.ifSecurityHole || '',
      taskClassifyList:         c.taskClassifyList || [],
      // 注意：接口文档里列了 reviewerRole，但本次抓包的两次请求都没带上它，
      // 按「报文里没有的字段不臆造」的原则暂不发送。确认后端支持后再加。
      projectType:              c.projectType || '',
      projLeadDept:             c.projLeadDept || '',
      prodPracDeptName:         c.prodPracDeptName || '',
      projectNo:                c.projectNo || '',
      projectName:              c.projectName || '',
      funcTestDate:             [],
      funcTestDateStart:        c.funcTestDateStart || '',
      funcTestDateEnd:          c.funcTestDateEnd || '',
      archiveDate:              [],
      startArchiveDate:         c.startArchiveDate || '',
      endArchiveDate:           c.endArchiveDate || '',
      belongYear:               c.belongYear || '',
    };
  }

  /**
   * @param {object} cond   筛选条件（见 buildTaskListBody）
   * @param {number} pageNum
   * @param {number} pageSize
   * @returns {Promise<{ok:boolean, local?:boolean, total:number, rows:Array, error?:string}>}
   */
  async function fetchTaskList(cond, pageNum, pageSize) {
    if (!isEnabled('taskList')) {
      return { ok: true, local: true, total: 0, rows: [] };
    }
    if (!window.API || typeof window.API.call !== 'function') {
      return { ok: false, total: 0, rows: [], error: 'API 客户端未就绪' };
    }
    try {
      const json = await request('taskList', buildTaskListBody(cond, pageNum, pageSize));
      // 报文：{ total, rows, code, msg, pageNum, pageSize, pageTotals }
      const rows = (json && (json.rows || (json.data && json.data.rows))) || [];
      const total = Number((json && (json.total != null ? json.total : (json.data && json.data.total))) || 0);
      return { ok: true, local: false, total, rows: Array.isArray(rows) ? rows : [] };
    } catch (e) {
      return { ok: false, total: 0, rows: [], error: e.message || String(e) };
    }
  }

  // ── 各类字典 ──────────────────────────────────────────────

  /** 抄送人部门列表 → [{ deptId, deptName, deptNo }] */
  async function fetchDeptList() {
    if (!isEnabled('deptList')) return { ok: true, local: true, list: [] };
    if (!window.API || typeof window.API.call !== 'function') {
      return { ok: false, list: [], error: 'API 客户端未就绪' };
    }
    try {
      // 抓包里这是个「无 body + ?deptName= 查询参数」的 POST，按原样发
      const json = await request('deptList', undefined, { deptName: '' });
      const arr = (json && (json.data || json.rows)) || [];
      const list = arr
        .map((d) => ({ deptId: d.deptId ?? d.id ?? '', deptName: d.deptName || '', deptNo: d.deptNo || '' }))
        .filter((d) => d.deptName);
      return { ok: true, local: false, list };
    } catch (e) {
      return { ok: false, list: [], error: e.message || String(e) };
    }
  }

  /**
   * 当前登录用户 → { userId, userName, orgId, orgName, teamId, teamName }
   * 报文：{ data: { userExtInfo: { ... } } }
   */
  async function fetchUserInfo() {
    if (!isEnabled('userInfo')) return { ok: true, local: true, user: null };
    if (!window.API || typeof window.API.call !== 'function') {
      return { ok: false, user: null, error: 'API 客户端未就绪' };
    }
    try {
      const json = await request('userInfo');
      const ext = json && json.data && json.data.userExtInfo;
      if (!ext) return { ok: true, local: false, user: null };
      return {
        ok: true,
        local: false,
        user: {
          userId:   ext.userId || '',
          userName: ext.userName || '',
          orgId:    ext.orgId || '',
          orgName:  ext.orgName || '',
          teamId:   ext.teamId || '',
          teamName: ext.teamName || '',
        },
      };
    } catch (e) {
      return { ok: false, user: null, error: e.message || String(e) };
    }
  }

  /** 任务分类 → [{ value: apName, label: apName }]（请求体就是 apName 字符串数组） */
  async function fetchTaskCategoryList() {
    if (!isEnabled('taskCategory')) return { ok: true, local: true, list: [] };
    if (!window.API || typeof window.API.call !== 'function') {
      return { ok: false, list: [], error: 'API 客户端未就绪' };
    }
    try {
      const json = await request('taskCategory', {});
      const arr = (json && (json.data || json.rows)) || [];
      const list = arr
        .filter((c) => c && c.apName)
        .map((c) => ({ value: c.apName, label: c.apName, id: c.id || '', code: c.apOde || '' }));
      return { ok: true, local: false, list };
    } catch (e) {
      return { ok: false, list: [], error: e.message || String(e) };
    }
  }

  /** 生产批次名称 → ["2611", "2703", ...] */
  async function fetchBatchNameList() {
    if (!isEnabled('batchNames')) return { ok: true, local: true, list: [] };
    if (!window.API || typeof window.API.call !== 'function') {
      return { ok: false, list: [], error: 'API 客户端未就绪' };
    }
    try {
      const json = await request('batchNames', { productionBatchName: '' });
      const arr = (json && (json.data || json.rows)) || [];
      const list = arr.filter((v) => typeof v === 'string' && v);
      return { ok: true, local: false, list };
    } catch (e) {
      return { ok: false, list: [], error: e.message || String(e) };
    }
  }

  /**
   * 参数列表（paramType: '系统参数' | '项目分类' | ...）
   * @returns {Promise<{ok, list:[{paramName, value}], error?}>}
   */
  async function fetchParamList(paramType, paramName, pageSize) {
    if (!isEnabled('parameterList')) return { ok: true, local: true, list: [] };
    if (!window.API || typeof window.API.call !== 'function') {
      return { ok: false, list: [], error: 'API 客户端未就绪' };
    }
    try {
      const json = await request('parameterList', {
        pageSize: Number(pageSize) || 20,
        pageNum: 1,
        paramType: paramType || '',
        paramName: paramName || '',
        status: 1,
      });
      const rows = (json && (json.rows || json.data)) || [];
      const list = rows
        .map((r) => ({ paramName: r.paramName || '', value: r.value ?? '' }))
        .filter((r) => r.paramName);
      return { ok: true, local: false, list };
    } catch (e) {
      return { ok: false, list: [], error: e.message || String(e) };
    }
  }

  /** 待办事项列表：GET /itamp-comm/bpm/todo/list?pageNum&pageSize&userId&processType */
  async function fetchTodoList(userId, pageNum, pageSize) {
    if (!isEnabled('todoList')) return { ok: true, local: true, total: 0, rows: [] };
    if (!window.API || typeof window.API.call !== 'function') {
      return { ok: false, total: 0, rows: [], error: 'API 客户端未就绪' };
    }
    try {
      const json = await request('todoList', undefined, {
        pageNum: Number(pageNum) || 1,
        pageSize: Number(pageSize) || 10,
        userId: userId || '',
        processType: 0,
      });
      const data = (json && json.data) || {};
      return {
        ok: true,
        local: false,
        total: Number(data.total || 0),
        rows: Array.isArray(data.data) ? data.data : [],
      };
    } catch (e) {
      return { ok: false, total: 0, rows: [], error: e.message || String(e) };
    }
  }

  if (typeof window !== 'undefined') {
    window.TaskApi = {
      endpoints: ENDPOINTS,
      isEnabled,
      fetchTaskList,
      fetchDeptList,
      fetchUserInfo,
      fetchTaskCategoryList,
      fetchBatchNameList,
      fetchParamList,
      fetchTodoList,
    };
  }
})();
