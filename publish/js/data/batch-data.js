/**
 * 批次数据动态加载
 *
 * ── 抓包依据：进入请求.har ──────────────────────────────
 *   POST http://itamp.bocsys.cn/itamp-tool/intfcMgmt/conditions/subscribe
 *   请求体：无（空 body）
 *   响应：{"msg":"查询成功","code":"200","data":{
 *           "batchList":[
 *             {"label":"2606批次","value":"2606","shortEn":null},
 *             {"label":"26年8月独立","value":"268dl","shortEn":null},
 *             ...
 *           ],
 *           ...其他下拉字典...
 *         }}
 *
 * 关键事实：
 *   1. POST 请求，无请求体
 *   2. code 是字符串 "200" 而非数字
 *   3. batchList 在 data.batchList 中（不是顶层 data）
 *   4. 每个批次有 label（显示名）和 value（筛选值）
 */

(function () {
  'use strict';

  // 调用时才取 window.debugLog（顶层捕获会在 debug.js 排后时静默变成空操作）
  const debugLog = (...a) => (window.debugLog || (() => {}))(...a);

  // 请求已收敛到 api-client.js 的 window.API.fetchSubscribePayload()：
  // 该接口与提供方系统列表是同一个，整个页面只发一次 HTTP，这里只做解析。

  /**
   * 解析批次接口响应
   * @param {object} payload - 接口返回的 JSON
   * @returns {Array<{label: string, value: string}>} 批次列表
   */
  function parseBatchList(payload) {
    // code 可能是 int 200 也可能是字符串 "200"
    if (!payload || Number(payload.code) !== 200) {
      throw new Error(
        '批次接口返回业务错误：code=' + (payload && payload.code) +
        ' msg=' + (payload && payload.msg)
      );
    }

    const data = payload.data || payload;
    const batchList = data.batchList;

    if (!Array.isArray(batchList)) {
      throw new Error(
        '批次接口响应结构与抓包不符。期望 { data: { batchList: [...] } }，实际：' +
        JSON.stringify(payload).slice(0, 300)
      );
    }

    /**
     * 提取批次 label 中的年月用于排序，让最新的排在最前面。
     * 返回 [是否为日期批次, 年, 月]：日期批次优先，普通文字最后。
     * 支持格式:
     *   "2703批次"       → [1, 2027, 3]
     *   "2611批次"       → [1, 2026, 11]
     *   "26年8月独立"     → [1, 2026, 8]
     *   "技术支持类-2026年批次" → [1, 2026, 0]
     */
    function extractSortKey(label) {
      const text = String(label).trim();

      // 26 年 11 月批次写成四位连续数字：前两位是年份，后两位是月份。
      const compact = /^(\d{2})(\d{2})(?:批次)?/.exec(text);
      if (compact) {
        const year = 2000 + Number(compact[1]);
        const month = Number(compact[2]);
        if (month >= 1 && month <= 12) return [1, year, month];
      }

      // 兼容“26年8月独立”“2026年批次”等中文年月写法。
      // 只有年份时按 YYYY-00 处理，排在该年份所有具体月份之后。
      const cn = /(?:^|\D)(\d{2,4})年(?:\s*(\d{1,2})月)?/.exec(text);
      if (cn) {
        const rawYear = Number(cn[1]);
        const year = rawYear < 100 ? 2000 + rawYear : rawYear;
        const month = cn[2] ? Number(cn[2]) : 0;
        return [1, year, month >= 1 && month <= 12 ? month : 0];
      }

      return [0, 0, 0];
    }

    return batchList
      .filter((it) => it && it.label != null && it.value != null && it.label !== '')
      .map((it, index) => ({ label: String(it.label), value: String(it.value), _index: index }))
      .sort((a, b) => {
        const ka = extractSortKey(a.label);
        const kb = extractSortKey(b.label);
        // 先按“是否有年月”排序：可识别日期的批次永远在普通文字前面。
        if (ka[0] !== kb[0]) return kb[0] - ka[0];
        // 再按年份、月份倒序：2706 > 2705 > 2704 > 2703 > 27年2月。
        if (ka[1] !== kb[1]) return kb[1] - ka[1];
        if (ka[2] !== kb[2]) return kb[2] - ka[2];
        // 同一个年月（例如“2611批次”和“26年11月独立”）保持接口原始顺序。
        return a._index - b._index;
      })
      .map(({ label, value }) => ({ label, value }));
  }

  /**
   * 「近 12 个月」批次 label：从（基准月 −2）到（基准月 +9），含两端，共 12 个。
   * 例：基准 2026-09 ⇒ [2607批次, …, 2706批次]。label 与抓包一致（YYMM批次），
   * 直接作为 prodBatch 的过滤值发给后端。
   *
   * 月份安全的两个要点（改这个函数时别破坏）：
   *   · **一律用 1 号构造再 setMonth(+1)**：若拿当天日期（比如 31 号）去加一个月，
   *     3/31 → 5/1（Date 的 day 溢出不会自减月份），会直接跳过一个月。
   *   · **跨年交给 Date 自己进位**：month 传 13 / 0 / -1 都合法，别手写 year--。
   *
   * @param {Date} [now] 基准日期（业务时区的"今天"）；留空取当前时刻
   * @returns {string[]}
   */
  function batchWindowLabels(now) {
    const Fmt = (typeof window !== 'undefined') ? window.Fmt : null;
    const base = (now instanceof Date)
      ? now
      : (Fmt && typeof Fmt.businessToday === 'function' ? Fmt.businessToday() : new Date());

    const start = new Date(base.getFullYear(), base.getMonth() - 2, 1);
    const end = new Date(base.getFullYear(), base.getMonth() + 9, 1);
    const out = [];
    const cur = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cur <= end) {
      const yy = String(cur.getFullYear()).slice(2);
      const mm = String(cur.getMonth() + 1).padStart(2, '0');
      out.push(`${yy}${mm}批次`);
      cur.setMonth(cur.getMonth() + 1);
    }
    return out;
  }

  /** 请求批次列表（与提供方系统共用同一次订阅条件接口响应，只发一次 HTTP） */
  async function fetchBatchList() {
    debugLog('🔄 加载批次列表（复用订阅条件接口，单次请求）...');
    const payload = await window.API.fetchSubscribePayload();
    return parseBatchList(payload);
  }

  if (typeof window !== 'undefined') {
    window.loadBatchList = fetchBatchList;
    window.parseBatchPayload = parseBatchList;
    window.batchWindowLabels = batchWindowLabels;
  }
})();
