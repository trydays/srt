const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { promisify } = require('node:util');
const { createVideoExportService } = require('../src/video-export');
const { buildGroupFilter, groupTextFiles } = require('../src/visual-group-export');

const execFileAsync = promisify(execFile);

function groupRecipe() {
  return {
    version: 1,
    steps: [{
      capability: 'visual.group@1',
      range: { start: 1, end: 3 },
      params: {
        layers: [{
          kind: 'shape',
          params: { x: 0.2, y: 0.25, width: 0.4, height: 0.4, color: '#E04020' }
        }, {
          kind: 'text',
          params: { text: '动画标题\n第二行', x: 0.23, y: 0.28, fontSize: 0.08, color: '#FFFFFF' }
        }],
        pivotX: 0.5,
        pivotY: 0.5,
        opacity: { keyframes: [
          { time: 0, value: 0, easing: 'linear' },
          { time: 1, value: 1, easing: 'back-out' },
          { time: 1.5, value: 1, easing: 'linear' },
          { time: 2, value: 0, easing: 'linear' }
        ] },
        scale: { keyframes: [
          { time: 0, value: 0.5, easing: 'linear' },
          { time: 1, value: 1, easing: 'back-out' }
        ] }
      }
    }, {
      capability: 'visual.group@1',
      range: { start: 1, end: 3 },
      params: {
        layers: [{
          kind: 'shape',
          params: { x: 0.55, y: 0.7, width: 0.2, height: 0.15, color: '#20D060' }
        }, {
          kind: 'shape',
          params: { x: 0.65, y: 0.7, width: 0.2, height: 0.15, color: '#20D060' }
        }],
        pivotX: 0.5,
        pivotY: 0.5,
        opacity: 0.5,
        scale: 1
      }
    }]
  };
}

async function rgbFrame(ffmpegPath, videoPath, frameIndex) {
  const { stdout } = await execFileAsync(ffmpegPath, [
    '-v', 'error', '-i', videoPath, '-vf', `select=eq(n\\,${frameIndex})`, '-frames:v', '1',
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'
  ], { encoding: 'buffer', maxBuffer: 320 * 240 * 4 });
  assert.equal(stdout.length, 320 * 240 * 3);
  return stdout;
}

function pixel(frame, x, y) {
  const offset = (y * 320 + x) * 3;
  return [frame[offset], frame[offset + 1], frame[offset + 2]];
}

function distance(left, right) {
  return Math.max(...left.map((value, index) => Math.abs(value - right[index])));
}

test('exports shared-opacity keyframed visual groups through real FFmpeg', {
  skip: process.env.SRT_REAL_EXPORT !== '1'
}, async (t) => {
  const ffmpegPath = process.env.SRT_FFMPEG_PATH;
  const ffprobePath = process.env.SRT_FFPROBE_PATH;
  assert.ok(ffmpegPath);
  assert.ok(ffprobePath);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'srt-cycle5-group-export-'));
  const sourcePath = path.join(directory, 'source.mp4');
  const outputPath = path.join(directory, 'group-export.mp4');
  if (process.env.SRT_KEEP_REAL_EXPORT === '1') console.log(`REAL_GROUP_EXPORT_DIR=${directory}`);
  else t.after(() => fs.rm(directory, { recursive: true, force: true }));

  await execFileAsync(ffmpegPath, [
    '-v', 'error', '-n', '-f', 'lavfi', '-i', 'color=c=0x102030:s=320x240:r=20',
    '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000',
    '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', sourcePath
  ]);
  const service = createVideoExportService({
    getExportTools: async () => ({ ffmpegPath, ffprobePath })
  });
  const result = await service.start({
    jobId: 'real-group-export', videoPath: sourcePath, outputPath, recipe: groupRecipe()
  }, () => {});

  assert.deepEqual(result, {
    jobId: 'real-group-export', status: 'completed', outputPath
  });
  const { stdout: probeText } = await execFileAsync(ffprobePath, [
    '-v', 'error', '-show_format', '-show_streams', '-of', 'json', outputPath
  ], { encoding: 'utf8' });
  const probe = JSON.parse(probeText);
  const video = probe.streams.find((stream) => stream.codec_type === 'video');
  const audio = probe.streams.find((stream) => stream.codec_type === 'audio');
  assert.equal(video.width, 320);
  assert.equal(video.height, 240);
  assert.equal(video.sample_aspect_ratio, '1:1');
  assert.ok(audio);
  assert.ok(Math.abs(Number(probe.format.duration) - 4) < 0.2);

  const [before, start, overshoot, settled, fading, end] = await Promise.all(
    [19, 20, 30, 40, 55, 60].map((frameIndex) => rgbFrame(ffmpegPath, outputPath, frameIndex))
  );
  const base = pixel(before, 100, 140);
  assert.ok(distance(pixel(start, 100, 140), base) <= 7, 'zero opacity at range start');
  assert.ok(distance(pixel(end, 100, 140), base) <= 7, 'half-open range excludes its end');
  assert.ok(distance(pixel(settled, 100, 140), base) > 80, 'settled rectangle is visible');

  function changedBounds(frame, y) {
    const xs = [];
    for (let x = 0; x < 240; x += 1) {
      if (distance(pixel(frame, x, y), base) > 35) xs.push(x);
    }
    return [xs[0], xs.at(-1)];
  }
  const settledBounds = changedBounds(settled, 140);
  const overshootBounds = changedBounds(overshoot, 140);
  assert.ok(overshootBounds[0] < settledBounds[0]);
  assert.ok(overshootBounds[1] > settledBounds[1]);
  assert.ok(Math.abs(settledBounds[0] - 64) <= 1);
  assert.ok(Math.abs(settledBounds[1] - 191) <= 1);
  assert.ok(Math.abs(overshootBounds[0] - 60) <= 1);
  assert.ok(Math.abs(overshootBounds[1] - 193) <= 1);

  const full = pixel(settled, 100, 140);
  const half = pixel(fading, 100, 140);
  full.forEach((channel, index) => {
    assert.ok(Math.abs(half[index] - (base[index] + channel) / 2) <= 7);
  });

  const secondBase = pixel(before, 190, 180);
  const unique = pixel(settled, 190, 180);
  const overlap = pixel(settled, 220, 180);
  assert.ok(distance(unique, secondBase) > 30);
  assert.ok(distance(unique, overlap) <= 7, 'overlapping children receive group opacity once');
  console.log(`REAL_GROUP_EXPORT_OUTPUT=${outputPath}`);
});

