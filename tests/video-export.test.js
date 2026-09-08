const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { promisify } = require('node:util');
const { buildSubtitleRecipe, buildRenderRecipe, SUBTITLE_STYLE } = require('../src/render-recipe');
const { createCapabilityRegistry } = require('../src/edit-capabilities');
const { createVideoExportService, buildVideoFilters } = require('../src/video-export');

test('lowers validated textures in order and keeps a valid neutral filter', () => {
  const media = { displayWidth: 96, displayHeight: 64, sampleAspectRatio: '1/1' };
  const filter = buildVideoFilters({ version: 1, steps: [
    { capability: 'video.noise@1', range: { start: 1, end: 2 }, params: { amount: 0.5 } },
    { capability: 'video.vignette@1', range: { start: 0, end: 3 }, params: { strength: 1 } }
  ] }, media);
  assert.equal((filter.match(/format=gbrp,geq=/g) || []).length, 2);
  assert.ok(filter.indexOf('127.5') < filter.indexOf('pow(X-(W-1)/2'));
  assert.match(filter, /gte\(T,1\)\*lt\(T,2\)/);
  assert.equal(buildVideoFilters({ version: 1, steps: [
    { capability: 'video.noise@1', range: { start: 0, end: 4 }, params: { amount: 0 } },
    { capability: 'video.vignette@1', range: { start: 0, end: 4 }, params: { strength: 0 } }
  ] }, media), 'null');
});

const execFileAsync = promisify(execFile);

const PROBE_JSON = JSON.stringify({
  streams: [
    { codec_type: 'video', codec_name: 'h264', width: 640, height: 360 },
    { codec_type: 'audio', codec_name: 'aac' }
  ],
  format: { duration: '4.000000' }
});

function fakeChild({ stdoutChunks = [], code = 0, beforeClose, autoClose = true } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killCalls = 0;
  child.kill = () => { child.killCalls += 1; };
  child.finish = async (closeCode = code) => {
    for (const chunk of stdoutChunks) child.stdout.write(chunk);
    if (beforeClose) await beforeClose();
    child.stdout.end();
    child.stderr.end();
    child.emit('close', closeCode, closeCode === 0 ? null : 'SIGTERM');
  };
  if (autoClose) setImmediate(() => child.finish().catch((error) => child.emit('error', error)));
  return child;
}

async function createFakePaths(t, outputContents) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'srt-cycle1-unit-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const sourcePath = path.join(directory, 'source.mp4');
  const outputPath = path.join(directory, 'output.mp4');
  await fs.writeFile(sourcePath, 'source');
  if (outputContents !== undefined) await fs.writeFile(outputPath, outputContents);
  return { directory, sourcePath, outputPath };
}

function createFakeService(spawnImpl, overrides = {}) {
  return createVideoExportService({
    getExportTools: async () => ({ ffmpegPath: 'ffmpeg', ffprobePath: 'ffprobe' }),
    spawnImpl,
    ...overrides
  });
}

function oneCaption(text = '字幕') {
  return buildSubtitleRecipe([{ id: 's1', start: 0.5, end: 3.5, text }]);
}

function oneCaptionGraph(text = '字幕') {
  return {
    schemaVersion: 1, projectId: 'project-1', documentRevision: 1, duration: 4,
    nodes: [
      { id: 'node-main-video', type: 'source.video@1', range: { start: 0, end: 4 }, inputs: [], props: { assetId: 'asset-1' } },
      { id: 'node-edit-1', type: 'visual.subtitle@1', range: { start: 0, end: 4 }, inputs: [{ port: 'base', nodeId: 'node-main-video' }], props: { segments: [{ id: 's1', start: 0.5, end: 3.5, text }], style: SUBTITLE_STYLE } }
    ],
    outputs: { video: { nodeId: 'node-edit-1', port: 'video' }, audio: { nodeId: 'node-main-video', port: 'audio' } }
  };
}

