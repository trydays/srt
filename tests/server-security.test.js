const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { EventEmitter, once } = require('events');

const { createScenarioDependencies } = require('./e2e/scenario-dependencies');
const fixtureInternals = require('./e2e/electron.fixture').__private;

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

function requestPort(port, pathname, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method }, (res) => {
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

async function closeTestServer(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function startTestServer(t) {
  const { startStaticServer } = require(serverPath);
  assert.equal(typeof startStaticServer, 'function');
  const server = startStaticServer({ port: 0 });
  await once(server, 'listening');
  t.after(() => closeTestServer(server));
  return server;
}

async function startCustomServer(t, root) {
  const { createStaticServer } = require(serverPath);
  const server = createStaticServer({ root });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => closeTestServer(server));
  return server;
}

async function startIsolatedServer(t, root) {
  const script = [
    `const { createStaticServer } = require(${JSON.stringify(serverPath)});`,
    `const server = createStaticServer({ root: ${JSON.stringify(root)} });`,
    "server.listen(0, '127.0.0.1', () => process.stdout.write(String(server.address().port) + '\\n'));"
  ].join('\n');
  const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  t.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  });

  const port = await new Promise((resolve, reject) => {
    let stdout = '';
    function onData(chunk) {
      stdout += chunk.toString();
      const newline = stdout.indexOf('\n');
      if (newline === -1) return;
      cleanup();
      resolve(Number(stdout.slice(0, newline)));
    }
    function onError(error) {
      cleanup();
      reject(error);
    }
    function onExit(code, signal) {
      cleanup();
      reject(new Error(`isolated server exited before listening (${code || signal}): ${stderr}`));
    }
    function cleanup() {
      child.stdout.off('data', onData);
      child.off('error', onError);
      child.off('exit', onExit);
    }
    child.stdout.on('data', onData);
    child.once('error', onError);
    child.once('exit', onExit);
  });

  return { child, port, stderr: () => stderr };
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

test('encoded NUL is rejected without crashing the server', async (t) => {
  const root = path.join(__dirname, '..', 'app');
  const isolated = await startIsolatedServer(t, root);

  const malformed = await requestPort(isolated.port, '/index.html%00.txt');
  assert.ok([400, 404].includes(malformed.statusCode));
  assert.equal(malformed.headers['content-type'], 'text/plain; charset=utf-8');

  const healthy = await requestPort(isolated.port, '/');
  assert.equal(healthy.statusCode, 200, isolated.stderr());
  assert.equal(isolated.child.exitCode, null);
});

test('lexical traversal stays outside the static root and the server remains responsive', async (t) => {
  const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'srt-static-lexical-'));
  t.after(() => fs.promises.rm(temporaryRoot, { recursive: true, force: true }));
  const staticRoot = path.join(temporaryRoot, 'app');
  await fs.promises.mkdir(staticRoot);
  await fs.promises.writeFile(path.join(staticRoot, '主页.html'), 'inside');
  await fs.promises.writeFile(path.join(temporaryRoot, 'outside.txt'), 'outside-secret');
  const server = await startCustomServer(t, staticRoot);

  for (const pathname of ['/../outside.txt', '/%2e%2e/outside.txt']) {
    const traversal = await request(server, pathname);
    assert.ok([403, 404].includes(traversal.statusCode));
    assert.equal(traversal.headers['content-type'], 'text/plain; charset=utf-8');
    assert.notEqual(traversal.body.toString(), 'outside-secret');
  }

  const healthy = await request(server, '/');
  assert.equal(healthy.statusCode, 200);
  assert.equal(healthy.body.toString(), 'inside');
});

