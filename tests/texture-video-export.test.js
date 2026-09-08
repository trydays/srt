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
const REAL = process.env.SRT_REAL_EXPORT === '1';

function independentNoise(data, width, height, time, amount) {
  const output = new Uint8ClampedArray(data);
  const micros = Math.floor(time * 1000000 + 0.5);
  const bucket = Math.floor((micros * 12 + 6) / 1000000) % 65521;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let z = ((x + 1) * 1973 + (y + 1) * 9277 + (bucket + 1) * 26699 + 911) % 65521;
    z = (31 * z * z + 17) % 65521; z = (31 * z * z + 17) % 65521;
    const delta = amount * 32 * ((z % 256 - 127.5) / 127.5), offset = (y * width + x) * 4;
    for (let c = 0; c < 3; c++) output[offset + c] = Math.min(255,
      Math.max(0, Math.floor(data[offset + c] + delta + .5)));
  }
  return output;
}

function independentVignette(data, width, height, strength) {
  const output = new Uint8ClampedArray(data), cx = (width - 1) / 2, cy = (height - 1) / 2;
  const denominator = Math.max(1, ((width - 1) ** 2 + (height - 1) ** 2) / 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const q = ((x - cx) ** 2 + (y - cy) ** 2) / denominator, offset = (y * width + x) * 4;
    for (let c = 0; c < 3; c++) output[offset + c] = Math.min(255,
      Math.max(0, Math.floor(data[offset + c] * (1 - strength * q) + .5)));
  }
  return output;
}

function maxRgbDifference(left, right) {
  let maximum = 0;
  for (let i = 0; i < left.length; i += 4) for (let c = 0; c < 3; c++)
    maximum = Math.max(maximum, Math.abs(left[i + c] - right[i + c]));
  return maximum;
}
function residuals(after, before) {
  const values = [];
  for (let i = 0; i < after.length; i += 4) values.push(after[i] - before[i]);
  return values;
}
function statistics(actual, predicted) {
  const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
  const am = mean(actual), pm = mean(predicted);
  const ar = Math.sqrt(mean(actual.map(v => v * v))), pr = Math.sqrt(mean(predicted.map(v => v * v)));
  let covariance = 0, as = 0, ps = 0;
  for (let i = 0; i < actual.length; i++) {
    const a = actual[i] - am, p = predicted[i] - pm;
    covariance += a * p; as += a * a; ps += p * p;
  }
  return { actualMean: am, predictedMean: pm, rmsRatio: ar / pr,
    correlation: covariance / Math.sqrt(as * ps) };
}
async function rgbaFrame(ffmpeg, file, time, width, height) {
  const result = await run(ffmpeg, ['-v', 'error', '-ss', String(time), '-i', file,
    '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'],
  { encoding: 'buffer', maxBuffer: width * height * 8 });
  return new Uint8ClampedArray(result.stdout);
}
async function exportVideo(ffmpeg, ffprobe, source, output, steps, jobId) {
  const service = createVideoExportService({ getExportTools: async () => ({ ffmpegPath: ffmpeg, ffprobePath: ffprobe }) });
  const result = await service.start({ jobId, videoPath: source, outputPath: output,
    recipe: { version: 1, steps } });
  assert.deepEqual(result, { jobId, status: 'completed', outputPath: output });
}
async function workspace(t, prefix) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  if (process.env.SRT_KEEP_REAL_EXPORT === '1') console.log(`REAL_TEXTURE_DIR=${directory}`);
  else t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('real raw FFmpeg agrees with independent arithmetic across geometry, time, extremes and order',
  { skip: !REAL }, async (t) => {
    const ffmpeg = process.env.SRT_FFMPEG_PATH; assert.ok(ffmpeg);
    const directory = await workspace(t, 'srt-cycle6-texture-raw-');
    for (const [width, height] of [[96, 64], [64, 96]]) {
      const input = new Uint8ClampedArray(width * height * 4);
      for (let i = 0; i < input.length; i += 4) {
        input[i] = 24 + (i / 4 % 180); input[i + 1] = 83;
        input[i + 2] = 226 - (i / 4 % 120); input[i + 3] = 37 + (i / 4 % 219);
      }
      const inputPath = path.join(directory, `input-${width}x${height}.rgba`); await fs.writeFile(inputPath, input);
      const cases = [
        { name: 'zero-before', time: .5, chain: [['noise', 0, 1, 3]] },
        { name: 'noise-start', time: 1, chain: [['noise', 1, 1, 3]] },
        { name: 'noise-middle', time: 2, chain: [['noise', 1, 1, 3]] },
        { name: 'noise-end', time: 3, chain: [['noise', 1, 1, 3]] },
        { name: 'vignette-after', time: 3.5, chain: [['vignette', 1, 1, 3]] },
        { name: 'noise-vignette', time: 2, chain: [['noise', .6, 1, 3], ['vignette', .8, 1, 3]] },
        { name: 'vignette-noise', time: 2, chain: [['vignette', .8, 1, 3], ['noise', .6, 1, 3]] }
      ];
      for (const item of cases) {
        let expected = new Uint8ClampedArray(input); const fragments = [];
        for (const [kind, value, start, end] of item.chain) {
          const params = kind === 'noise' ? { amount: value } : { strength: value };
          const fragment = texture.buildFilter(kind, params, { start, end }); if (fragment) fragments.push(fragment);
          if (item.time >= start && item.time < end) expected = kind === 'noise'
            ? independentNoise(expected, width, height, item.time, value)
            : independentVignette(expected, width, height, value);
        }
        const output = path.join(directory, `${width}x${height}-${item.name}.rgba`);
        await run(ffmpeg, ['-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`,
          '-r', '24', '-i', inputPath, '-vf', `setpts=${item.time}/TB,${fragments.length ? fragments.join(',') : 'null'}`,
          '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', output]);
        const actual = new Uint8ClampedArray(await fs.readFile(output));
        assert.ok(maxRgbDifference(actual, expected) <= 1, `${width}x${height} ${item.name}`);
      }
    }
  });