async function createRealInput(t, ffmpegPath) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'srt-cycle1-'));
  const sourcePath = path.join(directory, 'source.mp4');
  const outputPath = path.join(directory, 'export.mp4');

  if (process.env.SRT_KEEP_REAL_EXPORT === '1') {
    console.log(`REAL_EXPORT_DIR=${directory}`);
  } else {
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
  }

  await execFileAsync(ffmpegPath, [
    '-n', '-f', 'lavfi', '-i', 'color=c=0x243044:s=640x360:r=25',
    '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000',
    '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', sourcePath
  ]);

  return { directory, sourcePath, outputPath };
}

test('renders applied subtitles into a real playable MP4', {
  skip: process.env.SRT_REAL_EXPORT !== '1'
}, async (t) => {
  const ffmpegPath = process.env.SRT_FFMPEG_PATH;
  const ffprobePath = process.env.SRT_FFPROBE_PATH;
  assert.ok(ffmpegPath);
  assert.ok(ffprobePath);
  const paths = await createRealInput(t, ffmpegPath);
  const service = createVideoExportService({
    getExportTools: async () => ({ ffmpegPath, ffprobePath })
  });
  const graph = oneCaptionGraph('周期一真实字幕');
  graph.nodes[1].props.segments[0].id = 'real-1';
  const recipe = buildRenderRecipe(graph, createCapabilityRegistry());

  const result = await service.start({
    jobId: 'real-export',
    videoPath: paths.sourcePath,
    outputPath: paths.outputPath,
    recipe
  }, () => {});

  assert.deepEqual(result, {
    jobId: 'real-export', status: 'completed', outputPath: paths.outputPath
  });
  const outputStat = await fs.stat(paths.outputPath);
  assert.ok(outputStat.size > 0);
  const { stdout } = await execFileAsync(ffprobePath, [
    '-v', 'error', '-show_format', '-show_streams', '-of', 'json', paths.outputPath
  ]);
  const probe = JSON.parse(stdout);
  assert.equal(probe.streams.find((stream) => stream.codec_type === 'video').codec_name, 'h264');
  assert.equal(probe.streams.find((stream) => stream.codec_type === 'audio').codec_name, 'aac');
  assert.ok(Math.abs(Number(probe.format.duration) - 4) < 0.2);
  console.log(`REAL_EXPORT_OUTPUT=${paths.outputPath}`);
});

test('leaves an existing output unchanged', async (t) => {
  const paths = await createFakePaths(t, 'keep me');
  let spawnCalls = 0;
  const service = createFakeService((_command, args) => {
    spawnCalls += 1;
    if (args.includes('-progress')) {
      return fakeChild({ beforeClose: () => fs.writeFile(args.at(-1), 'rendered') });
    }
    return fakeChild({ stdoutChunks: [PROBE_JSON] });
  });

  const result = await service.start({
    jobId: 'existing', videoPath: paths.sourcePath, outputPath: paths.outputPath,
    recipe: oneCaption()
  }, () => {});

  assert.deepEqual(result, {
    jobId: 'existing', status: 'failed', errorCode: 'EXPORT_TARGET_EXISTS'
  });
  assert.equal(await fs.readFile(paths.outputPath, 'utf8'), 'keep me');
  assert.equal(spawnCalls, 0);
});

test('parses progress split across chunks and caps rendering at 99', async (t) => {
  const paths = await createFakePaths(t);
  let call = 0;
  const service = createFakeService((_command, args) => {
    call += 1;
    if (call === 1 || call === 3) return fakeChild({ stdoutChunks: [PROBE_JSON] });
    return fakeChild({
      stdoutChunks: ['out_time_', 'us=2000000\nprogress=continue\nout_time_us=4000000\n'],
      beforeClose: () => fs.writeFile(args.at(-1), 'rendered')
    });
  });
  const progress = [];

  const result = await service.start({
    jobId: 'progress', videoPath: paths.sourcePath, outputPath: paths.outputPath,
    recipe: oneCaption()
  }, (event) => progress.push(event));

  assert.equal(result.status, 'completed');
  assert.ok(progress.some((event) => event.phase === 'rendering' && event.percent === 50));
  assert.ok(progress.filter((event) => event.phase === 'rendering')
    .every((event) => event.percent <= 99));
});

