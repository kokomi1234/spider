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
require('./service-api.test');
require('./data-parsers.test');
require('./tool-api.test');
require('./publish-response.test');
require('./bootstrap.test');
require('./toast-queue.test');

runAll();
