const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createVideoExportService } = require('../src/video-export');

const run = promisify(execFile);
const W = 160, H = 120;
const range = { start: 1, end: 3 };
function transform(params) {
  return { capability: 'video.transform@1', range,
    params: { flipHorizontal: false, flipVertical: false, scale: 1, ...params } };
}
function pixel(frame, x, y, width = W) {
  return [...frame.subarray((y * width + x) * 3, (y * width + x) * 3 + 3)];
}
function close(actual, expected, label, tolerance = 18) {
  assert.ok(actual.every((v, i) => Math.abs(v - expected[i]) < tolerance),
    `${label}: actual ${actual}, expected ${expected}`);
}
async function frame(ffmpeg, file, time, width = W, height = H) {
  const { stdout } = await run(ffmpeg, ['-v', 'error', '-ss', String(time), '-i', file,
    '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'],
  { encoding: 'buffer', maxBuffer: width * height * 6 });
  assert.equal(stdout.length, width * height * 3);
  return stdout;
}
// Reference inverse mapping follows each stage separately, including its black
// frame and clipping. It deliberately does not import the production geometry.
function originalPoint(x, y, paramsList, width = W, height = H) {
  for (const params of [...paramsList].reverse()) {
    const sw = Math.max(1, Math.round(width * params.scale));
    const sh = Math.max(1, Math.round(height * params.scale));
    const ox = sw < width ? Math.floor((width - sw) / 2) : -Math.floor((sw - width) / 2);
    const oy = sh < height ? Math.floor((height - sh) / 2) : -Math.floor((sh - height) / 2);
    x = (x - ox + 0.5) * width / sw - 0.5;
    y = (y - oy + 0.5) * height / sh - 0.5;
    if (x < 0 || x >= width || y < 0 || y >= height) return null;
    if (params.flipHorizontal) x = width - 1 - x;
    if (params.flipVertical) y = height - 1 - y;
  }
  return [Math.round(x), Math.round(y)];
}