test('cancel waits for process close and task cleanup', async (t) => {
  const paths = await createFakePaths(t);
  let renderChild;
  let taskDir;
  let markRenderStarted;
  const renderStarted = new Promise((resolve) => { markRenderStarted = resolve; });
  const service = createFakeService((_command, args, options) => {
    if (!args.includes('-progress')) return fakeChild({ stdoutChunks: [PROBE_JSON] });
    taskDir = options.cwd;
    renderChild = fakeChild({ autoClose: false });
    markRenderStarted();
    return renderChild;
  });
  const completion = service.start({
    jobId: 'cancel', videoPath: paths.sourcePath, outputPath: paths.outputPath,
    recipe: oneCaption()
  }, () => {});
  await renderStarted;
  let cancelSettled = false;
  const cancellation = service.cancel('cancel').then(() => { cancelSettled = true; });

  let pendingAssertion;
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(cancelSettled, false);
    assert.equal(renderChild.killCalls, 1);
  } catch (error) {
    pendingAssertion = error;
  } finally {
    await renderChild.finish(255);
  }
  const result = await completion;
  await cancellation;
  if (pendingAssertion) throw pendingAssertion;
  assert.deepEqual(result, { jobId: 'cancel', status: 'cancelled' });
  await assert.rejects(fs.stat(taskDir), { code: 'ENOENT' });
});

test('neutralizes raw backslashes and opening braces in ASS text', async (t) => {
  const paths = await createFakePaths(t);
  let assContents;
  let call = 0;
  const service = createFakeService((_command, args, options) => {
    call += 1;
    if (call === 1 || call === 3) return fakeChild({ stdoutChunks: [PROBE_JSON] });
    return fakeChild({ beforeClose: async () => {
      assContents = await fs.readFile(path.join(options.cwd, 'captions.ass'), 'utf8');
      await fs.writeFile(args.at(-1), 'rendered');
    } });
  });

  const result = await service.start({
    jobId: 'literal-text', videoPath: paths.sourcePath, outputPath: paths.outputPath,
    recipe: oneCaption(String.raw`路径\N {\b1} 保持原样`)
  }, () => {});

  assert.equal(result.status, 'completed');
  assert.ok(assContents.includes(`路径\\\u2060N \\{\\\u2060b1} 保持原样`));
  assert.ok(!assContents.includes(String.raw`{\b1}`));
});

test('returns a render failure after non-zero close and removes its task directory', async (t) => {
  const paths = await createFakePaths(t);
  let taskDir;
  const service = createFakeService((_command, args, options) => {
    if (!args.includes('-progress')) return fakeChild({ stdoutChunks: [PROBE_JSON] });
    taskDir = options.cwd;
    return fakeChild({ code: 7 });
  });

  const result = await service.start({
    jobId: 'render-failure', videoPath: paths.sourcePath, outputPath: paths.outputPath,
    recipe: oneCaption()
  }, () => {});

  assert.deepEqual(result, {
    jobId: 'render-failure', status: 'failed', errorCode: 'EXPORT_RENDER_FAILED'
  });
  await assert.rejects(fs.stat(taskDir), { code: 'ENOENT' });
  await assert.rejects(fs.stat(paths.outputPath), { code: 'ENOENT' });
});

test('resolves invalid and unsupported recipes as failed terminals', async (t) => {
  const paths = await createFakePaths(t);
  const service = createFakeService(() => {
    throw new Error('invalid recipes must not start tools');
  });
  let invalidCompletion;

  assert.doesNotThrow(() => {
    invalidCompletion = service.start({
      jobId: 'invalid', videoPath: paths.sourcePath, outputPath: paths.outputPath,
      recipe: null
    }, () => {});
  });
  assert.deepEqual(await invalidCompletion, {
    jobId: 'invalid', status: 'failed', errorCode: 'EXPORT_INVALID_RECIPE'
  });
  const unsupported = await service.start({
    jobId: 'unsupported', videoPath: paths.sourcePath, outputPath: paths.outputPath,
    recipe: {
      version: 1,
      steps: [{
        capability: 'subtitle.burn@2',
        params: { segments: [{ id: 's1', start: 0, end: 1, text: '字幕' }] }
      }]
    }
  }, () => {});
  assert.deepEqual(unsupported, {
    jobId: 'unsupported', status: 'failed', errorCode: 'EXPORT_UNSUPPORTED_OPERATION'
  });
});

