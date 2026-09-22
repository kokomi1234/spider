/**
 * 测试入口：node tests/run.js
 * 新增用例只要加一个 *.test.js 并在这里 require 即可。
 */
'use strict';

const { runAll } = require('./harness');

require('./priority.test');
require('./csv-export.test');
require('./table-utils.test');
require('./subscription-batch-times.test');
require('./subscription-table.test');
require('./date-rules.test');
require('./request-layer.test');
require('./api-client.test');
require('./service-api.test');
require('./data-parsers.test');
require('./tool-api.test');
require('./user-api.test');
require('./publish-response.test');
require('./a11y-name.test');
require('./publish-model.test');
require('./publish-view.test');
require('./publish-query.test');
require('./subscribe-model.test');
require('./subscribe-dryrun.test');
require('./subscription-model.test');
require('./subscription-view.test');
require('./bootstrap.test');
require('./module-order.test');
require('./token-manager.test');
require('./toast-queue.test');
require('./query-feedback.test');
// 2026-09-18 全项目补测：核心逻辑 / 传输层 / UI 组件 三块的边界场景
require('./boundary-core.test');
require('./boundary-transport.test');
require('./boundary-ui.test');
// 首页 + 常用查询（2026-09-18 新增）
require('./saved-query.test');
require('./current-user.test');
require('./home-page.test');
// 2026-09-19：常用查询改落 SQLite（回答「这份条件被几个人保存过」）
require('./queries-db.test');
// （2026-09-22 移除）user-tokens.test：用户 token 改存浏览器本机后，代理侧的 token 库
// 与模块已整体删除；本机存储的用例在 user-token.test.js。
require('./user-token.test');
// 2026-09-20：.env 加载顺序防线（PROXY_HOST/PORT 写在 .env 里曾静默失效）
require('./proxy-env-order.test');
// 2026-09-21：发布查询页结果行两个弹窗的纯逻辑（编码映射 / 列定义 / 排序 / 分页口径）
require('./publish-dialog-model.test');
// 2026-09-23：结果表「折行 + 点击复制 + 键盘漫游」三页共用的那一层（原订阅页私有）
require('./copy-cells.test');

runAll();
