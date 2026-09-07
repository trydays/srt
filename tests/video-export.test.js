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
const { createVideoExportService } = require('../src/video-export');

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
