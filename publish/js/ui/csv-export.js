/* CSV 导出：
   · exportRows —— 发布页专用（列固定，需要订阅状态函数）
   · download   —— 通用版：传入列定义 [[key, label], ...]，任务单页 / 订阅页共用，
                   以前这两页各抄了一份 csvCell + downloadCsv。 */
(() => {
  'use strict';

  const HEADERS = [
    '序号', '服务编码', '接口名', '服务名称', '服务编号',
    '批次', '服务状态', '是否已核对', '所属部门', '订阅标记',
  ];

  // CSV 公式注入：以 = + - @ 以及制表符/回车开头的值，Excel/WPS 打开时会当公式执行
  // （经典载荷 =cmd|'/c calc'!A1）。导出的数据全部来自后端报文，属于不可信输入，
  // 所以在单元格层面统一加前导单引号中和。数字不走这条规则，否则负数会被转成文本。
  const FORMULA_PREFIX = /^[=+\-@\t\r]/;

  function csvCell(value) {
    const text = value == null ? '' : String(value);
    const safe = (typeof value === 'number') ? text : (FORMULA_PREFIX.test(text) ? "'" + text : text);
    return /[",\n\r]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
  }

  function exportRows(rows, getSubscribeStatus, notify) {
    if (!Array.isArray(rows) || !rows.length) {
      notify('⚠️ 当前没有可导出的结果', 2000, 'warn');
      return false;
    }

    const lines = [HEADERS.map(csvCell).join(',')];
    rows.forEach((row, index) => {
      const serverCoding = row.serverCoding || row.sysServeNo || '';
      const interfaceCode = row.interfaceCode || row.sysServeEnName || '';
      lines.push([
        index + 1,
        serverCoding,
        interfaceCode,
        row.serviceName || '',
        row.sysServeNo || row.serverCoding || '',
        row.sheetProductBatch || row.prodBatch || row.productBatch || '',
        row.offerServerState || row.status || '',
        (row.isChecked === '1' || row.isChecked === 1) ? '是' : '否',
        row.deptName || '',
        getSubscribeStatus(serverCoding) === 'subscribed' ? '已订阅' : '未订阅',
      ].map(csvCell).join(','));
    });

    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    // 文件名时间戳按业务时区取：toISOString() 是 UTC，北京时间 00:00~08:00 会落成前一天
    const stamp = (window.Fmt && typeof window.Fmt.stamp === 'function')
      ? window.Fmt.stamp()
      : new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    anchor.href = url;
    anchor.download = `服务发布数据_${stamp}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    notify(`✅ 已导出 ${rows.length} 条`, 2000, 'success');
    return true;
  }

  /**
   * 通用导出：按给定的列定义把 rows 写成 CSV 并触发下载。
   * @param {Array<object>} rows
   * @param {Array<[string, string]>} columns [[字段名, 表头], ...]
   * @param {string} filename
   */
  function download(rows, columns, filename) {
    const lines = [columns.map(([, label]) => csvCell(label)).join(',')];
    rows.forEach((r) => {
      lines.push(columns.map(([key]) => csvCell(r[key] ?? '')).join(','));
    });
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /**
   * 通用导出（带模块缺失保护）：任务单页 / 订阅页共用，替代两页各自抄的 downloadCsv 包装。
   * @param {Array<object>} rows
   * @param {Array<[string, string]>} columns [[字段名, 表头], ...]
   * @param {string} filename
   */
  function downloadRows(rows, columns, filename) {
    const exporter = window.CsvExporter;
    if (!exporter) { (window.toast || console.warn)('⚠️ 导出模块未加载', 2500); return; }
    exporter.download(rows, columns, filename);
  }

  /**
   * 按页把服务端分页的结果拉全（导出用），带进度与取消。
   *
   * 为什么要抽出来：任务单页的导出是「5000 条 = 串行 10 次请求」的长任务，
   * 原先只有按钮文案「导出中…」，既看不到进展也停不下来。
   * 循环本身与 DOM 无关，放这里就能在 node 侧把「取消」「某页失败」「正好拉完」
   * 这些分支测到（页面脚本要整页假 DOM，测不动）。
   *
   * @param {(pageNum:number, pageSize:number)=>Promise<{ok:boolean, rows?:Array, total?:number, error?:string}>} fetchPage
   *        取一页（形态与 TaskApi.fetchTaskList 一致：失败返回 {ok:false,error}，不抛）
   * @param {object} opts
   * @param {number} opts.total 服务端报的总条数
   * @param {number} [opts.pageSize=500] 每页取多少
   * @param {number} [opts.max=5000] 最多取多少条（超了只导前 max 条）
   * @param {(p:{done:number,want:number,page:number})=>void} [opts.onProgress] 每拉完一页调一次
   * @param {AbortSignal} [opts.signal] 取消信号；中止后返回 {ok:false, aborted:true}
   * @returns {Promise<{ok:boolean, rows?:Array, want:number, aborted?:boolean, error?:string, truncated?:boolean}>}
   */
  async function fetchAllPages(fetchPage, opts) {
    const o = opts || {};
    const pageSize = Number(o.pageSize) > 0 ? Number(o.pageSize) : 500;
    const total = Number(o.total) > 0 ? Number(o.total) : 0;
    const max = Number(o.max) > 0 ? Number(o.max) : 5000;
    const signal = o.signal || null;
    const want = Math.min(total, max);
    const rows = [];
    if (typeof fetchPage !== 'function') return { ok: false, want, error: '没有取数函数' };
    if (!want) return { ok: true, rows: [], want: 0 };

    for (let page = 1; rows.length < want; page++) {
      if (signal && signal.aborted) return { ok: false, want, aborted: true };
      const r = await fetchPage(page, pageSize);
      // 失败要先分清是不是「用户按了取消」：中止不是故障，别报成导出失败
      if (signal && signal.aborted) return { ok: false, want, aborted: true };
      if (!r || !r.ok) return { ok: false, want, error: (r && r.error) || '未知错误' };
      const part = Array.isArray(r.rows) ? r.rows : [];
      if (!part.length) break;                      // 服务端提前给空页 = 已经到底
      rows.push(...part.slice(0, Math.max(0, want - rows.length)));
      if (typeof o.onProgress === 'function') {
        try { o.onProgress({ done: rows.length, want, page }); } catch (_) { /* 进度回调炸了不该影响导出 */ }
      }
    }
    const out = rows.slice(0, want);
    return { ok: true, rows: out, want, truncated: total > max };
  }

  window.CsvExporter = Object.freeze({ exportRows, download, downloadRows, csvCell, fetchAllPages });
})();
