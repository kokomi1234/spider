/**
 * 服务发布数据查询的「响应解析 / 错误解析 / 参数校验 / 兼容性检查」
 * （从 index.js 拆出，约 90 行）
 *
 * ── 为什么单独成文件 ────────────────────────────────
 * 这四个函数都是纯逻辑（只吃参数、不碰页面状态），但藏在 1300 行的
 * index.js 里既没法复用、也没法单测。抽出来后：
 *   · 查询 与「失败分页重试」共用同一份解析（注释里原本就要求别漂移）
 *   · parsePublish 的 x-cache-match: loose 判定可以写单测守住
 *
 * 说明：本文件不依赖任何页面私有状态，只用到 window.fetch / localStorage。
 */
(function () {
  'use strict';

  /**
   * 统一解析后端响应：非 2xx / 业务错误码 抛错。
   * @returns {Promise<{data:object, rows:Array, total:number, loose:boolean}>}
   */
  async function parse(resp) {
    if (!resp.ok) throw { response: resp, message: `HTTP ${resp.status}` };
    let json;
    try {
      json = await resp.json();
    } catch (e) {
      throw { message: '接口返回数据格式异常，请联系管理员' };
    }
    const bizCode = Number(json.code);
    if (json.code != null && bizCode !== 0 && bizCode !== 200) {
      throw { message: json.msg || json.message || `业务错误: 代码 ${json.code}` };
    }
    const data = json.data || json.body || json;
    const rows = data.records || data.list || data.rows || [];
    const total = data.total ?? rows.length;
    // 本地代理宽松匹配时会带 X-Cache-Match: loose，意思是「精确没命中，
    // 回放的是同接口旧录制的数据」——这批数据未必属于本次的查询条件，
    // 上层必须如实告诉用户，否则会把回放数据当成真实结果。
    const loose = !!(resp.headers && resp.headers.get && resp.headers.get('x-cache-match') === 'loose');
    return { data, rows, total, loose };
  }

  /** 解析 API 错误信息 */
  function parseApiError(response, error) {
    if (response.status === 401) {
      return '认证失败，请检查 Token 是否有效';
    }
    if (response.status === 403) {
      return '权限不足，无法访问该接口';
    }
    if (response.status === 404) {
      // 业务用户看到的是这一句：不提「代理 / 缓存 / 控制台」这些部署细节，
      // 只给「没查到 + 下一步怎么做」。排障口径留在 README 的故障排除一节。
      return '没有查到符合条件的数据，请稍后重试，或调整筛选条件后再查';
    }
    if (response.status === 500) {
      return '服务器内部错误，请稍后重试';
    }
    if (error?.message?.includes('Failed to fetch') || error?.name === 'TypeError') {
      return '网络连接失败，请检查：\n1. 代理服务器是否运行\n2. 网络是否正常\n3. CORS 配置是否正确';
    }
    return error?.message || `未知错误 (${response.status})`;
  }

  /** 验证筛选条件有效性 */
  function validateFilters(filters) {
    const errors = [];

    // 提供方系统编号由下拉数据源决定，可能是 E/T/C 等不同前缀；这里只校验非空和长度。
    if (filters.compNum && !/^[A-Za-z][A-Za-z0-9_-]{1,31}$/.test(filters.compNum)) {
      errors.push('提供方系统编号格式不正确，请选择有效的系统编号');
    }

    // 注意用 != null 而不是真值判断：pageSize/pageNum 为 0 时 0 是 falsy，
    // 用 && 会整个跳过校验，让「第 0 页」这种非法值蒙混过关（单测抓到过）
    if (filters.pageSize != null && (filters.pageSize < 1 || filters.pageSize > 100)) {
      errors.push('每页数量应在 1-100 之间');
    }

    if (filters.pageNum != null && filters.pageNum < 1) {
      errors.push('页码应从 1 开始');
    }

    return errors;
  }

  /** 检查浏览器兼容性 */
  function checkBrowserCompatibility() {
    const issues = [];

    try {
      localStorage.setItem('__test__', '1');
      localStorage.removeItem('__test__');
    } catch (e) {
      issues.push('localStorage 不可用，订阅功能将无法正常工作');
    }

    if (!window.fetch) {
      issues.push('您的浏览器不支持 Fetch API，请使用现代浏览器（Chrome/Firefox/Edge/Safari）');
    }

    if (!window.JSON) {
      issues.push('您的浏览器不支持 JSON 解析，请使用现代浏览器');
    }

    return issues;
  }

  window.PublishResponse = Object.freeze({
    parse, parseApiError, validateFilters, checkBrowserCompatibility,
  });
})();
