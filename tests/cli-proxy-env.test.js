const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveCliEnv } = require('../src/cli-proxy-env');

test('explicit proxy and bypass settings take precedence without reading system settings', async () => {
  const env = { https_proxy: 'http://custom.example:8765', NO_PROXY: 'localhost', PATH: '/bin' };
  assert.deepEqual(await resolveCliEnv(env, 'darwin', () => { throw new Error('must not read'); }), env);
});

test('uses current proxy settings on every request, without mutating the source', async () => {
  let port = 8877;
  const read = async () => `HTTPSEnable : 1\nHTTPSProxy : localhost\nHTTPSPort : ${port}`;
  const env = { PATH: '/bin' };
  assert.equal((await resolveCliEnv(env, 'darwin', read)).HTTPS_PROXY, 'http://localhost:8877');
  port = 9988;
  assert.equal((await resolveCliEnv(env, 'darwin', read)).HTTPS_PROXY, 'http://localhost:9988');
  assert.deepEqual(env, { PATH: '/bin' });
});

test('disabled, malformed or unavailable system proxy preserves the environment', async () => {
  const env = { PATH: '/bin' };
  for (const text of ['', 'HTTPSEnable : 0\nHTTPSProxy : localhost\nHTTPSPort : 8888',
    'HTTPSEnable : 1\nHTTPSProxy : localhost\nHTTPSPort : 99999']) {
    assert.deepEqual(await resolveCliEnv(env, 'darwin', async () => text), env);
  }
  assert.deepEqual(await resolveCliEnv(env, 'darwin', async () => { throw new Error('unavailable'); }), env);
});

test('non-macOS keeps its supplied environment', async () => {
  const env = { PATH: '/bin' };
  assert.deepEqual(await resolveCliEnv(env, 'linux', () => { throw new Error('must not read'); }), env);
});