test('preparing callback can synchronously cancel and waits for completion', async (t) => {
  const paths = await createFakePaths(t);
  let releaseRealpath;
  const realpathGate = new Promise((resolve) => { releaseRealpath = resolve; });
  const fsApi = {
    ...fs,
    realpath: async (target) => {
      await realpathGate;
      return fs.realpath(target);
    }
  };
  const service = createFakeService(() => {
    throw new Error('cancelled preparation must not start tools');
  }, { fsApi });
  let cancellation;
  let cancelSettled = false;
  const completion = service.start({
    jobId: 'cancel-preparing', videoPath: paths.sourcePath, outputPath: paths.outputPath,
    recipe: oneCaption()
  }, (event) => {
    if (event.phase === 'preparing') {
      cancellation = service.cancel(event.jobId).then(() => { cancelSettled = true; });
    }
  });

  let pendingAssertion;
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(cancelSettled, false);
  } catch (error) {
    pendingAssertion = error;
  } finally {
    releaseRealpath();
  }
  assert.deepEqual(await completion, { jobId: 'cancel-preparing', status: 'cancelled' });
  await cancellation;
  if (pendingAssertion) throw pendingAssertion;
});

test('ignores progress callback errors without leaving the service busy', async (t) => {
  const paths = await createFakePaths(t);
  let call = 0;
  const service = createFakeService((_command, args) => {
    call += 1;
    if (call === 1 || call === 3) return fakeChild({ stdoutChunks: [PROBE_JSON] });
    return fakeChild({ beforeClose: () => fs.writeFile(args.at(-1), 'rendered') });
  });
  let completion;

  assert.doesNotThrow(() => {
    completion = service.start({
      jobId: 'throwing-progress', videoPath: paths.sourcePath, outputPath: paths.outputPath,
      recipe: oneCaption()
    }, () => { throw new Error('receiver disappeared'); });
  });
  assert.deepEqual(await completion, {
    jobId: 'throwing-progress', status: 'completed', outputPath: paths.outputPath
  });
  assert.deepEqual(service.getState(), { phase: 'idle' });
});

test('waits for close after a child error and maps it to render failure', async (t) => {
  const paths = await createFakePaths(t);
  let renderChild;
  let taskDir;
  let markRenderStarted;
  const renderStarted = new Promise((resolve) => { markRenderStarted = resolve; });
  const service = createFakeService((_command, args, options) => {
    if (!args.includes('-progress')) return fakeChild({ stdoutChunks: [PROBE_JSON] });
    taskDir = options.cwd;
    renderChild = fakeChild({ autoClose: false });
    markRenderStarted();
    return renderChild;
  });
  let completionSettled = false;
  const completion = service.start({
    jobId: 'child-error', videoPath: paths.sourcePath, outputPath: paths.outputPath,
    recipe: oneCaption()
  }, () => {}).then((result) => {
    completionSettled = true;
    return result;
  });
  await renderStarted;
  const spawnError = new Error('spawn failed');
  spawnError.code = 'ENOENT';
  renderChild.emit('error', spawnError);

  let pendingAssertion;
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(completionSettled, false);
    await fs.stat(taskDir);
  } catch (error) {
    pendingAssertion = error;
  } finally {
    await renderChild.finish(-2);
  }
  assert.deepEqual(await completion, {
    jobId: 'child-error', status: 'failed', errorCode: 'EXPORT_RENDER_FAILED'
  });
  if (pendingAssertion) throw pendingAssertion;
  await assert.rejects(fs.stat(taskDir), { code: 'ENOENT' });
});