const PROBE_JSON = JSON.stringify({
  streams: [
    { codec_type: 'video', width: 320, height: 240, sample_aspect_ratio: '1:1' },
    { codec_type: 'audio' }
  ],
  format: { duration: '4.000000' }
});

function fakeChild({ stdoutChunks = [], code = 0, beforeClose } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {};
  setImmediate(async () => {
    try {
      for (const chunk of stdoutChunks) child.stdout.write(chunk);
      if (beforeClose) await beforeClose();
      child.stdout.end();
      child.stderr.end();
      child.emit('close', code, code === 0 ? null : 'SIGTERM');
    } catch (error) {
      child.emit('error', error);
      child.emit('close', null, null);
    }
  });
  return child;
}

async function fakePaths(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'srt-cycle5-group-unit-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const sourcePath = path.join(directory, 'source.mp4');
  const outputPath = path.join(directory, 'output.mp4');
  await fs.writeFile(sourcePath, 'protected source');
  return { sourcePath, outputPath };
}

test('builds an ordered source-timestamp group branch with exact shared geometry', () => {
  const step = groupRecipe().steps[0];
  const filter = buildGroupFilter(step, 3, {
    displayWidth: 320, displayHeight: 240, sampleAspectRatio: '4/3'
  });
  assert.match(filter, /^split=2\[groupBase3\]\[groupWork3\];/);
  assert.match(filter, /\[groupWork3\]format=rgba,drawbox=x=0:y=0:w=iw:h=ih:color=black@0:t=fill:replace=1,/);
  assert.match(filter, /drawbox=x=64:y=60:w=128:h=96:color=0xE04020:t=fill:replace=1/);
  assert.match(filter, /drawtext=font='Heiti SC':textfile=group-3-1-0\.txt:expansion=none:fontsize=19:x=74:y=86:y_align=baseline:fontcolor=0xFFFFFF/);
  assert.match(filter, /drawtext=font='Heiti SC':textfile=group-3-1-1\.txt:expansion=none:fontsize=19:x=74:y=109:y_align=baseline:fontcolor=0xFFFFFF/);
  assert.ok(filter.indexOf('drawbox=x=64') < filter.indexOf('group-3-1-0.txt'));
  assert.ok(filter.indexOf('group-3-1-0.txt') < filter.indexOf('group-3-1-1.txt'));
  assert.match(filter, /format=gbrap,geq=r='r\(X,Y\)':g='g\(X,Y\)':b='b\(X,Y\)':a='alpha\(X,Y\)\*\(/);
  assert.match(filter, /\(T-1\)/);
  assert.match(filter, /format=gbrap,scale=w='max\(1,floor\(iw\*/);
  assert.match(filter, /\(t-1\)/);
  assert.match(filter, /h='max\(1,floor\(ih\*/);
  assert.match(filter, /eval=frame:flags=bilinear,setsar=4\/3\[groupScaled3\];/);
  assert.match(filter, /\[groupBase3\]\[groupScaled3\]overlay=x='floor\(0\.5\*\(W-w\)\+0\.5\)'/);
  assert.match(filter, /y='floor\(0\.5\*\(H-h\)\+0\.5\)':eval=frame:format=rgb:alpha=straight/);
  assert.match(filter, /enable='gte\(t,1\)\*lt\(t,3\)\*gt\(/);
  assert.doesNotMatch(filter, /color=.+:s=|setpts|trim=/);
});

test('returns only fixed relative filenames and literal nonempty group lines', () => {
  const step = groupRecipe().steps[0];
  step.params.layers[1].params.text = "第一行 % : ' [safe]\n\n第三行\\N {$HOME}";
  assert.deepEqual(groupTextFiles(step, 7, { displayWidth: 320, displayHeight: 240 }), [{
    filename: 'group-7-1-0.txt', text: "第一行 % : ' [safe]"
  }, {
    filename: 'group-7-1-2.txt', text: '第三行\\N {$HOME}'
  }]);
});

test('writes literal group text, protects the source and removes scratch files', async (t) => {
  const paths = await fakePaths(t);
  let taskDir;
  let renderFilter;
  let renderedFiles;
  let literal;
  const service = createVideoExportService({
    getExportTools: async () => ({ ffmpegPath: 'ffmpeg', ffprobePath: 'ffprobe' }),
    spawnImpl: (_command, args, options) => {
      if (!args.includes('-progress')) return fakeChild({ stdoutChunks: [PROBE_JSON] });
      taskDir = options.cwd;
      renderFilter = args[args.indexOf('-vf') + 1];
      return fakeChild({ beforeClose: async () => {
        renderedFiles = await fs.readdir(taskDir);
        literal = await fs.readFile(path.join(taskDir, 'group-0-1-0.txt'), 'utf8');
        await fs.writeFile(args.at(-1), 'rendered');
      } });
    }
  });
  const recipe = groupRecipe();
  recipe.steps.splice(1);
  recipe.steps[0].params.layers[1].params.text = "文字 % : ' [safe]\\N {$HOME}";
  const result = await service.start({
    jobId: 'literal-group', videoPath: paths.sourcePath, outputPath: paths.outputPath, recipe
  });
  assert.deepEqual(result, {
    jobId: 'literal-group', status: 'completed', outputPath: paths.outputPath
  });
  assert.equal(literal, "文字 % : ' [safe]\\N {$HOME}");
  assert.deepEqual(renderedFiles, ['group-0-1-0.txt']);
  assert.match(renderFilter, /textfile=group-0-1-0\.txt:expansion=none/);
  assert.equal(await fs.readFile(paths.sourcePath, 'utf8'), 'protected source');
  await assert.rejects(fs.stat(taskDir), { code: 'ENOENT' });
});

test('rejects malformed groups before spawning and out-of-range groups before rendering', async (t) => {
  const paths = await fakePaths(t);
  let spawnCalls = 0;
  const service = createVideoExportService({
    getExportTools: async () => ({ ffmpegPath: 'ffmpeg', ffprobePath: 'ffprobe' }),
    spawnImpl: () => {
      spawnCalls += 1;
      return fakeChild({ stdoutChunks: [PROBE_JSON] });
    }
  });
  const malformed = groupRecipe();
  malformed.steps.splice(1);
  malformed.steps[0].params.opacity.keyframes[1].easing = 'user-expression';
  assert.deepEqual(await service.start({
    jobId: 'malformed-group', videoPath: paths.sourcePath, outputPath: paths.outputPath,
    recipe: malformed
  }), { jobId: 'malformed-group', status: 'failed', errorCode: 'EXPORT_INVALID_RECIPE' });
  assert.equal(spawnCalls, 0);

  const outOfRange = groupRecipe();
  outOfRange.steps.splice(1);
  outOfRange.steps[0].range.end = 4.1;
  assert.deepEqual(await service.start({
    jobId: 'range-group', videoPath: paths.sourcePath, outputPath: paths.outputPath,
    recipe: outOfRange
  }), { jobId: 'range-group', status: 'failed', errorCode: 'EXPORT_INVALID_MEDIA' });
  assert.equal(spawnCalls, 1);
});

test('leaves no partial group output when rendering fails', async (t) => {
  const paths = await fakePaths(t);
  let taskDir;
  const service = createVideoExportService({
    getExportTools: async () => ({ ffmpegPath: 'ffmpeg', ffprobePath: 'ffprobe' }),
    spawnImpl: (_command, args, options) => {
      if (!args.includes('-progress')) return fakeChild({ stdoutChunks: [PROBE_JSON] });
      taskDir = options.cwd;
      return fakeChild({ code: 9 });
    }
  });
  const recipe = groupRecipe();
  recipe.steps.splice(1);
  assert.deepEqual(await service.start({
    jobId: 'failed-group', videoPath: paths.sourcePath, outputPath: paths.outputPath, recipe
  }), { jobId: 'failed-group', status: 'failed', errorCode: 'EXPORT_RENDER_FAILED' });
  assert.equal(await fs.readFile(paths.sourcePath, 'utf8'), 'protected source');
  await assert.rejects(fs.stat(paths.outputPath), { code: 'ENOENT' });
  await assert.rejects(fs.stat(taskDir), { code: 'ENOENT' });
});
