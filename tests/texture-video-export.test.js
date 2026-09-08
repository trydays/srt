const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const texture = require('../src/video-texture');
const { createVideoExportService } = require('../src/video-export');

const run = promisify(execFile);

async function rgbaFrame(ffmpeg, file, time, width, height) {
  const result = await run(ffmpeg, ['-v', 'error', '-ss', String(time), '-i', file,
    '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { encoding: 'buffer', maxBuffer: width * height * 8 });
  return new Uint8ClampedArray(result.stdout);
}

test('real ffmpeg texture filters agree with independent RGBA formulas', {
  skip: process.env.SRT_REAL_EXPORT !== '1'
}, async (t) => {
  const ffmpeg = process.env.SRT_FFMPEG_PATH;
  assert.ok(ffmpeg);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'srt-cycle6-texture-raw-'));
  if (process.env.SRT_KEEP_REAL_EXPORT === '1') console.log(`REAL_TEXTURE_RAW_DIR=${directory}`);
  else t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const width = 7, height = 5;
  const input = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < input.length; i += 4) {
    input[i] = 30 + (i % 170); input[i + 1] = 80; input[i + 2] = 220 - (i % 90); input[i + 3] = 255;
  }
  const inputPath = path.join(directory, 'input.rgba');
  await fs.writeFile(inputPath, input);
  for (const [kind, params, time] of [
    ['noise', { amount: 1 }, 13 / 12], ['vignette', { strength: 1 }, 1.5]
  ]) {
    const output = path.join(directory, `${kind}.rgba`);
    const filter = texture.buildFilter(kind, params, { start: 1, end: 2 });
    await run(ffmpeg, ['-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`,
      '-r', '24', '-i', inputPath, '-vf', `setpts=${time}/TB,${filter}`,
      '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', output]);
    const actual = new Uint8ClampedArray(await fs.readFile(output));
    const expected = new Uint8ClampedArray(input);
    texture.applyFrame(kind, params, expected, width, height, time);
    assert.equal(actual.length, expected.length);
    for (let i = 0; i < actual.length; i += 1) assert.ok(Math.abs(actual[i] - expected[i]) <= 1,
      `${kind} byte ${i}: ${actual[i]} vs ${expected[i]}`);
  }
});

test('real export writes playable ordered texture MP4 and preserves audio', {
  skip: process.env.SRT_REAL_EXPORT !== '1'
}, async (t) => {
  const ffmpeg = process.env.SRT_FFMPEG_PATH, ffprobe = process.env.SRT_FFPROBE_PATH;
  assert.ok(ffmpeg); assert.ok(ffprobe);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'srt-cycle6-texture-video-'));
  if (process.env.SRT_KEEP_REAL_EXPORT === '1') console.log(`REAL_TEXTURE_EXPORT_DIR=${directory}`);
  else t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'source.mp4'), output = path.join(directory, 'texture.mp4');
  await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=96x64:r=24:d=4',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=4',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source]);
  const service = createVideoExportService({ getExportTools: async () => ({ ffmpegPath: ffmpeg, ffprobePath: ffprobe }) });
  const result = await service.start({ jobId: 'texture-real', videoPath: source, outputPath: output,
    recipe: { version: 1, steps: [
      { capability: 'video.noise@1', range: { start: 1, end: 3 }, params: { amount: 0.6 } },
      { capability: 'video.vignette@1', range: { start: 0, end: 4 }, params: { strength: 0.8 } }
    ] } });
  assert.deepEqual(result, { jobId: 'texture-real', status: 'completed', outputPath: output });
  const probe = JSON.parse((await run(ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', output])).stdout);
  assert.ok(probe.streams.some(stream => stream.codec_type === 'audio'));
  const before = await rgbaFrame(ffmpeg, source, 1.5, 96, 64);
  const after = await rgbaFrame(ffmpeg, output, 1.5, 96, 64);
  let changed = 0;
  for (let i = 0; i < after.length; i += 4) if (Math.abs(after[i] - before[i]) > 3) changed += 1;
  assert.ok(changed > 96 * 64 / 2);
});