test('releases current and returns write failure when task cleanup fails', async (t) => {
  const paths = await createFakePaths(t);
  const fsApi = {
    ...fs,
    rm: async (...args) => {
      await fs.rm(...args);
      const error = new Error('cleanup denied');
      error.code = 'EACCES';
      throw error;
    }
  };
  let call = 0;
  const service = createFakeService((_command, args) => {
    call += 1;
    if (call === 1 || call === 3) return fakeChild({ stdoutChunks: [PROBE_JSON] });
    return fakeChild({ beforeClose: () => fs.writeFile(args.at(-1), 'rendered') });
  }, { fsApi });

  const result = await service.start({
    jobId: 'cleanup-error', videoPath: paths.sourcePath, outputPath: paths.outputPath,
    recipe: oneCaption()
  }, () => {});

  assert.deepEqual(result, {
    jobId: 'cleanup-error', status: 'failed', errorCode: 'EXPORT_WRITE_FAILED'
  });
  assert.deepEqual(service.getState(), { phase: 'idle' });
});

test('uses a translucent black ASS box with a non-zero outline', async (t) => {
  const paths = await createFakePaths(t);
  let assContents;
  let call = 0;
  const service = createFakeService((_command, args, options) => {
    call += 1;
    if (call === 1 || call === 3) return fakeChild({ stdoutChunks: [PROBE_JSON] });
    return fakeChild({ beforeClose: async () => {
      assContents = await fs.readFile(path.join(options.cwd, 'captions.ass'), 'utf8');
      await fs.writeFile(args.at(-1), 'rendered');
    } });
  });

  const result = await service.start({
    jobId: 'box-style', videoPath: paths.sourcePath, outputPath: paths.outputPath,
    recipe: oneCaption()
  }, () => {});

  assert.equal(result.status, 'completed');
  const styleLine = assContents.split('\n').find((line) => line.startsWith('Style: Default'));
  const fields = styleLine.slice('Style: '.length).split(',');
  assert.equal(fields[5], '&H47000000');
  assert.equal(fields[15], '3');
  assert.equal(fields[16], '1');
});

test('rejects subtitle timing beyond a millisecond rounding tolerance', async (t) => {
  const paths = await createFakePaths(t);
  let spawnCalls = 0;
  const service = createFakeService(() => {
    spawnCalls += 1;
    return fakeChild({ stdoutChunks: [PROBE_JSON] });
  });
  const recipe = buildSubtitleRecipe([
    { id: 's1', start: 0.5, end: 4.01, text: '字幕' }
  ]);

  const result = await service.start({
    jobId: 'timing', videoPath: paths.sourcePath, outputPath: paths.outputPath, recipe
  }, () => {});

  assert.deepEqual(result, {
    jobId: 'timing', status: 'failed', errorCode: 'EXPORT_INVALID_MEDIA'
  });
  assert.equal(spawnCalls, 1);
});

function colorRecipe(withSubtitle = false) {
  const steps = [{
    capability: 'video.color.adjust@1', range: { start: 1, end: 3 },
    params: { temperature: -1, brightness: 0.25, saturation: 1.5, contrast: 0.5 }
  }, {
    capability: 'video.color.adjust@1', range: { start: 0, end: 4 },
    params: { temperature: 1, brightness: -1, saturation: 0, contrast: 2 }
  }];
  if (withSubtitle) steps.push(oneCaption('literal movie=evil; $(command)').steps[0]);
  return { version: 1, steps };
}