test('real grain-only MP4s meet frozen statistics, half-open timing and repeat determinism',
  { skip: !REAL }, async (t) => {
    const ffmpeg = process.env.SRT_FFMPEG_PATH, ffprobe = process.env.SRT_FFPROBE_PATH;
    assert.ok(ffmpeg); assert.ok(ffprobe);
    const directory = await workspace(t, 'srt-cycle6-grain-encoded-');
    const source = path.join(directory, 'neutral-with-audio.mp4');
    await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=96x64:r=24:d=4',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=4', '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', source]);
    const outputs = [];
    for (const [name, amount] of [['grain-06', .6], ['grain-1', 1], ['grain-06-repeat', .6]]) {
      const output = path.join(directory, `${name}.mp4`); outputs.push(output);
      await exportVideo(ffmpeg, ffprobe, source, output,
        [{ capability: 'video.noise@1', range: { start: 1, end: 3 }, params: { amount } }], name);
      const base = await rgbaFrame(ffmpeg, source, 1.5, 96, 64), actual = await rgbaFrame(ffmpeg, output, 1.5, 96, 64);
      const predicted = independentNoise(base, 96, 64, 1.5, amount);
      const stats = statistics(residuals(actual, base), residuals(predicted, base));
      assert.ok(stats.rmsRatio >= .8 && stats.rmsRatio <= 1.15, `${name} RMS ${stats.rmsRatio}`);
      assert.ok(Math.abs(stats.actualMean - stats.predictedMean) <= 3, `${name} mean drift`);
      assert.ok(stats.correlation >= .9, `${name} correlation ${stats.correlation}`);
      assert.ok(maxRgbDifference(await rgbaFrame(ffmpeg, output, 1.25, 96, 64), actual) > 5);
      for (const time of [.5, 3, 3.5]) assert.ok(maxRgbDifference(
        await rgbaFrame(ffmpeg, output, time, 96, 64), await rgbaFrame(ffmpeg, source, time, 96, 64)) <= 7);
    }
    assert.deepEqual(await rgbaFrame(ffmpeg, outputs[0], 1.5, 96, 64),
      await rgbaFrame(ffmpeg, outputs[2], 1.5, 96, 64));
  });

test('real vignette-only and color-grain-vignette-transform-subtitle exports preserve media and order',
  { skip: !REAL }, async (t) => {
    const ffmpeg = process.env.SRT_FFMPEG_PATH, ffprobe = process.env.SRT_FFPROBE_PATH;
    assert.ok(ffmpeg); assert.ok(ffprobe);
    const directory = await workspace(t, 'srt-cycle6-texture-composed-');
    const source = path.join(directory, 'blocks-with-audio.mp4');
    const neutral = path.join(directory, 'neutral.mp4');
    await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=96x64:r=24:d=4',
      '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000:duration=4', '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', source]);
    await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=96x64:r=24:d=4',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', neutral]);
    const vignette = path.join(directory, 'vignette-only.mp4');
    await exportVideo(ffmpeg, ffprobe, neutral, vignette,
      [{ capability: 'video.vignette@1', range: { start: 0, end: 4 }, params: { strength: 1 } }], 'vignette');
    const neutralOriginal = await rgbaFrame(ffmpeg, neutral, 2, 96, 64);
    const vignetted = await rgbaFrame(ffmpeg, vignette, 2, 96, 64);
    const pixel = (data, x, y) => data[(y * 96 + x) * 4];
    assert.ok(pixel(vignetted, 0, 0) <= 7);
    assert.ok(Math.abs(pixel(vignetted, 48, 32) - pixel(neutralOriginal, 48, 32)) <= 7);
    assert.ok(pixel(vignetted, 12, 32) < pixel(vignetted, 36, 32));
    const composed = path.join(directory, 'color-grain-vignette-transform-subtitle.mp4');
    await exportVideo(ffmpeg, ffprobe, source, composed, [
      { capability: 'video.color.adjust@1', range: { start: 0, end: 4 },
        params: { temperature: .25, brightness: 0, saturation: 1, contrast: 1 } },
      { capability: 'video.noise@1', range: { start: 1, end: 3 }, params: { amount: .6 } },
      { capability: 'video.vignette@1', range: { start: 0, end: 4 }, params: { strength: .8 } },
      { capability: 'video.transform@1', range: { start: 1, end: 3 },
        params: { flipHorizontal: true, flipVertical: false, scale: 1 } },
      { capability: 'subtitle.burn@1', params: { segments: [
        { id: 'top-layer', start: 1.25, end: 2.75, text: '纹理字幕' }
      ] } }
    ], 'composed');
    const original = await rgbaFrame(ffmpeg, source, 2, 96, 64);
    const probe = JSON.parse((await run(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', composed])).stdout);
    assert.ok(probe.streams.some(stream => stream.codec_type === 'audio'));
    const video = probe.streams.find(stream => stream.codec_type === 'video');
    assert.deepEqual([video.width, video.height], [96, 64]); assert.ok(Number(probe.format.duration) > 3.9);
    assert.ok(maxRgbDifference(await rgbaFrame(ffmpeg, composed, 2, 96, 64), original) > 20);
  });
