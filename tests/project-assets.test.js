const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createProjectAssetStore } = require('../src/project-assets');

async function fixture(t) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'srt-assets-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const imagePath = path.join(rootDir, 'card.png'); await fs.writeFile(imagePath, 'png');
  const videoPath = path.join(rootDir, 'clip.mp4'); await fs.writeFile(videoPath, 'mp4');
  const probeFile = async (filePath, kind) => kind === 'image'
    ? { width: 200, height: 100 } : { width: 640, height: 360, durationSeconds: 2.5 };
  return { rootDir, imagePath, videoPath, probeFile };
}

test('imports supported decoded media and persists stable path-free summaries', async (t) => {
  const f = await fixture(t), store = createProjectAssetStore({ rootDir: f.rootDir, probeFile: f.probeFile });
  const first = await store.importFile({ projectId: 'project-a', filePath: f.imagePath });
  const again = await store.importFile({ projectId: 'project-a', filePath: f.imagePath });
  assert.deepEqual(again, first);
  assert.deepEqual(Object.keys(first).sort(), ['assetId','height','kind','name','width']);
  assert.equal(JSON.stringify(await store.list('project-a')).includes(f.rootDir), false);
  assert.deepEqual(await createProjectAssetStore({ rootDir: f.rootDir, probeFile: f.probeFile }).list('project-a'), [first]);
  assert.deepEqual(await store.list('project-b'), []);
});

test('resolve is project scoped, ordered and detects moved files', async (t) => {
  const f = await fixture(t), store = createProjectAssetStore({ rootDir: f.rootDir, probeFile: f.probeFile });
  const image = await store.importFile({ projectId: 'a', filePath: f.imagePath });
  const video = await store.importFile({ projectId: 'a', filePath: f.videoPath });
  assert.deepEqual((await store.resolve({ projectId: 'a', assetIds: [video.assetId, image.assetId] })).map(x => x.assetId), [video.assetId, image.assetId]);
  await assert.rejects(store.resolve({ projectId: 'b', assetIds: [image.assetId] }), { code: 'PROJECT_ASSET_UNKNOWN' });
  await fs.unlink(f.imagePath);
  await assert.rejects(store.resolve({ projectId: 'a', assetIds: [image.assetId] }), { code: 'PROJECT_ASSET_MISSING' });
});

test('validates referenced kinds and remaining video duration before commit', async (t) => {
  const f = await fixture(t), store = createProjectAssetStore({ rootDir: f.rootDir, probeFile: f.probeFile });
  const image = await store.importFile({ projectId: 'a', filePath: f.imagePath });
  const video = await store.importFile({ projectId: 'a', filePath: f.videoPath });
  const layers = [{ kind: 'image', params: { assetId: image.assetId } },
    { kind: 'video', params: { assetId: video.assetId, sourceStartSeconds: .5 } }];
  assert.deepEqual(await store.validate({ projectId: 'a', layers, range: { start: 1, end: 3 } }), { ok: true, assetIds: [image.assetId, video.assetId].sort() });
  await assert.rejects(store.validate({ projectId: 'a', layers, range: { start: 1, end: 3.01 } }), { code: 'PROJECT_ASSET_VIDEO_TOO_SHORT' });
  await assert.rejects(store.validate({ projectId: 'b', layers, range: { start: 1, end: 2 } }), { code: 'PROJECT_ASSET_UNKNOWN' });
});

test('rejects a structurally invalid index without overwriting its bytes', async (t) => {
  const f = await fixture(t), store = createProjectAssetStore({ rootDir: f.rootDir, probeFile: f.probeFile });
  const indexDir = path.join(f.rootDir, 'project-assets');
  const indexPath = path.join(indexDir, 'project-a.json');
  const malformed = '{"version":1,"assets":{}}\n';
  await fs.mkdir(indexDir, { recursive: true });
  await fs.writeFile(indexPath, malformed);
  await assert.rejects(store.list('project-a'), { code: 'PROJECT_ASSET_INDEX_INVALID' });
  await assert.rejects(store.importFile({ projectId: 'project-a', filePath: f.imagePath }),
    { code: 'PROJECT_ASSET_INDEX_INVALID' });
  assert.equal(await fs.readFile(indexPath, 'utf8'), malformed);
});