test('a linked file cannot escape the canonical static root', async (t) => {
  const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'srt-static-link-'));
  t.after(() => fs.promises.rm(temporaryRoot, { recursive: true, force: true }));
  const staticRoot = path.join(temporaryRoot, 'app');
  const outsideFile = path.join(temporaryRoot, 'outside.txt');
  await fs.promises.mkdir(staticRoot);
  await fs.promises.writeFile(path.join(staticRoot, '主页.html'), 'inside');
  await fs.promises.writeFile(outsideFile, 'outside-secret');
  await fs.promises.symlink(outsideFile, path.join(staticRoot, 'linked.txt'));
  const server = await startCustomServer(t, staticRoot);

  const linked = await request(server, '/linked.txt');
  assert.ok([403, 404].includes(linked.statusCode));
  assert.equal(linked.headers['content-type'], 'text/plain; charset=utf-8');
  assert.notEqual(linked.body.toString(), 'outside-secret');

  const healthy = await request(server, '/');
  assert.equal(healthy.statusCode, 200);
  assert.equal(healthy.body.toString(), 'inside');
});

test('scenario package-manager commands stay on their declared platform', async () => {
  const windows = createScenarioDependencies('windows-ready');
  await assert.rejects(windows.dependencies.run('brew', ['--version']), { code: 'ENOENT' });
  await assert.rejects(windows.dependencies.run('brew', ['install', 'ffmpeg']), { code: 'ENOENT' });
  assert.equal(windows.state.ffmpegInstallCount, 0);
  assert.equal(windows.state.confirmationCount, 0);

  const mac = createScenarioDependencies('mac-ready');
  await assert.rejects(mac.dependencies.run('winget', ['--version']), { code: 'ENOENT' });
  await assert.rejects(mac.dependencies.run('winget', [
    'install', '--id', 'Gyan.FFmpeg', '--exact', '--accept-package-agreements', '--accept-source-agreements'
  ]), { code: 'ENOENT' });
  assert.equal(mac.state.ffmpegInstallCount, 0);
  assert.equal(mac.state.confirmationCount, 0);
});

test('fixture diagnostics cover existing and newly-created renderer windows', () => {
  const existing = new EventEmitter();
  const future = new EventEmitter();
  const electronApp = new EventEmitter();
  electronApp.windows = () => [existing];
  const diagnostics = [];

  const detach = fixtureInternals.registerRendererDiagnostics(electronApp, diagnostics);
  existing.emit('console', { type: () => 'warning', text: () => 'existing window' });
  electronApp.emit('window', future);
  future.emit('pageerror', new Error('future window'));

  assert.equal(diagnostics[0], '[renderer:warning] existing window');
  assert.match(diagnostics[1], /^\[renderer:pageerror\] Error: future window/);
  detach();
});

test('fixture cleanup preserves failures while still closing Electron and deleting its temp directory', async (t) => {
  const userDataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'srt-fixture-cleanup-'));
  t.after(() => fs.promises.rm(userDataDir, { recursive: true, force: true }));
  const screenshotPath = path.join(userDataDir, 'failure.png');
  const diagnostics = ['primary diagnostic'];
  const attemptedAttachments = [];
  let closeAttempted = false;
  const testInfo = {
    outputPath: () => screenshotPath,
    attach: async (name) => {
      attemptedAttachments.push(name);
      throw new Error(`attachment failed: ${name}`);
    }
  };
  const window = {
    isClosed: () => false,
    screenshot: async ({ path: target }) => fs.promises.writeFile(target, 'image')
  };
  const electronApp = {
    close: async () => {
      closeAttempted = true;
      throw new Error('close failed');
    }
  };

  const cleanupErrors = await fixtureInternals.cleanupElectronFixture({
    unexpectedFailure: true,
    window,
    testInfo,
    diagnostics,
    electronApp,
    userDataDir
  });

  assert.equal(closeAttempted, true);
  await assert.rejects(fs.promises.access(userDataDir), { code: 'ENOENT' });
  assert.ok(attemptedAttachments.includes('failure-screenshot'));
  assert.ok(attemptedAttachments.includes('electron-diagnostics'));
  assert.ok(attemptedAttachments.includes('fixture-cleanup-diagnostics'));
  assert.ok(cleanupErrors.some((error) => /attachment failed/.test(error.message)));
  assert.ok(cleanupErrors.some((error) => /close failed/.test(error.message)));
});
