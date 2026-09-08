/**
 * Mock 代理服务器
 * 提供本地测试数据，不依赖真实接口
 */

const http = require('http');
const { MOCK_DATA, DEFAULT_SUBSCRIBED } = require('./mock-data');

const PORT = 3001; // 使用不同端口避免冲突

// 初始化已订阅列表
let subscribedServices = [...DEFAULT_SUBSCRIBED];

const server = http.createServer((req, res) => {
  // CORS 预检请求
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET',
      'Access-Control-Allow-Headers': 'Content-Type, token',
    });
    res.end();
    return;
  }

  const urlObj = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = urlObj.pathname;
  // 兼容新约定：前端现在发完整路径 /itamp-tool/publish/xxx，
  // 这里统一剥掉模块前缀，按逻辑路径匹配（同时兼容旧的短路径）。
  const logical = pathname.replace(/^\/itamp-tool\/publish/, '');

  console.log(`[${new Date().toISOString()}] ${req.method} ${pathname}`);

  // 处理获取发布数据列表
  if (logical === '/getPublishDataList' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const params = JSON.parse(body);
        const compNum = params.compNum || '';
        const pageNum = params.pageNum || 1;
        const pageSize = params.pageSize || 10;

        // 从 mock 数据中获取对应组件的服务列表
        const rows = MOCK_DATA[compNum] || [];

        // 分页处理
        const start = (pageNum - 1) * pageSize;
        const end = start + pageSize;
        const pagedRows = rows.slice(start, end);

        const response = {
          code: 200,
          message: 'success',
          data: {
            total: rows.length,
            pageNum: pageNum,
            pageSize: pageSize,
            rows: pagedRows,
            records: pagedRows,
            list: pagedRows,
          },
        };

        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(JSON.stringify(response));
      } catch (err) {
        console.error('Mock error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 500, message: err.message }));
      }
    });
    return;
  }

  // 处理订阅管理 API
  if (logical === '/subscribe/list' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify({
      code: 200,
      data: subscribedServices,
    }));
    return;
  }

  if (logical === '/subscribe/add' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { serverCoding } = JSON.parse(body);
        if (!serverCoding) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ code: 400, message: '缺少服务编码' }));
          return;
        }

        if (!subscribedServices.includes(serverCoding)) {
          subscribedServices.push(serverCoding);
        }

        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(JSON.stringify({
          code: 200,
          message: '成功',
          data: subscribedServices,
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 500, message: err.message }));
      }
    });
    return;
  }

  if (logical === '/subscribe/remove' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { serverCoding } = JSON.parse(body);
        subscribedServices = subscribedServices.filter(code => code !== serverCoding);

        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(JSON.stringify({
          code: 200,
          message: '成功',
          data: subscribedServices,
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 500, message: err.message }));
      }
    });
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ code: 404, message: 'Not Found' }));
});

server.listen(PORT, () => {
  console.log(`\n✅ Mock 代理服务器运行在 http://localhost:${PORT}\n`);
  console.log(`📦 默认已订阅服务：${DEFAULT_SUBSCRIBED.join(', ')}\n`);
});
