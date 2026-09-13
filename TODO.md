# 📌 待办清单

> 记录还没做、或在等外部条件的事项。做完一条就删掉（git 历史里能查到，不留"已完成"归档）。
> 项目约定与踩坑见 `.workbuddy/memory/MEMORY.md`。

## ⏳ 等外部条件

- [ ] **订阅关系页导出接口**：两个导出按钮（「导出」/「按变更批次导出」）目前走前端本地 CSV
      （上限 5000 条，不支持服务端格式）。需要用户提供**导出接口的抓包**，然后在
      `publish/js/api/tool-api.js` 把 `toolEndpoints.subscriptionExport` 填上真实路径，
      前端会自动切到后端导出。设计背景见 `publish/docs/服务订阅关系查询页面设计.md` 第十章。

- [ ] **WPSN（E00404）的真实数据**：想在订阅关系页点快速筛选 WPSN 就看到数据，
      需要补抓一次「页面上点在 WPSN 上、批次留空、点查询」的 har，交给我导入即可。
      现有抓包（`服务订阅关系查询.har`）里该条件的真实结果是 **0 条**。

## 🛠 项目自身不足 / 待修改

> 以下是我（agent）对当前代码库的技术债评估，按"性价比"从高到低排。每条写清目标 / 卡点 / 需要什么。
> 已验证的事实：原生 `<select>` 在 HTML 里全部是 `createSearchableSelect` 的挂载点（订阅弹窗也在 275-283/603-634 行转成了可搜索下拉），**不是**债务，故不列入。

- [ ] **收敛重复的 CSV 导出包装**：`js/page/task.js` 与 `js/page/subscription.js` 各有一份 `downloadCsv(rows, filename)`，
     主体完全相同（都调 `CsvExporter.download`，仅列定义不同）。建议把"包装 + toast 提示"抽到
     `js/ui/csv-export.js` 做成 `exportRows(rows, columns, filename)`，两页直接调用、删掉各自的 `downloadCsv`。
     **目标**：去重、单一转义实现。**卡点**：无，纯收口。**需要**：动手改 + 三页导出各点一次。

- [ ] **`.aixcoding/` 未加入 .gitignore**：`git status` 持续冒出 6 个未跟踪文件（`rules/`、`toolsets/` 下），
     全是工具自动生成。`.gitignore` 已忽略 `toolset-installs.json`，但整个目录没忽略。
     **目标**：消除提交噪音。**卡点**：无。**需要**：在 `.gitignore` 加一行 `.aixcoding/`。

- [ ] **补核心逻辑自动化测试**：目前零单测（`find` 无任何 `*.test.js`）。易回归且难手测的逻辑：
     优先级里程碑计算（`priority.js` 的 `MILESTONES` / `parseYmd` / `evaluate`）、分页并发"按页码 Map 拼接"、
     CSV 转义、批次 label 4 种写法解析。**目标**：给回归上保险。**卡点**：无框架，需定轻量方案（纯 node 脚本即可）。
     **需要**：先给 `priority.js` + `csv-export.js` 写单测，再视情况扩。

- [ ] **清残留 noise 级 console.log**：多数 `console.warn/error` 是真实失败诊断（列表加载失败、模块未加载），可保留；
     但 `js/ui/subscribe-ui.js:49` 的 `console.log('✅ 订阅管理 UI 初始化完成')` 属调试噪音，应改 `debugLog()` 或直接删。
     **目标**：统一日志分级。**卡点**：无。**需要**：逐处过一遍 47 处 console.*，noise 级改 `debugLog`。

- [ ] **巨型页面模块待拆**：`index.js`(1324 行) / `subscription.js`(1468 行) 仍是单文件 IIFE，
     查询 / 状态 / 渲染 / 分页 / 订阅筛选混在一个闭包里。**目标**：降低单文件复杂度。
     **卡点**：进一步拆分需先抽"状态层"（中风险），不急但应列为技术债。**需要**：先设计状态层，再按职责拆子模块。

- [ ] **隐式全局 `window.X` 与脚本加载顺序敏感**：18+ 处 `window.X =`，模块在 IIFE 加载时立即取 `window.*`，
     顺序错会静默降级成空实现（已知 `dict-selects.js` 必须在 `toast.js` 之后）。**目标**：消除"顺序陷阱"。
     **卡点**：引入模块注册表或 ESM 需改引入方式，要评估成本。**需要**：架构评估，短期先固化 `index.html` 脚本顺序注释。

- [ ] **EXPORT_PAGE_SIZE 仍偏小（50）**：之前因 2608 批次 7s 临时调小；该批 3854 条 / 10.2MB 是最大批，串行翻页 8 轮≈7s。
     若后端允许 500，请求数可降到 1/10、导出/统计明显更快。**目标**：在不 reintroduce 慢查询的前提下调大。
     **卡点**：需你确认后端单页上限。**需要**：你给后端上限 → 改常量（注意：别靠调小 pageSize 治慢，根因是数据量大）。

- [ ] **ITAMP 跳转未在真实内网验证**：`app-navigator.js` 拼的 query 参数，目标 Vue 单页（`/asserInstruments/serviceSearchView`）
     是否认参数、预填后是否自动查询，仍未在真实环境确认。**目标**：确认跳转真的能预填并出结果。
     **卡点**：我没有内网访问权。**需要**：你在真实环境点一次"查 看"并反馈。

- [ ] **跨页同名函数需逐对 review**：`bindEvents / boot / collectCond / query / render / renderTable / resetForm / loadDicts /
     renderPagination / totalPages` 在三页都有同名定义，但多为页面专属、未必真重复。**目标**：确认哪些是真重复。
     **卡点**：需逐对比对实现才能定论，不盲目合并。**需要**：抽时间做一次跨页 diff，真重复的再抽公共模块。

## 📝 使用约定

- 一条待办写清三件事：**目标是什么、卡在哪、需要什么**。
- 已完成直接删，不保留「已完成」小节。
- 实现细节不写在这里——放在对应文档（设计方案 / ONBOARDING / 记忆文件）里，这里只做索引。
- **不要把抓包 / 接口报文贴进本文件**：报文里含 token / Cookie / ssopSessionId，而本文件是入库文件。
  抓包统一放 `analysis/har/`（`.gitignore` 已忽略）。
