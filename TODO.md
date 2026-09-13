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

- [ ] **巨型页面模块继续拆**：已拆掉两批（`subscription.js` 1465→1288，抽出
     `js/page/subscription-batch-times.js`；`index.js` 1324→1241，抽出 `js/core/publish-response.js`），
     但两页仍各自 1200+ 行，查询 / 渲染 / 分页仍混在一个闭包里。
     **目标**：继续降到每页 800 行以内。**卡点**：剩下的查询/渲染高度依赖页面私有状态，
     要继续拆得先设计"状态层"（中风险，需配合单测）。**需要**：先定状态层边界，再逐块搬。

- [ ] **`js/api/sys-api.js`（245 行）是"写了但没接线"的预留适配层**：公告 / 提醒 / 角色 / AS 组织，
     endpoint 是真实抓包路径（`getAsOrgList` / `getRoleListByRoleGroupId` / `queryAdviceInfo` /
     `batch/getNoticeReadFlag` / `list/selectPage`），但 `fetchAsOrgList` / `fetchRoleList` /
     `fetchAdviceInfo` / `fetchNoticeReadFlag` / `fetchNoticePage` **5 个方法零调用**，三页却都加载它。
     **目标**：要么接进 UI，要么删掉（别让它长期空转）。**卡点**：需判断这几个功能是否还在计划内。
     **需要**：用户拍板——① 功能要做 → 给 UI 位置，我接线；② 不做 → 删文件 + 摘掉三页的 script 标签。

- [ ] **评估是否引入模块注册表 / ESM**：目前仍是 18+ 处 `window.X =` 隐式全局，模块在 IIFE
     加载时即取 `window.*`。**短期已做**：三页脚本顺序注释 + `bootstrap.js` 按页校验依赖，
     顺序错会在控制台点名报缺失（不会再静默降级）。**目标**：彻底摆脱顺序敏感。
     **卡点**：改 ESM / 注册表要动引入方式与部署（当前无构建）。**需要**：评估成本后决定，不急。

## 📝 使用约定

- 一条待办写清三件事：**目标是什么、卡在哪、需要什么**。
- 已完成直接删，不保留「已完成」小节。
- 实现细节不写在这里——放在对应文档（设计方案 / ONBOARDING / 记忆文件）里，这里只做索引。
- **不要把抓包 / 接口报文贴进本文件**：报文里含 token / Cookie / ssopSessionId，而本文件是入库文件。
  抓包统一放 `analysis/har/`（`.gitignore` 已忽略）。
