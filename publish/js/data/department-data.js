/**
 * 部门数据动态加载
 *
 * ── 抓包依据：进入请求.har ──────────────────────────────
 *   POST http://itamp.bocsys.cn/itamp-tool/publish/getOrgTreeList?orgID=M2534&n=0.8678281537364907
 *   请求体：无
 *   响应：{"msg":"操作成功","code":200,"data":[
 *           {"value":"中国银行软件中心党委宣传部（企业文化部）","key":"1628A"}, ... ]}
 *
 * 四个必须照抄的事实（照之前的猜测写全错）：
 *   1. 是 POST，不是 GET
 *   2. orgID 放在 query string 里；n 是防缓存随机数，和主接口一个套路
 *   3. data 是【扁平数组】，没有 children 层级
 *   4. 元素字段是 value（部门名称）+ key（部门ID）
 *      —— 注意顺序和含义：value 在前且是名称，key 是 ID，跟直觉相反
 *
 * 抓包样本：M2534 返回 70 条，3696H 返回 44 条，合并去重 114 个部门。
 * 已核对：getPublishDataList 数据里出现的 deptId（1465A、K4229）都能在这棵树里
 *         找到，所以拿 key 当 deptId 去筛选是成立的。
 *
 * 必须走本地代理而不是直连 itamp.bocsys.cn：页面是本地打开的，
 * 直连属于跨域请求，浏览器直接拦掉，下拉列表会一直空着。
 */

(function () {
  'use strict';

  // 调用时才取 window.debugLog（顶层捕获会在 debug.js 排后时静默变成空操作）
  const debugLog = (...a) => (window.debugLog || (() => {}))(...a);

  const API_PATH = '/itamp-tool/publish/getOrgTreeList';

  // 抓包里实际出现的两个组织根节点
  const ORG_IDS = ['3696H', 'M2534'];

  /**
   * 按抓包结构解析：{ msg, code, data:[{value,key}] } → [{key, value}]
   * 结构不符就直接报错，不做猜测性兜底——猜错比报错更难查
   */
  function parseDepartments(payload) {
    // code 可能是 int 200 也可能是字符串 "200"（后端不统一），用 Number 宽松比较
    if (!payload || Number(payload.code) !== 200) {
      throw new Error(
        '部门接口返回业务错误：code=' + (payload && payload.code) +
        ' msg=' + (payload && payload.msg)
      );
    }
    const data = payload.data;
    if (!Array.isArray(data)) {
      throw new Error(
        '部门接口响应结构与抓包不符。期望 { code:200, data:[{value,key}] }，实际：' +
        JSON.stringify(payload).slice(0, 300)
      );
    }
    return data
      .filter((it) => it && it.key != null && it.value != null && it.value !== '')
      .map((it) => ({ key: String(it.key), value: String(it.value) }));
  }

  /** 请求单个 orgID 的部门列表 */
  async function fetchOrgDepartments(orgId) {
    const n = Math.random().toString().slice(2);

    let resp;
    try {
      // 走统一 API 客户端：自动拼 BASE_URL、注入 token、POST 方法
      resp = await window.API.call(API_PATH, {
        method: 'POST',                       // 抓包确认是 POST
        query: { orgID: orgId, n },
      });
    } catch (e) {
      // fetch 抛 TypeError，基本就是代理没起 / 跨域被拦 / 网络不通
      throw new Error(
        `无法连接部门接口（${API_PATH}）。请确认：\n` +
        `1. 代理已启动：node proxy.js\n` +
        `2. 代理终端没有报 ENOTFOUND / 502\n` +
        `原始错误：${e.message}`
      );
    }

    if (!resp.ok) {
      let detail = '';
      try { detail = (await resp.text()).slice(0, 200); } catch (_) { /* ignore */ }
      throw new Error(`请求 orgID=${orgId} 失败：HTTP ${resp.status} ${detail}`);
    }

    let payload;
    try {
      payload = await resp.json();
    } catch (e) {
      throw new Error(`orgID=${orgId} 返回的不是 JSON：${e.message}`);
    }

    return parseDepartments(payload);
  }

  /** 合并所有 orgID 的部门列表，按 key 去重后按名称排序 */
  async function loadAllDepartments() {
    debugLog('🔄 开始加载部门列表...');

    const results = await Promise.allSettled(ORG_IDS.map(fetchOrgDepartments));

    const deptMap = new Map();
    const failures = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        r.value.forEach((d) => {
          if (!deptMap.has(d.key)) deptMap.set(d.key, d);
        });
      } else {
        failures.push(`orgID=${ORG_IDS[i]}: ${r.reason.message}`);
      }
    });

    if (!deptMap.size) {
      throw new Error(failures.join('\n') || '未解析出任何部门');
    }

    const result = [...deptMap.values()]
      .sort((a, b) => a.value.localeCompare(b.value, 'zh-CN'));

    debugLog(`✅ 部门列表加载完成: 共 ${result.length} 个部门`);
    if (failures.length) console.warn('部分 orgID 加载失败:', failures);
    return result;
  }

  if (typeof window !== 'undefined') {
    window.loadDepartmentList = loadAllDepartments;
    window.parseDepartmentPayload = parseDepartments;   // 便于在控制台拿真实响应试解析
  }
})();
