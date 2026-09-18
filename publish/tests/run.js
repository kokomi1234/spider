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
require('./home-page.test');

runAll();
