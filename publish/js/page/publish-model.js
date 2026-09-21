/* ============================================================
  服务发布数据查询 — 纯业务模型（无 DOM 依赖）
  ------------------------------------------------------------
  本模块只放「输入数据 → 输出数据/文本」的纯函数，不碰任何 DOM、
  不读 window.* 运行时状态（除挂自身接口外）。index.js 负责 DOM 读写、
  事件绑定与查询编排，需要纯逻辑时调用 window.PublishModel.*。

  约定（与项目其它模块一致）：浏览器 IIFE，挂 window.PublishModel。
============================================================ */

(function () {
  'use strict';

  // ── 筛选字段定义（表单 ID → 接口字段名）────────────────
  // 字段名来自 trace.har 里 getPublishDataList 的真实请求体，后端只认这 17 个：
  //   compNum / batch / serverCodingList / serviceName / callerComponent /
  //   subscriberStatus / isChecked / pageSize / pageNum / isSendOutsideSystem /
  //   principal / principalName / serviceStatus / sysServeNoList / sysServeNo /
  //   deptId / implementationUnit
  // 之前填的是 provideSystemNumber / prodBatch / offerServerState / deptName 等
  // 响应体字段名，后端一律忽略，所以筛选全部失效。
  //
  // mode 决定这个条件怎么生效：
  //   'api'   → 只发给后端
  //   'both'  → 发给后端，同时前端再兜底过滤一次。
  //             原因：这些后端字段在真实数据里全是 null（serviceStatus / batch），
  //             发过去大概率被忽略；前端改用有值的同义字段补过滤
  //   'local' → 后端无对应字段，纯前端过滤
  const FIELDS = [
    { id: 'f_provideSystemNumber',  key: 'compNum',             mode: 'api'   },
    { id: 'f_prodBatch',            key: 'batch',               mode: 'both', label: '变更批次',
      local: ['sheetProductBatch', 'prodBatch', 'productBatch', 'offerVersionBatch'] },
    // multi：多选控件（#msel_sysServeNo），值走独立通道 —— collectApiBody 会跳过它，
    // 由 index.js 用实例的 getValues() 取（DOM 是 div，没有 .value 可读）。
    // 归属仍写在这里，是为了让字段顺序 / 标签只有一处定义。
    { id: 'msel_sysServeNo',        key: 'sysServeNo',          mode: 'api', multi: true },
    { id: 'f_serviceName',          key: 'serviceName',         mode: 'api'   },
    { id: 'f_interfaceCode',        key: 'serverCodingList',    mode: 'both', array: true, label: '接口编码',
      local: ['interfaceCode', 'serverCoding', 'sysEnName', 'sysServeEnName'] },
    { id: 'f_sendOutSide',          key: 'isSendOutsideSystem', mode: 'api'   },
    { id: 'f_principalName',        key: 'principalName',       mode: 'api'   },
    { id: 'f_serviceStatus',        key: 'serviceStatus',       mode: 'both', label: '服务状态',
      local: ['offerServerState', 'serviceStatus', 'status'] },
    { id: 'f_deptName',             key: 'deptId',              mode: 'both', exact: true, label: '部门名称',
      local: ['deptId'] },
    { id: 'f_productImplementUnit', key: 'implementationUnit',  mode: 'api'   },
    // range：起始 / 结束两个日期框（#f_changeTimeStart / #f_changeTimeEnd），
    // 后端无对应字段，纯前端按下标区间过滤 —— conds 里会带 to 表示区间终点。
    { id: 'f_changeTimeStart',      key: null,                  mode: 'local', date: true, range: true, label: '变更时间',
      local: ['offerEffectiveTime', 'effectiveTime'] },
  ];

  // ── 收集请求体时的默认值 ──────────────────────────────
  // ⚠️ 必须全字段发送，空值用 "" / [] 占位，一个都不能省。
  // 抓包里后端收到的就是完整的 17 个字段。早期版本「只发非空值」有两个后果：
  //   1. 本地代理的缓存 key = sha1(method + path + query + body)，
  //      body 字段个数不同 → 算出来的 key 也不同 → 缓存永远命中不了，
  //      离线模式直接 404，前端还把 404 显示成「接口地址不存在」（误导）。
  //   2. 与后端真实契约不一致，本身就是隐患。
  //
  // 其中 subscriberStatus / isChecked / principal / sysServeNoList 目前没有
  // 对应的 UI 控件，固定发空值，保持结构完整即可。
  const API_BODY_DEFAULTS = {
    compNum: '', batch: '', serverCodingList: [], serviceName: '',
    callerComponent: '', subscriberStatus: '', isChecked: '',
    isSendOutsideSystem: '', principal: '', principalName: '',
    serviceStatus: '', sysServeNoList: [], sysServeNo: '',
    deptId: '', implementationUnit: '',
  };

  /**
   * 行的稳定主键 —— 只能用它做去重 / 详情定位。
   *
   * 必须用 r.id：真实数据里同一个 serverCoding 可能存在多条合法记录，
   * 它们的 sysServeNo 不同，是不同服务。例如 2609 批次：
   *   PsnFaceImageUpload → E00301TP0050 与 E00301TP0051
   *   PsnInsuranceRecordInfoQuery → E00301BX004 与 E00301BX001
   * 早先用 serverCoding 去重会把后一条静默丢掉，用户看到的条数比后端返回的少。
   *
   * 仅当 id 缺失时才回退到编码组合（此时无法区分，宁可去重要保守）。
   */
  function rowKey(r) {
    if (!r) return '';
    if (r.id != null && r.id !== '') return 'id:' + r.id;
    const code = r.serverCoding || r.sysServeNo || '';
    return code ? 'code:' + code : '';
  }

  /** 将 [{key, value}] 转为 searchable-select 需要的 [{label, value}] */
  function deptsToOptions(depts) {
    return (depts || []).map((d) => ({ label: d.value, value: d.key }));
  }

  /**
   * 批次下拉的 value 是 "2609pc" 这类代码，而请求体与行数据用的都是 label（"2609批次"）。
   * 批次选项（AppServices.batchOptions）只在批次列表加载成功时才有，缺失时解析不出 label。
   *
   * 原实现在解析失败时直接 `if (!val) return`，后果是：批次条件既没发给后端、
   * 也没进入前端兜底过滤，而必填校验用的是 getValue() 照样通过 ——
   * 用户以为查的是某批次，实际拿到的是全批次数据。
   * 所以这里把「解析失败」显式暴露出来（ok:false），由调用方阻断查询。
   */
  function resolveBatchLabel(value, options) {
    if (!value) return { value: '', label: '', ok: true };
    const opt = (options || []).find((o) => o.value === value);
    if (opt) return { value: value, label: opt.label, ok: true };
    return { value: value, label: '', ok: false };   // 选了东西但解析不出 label
  }

  /**
   * 部门条件怎么生效，取决于下拉是否建起来了：
   *   · 建起来了 → value 就是 deptId，可以精确发给后端
   *   · 没建起来（接口挂了，用户手输的是中文名）→ 不能把中文名当 deptId 发给后端，
   *     改为前端按 deptName 模糊过滤
   *
   * 入参语义（与 index.js 的 getDeptCondition 对齐）：
   *   hasInstance=true 时，deptId 来自 select.getValue()（精确 id），
   *                   freeText 来自 select.getFreeText()（手输未选的中文名）。
   *   hasInstance=false 时，deptId 实为 input.value（中文名），走前端模糊过滤。
   */
  function resolveDeptCondition(opts) {
    const deptId = (opts && opts.deptId) || '';
    const freeText = (opts && opts.freeText) || '';
    const hasInstance = !!(opts && opts.hasInstance);
    if (hasInstance) {
      if (deptId) return { api: deptId, local: null };
      // 下拉建起来了但用户没选中（只是手输了未选）：getValue() 拿不到，
      // 但 searchable-select 内部记着 freeText。把它退回成「按部门名前端模糊过滤」，
      // 与下拉未建时的降级分支行为一致 —— 否则手输条件会被静默丢弃，
      // 用户以为按部门查了，实际拿到的是全部门数据。
      if (freeText) return { api: null, local: { keys: ['deptName'], value: freeText, exact: false } };
      return null;
    }
    const txt = deptId;
    return txt ? { api: null, local: { keys: ['deptName'], value: txt, exact: false } } : null;
  }

  /**
   * 前端兜底过滤：后端不认的字段（或后端字段恒为 null 的）在这里补一刀。
   * 若后端本来就正确过滤了，这一步是幂等的，不会多筛。
   */
  function applyLocalFilters(rows, conds) {
    conds = conds || [];
    if (!conds.length) return rows;
    // 守卫：rows 为 null/undefined、或数组里混入非对象（如 null）的脏数据时，
    // 不抛 TypeError，直接当成「不满足任何条件」过滤掉（视为无数据，不造假）。
    return (rows || []).filter((row) => {
      if (!row || typeof row !== 'object') return false;
      return conds.every(({ keys, value, exact, date, to, range }) => {
        const needle = String(value == null ? '' : value).toLowerCase();
        // 区间条件（变更时间起止）：值本身按 YYYY-MM-DD 比大小，起止都可为空（半开区间）
        const from = String(value == null ? '' : value).slice(0, 10);
        const until = String(to == null ? '' : to).slice(0, 10);
        return keys.some((k) => {
          const v = row[k];
          if (v == null || v === '') return false;
          const s = String(v);
          if (date && range) {
            const day = s.slice(0, 10);
            if (from && day < from) return false;
            if (until && day > until) return false;
            return true;
          }
          if (date)  return s.slice(0, 10) === needle;      // 变更时间按 YYYY-MM-DD 比对
          if (exact) return s === value;                    // 部门用 deptId 精确匹配
          return s.toLowerCase().includes(needle);
        });
      });
    });
  }

  /**
   * 状态→{cls,text} 映射（供徽章渲染使用，无 DOM）。
   * 当 val 为假时返回未设置兜底。
   */
  function stateBadgeInfo(val) {
    if (!val) return { cls: 'b-off', text: '未设置' };
    const map = {
      '编辑中':           ['chip-edit',    '编辑中'],
      '功能测试基线':     ['chip-ext',     '功能测试基线'],
      '开发基线':         ['chip-own',     '开发基线'],
      '正式版基线':       ['b-run',        '正式版基线'],
      '运行中':           ['b-run',        '运行中'],
      '已暂停':           ['b-pause',      '已暂停'],
      '已停止':           ['b-off',        '已停止'],
      '下线':             ['b-off',        '下线'],   // 2026-09-21 用户告知的后端口径
      '已下线':           ['b-off',        '已下线'], // 兼容旧口径
    };
    const entry = map[val] || ['b-off', val];
    return { cls: entry[0], text: entry[1] };
  }

  /**
   * 按状态分类计数。
   * @returns {{counts:object, published:number, pending:number, failed:number}}
   */
  function countByStatus(rows) {
    const counts = {};
    // 守卫：rows 为 null 或混入 null 元素时不抛，直接跳过脏行（视为无数据）。
    (rows || []).forEach((r) => {
      if (!r || typeof r !== 'object') return;
      const s = r.offerServerState || '未设置';
      counts[s] = (counts[s] || 0) + 1;
    });
    return {
      counts,
      published: counts['正式版基线'] || counts['运行中'] || 0,
      pending: (counts['功能测试基线'] || 0) + (counts['开发基线'] || 0) + (counts['编辑中'] || 0),
      // 2026-09-21：后端口径是「下线」，旧的「已下线」保留兼容（两边都算失败）
      failed: (counts['下线'] || 0) + (counts['已下线'] || 0),
    };
  }

  /**
   * 订阅统计。
   * @param {Array} rows
   * @param {(code:string)=>boolean} [isSubscribed] 给定编码返回是否已订阅；
   *        不传则全部按未订阅计。编码优先取 serverCoding，回退 sysServeNo。
   */
  function subscribeStats(rows, isSubscribed) {
    rows = rows || [];
    const subscribed = rows.filter((r) => {
      const code = r.serverCoding || r.sysServeNo;
      return isSubscribed ? !!isSubscribed(code) : false;
    }).length;
    const unsubscribed = rows.length - subscribed;
    const rate = rows.length > 0 ? Math.round((subscribed / rows.length) * 100) : 0;
    return { subscribed, unsubscribed, rate };
  }

  /** 按页码顺序把各页行拼成一条数组（并发完成顺序不确定，不能边拉边 concat —— 既乱序又 O(n²)） */
  function flattenPages(pages, byPage) {
    const out = [];
    // byPage 由并发取数层构造，取数整体失败时会是 null；普通对象（无 .get）也要兜住。
    // 少了这层守卫，一次失败就把整页查询拖成 TypeError。
    const get = (byPage && typeof byPage.get === 'function')
      ? (p) => byPage.get(p)
      : (p) => (byPage ? byPage[p] : null);
    (pages || []).forEach((p) => {
      const rows = get(p);
      if (rows) out.push(...rows);
    });
    return out;
  }

  /**
   * 去重：用 keyFn 生成稳定主键，重复的丢掉。
   * @param {Array} rows
   * @param {(r:any)=>string} [keyFn] 默认 rowKey
   */
  function dedupeByKey(rows, keyFn) {
    keyFn = keyFn || rowKey;
    const seen = new Set();
    const out = [];
    (rows || []).forEach((r) => {
      const key = keyFn(r);
      if (key && seen.has(key)) return;
      if (key) seen.add(key);
      out.push(r);
    });
    return out;
  }

  /**
   * 分页数：ceil(total/size)，并对上限封顶。
   * @param {number} total 后端 total
   * @param {number} size 每页条数（如 FETCH_SIZE=200）
   * @param {number} [maxPages] 页数上限（如 MAX_FETCH_PAGES=20）；不传则不封顶
   */
  function pageCount(total, size, maxPages) {
    const sz = size > 0 ? size : 1;
    // total 来自后端报文，出现负数（脏数据/接口异常）时不能给出负页数——
    // 下游的「第 X / -10 页」与跳页夹取都会跟着错，所以这里 clamp 到 ≥ 0。
    const totalPages = Math.max(0, Math.ceil((Number(total) || 0) / sz));
    return (maxPages != null) ? Math.min(totalPages, maxPages) : totalPages;
  }

  /**
   * 生成页码数组（含端点）。
   * @param {number} count 最大页码
   * @param {number} [start=1] 起始页码
   */
  function pageNumbers(count, start) {
    const s = start || 1;
    const out = [];
    for (let p = s; p <= count; p++) out.push(p);
    return out;
  }

  /**
   * 空结果文案决策。
   * @param {{replayLoose:boolean, dropped:number, droppedDup:number}} o
   */
  function emptyHint(o) {
    o = o || {};
    const replayLoose = !!o.replayLoose;
    const dropped = o.dropped || 0;
    const droppedDup = o.droppedDup || 0;
    // 宽松回放时数据来自旧录制，跟当前筛选对不上是必然结果，
    // 这时提示「不满足筛选条件」会误导用户去调筛选条件，要单独说明。
    if (replayLoose && (dropped > 0 || droppedDup > 0))
      return '本地代理回放的是旧录制数据，与当前查询条件不符，已被前端过滤。请连内网用当前条件重新请求一次以重新录制';
    if (dropped > 0 || droppedDup > 0)
      // 口径（2026-09-19 核）：这些条件作用在**已拉全并去重**的数据上，之后才前端分页，
      // 所以不是「本页」被筛掉 —— 写「本页」会让人以为是分页问题、反复翻页。
      return '已加载的数据里没有满足筛选条件的记录（部分条件后端未支持，由前端在全量结果上过滤）';
    return '未找到匹配的数据，请尝试调整筛选条件';
  }

  /**
   * 「被前端过滤掉 N 条」的提示文案（对应原 1007–1010 行的 ℹ️ toast）。
   * @param {Array} localConds collectLocalFilters 返回的条件
   * @param {number} dropped 被过滤掉的条数
   */
  function droppedFilterHint(localConds, dropped) {
    const names = (localConds || []).map((c) => c.label).filter(Boolean).join('、');
    return `ℹ️ 过滤掉 ${dropped} 条不满足「${names}」的数据（后端未支持该字段，在前端按全量结果筛）`;
  }

  /**
   * 行字段兜底口径：从真实返回数据里提取展示字段，缺失时回退。
   * 不处理「是否已核对 / 订阅标记」这类需要外部状态或生成 HTML 的部分
   * （见 isCheckedVal / 视图层 renderRows）。
   */
  function normalizeRow(r) {
    r = r || {};
    const serverCoding = r.serverCoding || r.sysServeNo || '—';
    const serviceName  = r.serviceName || '—';
    const interfaceCode = r.interfaceCode || r.sysServeEnName || '';
    const compNum      = r.sysServeNo || r.serverCoding || '—';
    const codeAndInterface = interfaceCode && interfaceCode !== serverCoding
      ? `${serverCoding} / ${interfaceCode}`
      : serverCoding;
    const batch        = r.sheetProductBatch || r.prodBatch || r.productBatch || '—';
    const serviceStatus = r.offerServerState || r.status || '—';
    // 根据真实接口数据：principal/principalName/implementationUnit 全为空
    // 所以用 deptName（部门名称）替代负责人列
    const deptName = r.deptName || '—';
    return {
      serverCoding, serviceName, interfaceCode, compNum,
      codeAndInterface, batch, serviceStatus, deptName,
    };
  }

  /** 是否已核对：isChecked === '1' 或 1 视为「是」 */
  function isCheckedVal(r) {
    return r != null && (r.isChecked === '1' || r.isChecked === 1);
  }

  /**
   * 详情/订阅按钮用的「全量偏移 + 页内偏移」绝对下标。
   * 用页内 i 会导致从第 2 页开始点详情看到的是别人家的数据。
   */
  function absIndex(pageNum, pageSize, i) {
    return (pageNum - 1) * pageSize + i;
  }

  window.PublishModel = Object.freeze({
    FIELDS,
    API_BODY_DEFAULTS,
    rowKey,
    deptsToOptions,
    resolveBatchLabel,
    resolveDeptCondition,
    applyLocalFilters,
    stateBadgeInfo,
    countByStatus,
    subscribeStats,
    flattenPages,
    dedupeByKey,
    pageCount,
    pageNumbers,
    emptyHint,
    droppedFilterHint,
    normalizeRow,
    isCheckedVal,
    absIndex,
  });
})();
