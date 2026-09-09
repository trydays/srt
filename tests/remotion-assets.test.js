const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createRenderAssetSession, createRenderAssetSessions } = require('../src/remotion-assets');

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'srt-remotion-assets-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const videoPath = path.join(directory, '示例 video.mp4');
  const contents = Buffer.from('0123456789abcdef');
  await fs.writeFile(videoPath, contents);
  return { directory, videoPath, contents };
}

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.once('end', () => resolve({
        statusCode: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks)
      }));
    });
    req.once('error', reject);
    req.end();
  });
}

test('serves only the selected real file through its opaque session route', async (t) => {
  const { videoPath, contents } = await fixture(t);
  const session = await createRenderAssetSession({ assetId: 'asset-main', videoPath });
  t.after(() => session.close());

  const response = await request(session.assets['asset-main'].src, {
    headers: { Origin: 'file://' }
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, contents);
  assert.equal(response.headers['content-type'], 'video/mp4');
  assert.equal(response.headers['access-control-allow-origin'], '*');

  const arbitrary = new URL(session.assets['asset-main'].src);
  arbitrary.pathname = '/etc/passwd';
  const blocked = await request(arbitrary);
  assert.equal(blocked.statusCode, 404);
  assert.equal(blocked.body.length, 0);
});

test('combines multiple referenced files and cleans prepared sessions on failure', async (t) => {
  const { videoPath } = await fixture(t);
  const second = path.join(path.dirname(videoPath), 'image.png'); await fs.writeFile(second, 'image');
  const combined = await createRenderAssetSessions({ assets: [
    { assetId: 'main', filePath: videoPath }, { assetId: 'image', filePath: second }
  ] });
  assert.deepEqual(Object.keys(combined.assets).sort(), ['image', 'main']);
  assert.equal((await request(combined.assets.image.src)).headers['content-type'], 'image/png');
  const mainUrl = combined.assets.main.src;
  await combined.close();
  await assert.rejects(request(mainUrl));

  let closed = 0;
  await assert.rejects(createRenderAssetSessions({ assets: [
    { assetId: 'first', filePath: videoPath }, { assetId: 'bad', filePath: '/missing' }
  ], createSession: async (item) => item.assetId === 'bad' ? Promise.reject(new Error('bad'))
    : { assets: { first: { src: 'http://127.0.0.1:1/a' } }, close: async () => { closed++; } } }));
  assert.equal(closed, 1);
});

test('supports HEAD without reading a body', async (t) => {
  const { videoPath, contents } = await fixture(t);
  const session = await createRenderAssetSession({ assetId: 'asset-main', videoPath });
  t.after(() => session.close());

  const response = await request(session.assets['asset-main'].src, { method: 'HEAD' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-length'], String(contents.length));
  assert.equal(response.headers['accept-ranges'], 'bytes');
  assert.equal(response.body.length, 0);
});

test('serves a single byte range and rejects unsatisfiable ranges', async (t) => {
  const { videoPath, contents } = await fixture(t);
  const session = await createRenderAssetSession({ assetId: 'asset-main', videoPath });
  t.after(() => session.close());

  const partial = await request(session.assets['asset-main'].src, {
    headers: { Range: 'bytes=3-7' }
  });
  assert.equal(partial.statusCode, 206);
  assert.equal(partial.headers['content-range'], `bytes 3-7/${contents.length}`);
  assert.equal(partial.headers['content-length'], '5');
  assert.deepEqual(partial.body, contents.subarray(3, 8));

  const invalid = await request(session.assets['asset-main'].src, {
    headers: { Range: 'bytes=99-100' }
  });
  assert.equal(invalid.statusCode, 416);
  assert.equal(invalid.headers['content-range'], `bytes */${contents.length}`);
  assert.equal(invalid.body.length, 0);
});

test('requires a regular real file and closes idempotently', async (t) => {
  const { directory, videoPath } = await fixture(t);
  await assert.rejects(
    createRenderAssetSession({ assetId: 'asset-main', videoPath: directory })
  );

  const session = await createRenderAssetSession({ assetId: 'asset-main', videoPath });
  const sourceUrl = session.assets['asset-main'].src;
  await Promise.all([session.close(), session.close()]);
  await assert.rejects(request(sourceUrl));
});

test('close terminates a paused active stream before releasing the file', { timeout: 5000 }, async (t) => {
  const { videoPath } = await fixture(t);
  await fs.writeFile(videoPath, Buffer.alloc(8 * 1024 * 1024, 7));
  const session = await createRenderAssetSession({ assetId: 'asset-main', videoPath });
  let response;
  let markStopped;
  const stopped = new Promise((resolve) => { markStopped = resolve; });
  const firstChunk = new Promise((resolve, reject) => {
    const req = http.get(session.assets['asset-main'].src, (incoming) => {
      response = incoming;
      incoming.once('data', () => {
        incoming.pause();
        resolve();
      });
      incoming.once('error', markStopped);
      incoming.once('aborted', markStopped);
      incoming.once('close', markStopped);
    });
    req.once('error', reject);
  });
  await firstChunk;

  await session.close();
  await stopped;
  assert.equal(response.destroyed, true);
  await assert.rejects(request(session.assets['asset-main'].src));
});

test('aborting a video request preserves the session for a remounted video and concurrent ranges', { timeout: 5000 }, async (t) => {
  const { videoPath } = await fixture(t);
  const contents = Buffer.alloc(8 * 1024 * 1024, 7);
  await fs.writeFile(videoPath, contents);
  const session = await createRenderAssetSession({ assetId: 'asset-main', videoPath });
  t.after(() => session.close());
  const url = session.assets['asset-main'].src;
  await new Promise((resolve, reject) => {
    const req = http.get(url, response => {
      response.once('data', () => { response.destroy(); });
      response.once('close', resolve);
      response.once('error', reject);
    });
    req.once('error', reject);
  });
  for (let turn = 0; turn < 3; turn++) {
    const responses = await Promise.all([request(url, { headers: { Range: 'bytes=32-63' } }),
      request(url, { headers: { Range: 'bytes=128-255' } })]);
    assert.deepEqual(responses[0].body, contents.subarray(32, 64));
    assert.deepEqual(responses[1].body, contents.subarray(128, 256));
  }
});
