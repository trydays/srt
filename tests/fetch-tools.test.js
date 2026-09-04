const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { inspectBundledTools } = require('../src/environment/node-adapter');

test('fetch-tools writes real sizes that make a Windows release bundle discoverable', async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'srt-fetch-tools-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));

  const toolsRoot = path.join(root, 'resources', 'tools');
  await fs.promises.mkdir(toolsRoot, { recursive: true });
  await fs.promises.copyFile(path.join(__dirname, '..', 'fetch-tools.sh'), path.join(root, 'fetch-tools.sh'));

  const fileSizes = {
    'ffmpeg.exe': 2049,
    'ffprobe.exe': 2051,
    'node.exe': 2053,
    'python.exe': 2057
  };
  for (const [fileName, size] of Object.entries(fileSizes)) {
    await fs.promises.writeFile(path.join(toolsRoot, fileName), Buffer.alloc(size, fileName.length));
  }
  await fs.promises.writeFile(path.join(toolsRoot, 'tools-versions.json'), JSON.stringify({
    version: 1,
    bundled: {
      ffmpeg: { version: '8.0.1', exe: 'ffmpeg.exe', size: 6 },
      ffprobe: { version: '8.0.1', exe: 'ffprobe.exe', size: 6 },
      node: { version: '20.18.1', exe: 'node.exe', size: 6 },
      python: { version: '3.12.4', exe: 'python.exe', size: 6 },
      whisper: { version: 'large-v3', exe: 'ggml-large-v3.bin', size: 0 },
      vcredist: { version: '14.40', exe: 'VC_redist.x64.exe', size: 0 }
    }
  }));

  const result = spawnSync('bash', [path.join(root, 'fetch-tools.sh'), '--skip', 'large'], {
    cwd: root,
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const manifest = JSON.parse(await fs.promises.readFile(path.join(toolsRoot, 'tools-versions.json'), 'utf8'));
  for (const [toolId, fileName] of [['ffmpeg', 'ffmpeg.exe'], ['node', 'node.exe'], ['python', 'python.exe']]) {
    assert.equal(manifest.bundled[toolId].size, fileSizes[fileName]);
  }

  const tools = inspectBundledTools(toolsRoot, 'win32');
  assert.deepEqual(
    ['ffmpeg', 'node', 'python'].map((toolId) => [toolId, tools[toolId].available, tools[toolId].version]),
    [
      ['ffmpeg', true, '8.0.1'],
      ['node', true, '20.18.1'],
      ['python', true, '3.12.4']
    ]
  );
});
