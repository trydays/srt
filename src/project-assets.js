const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);

const KINDS = Object.freeze({ '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.webp': 'image', '.mp4': 'video' });
function coded(code) { const error = new Error(code); error.code = code; return error; }
function validId(value) { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value); }
function indexName(projectId) { if (!validId(projectId)) throw coded('PROJECT_ASSET_INVALID'); return `${encodeURIComponent(projectId)}.json`; }
function summary(entry) {
  const value = { assetId: entry.assetId, name: entry.name, kind: entry.kind, width: entry.width, height: entry.height };
  if (entry.kind === 'video') value.durationSeconds = entry.durationSeconds;
  return value;
}
function validIndex(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || value.version !== 1 || !Array.isArray(value.assets)
      || Object.keys(value).length !== 2) return false;
  const ids = new Set();
  return value.assets.every(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
        || !validId(entry.assetId) || ids.has(entry.assetId)
        || typeof entry.name !== 'string' || !entry.name
        || (entry.kind !== 'image' && entry.kind !== 'video')
        || !Number.isSafeInteger(entry.width) || entry.width <= 0
        || !Number.isSafeInteger(entry.height) || entry.height <= 0
        || typeof entry.filePath !== 'string' || !path.isAbsolute(entry.filePath)) return false;
    const expected = entry.kind === 'video'
      ? ['assetId', 'durationSeconds', 'filePath', 'height', 'kind', 'name', 'width']
      : ['assetId', 'filePath', 'height', 'kind', 'name', 'width'];
    if (Object.keys(entry).sort().join('\0') !== expected.join('\0')
        || (entry.kind === 'video' && (!Number.isFinite(entry.durationSeconds) || entry.durationSeconds <= 0))) return false;
    ids.add(entry.assetId);
    return true;
  });
}
async function nativeProbe(filePath, kind, ffprobePath) {
  if (!ffprobePath) throw coded('PROJECT_ASSET_PROBE_UNAVAILABLE');
  let parsed;
  try {
    const { stdout } = await execFileAsync(ffprobePath, ['-v','error','-show_streams','-show_format','-of','json',filePath], { encoding: 'utf8', timeout: 15000, windowsHide: true });
    parsed = JSON.parse(stdout);
  } catch (_) { throw coded('PROJECT_ASSET_INVALID_MEDIA'); }
  const video = Array.isArray(parsed.streams) && parsed.streams.find(stream => stream && stream.codec_type === 'video');
  const width = Number(video && video.width), height = Number(video && video.height);
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) throw coded('PROJECT_ASSET_INVALID_MEDIA');
  if (kind === 'image') return { width, height };
  const durationSeconds = Number(video.duration || parsed.format && parsed.format.duration);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw coded('PROJECT_ASSET_INVALID_MEDIA');
  return { width, height, durationSeconds };
}
function createProjectAssetStore({ rootDir, probeFile, ffprobePath } = {}) {
  if (typeof rootDir !== 'string' || !rootDir) throw new TypeError('rootDir is required');
  const directory = path.join(rootDir, 'project-assets');
  const probe = probeFile || ((filePath, kind) => nativeProbe(filePath, kind, ffprobePath));
  async function read(projectId) {
    try {
      const value = JSON.parse(await fs.readFile(path.join(directory, indexName(projectId)), 'utf8'));
      if (!validIndex(value)) throw coded('PROJECT_ASSET_INDEX_INVALID');
      return value.assets;
    }
    catch (error) { if (error.code === 'ENOENT') return []; throw coded('PROJECT_ASSET_INDEX_INVALID'); }
  }
  async function write(projectId, assets) {
    await fs.mkdir(directory, { recursive: true });
    const target = path.join(directory, indexName(projectId));
    const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
    await fs.writeFile(temp, JSON.stringify({ version: 1, assets }), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temp, target);
  }
  async function importFile({ projectId, filePath } = {}) {
    indexName(projectId);
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw coded('PROJECT_ASSET_INVALID');
    const kind = KINDS[path.extname(filePath).toLowerCase()];
    if (!kind) throw coded('PROJECT_ASSET_UNSUPPORTED');
    let realPath;
    try { realPath = await fs.realpath(filePath); if (!(await fs.stat(realPath)).isFile()) throw new Error(); }
    catch (_) { throw coded('PROJECT_ASSET_MISSING'); }
    const assets = await read(projectId), existing = assets.find(item => item.filePath === realPath);
    if (existing) return summary(existing);
    let facts;
    try { facts = await probe(realPath, kind); } catch (error) { throw error && error.code ? error : coded('PROJECT_ASSET_INVALID_MEDIA'); }
    if (!facts || !Number.isSafeInteger(facts.width) || facts.width <= 0 || !Number.isSafeInteger(facts.height) || facts.height <= 0
        || (kind === 'video' && (!Number.isFinite(facts.durationSeconds) || facts.durationSeconds <= 0))) throw coded('PROJECT_ASSET_INVALID_MEDIA');
    const entry = { assetId: `asset-${randomUUID()}`, name: path.basename(realPath), kind, width: facts.width, height: facts.height,
      ...(kind === 'video' ? { durationSeconds: facts.durationSeconds } : {}), filePath: realPath };
    assets.push(entry); await write(projectId, assets); return summary(entry);
  }
  async function list(projectId) { return (await read(projectId)).map(summary); }
  async function resolve({ projectId, assetIds } = {}) {
    if (!Array.isArray(assetIds) || assetIds.some(id => !validId(id))) throw coded('PROJECT_ASSET_INVALID');
    const assets = await read(projectId), byId = new Map(assets.map(item => [item.assetId, item]));
    const entries = assetIds.map(id => { const entry = byId.get(id); if (!entry) throw coded('PROJECT_ASSET_UNKNOWN'); return entry; });
    for (const entry of entries) { try { if (!(await fs.stat(entry.filePath)).isFile()) throw new Error(); } catch (_) { throw coded('PROJECT_ASSET_MISSING'); } }
    return entries.map(entry => ({ assetId: entry.assetId, filePath: entry.filePath }));
  }
  async function validate({ projectId, layers, range } = {}) {
    if (!Array.isArray(layers) || !range || !Number.isFinite(range.start) || !Number.isFinite(range.end) || range.end <= range.start) throw coded('PROJECT_ASSET_INVALID');
    const assets = await read(projectId), byId = new Map(assets.map(item => [item.assetId, item])), ids = [];
    for (const layer of layers) {
      if (!layer || (layer.kind !== 'image' && layer.kind !== 'video') || !layer.params || !validId(layer.params.assetId)) continue;
      const entry = byId.get(layer.params.assetId); if (!entry) throw coded('PROJECT_ASSET_UNKNOWN');
      if (entry.kind !== layer.kind) throw coded('PROJECT_ASSET_KIND_MISMATCH');
      const start = layer.kind === 'video' ? (layer.params.sourceStartSeconds || 0) : 0;
      if (layer.kind === 'video' && start + (range.end - range.start) > entry.durationSeconds + 1e-9) throw coded('PROJECT_ASSET_VIDEO_TOO_SHORT');
      ids.push(entry.assetId);
    }
    await resolve({ projectId, assetIds: ids });
    return { ok: true, assetIds: Array.from(new Set(ids)).sort() };
  }
  return { importFile, list, resolve, validate };
}
module.exports = { createProjectAssetStore };
