/* CSV 导出 feature：不依赖页面查询状态，输入 rows 和订阅状态函数即可复用。 */
(() => {
  'use strict';

  const HEADERS = [
    '序号', '服务编码', '接口名', '服务名称', '服务编号',
    '批次', '服务状态', '是否已核对', '所属部门', '订阅标记',
  ];

  function csvCell(value) {
    const text = value == null ? '' : String(value);
    return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
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
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    anchor.href = url;
    anchor.download = `服务发布数据_${stamp}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    notify(`✅ 已导出 ${rows.length} 条`, 2000, 'success');
    return true;
  }

  window.CsvExporter = Object.freeze({ exportRows });
})();
