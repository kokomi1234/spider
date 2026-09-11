# 📌 待办清单

> 记录还没做、或在等外部条件的事项。做完一条就删掉（git 历史里能查到，不留"已完成"归档）。
> 项目约定与踩坑见 `.workbuddy/memory/MEMORY.md`。

## ⏳ 等外部条件

- [ ] **批次时间是否驱动优先级（待定）**：订阅页「批量修改批次时间」已改为**本地落盘**
      ——存 `publish/config/batch-times.json`（走代理 `/local/batch-times` 读写；静态部署/无代理时
      降级 localStorage），**不走后端接口**（原 updateBatchTimes 预留已删）。
      目前只做「记录/记忆」，**尚未**参与 `js/ui/priority.js` 的截止日计算；
      如需让设定的日期覆盖「批次月 −3 的 15 日 / 批次月 15 日」这条默认里程碑，再单独加。

- [ ] **订阅关系页导出接口**：两个导出按钮（「导出」/「按变更批次导出」）目前走前端本地 CSV
      （上限 5000 条，不支持服务端格式）。需要用户提供**导出接口的抓包**，然后在
      `publish/js/api/tool-api.js` 把 `toolEndpoints.subscriptionExport` 填上真实路径，
      前端会自动切到后端导出。设计背景见 `publish/docs/服务订阅关系查询页面设计.md` 第十章。

- [ ] **WPSN（E00404）的真实数据**：想在订阅关系页点快速筛选 WPSN 就看到数据，
      需要补抓一次「页面上点在 WPSN 上、批次留空、点查询」的 har，交给我导入即可。
      现有抓包（`服务订阅关系查询.har`）里该条件的真实结果是 **0 条**。

## ❓ 待验证（已实现初版，缺真实环境确认）

- [ ] **跳转 ITAMP 服务搜索的参数预填**：首页「🔗 ITAMP 服务搜索」按钮已按
      `2026-09-11` 的 `serviceSearchView` 抓包字段名拼 URL（`compNum / putBatch /
      providerServiceNameAndId / useNum / serverCodingList / sysServeNoList / deptId /
      isSendOutsideSystem`），但目标 Vue 单页**是否认这些 query 参数、预填后是否自动查询**
      尚未在真实环境确认（该页登录后跳 `?sessionid=...&statuscode=10000`，说明它至少读 query）。
      内网可访问时点一次验证；若目标页不认，退化为「跳过去手动填」。

## 📝 使用约定

- 一条待办写清三件事：**目标是什么、卡在哪、需要什么**。
- 已完成直接删，不保留「已完成」小节。
- 实现细节不写在这里——放在对应文档（设计方案 / ONBOARDING / 记忆文件）里，这里只做索引。
- **不要把抓包 / 接口报文贴进本文件**：报文里含 token / Cookie / ssopSessionId，而本文件是入库文件。
  抓包统一放 `analysis/har/`（`.gitignore` 已忽略）。
