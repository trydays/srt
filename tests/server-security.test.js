const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { once } = require('events');

const serverPath = require.resolve('../server');

function request(server, pathname, method = 'GET') {
  const address = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: address.port,
      path: pathname,
      method
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks)
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function startTestServer(t) {
  const { startStaticServer } = require(serverPath);
  assert.equal(typeof startStaticServer, 'function');
  const server = startStaticServer({ port: 0 });
  await once(server, 'listening');
  t.after(async () => {
    if (!server.listening) return;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  return server;
}

test('importing server.js has no listening side effect', () => {
  const originalListen = http.Server.prototype.listen;
  var listenCalls = 0;
  http.Server.prototype.listen = function() {
    listenCalls += 1;
    return this;
  };

  delete require.cache[serverPath];
  var exported;
  try {
    exported = require(serverPath);
  } finally {
    http.Server.prototype.listen = originalListen;
  }

  assert.equal(listenCalls, 0);
  assert.equal(typeof exported.createStaticServer, 'function');
  assert.equal(typeof exported.startStaticServer, 'function');
});

test('startStaticServer binds to IPv4 loopback', async (t) => {
  const server = await startTestServer(t);
  assert.equal(server.address().address, '127.0.0.1');
});

test('native command and installation routes do not exist', async (t) => {
  const server = await startTestServer(t);
  const execResponse = await request(server, '/api/exec', 'POST');
  const installResponse = await request(server, '/api/install', 'POST');
  assert.equal(execResponse.statusCode, 404);
  assert.equal(installResponse.statusCode, 404);
});

test('responses never enable wildcard cross-origin access', async (t) => {
  const server = await startTestServer(t);
  const response = await request(server, '/');
  assert.notEqual(response.headers['access-control-allow-origin'], '*');
});

test('root serves app/主页.html without exposing the repository root', async (t) => {
  const server = await startTestServer(t);
  const response = await request(server, '/');
  const expected = await fs.promises.readFile(path.join(__dirname, '..', 'app', '主页.html'));
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, expected);

  const packageResponse = await request(server, '/package.json');
  assert.equal(packageResponse.statusCode, 404);
});