for (const withSubtitle of [false, true]) {
  test(`exports controlled color argv and creates ASS only with subtitle=${withSubtitle}`, async (t) => {
    const paths = await createFakePaths(t);
    const calls = [];
    const writes = [];
    let renderedFiles;
    let assContents;
    const service = createFakeService((command, args, options) => {
      calls.push({ command, args, options });
      if (!args.includes('-progress')) return fakeChild({ stdoutChunks: [PROBE_JSON] });
      return fakeChild({
        stdoutChunks: ['out_time_us=2000000\n'],
        beforeClose: async () => {
          renderedFiles = await fs.readdir(options.cwd);
          if (withSubtitle) assContents = await fs.readFile(path.join(options.cwd, 'captions.ass'), 'utf8');
          await fs.writeFile(args.at(-1), 'rendered');
        }
      });
    }, { fsApi: { ...fs, writeFile: async (...args) => {
      writes.push(args[0]);
      return fs.writeFile(...args);
    } } });
    const progress = [];
    const result = await service.start({
      jobId: 'colors', videoPath: paths.sourcePath, outputPath: paths.outputPath,
      recipe: colorRecipe(withSubtitle)
    }, (event) => progress.push(event));
    assert.deepEqual(result, { jobId: 'colors', status: 'completed', outputPath: paths.outputPath });
    assert.equal(calls.length, 3);
    const render = calls[1];
    const filters = [
      "colorchannelmixer=rr=0.8:gg=1:bb=1.2:enable='gte(t,1)*lt(t,3)'",
      "eq=brightness=0.0625:saturation=1.5:contrast=0.5:enable='gte(t,1)*lt(t,3)'",
      "colorchannelmixer=rr=1.2:gg=1:bb=0.8:enable='gte(t,0)*lt(t,4)'",
      "eq=brightness=-0.25:saturation=0:contrast=2:enable='gte(t,0)*lt(t,4)'"
    ];
    if (withSubtitle) filters.push('ass=captions.ass');
    assert.equal(render.command, 'ffmpeg');
    assert.deepEqual(render.args, [
      '-hide_banner', '-nostdin', '-n', '-i', await fs.realpath(paths.sourcePath),
      '-map', '0:v:0', '-map', '0:a:0?', '-vf', filters.join(','),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
      '-pix_fmt', 'yuv420p', '-fps_mode', 'passthrough',
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
      '-progress', 'pipe:1', '-nostats', path.join(render.options.cwd, 'staged.mp4')
    ]);
    assert.ok(calls.every((call) => call.options.shell === false));
    assert.deepEqual(renderedFiles, withSubtitle ? ['captions.ass'] : []);
    assert.deepEqual(writes, withSubtitle ? [path.join(render.options.cwd, 'captions.ass')] : []);
    if (withSubtitle) assert.ok(assContents.includes('literal movie=evil; $(command)'));
    assert.ok(progress.some((event) => event.phase === 'rendering' && event.percent === 50));
    assert.equal(await fs.readFile(paths.sourcePath, 'utf8'), 'source');
    await assert.rejects(fs.stat(render.options.cwd), { code: 'ENOENT' });
  });
}

test('rejects color and mixed recipe ranges outside source duration before rendering', async (t) => {
  const paths = await createFakePaths(t);
  let spawnCalls = 0;
  const service = createFakeService(() => {
    spawnCalls += 1;
    return fakeChild({ stdoutChunks: [PROBE_JSON] });
  });
  for (const withSubtitle of [false, true]) {
    for (const range of [{ start: 1, end: 4.01 }, { start: 4, end: 5 }]) {
      const recipe = colorRecipe(withSubtitle);
      recipe.steps[1].range = range;
      const result = await service.start({
        jobId: 'range', videoPath: paths.sourcePath, outputPath: paths.outputPath, recipe
      });
      assert.deepEqual(result, { jobId: 'range', status: 'failed', errorCode: 'EXPORT_INVALID_MEDIA' });
    }
  }
  const recipe = colorRecipe(true);
  recipe.steps[2] = {
    capability: 'subtitle.burn@1',
    params: { segments: [{ id: 's1', start: 0.5, end: 4.01, text: '字幕' }] }
  };
  assert.equal((await service.start({
    jobId: 'subtitle-range', videoPath: paths.sourcePath, outputPath: paths.outputPath, recipe
  })).errorCode, 'EXPORT_INVALID_MEDIA');
  assert.equal(spawnCalls, 5);
});

test('rejects recipe commands, paths and filter strings without spawning tools', async (t) => {
  const paths = await createFakePaths(t);
  let spawnCalls = 0;
  const service = createFakeService(() => { spawnCalls += 1; throw new Error('must not spawn'); });
  const recipes = [];
  for (const field of ['command', 'args', 'filter', 'path', 'ffmpegPath', 'outputPath']) {
    const recipe = colorRecipe();
    recipe.steps[0][field] = 'movie=evil';
    recipes.push(recipe);
  }
  for (const value of ['1,drawtext=text=evil', Infinity, NaN]) {
    const recipe = colorRecipe();
    recipe.steps[0].params.temperature = value;
    recipes.push(recipe);
  }
  for (const recipe of recipes) {
    assert.equal((await service.start({
      jobId: 'injection', videoPath: paths.sourcePath, outputPath: paths.outputPath, recipe
    })).errorCode, 'EXPORT_INVALID_RECIPE');
  }
  assert.equal(spawnCalls, 0);
});

