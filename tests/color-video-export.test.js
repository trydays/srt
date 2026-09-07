const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createVideoExportService } = require('../src/video-export');

const run = promisify(execFile);
const WIDTH = 320;
const HEIGHT = 240;

async function frame(ffmpeg, file, time) {
  const { stdout } = await run(ffmpeg, ['-v', 'error', '-ss', String(time), '-i', file,
    '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'],
  { encoding: 'buffer', maxBuffer: WIDTH * HEIGHT * 3 * 2 });
  assert.equal(stdout.length, WIDTH * HEIGHT * 3);
  return stdout;
}

function statistics(rgb) {
  let red = 0, blue = 0, luma = 0, square = 0, chroma = 0;
  const pixels = rgb.length / 3;
  for (let i = 0; i < rgb.length; i += 3) {
    const r = rgb[i], g = rgb[i + 1], b = rgb[i + 2];
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    red += r; blue += b; luma += y; square += y * y;
    chroma += Math.sqrt((r - y) ** 2 + (g - y) ** 2 + (b - y) ** 2);
  }
  return { blueRed: blue / red, luma: luma / pixels, chroma: chroma / pixels,
    spread: Math.sqrt(square / pixels - (luma / pixels) ** 2) };
}

function meanAbsoluteDifference(a, b) {
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference += Math.abs(a[i] - b[i]);
  return difference / a.length;
}

test('real color exports preserve media and isolate all four parameters to [1,3)', {
  skip: process.env.SRT_REAL_EXPORT !== '1', timeout: 120000
}, async (t) => {
  const ffmpegPath = process.env.SRT_FFMPEG_PATH;
  const ffprobePath = process.env.SRT_FFPROBE_PATH;
  assert.ok(ffmpegPath, 'SRT_FFMPEG_PATH is required');
  assert.ok(ffprobePath, 'SRT_FFPROBE_PATH is required');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'srt-cycle2-color-'));
  if (process.env.SRT_KEEP_REAL_EXPORT !== '1') {
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
  }
  const source = path.join(directory, 'source.mp4');
  // One static, conditioned multi-color source leaves headroom for saturation
  // and contrast, while retaining measurable color and luma differences.
  await run(ffmpegPath, ['-v', 'error', '-n', '-f', 'lavfi', '-i',
    `smptebars=size=${WIDTH}x${HEIGHT}:rate=25`, '-f', 'lavfi', '-i',
    'sine=frequency=660:sample_rate=48000', '-t', '4', '-vf',
    'eq=saturation=0.45:contrast=0.55:brightness=0.03',
    '-c:v', 'libx264', '-crf', '10', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source]);
  const times = [0.5, 1, 2, 3, 3.5];
  const originals = new Map();
  for (const time of times) originals.set(time, await frame(ffmpegPath, source, time));
  const service = createVideoExportService({
    getExportTools: async () => ({ ffmpegPath, ffprobePath })
  });
  const evidence = [];
  const cases = [
    ['temperature', -1, 'blueRed', 1.2],
    ['brightness', 0.5, 'luma', 1.15],
    ['saturation', 1.8, 'chroma', 1.35],
    ['contrast', 1.6, 'spread', 1.3]
  ];
  for (const [parameter, value, metric, minimumRatio] of cases) {
    await t.test(parameter, async () => {
      const output = path.join(directory, `${parameter}.mp4`);
      const params = { temperature: 0, brightness: 0, saturation: 1, contrast: 1,
        [parameter]: value };
      const result = await service.start({ jobId: `real-${parameter}`, videoPath: source,
        outputPath: output, recipe: { version: 1, steps: [
          { capability: 'video.color.adjust@1', range: { start: 1, end: 3 }, params }
        ] } });
      assert.deepEqual(result, { jobId: `real-${parameter}`, status: 'completed', outputPath: output });
      const { stdout } = await run(ffprobePath, ['-v', 'error', '-show_format',
        '-show_streams', '-of', 'json', output]);
      const probe = JSON.parse(stdout);
      const video = probe.streams.find(stream => stream.codec_type === 'video');
      assert.deepEqual([video.width, video.height, video.codec_name], [WIDTH, HEIGHT, 'h264']);
      assert.equal(probe.streams.find(stream => stream.codec_type === 'audio').codec_name, 'aac');
      assert.ok(Math.abs(Number(probe.format.duration) - 4) < 0.1);
      const samples = [];
      for (const time of times) {
        const rendered = await frame(ffmpegPath, output, time);
        const difference = meanAbsoluteDifference(originals.get(time), rendered);
        const ratio = statistics(rendered)[metric] / statistics(originals.get(time))[metric];
        if (time >= 1 && time < 3) {
          assert.ok(ratio > minimumRatio, `${parameter} at ${time}s: ${metric} ratio ${ratio}`);
        } else {
          assert.ok(difference < 4, `${parameter} leaked at ${time}s: mean RGB difference ${difference}`);
        }
        samples.push({ time, difference, ratio });
      }
      evidence.push({ parameter, value, metric, samples, output });
    });
  }
  console.log(`COLOR_EXPORT_EVIDENCE=${JSON.stringify({ directory, evidence })}`);
});