test('real product exports flips, center scaling, clipping and half-open ranges with audio', {
  skip: process.env.SRT_REAL_EXPORT !== '1', timeout: 120000
}, async t => {
  const ffmpegPath = process.env.SRT_FFMPEG_PATH, ffprobePath = process.env.SRT_FFPROBE_PATH;
  assert.ok(ffmpegPath && ffprobePath);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'srt-cycle3-transform-'));
  if (process.env.SRT_KEEP_REAL_EXPORT !== '1') t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'source.mp4');
  await run(ffmpegPath, ['-v', 'error', '-n', '-f', 'lavfi', '-i',
    `color=c=red:s=${W}x${H}:r=10,drawbox=x=80:y=0:w=80:h=60:color=lime:t=fill,drawbox=x=0:y=60:w=80:h=60:color=blue:t=fill,drawbox=x=80:y=60:w=80:h=60:color=yellow:t=fill,drawbox=x=24:y=18:w=24:h=18:color=white:t=fill,drawbox=x=8:y=80:w=12:h=24:color=magenta:t=fill`,
    '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000', '-t', '4',
    '-c:v', 'libx264', '-crf', '10', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source]);
  const original = await frame(ffmpegPath, source, 0);
  const service = createVideoExportService({ getExportTools: async () => ({ ffmpegPath, ffprobePath }) });
  const cases = [
    ['horizontal', [transform({ flipHorizontal: true })]],
    ['vertical', [transform({ flipVertical: true })]],
    ['enlarge', [transform({ scale: 1.5 })]],
    ['shrink', [transform({ scale: 0.5 })]],
    ['combined', [transform({ flipHorizontal: true, flipVertical: true, scale: 1.25 })]],
    ['shrink-enlarge', [transform({ scale: 0.5 }), transform({ scale: 1.5 })]],
    ['enlarge-shrink', [transform({ scale: 2 }), transform({ scale: 0.5 })]]
  ];
  const evidence = [];
  for (const [name, steps] of cases) await t.test(name, async () => {
    const output = path.join(directory, name + '.mp4');
    assert.deepEqual(await service.start({ jobId: name, videoPath: source, outputPath: output,
      recipe: { version: 1, steps } }), { jobId: name, status: 'completed', outputPath: output });
    const { stdout } = await run(ffprobePath, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', output]);
    const probe = JSON.parse(stdout), video = probe.streams.find(s => s.codec_type === 'video');
    assert.deepEqual([video.width, video.height, video.codec_name], [W, H, 'h264']);
    assert.equal(probe.streams.find(s => s.codec_type === 'audio').codec_name, 'aac');
    assert.ok(Math.abs(Number(probe.format.duration) - 4) < 0.1);
    let compared = 0, changed = 0;
    for (const time of [0.5, 1, 2, 3, 3.5]) {
      const rendered = await frame(ffmpegPath, output, time);
      const active = time >= 1 && time < 3;
      for (let y = 7; y < H; y += 13) for (let x = 7; x < W; x += 13) {
        const mapped = active ? originalPoint(x, y, steps.map(s => s.params)) : [x, y];
        const expected = mapped ? pixel(original, ...mapped) : [0, 0, 0];
        // Skip edge/resampling pixels; compare recognizable solid interior patches.
        if (mapped && [-3, 3].some(d => {
          const [mx, my] = mapped;
          return mx + d < 0 || mx + d >= W || my + d < 0 || my + d >= H
            || pixel(original, mx + d, my).some((v, i) => Math.abs(v - expected[i]) > 8)
            || pixel(original, mx, my + d).some((v, i) => Math.abs(v - expected[i]) > 8);
        })) continue;
        close(pixel(rendered, x, y), expected, `${name} at ${time}s (${x},${y})`);
        compared++;
        if (active && expected.some((v, i) => Math.abs(v - pixel(original, x, y)[i]) > 80)) changed++;
      }
    }
    assert.ok(compared > 100 && changed > 5, `${name}: ${compared} comparisons, ${changed} changes`);
    evidence.push({ name, output, compared, changed });
  });
  await t.test('mixed source effects keep graph order and compose subtitles last', async () => {
    const color = { capability: 'video.color.adjust@1', range,
      params: { temperature: 0, brightness: 0.8, saturation: 1, contrast: 1 } };
    const subtitle = { capability: 'subtitle.burn@1', params: { segments: [
      { id: 's', start: 1, end: 3, text: 'UPRIGHT' }
    ] } };
    const outputs = [];
    for (const colorAfterShrink of [false, true]) {
      const output = path.join(directory, `mixed-${colorAfterShrink}.mp4`);
      const effects = colorAfterShrink ? [transform({ scale: 0.5 }), color] : [color, transform({ scale: 0.5 })];
      const steps = [...effects, transform({ flipHorizontal: true }), subtitle];
      assert.equal((await service.start({ jobId: 'mixed', videoPath: source, outputPath: output,
        recipe: { version: 1, steps } })).status, 'completed');
      outputs.push(await frame(ffmpegPath, output, 1));
      close(pixel(await frame(ffmpegPath, output, 3), 12, 12), pixel(original, 12, 12), 'mixed end boundary');
      evidence.push({ name: `mixed-${colorAfterShrink}`, output });
    }
    close(pixel(outputs[0], 12, 12), [0, 0, 0], 'color before shrink leaves new margins black');
    assert.ok(pixel(outputs[1], 12, 12).every(v => v > 45), 'color after shrink brightens existing black margins');
    // Fixed subtitle style is only ~4 intrinsic pixels high on this fixture;
    // antialiasing lowers glyph intensity, but black margins remain near zero.
    let subtitlePixels = 0;
    for (let y = 100; y < 116; y++) for (let x = 40; x < 120; x++) {
      if (pixel(outputs[0], x, y).every(v => v > 80)) subtitlePixels++;
    }
    assert.ok(subtitlePixels > 8, 'subtitle stays at bottom outside transformed content');
  });
  await t.test('odd intermediate dimensions retain source geometry and sample aspect ratio', async () => {
    const oddSource = path.join(directory, 'sar-source.mp4'), output = path.join(directory, 'sar-transform.mp4');
    await run(ffmpegPath, ['-v', 'error', '-n', '-i', source, '-vf', 'scale=96:64,setsar=4/3',
      '-c:v', 'libx264', '-crf', '10', '-c:a', 'copy', oddSource]);
    assert.equal((await service.start({ jobId: 'odd-intermediate', videoPath: oddSource, outputPath: output,
      recipe: { version: 1, steps: [transform({ scale: 0.49 })] } })).status, 'completed');
    const { stdout } = await run(ffprobePath, ['-v', 'error', '-show_streams', '-of', 'json', output]);
    const video = JSON.parse(stdout).streams.find(s => s.codec_type === 'video');
    assert.deepEqual([video.width, video.height, video.sample_aspect_ratio], [96, 64, '4:3']);
    const actual = await frame(ffmpegPath, output, 1, 96, 64);
    close(pixel(actual, 12, 12, 96), [0, 0, 0], 'odd intermediate black margin');
    assert.ok(pixel(actual, 30, 20, 96)[0] > 200, 'odd intermediate scaled content remains visible');
    evidence.push({ name: 'odd-intermediate-sar', output });
  });
  console.log('TRANSFORM_EXPORT_EVIDENCE=' + JSON.stringify({ directory, evidence }));
});