test('requires color ranges to end within source duration without subtitle rounding tolerance', async (t) => {
  const paths = await createFakePaths(t);
  let spawnCalls = 0;
  const service = createFakeService((_command, args) => {
    spawnCalls += 1;
    if (args.includes('-progress')) {
      return fakeChild({ beforeClose: () => fs.writeFile(args.at(-1), 'rendered') });
    }
    return fakeChild({ stdoutChunks: [PROBE_JSON] });
  });
  const recipe = colorRecipe();
  recipe.steps[0].range.end = 4.0005;
  assert.deepEqual(await service.start({
    jobId: 'exact-range', videoPath: paths.sourcePath, outputPath: paths.outputPath, recipe
  }), { jobId: 'exact-range', status: 'failed', errorCode: 'EXPORT_INVALID_MEDIA' });
  assert.equal(spawnCalls, 1);
});

test('lowers repeated transforms from probed geometry between color steps and before subtitles', async (t) => {
  const paths = await createFakePaths(t);
  let render;
  const probe = JSON.parse(PROBE_JSON);
  Object.assign(probe.streams[0], { width: 96, height: 64, sample_aspect_ratio: '4:3' });
  const service = createFakeService((_command, args, options) => {
    assert.equal(options.shell, false);
    if (!args.includes('-progress')) return fakeChild({ stdoutChunks: [JSON.stringify(probe)] });
    render = args;
    return fakeChild({ beforeClose: () => fs.writeFile(args.at(-1), 'rendered') });
  });
  const recipe = colorRecipe(true);
  const transform = { capability: 'video.transform@1', range: { start: 1, end: 3 },
    params: { flipHorizontal: true, flipVertical: false, scale: 0.49 } };
  recipe.steps.splice(1, 0, transform);
  recipe.steps.splice(3, 0, { ...transform, params: { ...transform.params, flipVertical: true, scale: 1.25 } });
  const result = await service.start({ jobId: 'transforms', videoPath: paths.sourcePath,
    outputPath: paths.outputPath, recipe });
  assert.equal(result.status, 'completed');
  const filter = render[render.indexOf('-vf') + 1];
  assert.match(filter, /scale=47:31:flags=bilinear,pad=96:64:24:16:color=black,crop=96:64:0:0:exact=1,setsar=4\/3/);
  assert.match(filter, /hflip,vflip,scale=120:80:flags=bilinear,pad=120:80:0:0:color=black,crop=96:64:12:8:exact=1/);
  assert.equal((filter.match(/split=2/g) || []).length, 2);
  assert.equal((filter.match(/overlay=0:0:format=auto:enable='gte\(t,1\)\*lt\(t,3\)'/g) || []).length, 2);
  const positions = ['colorchannelmixer=rr=0.8', 'scale=47:31', 'colorchannelmixer=rr=1.2', 'scale=120:80', 'ass=captions.ass'].map(v => filter.indexOf(v));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  assert.equal(render[render.indexOf('-pix_fmt') + 1], 'yuv420p');
});

test('rejects transform ranges past the source without subtitle rounding tolerance', async (t) => {
  const paths = await createFakePaths(t);
  let calls = 0;
  const service = createFakeService(() => { calls++; return fakeChild({ stdoutChunks: [PROBE_JSON] }); });
  const result = await service.start({ jobId: 'range-transform', videoPath: paths.sourcePath,
    outputPath: paths.outputPath, recipe: { version: 1, steps: [{ capability: 'video.transform@1',
      range: { start: 1, end: 4.0005 }, params: { flipHorizontal: true, flipVertical: false, scale: 1 } }] } });
  assert.equal(result.errorCode, 'EXPORT_INVALID_MEDIA');
  assert.equal(calls, 1);
});
