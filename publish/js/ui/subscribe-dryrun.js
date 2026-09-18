/* ============================================================
   订阅报文预演台（DRY RUN）—— window.SubscribeDryRun
   ------------------------------------------------------------
   为什么需要：真实订阅一旦成功就写进生产库，无法反复试。而在内网/离线环境里
   又没法靠后端报错来反推「我这个表单到底会发出什么报文」。这个模块用**真实的
   组包与发送函数**跑一遍订阅流程，但在传输层（window.API.call + window.fetch）
   双重拦截并回放假响应，因此：

     · 走的是真代码：ServiceApi.subscribeWithForm（setSubcription 报文）、
       ToolApi.submitSubscriptionReview（评委报文）、
       SubscribeModel.validateSubscribe / validateJudgeSubmit（必填与格式校验）
     · 一个字节都不出浏览器：API 层拦一次，fetch 层再拦一次
       （全项目请求都走 api-client 的 fetch，无 XHR）
     · 控制台打印：完整报文 JSON + 所有非空字段（按报文键序）+ 空值字段清单
       + 关键字段来源 + 校验结论，便于逐字段对照抓包

   用法 A（推荐）：**点击驱动** —— 照常点页面上的「订阅」→ 弹窗 → 「确 认」，写请求被拦下并打印：
     ① 地址栏加 ?dryrun=1 打开页面（或控制台 SubscribeDryRun.enable() 一次）
     ② 点结果行「订阅」→ 填表 → 点「确 认」→ 控制台自动打印两个报文与字段明细
        （「关联文档」可不选：预演下这条必填不拦，离线取不到文档列表也试得动）
     ③ 关闭：点右下角浮标，或 SubscribeDryRun.disable()（会撤销预演产生的本地「已订阅」标记）
     可选：enable({ fail: 'subscribe' | 'review' }) 模拟写入失败，观察失败链路
     注意：只拦写接口，**读接口照常发真实请求**（页面其它功能不受影响）

   用法 B（辅助）：脚本驱动
     SubscribeDryRun.run()                 // 用当前订阅弹窗里的表单预演（不点按钮）
     SubscribeDryRun.run({ force: true })  // 校验不过也把整条链路构造出来看报文
     SubscribeDryRun.run({ row, form, judges, defaultsFetched })   // 显式注入
     SubscribeDryRun.scenarios()           // 跑内置场景矩阵（必填缺失/字段为空/格式错误…）
     SubscribeDryRun.dump(body, '标签')     // 只打印一份报文

   依赖：subscribe-model.js / service-api.js / tool-api.js / subscribe-dialog.js
        （一律「调用时才取 window.*」，脚本顺序无关）
============================================================ */
(function () {
  'use strict';

  const LINE = '═'.repeat(78);
  const SUB = '─'.repeat(78);

  const SM = () => window.SubscribeModel || {};
  const SA = () => window.ServiceApi || {};
  const TA = () => window.ToolApi || {};
  const DIALOG = () => window.SubscribeDialog || {};

  // ═══════════════════════════════════════════════════
  // 取值判定 / 格式化（纯函数，单测直接断言）
  // ═══════════════════════════════════════════════════

  /**
   * 「空值」判定 —— 这是打印分组的口径，必须与「后端会不会当成没填」一致：
   *   null / undefined、「只含空白的字符串」、空数组 都算空；
   *   数字 0、布尔 false 算**非空**（它们是有效取值，不能跟空串混为一谈）。
   */
  function isEmptyValue(v) {
    if (v === null || v === undefined) return true;
    if (typeof v === 'string') return v.trim() === '';
    if (Array.isArray(v)) return v.length === 0;
    return false;
  }

  /** 打印用的取值文本：字符串带引号（能看出前后空格），过长截断 */
  function formatValue(v, max) {
    const limit = max || 46;
    let s;
    if (typeof v === 'string') s = JSON.stringify(v);
    else if (v === undefined) s = 'undefined';
    else if (v === null) s = 'null';
    else if (Array.isArray(v) || typeof v === 'object') s = JSON.stringify(v);
    else s = String(v);
    if (s.length > limit) s = s.slice(0, limit - 1) + '…';
    return s;
  }

  /** 对象 → 按原键序拆成 { keys, nonEmpty, empty, total } */
  function describeObject(obj) {
    const keys = Object.keys(obj || {});
    const nonEmpty = [];
    const empty = [];
    keys.forEach((k) => { (isEmptyValue(obj[k]) ? empty : nonEmpty).push(k); });
    return { keys, nonEmpty, empty, total: keys.length };
  }

  /**
   * 报文 → 结构描述（纯函数；打印与断言共用同一份口径）。
   * 顶层每个键会按 kind 分类：object（逐字段拆非空/空）/ array（逐元素拆）/ scalar。
   * **顺序 = Object.keys 的顺序 = buildSubscribeBody 的构造顺序 = JSON 里的顺序**，
   * 所以打印出来的编号可以直接跟抓包逐个对照。
   */
  function describe(body) {
    const src = body || {};
    const sections = Object.keys(src).map((key) => {
      const v = src[key];
      if (Array.isArray(v)) {
        return {
          key,
          kind: 'array',
          count: v.length,
          allEmpty: v.length === 0,
          items: v.map((it) => (it && typeof it === 'object' ? describeObject(it) : { scalar: it })),
        };
      }
      if (v && typeof v === 'object') {
        const d = describeObject(v);
        return {
          key,
          kind: 'object',
          count: d.total,
          keys: d.keys,
          nonEmpty: d.nonEmpty,
          emptyKeys: d.empty,
          allEmpty: d.total > 0 && d.nonEmpty.length === 0,
        };
      }
      return { key, kind: 'scalar', empty: isEmptyValue(v), count: 1 };
    });
    return { topKeys: Object.keys(src), sections };
  }

  // ═══════════════════════════════════════════════════
  // 关键字段来源（人工标注，只标这些；其余字段的来源见 service-api.js 构造代码）
  // ═══════════════════════════════════════════════════
  const FIELD_SOURCES = {
    id: 'row.id',
    publishId: 'row.publishId',
    callerComponent: 'form.callerSystem（row 兜底）',
    sysType: 'row.sysType',
    serveTyep: 'row.serveTyep || row.serviceType',
    serverCoding: 'row.serverCoding || row.sysServeNo',
    serverVsn: "常量 'V1'（组包末尾覆盖）",
    serverNo: 'row.serverNo || row.taskNo || form.taskNo（新增兜底）',
    prodTaskNo: 'row.prodTaskNo || row.taskNo || row.serverNo || form.taskNo',
    prodBatch: 'row.prodBatch',
    prodBatchList: 'row.prodBatchList || row.prodBatch（抓包口径）',
    sysServeNo: 'providerSysServeNo = row.sysServeNo || row.serviceId || serverCoding',
    serviceId: '同上（providerSysServeNo）',
    serviceNumber: '同上（providerSysServeNo）',
    targetServeNo: '同上（providerSysServeNo）',
    interfaceCode: 'serverCoding',
    sysEnName: 'serverCoding',
    sysServeEnName: 'serverCoding',
    prodSysServeNoList: 'form.callerServiceNo || 派生（调用方系统编号 + 行编码尾号 TOxxxx）',
    prodTPSPeak: 'row.prodTPSPeak || form.perfPeak.tps',
    serviceName: 'form.serviceCnName',
    serviceFunctionDescription: 'form.serviceCnName',
    remark: 'form.remark',
    isChecked: "协议常量 '1'（抓包）",
    isDelete: "协议常量 '1'（抓包）",
    reviewStatus: "协议常量 '03'（抓包）",
    isBackup: "row.isBackup || 常量 '否'",
    provideComponentName: 'row.provideComponentName || row.assemblyName',
    provideSystemNumber: 'row.provideSystemNumber || row.assemblyNo',
    assemblyNo: 'row.assemblyNo || row.provideSystemNumber',
    assemblyName: 'row.assemblyName || row.provideComponentName',
    deptId: 'row.deptId',
    deptName: 'row.deptName',
    serviceType: 'row.serviceType',
    serviceVersion: "row.serviceVersion || 常量 'V1'",
    offerServerState: 'row.offerServerState',
    offerEffectiveTime: 'row.offerEffectiveTime',
  };

  // ═══════════════════════════════════════════════════
  // 传输层拦截（预演的核心安全保证）
  // ═══════════════════════════════════════════════════

  const FAKE_JSON = { code: 200, msg: '操作成功（预演桩，未真实发送）', data: null };

  /**
   * 在「API 层 + fetch 层」同时拦截，跑一段会发请求的逻辑。
   * @returns {Promise<{result:any, captured:Array, fetchCalls:number, restored:boolean}>}
   *          captured = [{ name, method, path, body, query }]，按发送先后排列
   */
  async function withStubbedTransport(fn) {
    const captured = [];
    let fetchCalls = 0;
    const realCall = window.API && window.API.call;
    const realFetch = window.fetch;
    let restored = false;

    const fakeResponse = () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => FAKE_JSON,
    });
    // ① API 层：所有接口模块都经 api-client 的 requester → window.API.call（延迟取值）
    if (window.API && typeof window.API.call === 'function') {
      window.API.call = async (path, opts) => {
        captured.push({
          name: (path || '').split('/').pop() || String(path),
          method: (opts && opts.method) || 'POST',
          path: String(path || ''),
          body: opts && opts.body,
          query: opts && opts.query,
        });
        return fakeResponse();
      };
    }
    // ② fetch 层：兜住任何绕过 API 层的直连（项目内无 XHR，fetch 是唯一出口）
    try {
      window.fetch = async (url) => {
        fetchCalls += 1;
        captured.push({
          name: (String(url).split('/').pop() || '').split('?')[0] || String(url),
          method: 'FETCH(绕过 API 层)',
          path: String(url),
          body: null,
          query: null,
        });
        return fakeResponse();
      };
    } catch (_) { /* 仅当宿主禁用 fetch 重写时忽略 */ }

    let result;
    try {
      result = await fn();
    } finally {
      if (realCall) window.API.call = realCall;
      if (realFetch) window.fetch = realFetch; else { try { delete window.fetch; } catch (_) { /* ignore */ } }
      restored = true;
    }
    return { result, captured, fetchCalls, restored };
  }

  // ═══════════════════════════════════════════════════
  // 打印
  // ═══════════════════════════════════════════════════

  const pad = (s, n) => {
    const str = String(s);
    // 中文按 2 个字符宽度估算，避免列错位
    let w = 0;
    for (const ch of str) w += /[\u4e00-\u9fa5\uff00-\uffef]/.test(ch) ? 2 : 1;
    return str + ' '.repeat(Math.max(0, n - w));
  };

  function printValidate(title, v) {
    console.log(SUB);
    console.log(title);
    if (!v) { console.log('  （未执行）'); return; }
    if (v.ok) { console.log('  结果：✅ 通过' + (v.serverCoding ? `（serverCoding=${v.serverCoding}）` : '')); return; }
    console.log(`  结果：⛔ 拦下   code=${v.code}${v.msg ? '' : '（静默返回，无文案）'}`);
    if (v.msg) console.log(`  文案：${v.msg}`);
    if (v.focus) console.log(`  焦点：${v.focus}   （duration=${v.duration}ms）`);
    if (v.publishId) console.log(`  publishId：${v.publishId}`);
  }

  /** 打印一份报文：顶层结构 → 每个对象段的非空字段（按键序）→ 空值字段 → 完整 JSON */
  function printBody(req, index, total) {
    const body = req.body;
    console.log(SUB);
    console.log(`【请求 ${index}/${total}】${req.method} ${req.path}`);
    if (req.query) console.log(`  query：${JSON.stringify(req.query)}`);
    if (body === undefined || body === null) {
      console.log('  （无请求体：该接口为纯查询参数形态，或本次未构造报文）');
      return;
    }
    const d = describe(body);
    console.log(`  顶层键（报文键序）：${d.topKeys.join('、')}`);
    d.sections.forEach((sec) => {
      if (sec.kind === 'object') {
        console.log(`  ── ${sec.key}：${sec.count} 个字段 → 非空 ${sec.nonEmpty.length} / 空 ${sec.emptyKeys.length}（按报文键序）`);
        sec.nonEmpty.forEach((k, i) => {
          const src = FIELD_SOURCES[k] ? `   ← ${FIELD_SOURCES[k]}` : '';
          console.log(`   ${pad(String(i + 1), 3)} ${pad(k, 30)} ${pad(formatValue(body[sec.key][k], 46), 48)}${src}`);
        });
        if (sec.emptyKeys.length) {
          console.log(`  ── ${sec.key} 的空值字段（${sec.emptyKeys.length} 个，未发送有效值；每行 8 个）：`);
          for (let i = 0; i < sec.emptyKeys.length; i += 8) {
            console.log(`     ${sec.emptyKeys.slice(i, i + 8).join('、')}`);
          }
        }
      } else if (sec.kind === 'array') {
        console.log(`  ── ${sec.key}：${sec.count} 条`);
        sec.items.forEach((item, i) => {
          if (item.scalar !== undefined) {
            console.log(`   [${i + 1}] ${formatValue(item.scalar, 60)}`);
            return;
          }
          const pairs = item.keys.map((k) => {
            const val = (Array.isArray(body[sec.key]) ? body[sec.key][i] : {})[k];
            return `${k}=${formatValue(val, 26)}${item.nonEmpty.includes(k) ? '' : '(空)'}`;
          });
          console.log(`   [${i + 1}] ${pairs.join('  ')}`);
          if (item.empty.length) console.log(`        其中空值键：${item.empty.join('、')}`);
        });
        if (sec.allEmpty) console.log('   （空数组）');
      } else {
        console.log(`  ── ${sec.key} = ${formatValue(body[sec.key], 60)}${FIELD_SOURCES[sec.key] ? `   ← ${FIELD_SOURCES[sec.key]}` : ''}`);
      }
    });
    console.log('  ── 完整报文（可整体复制；字段顺序与 JSON 一致）：');
    console.log(JSON.stringify(body, null, 2));
  }

  /** 只打印一份报文（不跑流程） */
  function dump(body, label) {
    printBody({ method: 'POST', path: label || '(未知端点)', body }, 1, 1);
    return describe(body);
  }

  // ═══════════════════════════════════════════════════
  // 主流程：预演一次「确认订阅」
  // ═══════════════════════════════════════════════════

  /** 内置示例（弹窗没打开时的兜底，字段值都来自抓包样本形状） */
  function sampleSource() {
    return {
      from: '内置示例（未读取到订阅弹窗）',
      row: {
        id: 'PUB-DEMO-1', publishId: 'PUB-DEMO-1',
        serverCoding: 'E00301TO1197', sysServeNo: 'E00301TO1197',
        provideComponentName: '互联网金融服务平台', provideSystemNumber: 'E00301',
        assemblyNo: 'E00301', assemblyName: '互联网金融服务平台',
        prodBatch: '2611批次', prodBatchList: '2611批次',
        serverNo: 'M-202607-11289', prodTaskNo: 'M-202607-11289',
        deptId: 'K4229', deptName: '中国银行软件中心（深圳）开发三部',
        isBackup: '否',
      },
      form: {
        callerSystem: 'E00406', callerServiceNo: 'E00406TO1197',
        relDocIds: 'doc-demo-1', relDocNames: '某系统细化设计说明书',
        relDocDetails: [{
          batchNum: '2611', docName: '某系统细化设计说明书', docNo: 'BOCNETC-O-MAPSN_CD_84',
          label: 'BOCNETC-O-MAPSN_CD_84-某系统细化设计说明书', templateCode: '16', docInstId: 'doc-demo-1',
        }],
        perfPeak: { tps: '5' }, taskNo: 'T-2026-001',
      },
      judges: [{ role: '调用方产品负责人', empNo: '6464402', name: '吴树海', dept: '中国银行软件中心（深圳）开发三部', deptId: 'K4229' }],
      defaultsFetched: false,
    };
  }

  /**
   * 取本次要预演的输入：显式传入 > 当前弹窗 > 内置示例。
   * 注意用 hasOwnProperty 判断「有没有传 row」而不是真假判断 ——
   * 显式传 `row: null` 是「无行数据」这个场景，不能被当成没传而回落到示例。
   */
  function resolveSource(opts) {
    const explicit = !!(opts && Object.prototype.hasOwnProperty.call(opts, 'row'));
    if (explicit) {
      return {
        from: '显式传入的 row / form',
        row: opts.row || null,
        form: opts.form || {},
        judges: opts.judges || [],
        defaultsFetched: !!opts.defaultsFetched,
      };
    }
    const snap = typeof DIALOG().snapshot === 'function' ? DIALOG().snapshot() : null;
    if (snap && snap.row) {
      return {
        from: snap.open ? '当前订阅弹窗（已打开）' : '当前订阅弹窗（已关闭但行数据还在）',
        row: snap.row,
        form: snap.form || {},
        judges: snap.judges || [],
        defaultsFetched: !!snap.defaultsFetched,
      };
    }
    return sampleSource();
  }

  /**
   * 预演一次「确认订阅」：校验 → 组包 → （拦截式）发送 → 打印
   * @param {{row?:object, form?:object, judges?:Array, defaultsFetched?:boolean,
   *          force?:boolean, quiet?:boolean, isSubscribed?:Function}} [opts]
   * @returns {Promise<object>} 结构化结果（单测断言用；quiet=true 时不打印）
   */
  async function run(opts) {
    const o = opts || {};
    const quiet = !!o.quiet;
    const src = resolveSource(o);
    const SMx = SM();

    // ── 校验（与 confirmSubscribe 同一函数、同一入参口径）──
    const isSubscribed = typeof o.isSubscribed === 'function'
      ? o.isSubscribed
      : (typeof window.SubscribeManager !== 'undefined' && window.SubscribeManager
        && typeof window.SubscribeManager.isSubscribed === 'function'
        ? (code) => window.SubscribeManager.isSubscribed(code)
        : null);
    // 预演模式（点击驱动的 enable()）默认**放开「关联文档」必填** —— 离线/内网拿不到
    // 文档列表时用户无从选择，拦了整条链路就试不动。显式传 dryRun 可覆盖。
    const dryRun = o.dryRun !== undefined ? !!o.dryRun : isEnabled();
    const docSkipped = dryRun && !String(src.form.relDocIds || '').trim();
    const validate = typeof SMx.validateSubscribe === 'function'
      ? SMx.validateSubscribe(src.row, src.form, isSubscribed, {
        judges: src.judges, defaultsFetched: src.defaultsFetched, dryRun,
      })
      : { ok: false, code: 'no-model', msg: '⚠️ SubscribeModel 未加载', duration: 0 };
    const judgeValidate = typeof SMx.validateJudgeSubmit === 'function'
      ? SMx.validateJudgeSubmit(src.row, src.judges)
      : { ok: true, code: '', msg: '', publishId: '' };

    if (!quiet) {
      const row = src.row || {};
      const form = src.form || {};
      console.log(LINE);
      console.log('订阅报文预演（DRY RUN）—— 一个字节都不会发出浏览器');
      console.log(`输入来源：${src.from}`);
      console.log(`时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`);
      console.log(`行数据：serverCoding=${row.serverCoding || row.sysServeNo || '(空)'}  publishId=${row.publishId || row.id || '(空)'}`);
      console.log(`表单：调用方系统=${form.callerSystem || '(空)'}  任务编号=${form.taskNo || '(空)'}  TPS=${(form.perfPeak || {}).tps || '(空)'}  文档=${(String(form.relDocIds || '').split(',').filter(Boolean)).length} 个  评委=${src.judges.length} 条${src.defaultsFetched ? '（已拉取默认评委）' : ''}`);
      console.log('校验顺序（来源：subscribe-model.js validateSubscribe 的实现顺序）：行 → 服务编码 → 是否已订阅 → 调用方系统 → 关联文档 → 服务编号 → TPS(峰值) → 评委信息 → 任务编号');
      printValidate('【一】确认订阅前的必填/格式校验（subscribe-model.js validateSubscribe）', validate);
      if (docSkipped) {
        console.log('   ⓘ 预演模式：未选关联文档 → 该校验已跳过（离线拿不到文档列表时也能把流程试通）；报文里 documents 会是空数组');
      }
      printValidate('【二】评委提交校验（validateJudgeSubmit）', src.judges.length ? judgeValidate : { ok: true, code: '', msg: '（无评委行，与线上一致：不提交评委）' });
    }

    const out = {
      from: src.from,
      dryRun,
      docSkipped,
      validate,
      judgeValidate,
      requests: [],
      fetchCalls: 0,
      restored: false,
      skipped: null,
      ok: false,
    };

    if (!validate.ok && !o.force) {
      out.skipped = '前端会拦下，未构造报文（需要看报文可用 { force: true }）';
      if (!quiet) {
        console.log(SUB);
        console.log(`⛔ ${out.skipped}`);
        console.log(LINE);
      }
      return out;
    }
    if (!validate.ok && o.force && !quiet) {
      console.log(SUB);
      console.log('⚠️ 校验未通过，但因 force=true 仍继续构造报文（仅用于观察报文，真实提交会被前端拦下）');
    }

    // ── 组包 + 拦截式「发送」（真实函数，只换掉传输层）──
    const judged = src.judges.filter((j) => j && (j.empNo || j.name));
    const derived = typeof SMx.deriveCallerServiceNo === 'function'
      ? SMx.deriveCallerServiceNo(src.form.callerSystem, src.row.sysServeNo || src.row.serverCoding)
      : '';
    const prodSysServeNoList = src.form.callerServiceNo
      ? [src.form.callerServiceNo]
      : (derived ? [derived] : []);

    const transport = await withStubbedTransport(async () => {
      const results = [];
      if (SA() && typeof SA().subscribeWithForm === 'function') {
        results.push({ step: 'setSubcription', r: await SA().subscribeWithForm(src.row, src.form) });
      } else {
        results.push({ step: 'setSubcription', r: { ok: false, error: 'ServiceApi 未加载' } });
      }
      if (judged.length && TA() && typeof TA().submitSubscriptionReview === 'function') {
        results.push({
          step: 'subscriptionReview',
          r: await TA().submitSubscriptionReview({
            publishId: judgeValidate.publishId || src.row.publishId || src.row.id || '',
            prodSysServeNoList,
            judgeInfoList: typeof SMx.toJudgeInfoList === 'function' ? SMx.toJudgeInfoList(judged) : [],
          }),
        });
      }
      return results;
    });

    out.requests = transport.captured;
    out.fetchCalls = transport.fetchCalls;
    out.restored = transport.restored;
    out.steps = transport.result;

    if (!quiet) {
      if (!transport.captured.length) {
        console.log(SUB);
        console.log('ℹ️ 没有捕获到请求：可能是相关接口未配置（endpoint 为空 → 只做本地处理），或评委为空时本就不发评委报文。');
        console.log(`   各步骤结果：${JSON.stringify(transport.result)}`);
      } else {
        transport.captured.forEach((req, i) => printBody(req, i + 1, transport.captured.length));
        console.log(SUB);
        console.log('【三】发送顺序（与抓包一致）');
        console.log(`  ${transport.captured.map((r, i) => `${i + 1}. ${r.name}`).join('  →  ')}`);
        console.log('  （真实链路：点「确认」先发 setSubcription，成功后再发 subscriptionReview；评委失败会记编码只补交评委）');
      }
      console.log(SUB);
      console.log('【四】安全检查');
      console.log(`  API 层拦截（window.API.call）：${transport.captured.filter((r) => !/^FETCH/.test(r.method)).length} 次（已回放假 200 响应）`);
      console.log(`  fetch 层调用：${transport.fetchCalls} 次（项目全部请求走 fetch，两层都拦 → 不可能发出真实请求）`);
      console.log(`  传输层已还原：${transport.restored ? '是' : '否（异常路径，请刷新页面）'}`);
      console.log(LINE);
    }

    out.ok = transport.captured.length > 0 && transport.fetchCalls === 0;
    return out;
  }

  // ═══════════════════════════════════════════════════
  // 点击驱动的预演模式（enable / disable）—— 主用法
  // ------------------------------------------------------------
  // 开启后**照常点页面上的「订阅」→ 弹窗 → 「确 认」**，写请求在传输层被拦下并打印，
  // 读接口一律放行（页面其它功能不受影响）。弹窗会像真订阅成功那样关掉、列表会刷新，
  // 所以整条交互链路（校验 → 订阅 → 评委 → 本地标记 → 关闭）都能看到。
  //
  // 开启方式：
  //   · 页面地址加 ?dryrun=1（加载即开启）
  //   · 控制台 SubscribeDryRun.enable()
  // 关闭方式：点右下角浮标，或 SubscribeDryRun.disable()（会撤销预演产生的本地订阅标记）
  // ═══════════════════════════════════════════════════

  let MODE = null;
  const CLICK_GAP = 1500;   // 两个写请求间隔小于它 = 同一次点击（用于把「一次确认」的两个报文归组）

  /**
   * 定时器取用：优先 window.setTimeout，其次裸 setTimeout，都没有就直接执行。
   * 为什么要写这层：单测的 harness 用 `new Function` 执行页面脚本，未列入形参的全局才回落到 Node 全局 ——
   * 而 `setTimeout` 恰好是列进去的形参，测试不注入时它是 undefined，裸调会抛
   * 「setTimeout is not a function」（与浏览器无关，纯测试环境问题）。
   */
  function later(fn, ms) {
    const t = (typeof window !== 'undefined' && typeof window.setTimeout === 'function' && window.setTimeout)
      || (typeof setTimeout === 'function' && setTimeout);
    if (!t) { fn(); return null; }
    return t(fn, ms);
  }
  function cancelLater(id) {
    if (id == null) return;
    const c = (typeof window !== 'undefined' && typeof window.clearTimeout === 'function' && window.clearTimeout)
      || (typeof clearTimeout === 'function' && clearTimeout);
    if (c) c(id);
  }

  /**
   * 可拦截的写接口白名单 —— **从各接口模块现取的 endpoints 配置**，不写死路径。
   * 为什么不写死：`/itamp-tool/intfcMgmt/conditions/subscribe` 是**读**接口（批次/系统下拉），
   * 按名字含 subscribe 就拦会把页面数据源一起拦掉。
   */
  function writePaths() {
    const out = [];
    const sa = window.ServiceApi;
    if (sa && sa.endpoints) {
      ['subscribeAdd', 'subscribeRemove'].forEach((k) => { if (sa.endpoints[k]) out.push(sa.endpoints[k]); });
    }
    const ta = window.ToolApi;
    if (ta && ta.endpoints && ta.endpoints.subscriptionReview) out.push(ta.endpoints.subscriptionReview);
    return out;
  }
  const pathOf = (p) => String(p || '').split('?')[0];
  function isWritePath(p) {
    const t = pathOf(p);
    return writePaths().some((w) => pathOf(w) === t);
  }
  function failFor(path, fail) {
    if (!fail) return null;
    const isReview = pathOf(path) === pathOf((window.ToolApi && window.ToolApi.endpoints || {}).subscriptionReview || '');
    return (fail === 'review' && isReview) || (fail === 'subscribe' && !isReview) ? fail : null;
  }

  function isEnabled() { return !!MODE; }

  function updateBadge() {
    if (!MODE || !MODE.badge) return;
    MODE.badge.textContent = `🧪 订阅预演中 · 已拦 ${MODE.count} 条写请求 · 点此关闭`;
  }

  function installBadge() {
    if (typeof document === 'undefined' || !document.body) return;
    const el = document.createElement('div');
    el.id = 'dryrunBadge';
    el.setAttribute('role', 'status');
    el.title = '点击关闭预演模式（关闭后写请求不再被拦截）';
    el.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:3000;padding:8px 14px;'
      + 'border-radius:999px;font:12px/1.4 var(--font-sans,system-ui,sans-serif);'
      + 'background:#FAEEDA;color:#633806;border:1px solid #BA7517;cursor:pointer;user-select:none';
    el.addEventListener('click', () => disable());
    document.body.appendChild(el);
    MODE.badge = el;
    updateBadge();
  }

  /** 一次点击的两个报文归到一组，点击结束（600ms 无新请求）后打一份小计 */
  function printClickSummary() {
    if (!MODE || !MODE.group.length) return;
    const g = MODE.group.slice();
    MODE.group = [];
    console.log(SUB);
    console.log(`🧪 本次点击共拦截 ${g.length} 个写请求（未写入后端）：`);
    g.forEach((it) => {
      const secs = describe(it.body).sections;
      const parts = secs.map((s) => (s.kind === 'array' ? `${s.key} ${s.count} 条`
        : (s.kind === 'object' ? `${s.key} 非空 ${s.nonEmpty.length}/${s.count}` : `${s.key} 有值`)));
      console.log(`   · ${it.name}  →  ${parts.join('，')}`);
    });
    console.log('   字段明细见上面每个请求的打印（顺序 = 报文键序，可直接与抓包逐行对照）');
    console.log(LINE);
  }

  function printIntercepted(item, sameClick) {
    console.log(LINE);
    console.log(`🧪 订阅预演（DRY RUN）· 第 ${item.index} 个写请求已拦截 —— 未写入后端`);
    console.log(`触发：前端点击${sameClick ? '（与上一个请求属同一次「确认」）' : ''}　时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`);
    printBody(item, 1, 1);
  }

  /**
   * 开启预演模式。
   * @param {{fail?:'subscribe'|'review'}} [opts]
   *        fail='subscribe' → 订阅写入返回失败（看「订阅失败」提示与本地不标记）
   *        fail='review'    → 订阅成功但评委写入失败（看「只补交评委」的部分失败链路）
   * @returns {{ok:boolean, paths?:string[], already?:boolean, error?:string}}
   */
  function enable(opts) {
    const o = opts || {};
    if (MODE) return { ok: true, already: true, count: MODE.count, paths: MODE.paths };
    if (typeof window === 'undefined' || !window.API || typeof window.API.call !== 'function') {
      console.warn('[订阅预演] window.API 未就绪，暂不能开启（等页面脚本加载完再试）');
      return { ok: false, error: 'API 未就绪' };
    }
    const paths = writePaths();
    if (!paths.length) {
      console.warn('[订阅预演] 没有可拦截的写接口：ServiceApi / ToolApi 未加载，或端点未配置');
      return { ok: false, error: '没有可拦截的写接口' };
    }
    const sm = window.SubscribeManager;
    MODE = {
      savedCall: window.API.call,
      savedToast: null,
      count: 0,
      writes: [],
      group: [],
      lastAt: 0,
      timer: null,
      badge: null,
      fail: o.fail || null,
      paths,
      startedAt: new Date(),
      // 预演会在本地把服务标记为「已订阅」（模拟成功的一部分），先记下开启前的快照，
      // 关闭时把这期间新增的标记撤销，避免污染真实订阅清单
      beforeSubscribed: (sm && typeof sm.getAll === 'function') ? sm.getAll().slice() : null,
    };

    const savedCall = window.API.call;
    window.API.call = async (path, callOpts) => {
      // 读接口照常走真实请求；模式已关闭（在途请求收尾）也直接放行
      if (!MODE || !isWritePath(path)) return savedCall(path, callOpts);
      const body = callOpts && callOpts.body;
      const item = {
        index: ++MODE.count,
        name: ((pathOf(path).split('/').pop()) || String(path)),
        method: (callOpts && callOpts.method) || 'POST',
        path: String(path || ''),
        body,
        query: callOpts && callOpts.query,
      };
      MODE.writes.push(item);
      const sameClick = (Date.now() - MODE.lastAt) < CLICK_GAP;
      MODE.lastAt = Date.now();
      if (sameClick) MODE.group.push(item); else MODE.group = [item];
      printIntercepted(item, sameClick);
      // 预演下「关联文档」必填被跳过，报文里的 documents 会是空数组 —— 明确说一句，
      // 免得把「空 documents」当成脚本 bug（真实环境后端会拒这一条）
      if (body && Array.isArray(body.documents) && !body.documents.length) {
        console.log('   ⓘ 预演模式：本次未选关联文档（必填已跳过），documents 为空数组；真实环境里这一条后端会拒');
      }
      updateBadge();
      cancelLater(MODE.timer);
      MODE.timer = later(printClickSummary, 600);
      const hit = failFor(path, MODE.fail);
      if (hit) {
        console.log(`  ⛔ 本次按设置模拟「${hit} 写入失败」：返回 500，用于观察失败链路`);
        return {
          ok: false, status: 500, headers: { get: () => null },
          json: async () => ({ code: 500, msg: `预演桩：模拟 ${hit} 写入失败` }),
        };
      }
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => FAKE_JSON };
    };

    // 顺手把弹窗提示镜像到控制台：被校验拦下时（不发请求）这里是唯一的证据
    if (window.AppServices && typeof window.AppServices.toast === 'function') {
      const origToast = window.AppServices.toast;
      MODE.savedToast = origToast;
      window.AppServices.toast = (msg, d, t) => {
        try { console.log(`   💬 页面提示：${msg}`); } catch (_) { /* ignore */ }
        return origToast(msg, d, t);
      };
    }

    installBadge();
    console.log(LINE);
    console.log('🧪 订阅预演模式已开启（DRY RUN）—— 写请求会被拦截，不会写入后端');
    console.log(`   拦截范围（取自各接口模块的 endpoints 配置）：${paths.join('、')}`);
    console.log('   现在请照常点击页面上的「订阅」→ 弹窗里填好 → 点「确 认」；读接口照常发真实请求。');
    console.log('   预演下「关联文档」必填不拦：离线拿不到文档列表时不用选也能把流程试通（报文里 documents 会是空数组）。');
    console.log(`   关闭：点右下角浮标，或 SubscribeDryRun.disable()${o.fail ? `（本次模拟 ${o.fail} 写入失败）` : ''}`);
    console.log('   注意：模拟成功也会把该服务标记为已订阅（本地）；disable() 会撤销这些标记。');
    console.log(LINE);
    return { ok: true, paths };
  }

  /** 关闭预演模式：还原传输层与提示、撤掉浮标、撤销预演期间新增的本地订阅标记 */
  function disable() {
    if (!MODE) return { ok: true, already: true };
    const m = MODE;
    MODE = null;
    window.API.call = m.savedCall;
    if (window.AppServices && m.savedToast) window.AppServices.toast = m.savedToast;
    cancelLater(m.timer);
    if (m.badge && m.badge.parentNode) m.badge.parentNode.removeChild(m.badge);

    const reverted = [];
    const sm = window.SubscribeManager;
    if (sm && m.beforeSubscribed && typeof sm.getAll === 'function' && typeof sm.remove === 'function') {
      const before = new Set(m.beforeSubscribed);
      sm.getAll().forEach((c) => { if (!before.has(c) && sm.remove(c)) reverted.push(c); });
    }
    console.log(LINE);
    console.log(`🧪 订阅预演模式已关闭 —— 本次共拦截 ${m.count} 个写请求（都未写入后端）`);
    console.log(`   已还原传输层${m.savedToast ? '与页面提示' : ''}${reverted.length ? `；撤销本地「已订阅」标记：${reverted.join('、')}` : '；无新增的本地订阅标记需要撤销'}`);
    console.log(LINE);
    return { ok: true, count: m.count, reverted, writes: m.writes };
  }

  // ?dryrun=1 → 打开页面即进入预演模式（纯点击操作，不用碰控制台）
  if (typeof window !== 'undefined' && typeof location !== 'undefined'
    && /[?&]dryrun=1(&|$)/.test(location.search)) {
    later(() => { try { enable(); } catch (e) { console.warn('[订阅预演] 自动开启失败：', e && e.message); } }, 0);
  }

  // ═══════════════════════════════════════════════════
  // 场景矩阵：必填缺失 / 字段为空 / 格式错误 / 顺序 / 组包
  // ═══════════════════════════════════════════════════

  const goodRow = () => ({
    id: 'PUB-1', publishId: 'PUB-1', serverCoding: 'E00301TO1197', sysServeNo: 'E00301TO1197',
    provideComponentName: '组件名', provideSystemNumber: 'E00301', assemblyNo: 'E00301',
    prodBatch: '2611批次', serverNo: 'M-202607-11289', deptId: 'K4229',
  });
  const goodForm = () => ({
    callerSystem: 'E00406', callerServiceNo: 'E00406TO1197',
    relDocIds: 'doc-1', relDocNames: '某文档',
    relDocDetails: [{
      batchNum: '2611', docName: '某文档', docNo: 'D-1', label: 'D-1-某文档', templateCode: '16', docInstId: 'doc-1',
    }],
    perfPeak: { tps: '5' }, taskNo: 'T-2026-001',
  });
  const goodJudges = () => ([
    { role: '调用方产品负责人', empNo: '6464402', name: '吴树海', dept: '中国银行软件中心（深圳）开发三部', deptId: 'K4229' },
    { role: '服务方产品负责人', empNo: '6554220', name: '钟剑标', dept: '中国银行软件中心（深圳）开发三部', deptId: 'K4229' },
  ]);

  /**
   * 场景清单（数据驱动，便于增删）。
   *  · kind='validate'：只跑校验，断言 code / focus（不发请求）
   *  · kind='request' ：跑完整预演（拦截式），断言捕获到的请求与字段
   *  expect 是人话期望，check(res) 返回 true/false；actual 由 report 生成便于对照
   */
  const SCENARIOS = [
    // ── 必填缺失 ──
    {
      name: '必填齐全 → 通过',
      kind: 'validate',
      expect: 'ok=true',
      input: () => ({ row: goodRow(), form: goodForm(), judges: goodJudges() }),
      check: (r) => r.validate.ok === true,
      actual: (r) => `ok=${r.validate.ok}`,
    },
    {
      name: '无行数据 → no-row（静默，无文案）',
      kind: 'validate',
      expect: 'code=no-row 且 msg 为空',
      input: () => ({ row: null, form: goodForm(), judges: goodJudges() }),
      check: (r) => r.validate.code === 'no-row' && r.validate.msg === '',
      actual: (r) => `code=${r.validate.code} msg=${JSON.stringify(r.validate.msg)}`,
    },
    {
      name: '行缺服务编码 → no-coding',
      kind: 'validate',
      expect: "code=no-coding，文案「无法获取服务编码」",
      input: () => ({ row: { id: 'X' }, form: goodForm(), judges: goodJudges() }),
      check: (r) => r.validate.code === 'no-coding' && /服务编码/.test(r.validate.msg),
      actual: (r) => `code=${r.validate.code} msg=${r.validate.msg}`,
    },
    {
      name: '已在订阅列表 → subscribed',
      kind: 'validate',
      expect: 'code=subscribed',
      input: () => ({ row: goodRow(), form: goodForm(), judges: goodJudges() }),
      check: (r) => r.validate.code === 'subscribed',
      actual: (r) => `code=${r.validate.code}`,
      isSubscribed: () => true,
    },
    {
      name: '未选调用方系统 → no-caller + 聚焦 sub_callerSystem',
      kind: 'validate',
      expect: 'code=no-caller，focus=sub_callerSystem',
      input: () => {
        const f = goodForm(); delete f.callerSystem; return { row: goodRow(), form: f, judges: goodJudges() };
      },
      check: (r) => r.validate.code === 'no-caller' && r.validate.focus === 'sub_callerSystem',
      actual: (r) => `code=${r.validate.code} focus=${r.validate.focus}`,
    },
    {
      name: '未选关联文档 → no-doc + 聚焦 sub_relDoc',
      kind: 'validate',
      expect: 'code=no-doc，focus=sub_relDoc',
      input: () => {
        const f = goodForm(); f.relDocIds = ''; return { row: goodRow(), form: f, judges: goodJudges() };
      },
      check: (r) => r.validate.code === 'no-doc' && r.validate.focus === 'sub_relDoc',
      actual: (r) => `code=${r.validate.code} focus=${r.validate.focus}`,
    },
    {
      name: '服务编号空且推不出（行编码无 TO 尾号）→ no-service-no',
      kind: 'validate',
      expect: 'code=no-service-no',
      input: () => {
        const f = goodForm(); f.callerServiceNo = '';
        return { row: { ...goodRow(), serverCoding: 'E00301', sysServeNo: '' }, form: f, judges: goodJudges() };
      },
      check: (r) => r.validate.code === 'no-service-no',
      actual: (r) => `code=${r.validate.code}`,
    },
    {
      name: '服务编号空但可派生（调用方系统 + TO 尾号）→ 通过',
      kind: 'validate',
      expect: 'ok=true（不能假失败）',
      input: () => {
        const f = goodForm(); f.callerServiceNo = '';
        return { row: { ...goodRow(), serverCoding: 'E00301TO1197' }, form: f, judges: goodJudges() };
      },
      check: (r) => r.validate.ok === true,
      actual: (r) => `ok=${r.validate.ok}`,
    },
    // ── 字段为空 / 格式错误 ──
    {
      name: 'TPS 为空 → no-tps + 聚焦 sub_tpsPeak',
      kind: 'validate',
      expect: 'code=no-tps，focus=sub_tpsPeak',
      input: () => {
        const f = goodForm(); f.perfPeak = { tps: '' };
        return { row: goodRow(), form: f, judges: goodJudges() };
      },
      check: (r) => r.validate.code === 'no-tps' && r.validate.focus === 'sub_tpsPeak',
      actual: (r) => `code=${r.validate.code} focus=${r.validate.focus}`,
    },
    ...[['abc', '非数字'], ['5a', '数字带字母'], ['-1', '负数'], ['0', '零'], ['5.5.5', '多个小数点']].map(([tps, label]) => ({
      name: `TPS 格式错误（${label}：「${tps}」）→ bad-tps`,
      kind: 'validate',
      expect: 'code=bad-tps',
      input: () => {
        const f = goodForm(); f.perfPeak = { tps };
        return { row: goodRow(), form: f, judges: goodJudges() };
      },
      check: (r) => r.validate.code === 'bad-tps',
      actual: (r) => `code=${r.validate.code} msg=${r.validate.msg}`,
    })),
    {
      name: 'TPS 全角数字「５」→ 通过（先归一再看数值）',
      kind: 'validate',
      expect: 'ok=true',
      input: () => {
        const f = goodForm(); f.perfPeak = { tps: '５' };
        return { row: goodRow(), form: f, judges: goodJudges() };
      },
      check: (r) => r.validate.ok === true,
      actual: (r) => `ok=${r.validate.ok}`,
    },
    {
      name: '评委为空且未拉取默认评委 → no-judges + 聚焦 btnFetchJudges',
      kind: 'validate',
      expect: 'code=no-judges，focus=btnFetchJudges',
      input: () => ({ row: goodRow(), form: goodForm(), judges: [], defaultsFetched: false }),
      check: (r) => r.validate.code === 'no-judges' && r.validate.focus === 'btnFetchJudges',
      actual: (r) => `code=${r.validate.code} focus=${r.validate.focus}`,
    },
    {
      name: '评委为空但已成功拉取默认评委 → 通过（唯一豁免）',
      kind: 'validate',
      expect: 'ok=true',
      input: () => ({ row: goodRow(), form: goodForm(), judges: [], defaultsFetched: true }),
      check: (r) => r.validate.ok === true,
      actual: (r) => `ok=${r.validate.ok}`,
    },
    {
      name: '任务编号为空 → no-task-no + 聚焦 sub_taskNo',
      kind: 'validate',
      expect: 'code=no-task-no',
      input: () => {
        const f = goodForm(); f.taskNo = '   ';
        return { row: goodRow(), form: f, judges: goodJudges() };
      },
      check: (r) => r.validate.code === 'no-task-no' && /任务编号/.test(r.validate.msg),
      actual: (r) => `code=${r.validate.code} msg=${r.validate.msg}`,
    },
    {
      name: '批次为空 → 通过（刻意不硬拦：该下拉当前不进报文）',
      kind: 'validate',
      expect: 'ok=true',
      input: () => {
        const f = goodForm(); f.callerBatch = '';
        return { row: goodRow(), form: f, judges: goodJudges() };
      },
      check: (r) => r.validate.ok === true,
      actual: (r) => `ok=${r.validate.ok}`,
    },
    {
      name: '校验顺序：编码缺失 + 系统未选 → 先报 no-coding',
      kind: 'validate',
      expect: 'code=no-coding（不是 no-caller）',
      input: () => ({ row: {}, form: {}, judges: [] }),
      check: (r) => r.validate.code === 'no-coding',
      actual: (r) => `code=${r.validate.code}`,
    },
    {
      name: '校验顺序：评委缺失 + 任务编号缺失 → 先报 no-judges',
      kind: 'validate',
      expect: 'code=no-judges',
      input: () => {
        const f = goodForm(); f.taskNo = '';
        return { row: goodRow(), form: f, judges: [], defaultsFetched: false };
      },
      check: (r) => r.validate.code === 'no-judges',
      actual: (r) => `code=${r.validate.code}`,
    },
    // ── 组包（拦截式预演）──
    {
      name: '组包：两个报文都捕获到，且顺序 = setSubcription → subscriptionReview',
      kind: 'request',
      expect: '2 个请求，顺序正确，且未发生真实 fetch',
      input: () => ({ row: goodRow(), form: goodForm(), judges: goodJudges() }),
      check: (r) => r.requests.length === 2
        && r.requests[0].name === 'setSubcription'
        && r.requests[1].name === 'subscriptionReview'
        && r.fetchCalls === 0,
      actual: (r) => `requests=[${r.requests.map((x) => x.name).join(', ')}] fetchCalls=${r.fetchCalls}`,
    },
    {
      name: '组包：评委报文每条 7 键，且 roleId 按抓包映射（调用方=03 / 服务方=05）',
      kind: 'request',
      expect: 'judgeInfoList 每条 7 键，03/05 各一',
      input: () => ({ row: goodRow(), form: goodForm(), judges: goodJudges() }),
      check: (r) => {
        const jl = (r.requests[1] || {}).body && r.requests[1].body.judgeInfoList;
        if (!jl || jl.length !== 2) return false;
        const keys = Object.keys(jl[0]).sort().join(',');
        return keys === 'involvedProduct,judgeDeptId,judgeDeptName,judgeName,judgeRoleId,judgeRoleName,judgeUserId'
          && jl[0].judgeRoleId === '03' && jl[1].judgeRoleId === '05'
          && jl[0].judgeDeptId === 'K4229';
      },
      actual: (r) => JSON.stringify((r.requests[1] || {}).body && r.requests[1].body.judgeInfoList),
    },
    {
      name: '组包：字段为空（行无 serverNo/taskNo）→ serverNo/prodTaskNo 用表单任务编号兜底',
      kind: 'request',
      expect: 'serverNo = prodTaskNo = 表单任务编号',
      input: () => {
        const row = goodRow();
        delete row.serverNo;
        return { row, form: goodForm(), judges: goodJudges() };
      },
      check: (r) => {
        const pub = ((r.requests[0] || {}).body || {}).publishSubcription || {};
        return pub.serverNo === 'T-2026-001' && pub.prodTaskNo === 'T-2026-001';
      },
      actual: (r) => {
        const pub = ((r.requests[0] || {}).body || {}).publishSubcription || {};
        return `serverNo=${pub.serverNo} prodTaskNo=${pub.prodTaskNo}`;
      },
    },
    {
      name: '组包：行有 serverNo → 以行为准（表单任务编号不顶掉）',
      kind: 'request',
      expect: 'serverNo = 行里的 M-202607-11289',
      input: () => ({ row: goodRow(), form: goodForm(), judges: goodJudges() }),
      check: (r) => {
        const pub = ((r.requests[0] || {}).body || {}).publishSubcription || {};
        return pub.serverNo === 'M-202607-11289' && pub.prodTaskNo === 'M-202607-11289';
      },
      actual: (r) => {
        const pub = ((r.requests[0] || {}).body || {}).publishSubcription || {};
        return `serverNo=${pub.serverNo} prodTaskNo=${pub.prodTaskNo}`;
      },
    },
    {
      name: '组包：TPS 优先取行数据 prodTPSPeak',
      kind: 'request',
      expect: '行数据有 prodTPSPeak=9 → 报文里就是 9（不被表单的 5 顶掉）',
      input: () => ({ row: { ...goodRow(), prodTPSPeak: '9' }, form: goodForm(), judges: goodJudges() }),
      check: (r) => {
        const pub = ((r.requests[0] || {}).body || {}).publishSubcription || {};
        return pub.prodTPSPeak === '9';
      },
      actual: (r) => `prodTPSPeak=${(((r.requests[0] || {}).body || {}).publishSubcription || {}).prodTPSPeak}`,
    },
    {
      name: '组包：TPS 行数据没有时才用表单值',
      kind: 'request',
      expect: '行无 prodTPSPeak → 报文里是表单的 5',
      input: () => ({ row: goodRow(), form: goodForm(), judges: goodJudges() }),
      check: (r) => {
        const pub = ((r.requests[0] || {}).body || {}).publishSubcription || {};
        return pub.prodTPSPeak === '5';
      },
      actual: (r) => `prodTPSPeak=${(((r.requests[0] || {}).body || {}).publishSubcription || {}).prodTPSPeak}`,
    },
    {
      name: '组包：无评委行 → 只发订阅报文（与线上一致），不发评委报文',
      kind: 'request',
      expect: '1 个请求（仅 setSubcription）',
      input: () => ({ row: goodRow(), form: goodForm(), judges: [], defaultsFetched: true }),
      check: (r) => r.requests.length === 1 && r.requests[0].name === 'setSubcription',
      actual: (r) => `requests=[${r.requests.map((x) => x.name).join(', ')}]`,
    },
    {
      name: '预演模式：未选关联文档也放行（离线拿不到文档列表时仍能试）',
      kind: 'request',
      dryRun: true,
      expect: '校验放行 + 订阅报文照发，documents 为空数组，并标注「必填已跳过」',
      input: () => {
        const f = goodForm();
        f.relDocIds = '';
        f.relDocNames = '';
        f.relDocDetails = [];
        return { row: goodRow(), form: f, judges: goodJudges() };
      },
      check: (r) => r.validate.ok === true
        && r.docSkipped === true
        && r.requests.length >= 1
        && Array.isArray((r.requests[0] || {}).body.documents)
        && r.requests[0].body.documents.length === 0,
      actual: (r) => `ok=${r.validate.ok} docSkipped=${r.docSkipped} requests=${r.requests.length} `
        + `documents=${JSON.stringify(((r.requests[0] || {}).body || {}).documents)}`,
    },
    {
      name: '非预演模式：未选关联文档仍按线上拦下（no-doc，不发报文）',
      kind: 'request',
      dryRun: false,
      expect: 'code=no-doc 且 0 个请求',
      input: () => {
        const f = goodForm();
        f.relDocIds = '';
        return { row: goodRow(), form: f, judges: goodJudges() };
      },
      check: (r) => r.validate.code === 'no-doc' && r.requests.length === 0,
      actual: (r) => `code=${r.validate.code} requests=${r.requests.length}`,
    },
    {
      name: '组包：校验不过时按线上行为直接拦下，不构造报文',
      kind: 'request',
      expect: 'skipped 有值且 0 个请求',
      input: () => {
        const f = goodForm(); f.perfPeak = { tps: 'abc' };
        return { row: goodRow(), form: f, judges: goodJudges() };
      },
      check: (r) => !!r.skipped && r.requests.length === 0,
      actual: (r) => `skipped=${JSON.stringify(r.skipped)} requests=${r.requests.length}`,
    },
    {
      name: '组包：force=true 时即使校验不过也能看到整条链路的报文（仅观察用）',
      kind: 'request',
      expect: '2 个请求（订阅 + 评委都构造出来，便于逐字段对照）',
      force: true,
      input: () => {
        const f = goodForm(); f.perfPeak = { tps: 'abc' };
        return { row: goodRow(), form: f, judges: goodJudges() };
      },
      check: (r) => r.requests.length === 2,
      actual: (r) => `requests=[${r.requests.map((x) => x.name).join(', ')}]`,
    },
  ];

  /**
   * 跑内置场景矩阵。
   * @param {{quiet?:boolean}} [opts]
   * @returns {Promise<{total:number, passed:number, failed:number, items:Array}>}
   */
  async function scenarios(opts) {
    const quiet = !!(opts && opts.quiet);
    const items = [];
    if (!quiet) {
      console.log(LINE);
      console.log('订阅预演 · 场景矩阵（全部在拦截式预演下运行，不产生真实请求）');
      console.log('规则来源：subscribe-model.js（validateSubscribe / validateJudgeSubmit / toJudgeInfoList / deriveCallerServiceNo）');
      console.log('          + service-api.js buildSubscribeBody（报文与字段顺序）+ analysis/har/订阅.json（协议常量与评委 7 字段）');
      console.log(LINE);
    }
    for (const sc of SCENARIOS) {
      if (sc.skip) continue;
      const input = sc.input();
      let res;
      // 场景矩阵一律显式指定 dryRun（默认 false）——「关联文档必填」这条的期望值
      // 不能因为预演模式开着就漂移；预演模式的放行行为另有专门场景覆盖。
      const dryRun = sc.dryRun === undefined ? false : !!sc.dryRun;
      if (sc.kind === 'validate') {
        res = await run({
          ...input, quiet: true, force: sc.force, isSubscribed: sc.isSubscribed, dryRun,
        });
      } else {
        res = await run({ ...input, quiet: true, force: sc.force, dryRun });
      }
      let pass = false;
      let err = '';
      try {
        pass = sc.check(res) === true;
      } catch (e) { err = `check 抛错：${e.message}`; }
      const actual = (() => { try { return sc.actual(res); } catch (e) { return `actual 抛错：${e.message}`; } })();
      items.push({ name: sc.name, expect: sc.expect, actual, pass, ok: res.validate && res.validate.ok });
      if (!quiet) {
        console.log(`${pass ? '✓' : '✗'} ${sc.name}`);
        console.log(`    期望：${sc.expect}`);
        console.log(`    实际：${actual}${err ? `（${err}）` : ''}`);
      }
    }
    const passed = items.filter((i) => i.pass).length;
    if (!quiet) {
      console.log(SUB);
      console.log(`场景矩阵结果：${passed}/${items.length} 通过${passed === items.length ? '（全部符合预期）' : '—— 有不符合预期的项，见上面的 ✗'}`);
      console.log(LINE);
    }
    return { total: items.length, passed, failed: items.length - passed, items };
  }

  window.SubscribeDryRun = Object.freeze({
    // 点击驱动（主用法）：开启后照常点「订阅」→「确 认」，写请求被拦下并打印
    enable,
    disable,
    isEnabled,
    // 脚本驱动：预演一次 / 跑场景矩阵 / 只打印一份报文
    run,
    scenarios,
    dump,
    describe,
    // 纯函数（单测直接断言，不必走流程）
    isEmptyValue,
    formatValue,
    describeObject,
    isWritePath,
    writePaths,
    FIELD_SOURCES,
    SCENARIOS,
  });
})();
