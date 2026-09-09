const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createRenderGraphCompiler } = require('../src/render-graph');
const { normalizeParams } = require('../src/visual-group');
const { readMediaFacts, createRemotionExportService } = require('../src/remotion-export');

const execFileAsync = promisify(execFile);

async function rgbPixel(ffmpegPath, mediaPath, time, x, y) {
  const { stdout } = await execFileAsync(ffmpegPath, [
    '-v', 'error', '-ss', String(time), '-i', mediaPath,
    '-vf', `format=rgb24,crop=1:1:${x}:${y}`, '-frames:v', '1',
    '-f', 'rawvideo', 'pipe:1'
  ], { encoding: 'buffer' });
  return Array.from(stdout.subarray(0, 3));
}

async function monoPcm(ffmpegPath, mediaPath) {
  const { stdout } = await execFileAsync(ffmpegPath, [
    '-v', 'error', '-ss', '1', '-i', mediaPath, '-map', '0:a:0', '-t', '0.5',
    '-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1'
  ], { encoding: 'buffer' });
  return new Int16Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.length / 2));
}

async function fakeProbe(t, payload, { delayMs = 0 } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'srt-remotion-probe-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const scriptPath = path.join(directory, 'fake-ffprobe');
  const expectedArgs = ['-v', 'error', '-show_format', '-show_streams', '-of', 'json',
    path.join(directory, 'source with spaces.mp4')];
  await fs.writeFile(scriptPath, [
    '#!/usr/bin/env node',
    `'use strict';`,
    `const expected = ${JSON.stringify(expectedArgs)};`,
    `if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(expected)) process.exit(19);`,
    `setTimeout(() => process.stdout.write(${JSON.stringify(JSON.stringify(payload))}), ${delayMs});`,
    ''
  ].join('\n'), { mode: 0o700 });
  return { scriptPath, videoPath: expectedArgs.at(-1) };
}

test('reads display media facts and exact average frame rate with fixed ffprobe argv', async (t) => {
  const fake = await fakeProbe(t, {
    streams: [
      { codec_type: 'video', width: 1920, height: 1080,
        avg_frame_rate: '30000/1001', r_frame_rate: '25/1',
        side_data_list: [{ rotation: 90 }] },
      { codec_type: 'audio' }
    ],
    format: { duration: '4.25' }
  });

  const facts = await readMediaFacts(fake.videoPath, { ffprobePath: fake.scriptPath });
  assert.deepEqual(facts, {
    duration: 4.25,
    width: 1080,
    height: 1920,
    fps: 30000 / 1001,
    hasAudio: true
  });
});

test('falls back to a valid real frame rate when average frame rate is invalid', async (t) => {
  const fake = await fakeProbe(t, {
    streams: [{ codec_type: 'video', width: 640, height: 360,
      avg_frame_rate: '0/0', r_frame_rate: '24000/1001' }],
    format: { duration: '2' }
  });

  const facts = await readMediaFacts(fake.videoPath, { ffprobePath: fake.scriptPath });
  assert.equal(facts.fps, 24000 / 1001);
  assert.equal(facts.hasAudio, false);
});

test('rejects media without a positive finite declared frame rate instead of guessing', async (t) => {
  const fake = await fakeProbe(t, {
    streams: [{ codec_type: 'video', width: 640, height: 360,
      avg_frame_rate: '0/0', r_frame_rate: 'N/A' }],
    format: { duration: '2' }
  });

  await assert.rejects(
    readMediaFacts(fake.videoPath, { ffprobePath: fake.scriptPath }),
    { code: 'EXPORT_INVALID_MEDIA' }
  );
});

test('uses video stream duration before the container duration', async (t) => {
  const fake = await fakeProbe(t, {
    streams: [{ codec_type: 'video', width: 640, height: 360,
      duration: '2.000000', avg_frame_rate: '25/1' }],
    format: { duration: '2.200000' }
  });

  const facts = await readMediaFacts(fake.videoPath, { ffprobePath: fake.scriptPath });
  assert.equal(facts.duration, 2);
});

test('bounds a stalled ffprobe child process', async (t) => {
  const fake = await fakeProbe(t, {
    streams: [{ codec_type: 'video', width: 640, height: 360,
      duration: '2', avg_frame_rate: '25/1' }]
  }, { delayMs: 200 });

  await assert.rejects(readMediaFacts(fake.videoPath, {
    ffprobePath: fake.scriptPath,
    timeoutInMilliseconds: 20
  }), { code: 'EXPORT_INVALID_MEDIA' });
});

function snapshotFixture({ duration = 2, width = 640, height = 360, withGroup = false } = {}) {
  const document = {
    schemaVersion: 1, projectId: 'remotion-export', revision: 3,
    timeline: { duration, canvas: { width, height } },
    sources: [{ id: 'main-video', assetId: 'source-asset', kind: 'video',
      range: { start: 0, end: duration } }],
    edits: []
  };
  if (withGroup) document.edits.push({
    id: 'card', transactionId: 'card-transaction', type: 'visual.group.layer@1',
    target: { kind: 'source', id: 'main-video' },
    range: { start: 0.25, end: Math.min(1.75, duration) }, order: 0, enabled: true,
    payload: normalizeParams({
      layers: [
        { kind: 'shape', params: { x: 0.2, y: 0.2, width: 0.45, height: 0.3,
          color: '#E04020' } },
        { kind: 'text', params: { text: 'Remotion 卡片', x: 0.24, y: 0.27,
          fontSize: 0.08, color: '#FFFFFF' } }
      ],
      opacity: { keyframes: [{ time: 0, value: 0 }, { time: 0.4, value: 1 }] },
      scale: 1
    }, Math.min(1.5, duration - 0.25))
  });
  return { document, graph: createRenderGraphCompiler().compile(document) };
}

async function exportFixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'srt-remotion-export-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const sourcePath = path.join(directory, 'source.mp4');
  const outputPath = path.join(directory, 'output.mp4');
  await fs.writeFile(sourcePath, 'source');
  return { directory, sourcePath, outputPath };
}

function cancelController() {
  const callbacks = new Set();
  return {
    cancelSignal(callback) { callbacks.add(callback); },
    cancel() { for (const callback of callbacks) callback(); }
  };
}

function serviceHarness(t, paths, overrides = {}) {
  const calls = { select: [], render: [], sessionClosed: 0 };
  const sourceFacts = overrides.sourceFacts || {
    duration: 2, width: 640, height: 360, fps: 25, hasAudio: true
  };
  const outputFacts = overrides.outputFacts || sourceFacts;
  const renderer = overrides.renderer || {
    makeCancelSignal: cancelController,
    async selectComposition(options) {
      calls.select.push(options);
      return { id: 'SrtProject', width: 1, height: 1, fps: 1,
        durationInFrames: 1, defaultProps: { stale: true }, props: { stale: true } };
    },
    async renderMedia(options) {
      calls.render.push(options);
      options.onProgress({ progress: 0.42 });
      await fs.writeFile(options.outputLocation, 'rendered');
    }
  };
  const service = createRemotionExportService({
    getExportTools: overrides.getExportTools || (async () => ({
      ffmpegPath: '/tools/ffmpeg', ffprobePath: '/tools/ffprobe'
    })),
    getMediaFacts: overrides.getMediaFacts || (async (mediaPath) => (
      mediaPath === await fs.realpath(paths.sourcePath) ? sourceFacts : outputFacts
    )),
    getBundlePath: overrides.getBundlePath || (async () => '/render/bundle'),
    createAssetSession: overrides.createAssetSession || (async ({ assetId, videoPath }) => {
      assert.equal(assetId, 'source-asset');
      assert.equal(videoPath, await fs.realpath(paths.sourcePath));
      return {
        assets: { [assetId]: { src: 'http://127.0.0.1:49152/opaque-token' } },
        async close() { calls.sessionClosed += 1; }
      };
    }),
    renderer
  });
  return { service, calls, renderer };
}

test('Remotion export requires a media probe, not the old FFmpeg effect encoder', async (t) => {
  const paths = await exportFixture(t);
  const harness = serviceHarness(t, paths, {
    getExportTools: async () => ({ ffprobePath: '/tools/ffprobe' })
  });
  const result = await harness.service.start({ jobId: 'probe-only', videoPath: paths.sourcePath,
    outputPath: paths.outputPath, snapshot: snapshotFixture() });
  assert.equal(result.status, 'completed');
  assert.equal(harness.calls.render.length, 1);
});

test('uses the already checked browser and bundle without implicit browser acquisition', async (t) => {
  const paths = await exportFixture(t);
  const harness = serviceHarness(t, paths, {
    getExportTools: async () => ({ ffprobePath: '/tools/ffprobe', browserExecutable: '/tools/checked-browser',
      bundlePath: '/checked/render-bundle' }),
    getBundlePath: async () => { throw new Error('do not replace the checked bundle'); }
  });
  const opened = []; let closed = 0;
  harness.renderer.openBrowser = async (...args) => {
    opened.push(args); return { close: async () => { closed++; } };
  };
  const result = await harness.service.start({ jobId: 'checked-runtime', videoPath: paths.sourcePath,
    outputPath: paths.outputPath, snapshot: snapshotFixture() });
  assert.equal(result.status, 'completed');
  assert.deepEqual(opened, [['chrome', { browserExecutable: '/tools/checked-browser' }]]);
  assert.equal(harness.calls.select[0].serveUrl, '/checked/render-bundle');
  assert.equal(harness.calls.render[0].serveUrl, '/checked/render-bundle');
  assert.equal(closed, 1);
});

test('renders a frozen snapshot with one input and authoritative composition metadata', async (t) => {
  const paths = await exportFixture(t);
  let releaseTools;
  const toolsReady = new Promise((resolve) => { releaseTools = resolve; });
  const harness = serviceHarness(t, paths, { getExportTools: () => toolsReady });
  const snapshot = snapshotFixture();
  const progress = [];

  const completion = harness.service.start({
    jobId: 'complete', videoPath: paths.sourcePath, outputPath: paths.outputPath, snapshot
  }, (event) => {
    progress.push(event);
    if (event.phase === 'rendering' && event.percent === 42) throw new Error('ui closed');
  });
  snapshot.document.timeline.duration = 99;
  releaseTools({ ffmpegPath: '/tools/ffmpeg', ffprobePath: '/tools/ffprobe' });
  const result = await completion;

  assert.deepEqual(result, {
    jobId: 'complete', status: 'completed', outputPath: paths.outputPath
  });
  assert.equal(await fs.readFile(paths.outputPath, 'utf8'), 'rendered');
  assert.equal(harness.calls.select.length, 1);
  assert.equal(harness.calls.render.length, 1);
  assert.strictEqual(harness.calls.select[0].inputProps, harness.calls.render[0].inputProps);
  assert.deepEqual(harness.calls.render[0].composition, {
    id: 'SrtProject', width: 640, height: 360, fps: 25, durationInFrames: 50,
    defaultProps: harness.calls.select[0].inputProps,
    props: harness.calls.select[0].inputProps
  });
  assert.equal(harness.calls.render[0].serveUrl, '/render/bundle');
  assert.equal(harness.calls.render[0].codec, 'h264');
  assert.equal(harness.calls.render[0].overwrite, false);
  assert.equal(harness.calls.render[0].muted, false);
  assert.equal(Object.hasOwn(harness.calls.render[0], 'binariesDirectory'), false);
  assert.deepEqual(harness.calls.render[0].ffmpegOverride({
    type: 'pre-stitcher', args: ['-i', '-', '/tmp/pre.mp4']
  }), ['-i', '-', '/tmp/pre.mp4']);
  assert.deepEqual(harness.calls.render[0].ffmpegOverride({
    type: 'stitcher', args: ['-i', 'video', '-i', 'audio', '/tmp/final.mp4']
  }), ['-i', 'video', '-i', 'audio', '-t', '2', '/tmp/final.mp4']);
  assert.equal(harness.calls.sessionClosed, 1);
  assert.ok(progress.some((event) => event.phase === 'preparing' && event.percent === null));
  assert.ok(progress.some((event) => event.phase === 'rendering' && event.percent === 42));
  assert.ok(progress.some((event) => event.phase === 'finalizing' && event.percent === 99));
});

test('does not open a render session when output exists or resolves to the source', async (t) => {
  const paths = await exportFixture(t);
  const existingPath = path.join(paths.directory, 'existing.mp4');
  await fs.writeFile(existingPath, 'keep');
  const aliasPath = path.join(paths.directory, 'source-alias.mp4');
  await fs.symlink(paths.sourcePath, aliasPath);
  let toolsCalls = 0;
  const harness = serviceHarness(t, paths, {
    getExportTools: async () => { toolsCalls += 1; return {}; }
  });

  const existing = await harness.service.start({
    jobId: 'exists', videoPath: paths.sourcePath, outputPath: existingPath,
    snapshot: snapshotFixture()
  });
  const alias = await harness.service.start({
    jobId: 'alias', videoPath: paths.sourcePath, outputPath: aliasPath,
    snapshot: snapshotFixture()
  });

  assert.deepEqual(existing, {
    jobId: 'exists', status: 'failed', errorCode: 'EXPORT_TARGET_EXISTS'
  });
  assert.deepEqual(alias, {
    jobId: 'alias', status: 'failed', errorCode: 'EXPORT_SOURCE_OVERWRITE'
  });
  assert.equal(await fs.readFile(existingPath, 'utf8'), 'keep');
  assert.equal(toolsCalls, 0);
});

test('rejects snapshot geometry or duration that differs from the source facts', async (t) => {
  const paths = await exportFixture(t);
  const harness = serviceHarness(t, paths);
  const wrongSize = snapshotFixture({ width: 320 });
  const wrongDuration = snapshotFixture({ duration: 1.5 });

  for (const [jobId, snapshot] of [['size', wrongSize], ['duration', wrongDuration]]) {
    const result = await harness.service.start({
      jobId, videoPath: paths.sourcePath, outputPath: paths.outputPath, snapshot
    });
    assert.deepEqual(result, {
      jobId, status: 'failed', errorCode: 'EXPORT_INVALID_MEDIA'
    });
  }
  assert.equal(harness.calls.render.length, 0);
  assert.equal(harness.calls.sessionClosed, 0);
});

test('rejects a project duration mismatch just beyond one source frame', async (t) => {
  const paths = await exportFixture(t);
  const harness = serviceHarness(t, paths);
  const result = await harness.service.start({
    jobId: 'one-frame-boundary', videoPath: paths.sourcePath, outputPath: paths.outputPath,
    snapshot: snapshotFixture({ duration: 1.955 })
  });
  assert.deepEqual(result, {
    jobId: 'one-frame-boundary', status: 'failed', errorCode: 'EXPORT_INVALID_MEDIA'
  });
  assert.equal(harness.calls.render.length, 0);
});

test('rejects invalid rendered media and leaves no partial target', async (t) => {
  const paths = await exportFixture(t);
  let stagedPath;
  const harness = serviceHarness(t, paths, {
    outputFacts: { duration: 2, width: 320, height: 360, fps: 25, hasAudio: true },
    renderer: {
      makeCancelSignal: cancelController,
      async selectComposition() { return { id: 'SrtProject' }; },
      async renderMedia(options) {
        stagedPath = options.outputLocation;
        await fs.writeFile(stagedPath, 'partial');
      }
    }
  });

  const result = await harness.service.start({
    jobId: 'bad-output', videoPath: paths.sourcePath, outputPath: paths.outputPath,
    snapshot: snapshotFixture()
  });
  assert.deepEqual(result, {
    jobId: 'bad-output', status: 'failed', errorCode: 'EXPORT_RENDER_FAILED'
  });
  await assert.rejects(fs.stat(paths.outputPath), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.dirname(stagedPath)), { code: 'ENOENT' });
  assert.equal(harness.calls.sessionClosed, 1);
});

test('cancel during rendering signals Remotion and waits for asset and task cleanup', async (t) => {
  const paths = await exportFixture(t);
  let renderStarted;
  const started = new Promise((resolve) => { renderStarted = resolve; });
  let allowClose;
  const closeAllowed = new Promise((resolve) => { allowClose = resolve; });
  let sessionClosed = false;
  let stagedPath;
  const renderer = {
    makeCancelSignal: cancelController,
    async selectComposition() { return { id: 'SrtProject' }; },
    renderMedia(options) {
      stagedPath = options.outputLocation;
      return new Promise((_resolve, reject) => {
        options.cancelSignal(() => reject(new Error('renderMedia() was cancelled')));
        renderStarted();
      });
    }
  };
  const harness = serviceHarness(t, paths, {
    renderer,
    createAssetSession: async () => ({
      assets: { 'source-asset': { src: 'http://127.0.0.1:49152/token' } },
      async close() { await closeAllowed; sessionClosed = true; }
    })
  });
  const completion = harness.service.start({
    jobId: 'cancel', videoPath: paths.sourcePath, outputPath: paths.outputPath,
    snapshot: snapshotFixture()
  });
  await started;
  let cancellationSettled = false;
  const cancellation = harness.service.cancel('cancel').then(() => { cancellationSettled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancellationSettled, false);
  allowClose();
  await cancellation;

  assert.deepEqual(await completion, { jobId: 'cancel', status: 'cancelled' });
  assert.equal(sessionClosed, true);
  await assert.rejects(fs.stat(path.dirname(stagedPath)), { code: 'ENOENT' });
  await assert.rejects(fs.stat(paths.outputPath), { code: 'ENOENT' });
});

test('cancel during composition selection does not wait for an unresponsive browser', async (t) => {
  const paths = await exportFixture(t);
  let markSelecting;
  const selecting = new Promise((resolve) => { markSelecting = resolve; });
  let releaseSelection;
  const renderer = {
    makeCancelSignal: cancelController,
    selectComposition() {
      markSelecting();
      return new Promise((resolve) => { releaseSelection = resolve; });
    },
    async renderMedia() { throw new Error('must not render'); }
  };
  const harness = serviceHarness(t, paths, { renderer });
  const completion = harness.service.start({
    jobId: 'cancel-select', videoPath: paths.sourcePath, outputPath: paths.outputPath,
    snapshot: snapshotFixture()
  });
  await selecting;
  let cancellationSettled = false;
  const cancellation = harness.service.cancel('cancel-select')
    .then(() => { cancellationSettled = true; });
  await new Promise((resolve) => setTimeout(resolve, 30));
  const failedBoundary = cancellationSettled ? null
    : new assert.AssertionError({ message: 'preparing cancellation remained blocked' });
  releaseSelection({ id: 'SrtProject' });
  await Promise.all([completion, cancellation]);
  if (failedBoundary) throw failedBoundary;
  assert.deepEqual(await completion, { jobId: 'cancel-select', status: 'cancelled' });
});

test('cancel awaits a late-created asset session without waiting forever on selection', async (t) => {
  const paths = await exportFixture(t);
  let markCreating;
  const creating = new Promise((resolve) => { markCreating = resolve; });
  let releaseSession;
  let sessionClosed = false;
  const harness = serviceHarness(t, paths, {
    createAssetSession: () => {
      markCreating();
      return new Promise((resolve) => {
        releaseSession = () => resolve({
          assets: { 'source-asset': { src: 'http://127.0.0.1:49152/late' } },
          async close() { sessionClosed = true; }
        });
      });
    }
  });
  const completion = harness.service.start({
    jobId: 'cancel-late-session', videoPath: paths.sourcePath, outputPath: paths.outputPath,
    snapshot: snapshotFixture()
  });
  await creating;
  let cancellationSettled = false;
  const cancellation = harness.service.cancel('cancel-late-session')
    .then(() => { cancellationSettled = true; });
  await new Promise((resolve) => setTimeout(resolve, 30));
  const failedBoundary = cancellationSettled ? new assert.AssertionError({
    message: 'cancel resolved before the late asset session could be closed'
  }) : null;
  releaseSession();
  await Promise.all([completion, cancellation]);
  if (failedBoundary) throw failedBoundary;
  assert.equal(sessionClosed, true);
});

test('rejects a second concurrent render as busy', async (t) => {
  const paths = await exportFixture(t);
  let releaseTools;
  const toolsReady = new Promise((resolve) => { releaseTools = resolve; });
  const harness = serviceHarness(t, paths, {
    getExportTools: () => toolsReady
  });
  const first = harness.service.start({
    jobId: 'first', videoPath: paths.sourcePath, outputPath: paths.outputPath,
    snapshot: snapshotFixture()
  });
  const second = await harness.service.start({
    jobId: 'second', videoPath: paths.sourcePath,
    outputPath: path.join(paths.directory, 'second.mp4'), snapshot: snapshotFixture()
  });
  assert.deepEqual(second, {
    jobId: 'second', status: 'failed', errorCode: 'EXPORT_BUSY'
  });
  releaseTools({ ffmpegPath: '/tools/ffmpeg', ffprobePath: '/tools/ffprobe' });
  assert.equal((await first).status, 'completed');
});

test('renders a synthetic source and animated card through the real Remotion renderer', {
  skip: process.env.SRT_REAL_REMOTION !== '1', timeout: 180000
}, async (t) => {
  const ffmpegPath = process.env.SRT_FFMPEG_PATH
    || '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg';
  const ffprobePath = process.env.SRT_FFPROBE_PATH
    || '/opt/homebrew/opt/ffmpeg-full/bin/ffprobe';
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'srt-real-remotion-'));
  const sourcePath = path.join(directory, 'source.mp4');
  const outputPath = path.join(directory, 'output.mp4');
  if (process.env.SRT_KEEP_REAL_REMOTION === '1') console.log(`REAL_REMOTION_DIR=${directory}`);
  else t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await execFileAsync(ffmpegPath, [
    '-v', 'error', '-n', '-f', 'lavfi', '-i', 'color=c=0x102030:s=640x360:r=24',
    '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000',
    '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', sourcePath
  ]);
  const service = createRemotionExportService({
    getExportTools: async () => ({ ffmpegPath, ffprobePath })
  });

  const result = await service.start({
    jobId: 'real-remotion', videoPath: sourcePath, outputPath,
    snapshot: snapshotFixture({ duration: 4, withGroup: true })
  });
  assert.deepEqual(result, {
    jobId: 'real-remotion', status: 'completed', outputPath
  });
  const output = await readMediaFacts(outputPath, { ffprobePath });
  assert.equal(output.width, 640);
  assert.equal(output.height, 360);
  assert.equal(output.hasAudio, true);
  assert.ok(Math.abs(output.duration - 4) <= 1 / 24);
  const { stdout: probeText } = await execFileAsync(ffprobePath, [
    '-v', 'error', '-show_streams', '-show_format', '-of', 'json', outputPath
  ]);
  const probe = JSON.parse(probeText);
  const audio = probe.streams.find((stream) => stream.codec_type === 'audio');
  assert.ok(audio);
  assert.ok(Math.abs(Number(audio.duration) - 4) <= 1 / 24);
  assert.ok(Math.abs(Number(probe.format.duration) - 4) <= 1 / 24);
  const cardPixel = await rgbPixel(ffmpegPath, outputPath, 1, 352, 144);
  assert.ok(Math.max(...cardPixel.map((value, index) =>
    Math.abs(value - [224, 64, 32][index]))) <= 12);
  const samples = await monoPcm(ffmpegPath, outputPath);
  const rms = Math.sqrt(Array.from(samples).reduce((sum, value) => sum + value * value, 0)
    / samples.length);
  let crossings = 0;
  for (let index = 1; index < samples.length; index += 1) {
    if ((samples[index - 1] < 0 && samples[index] >= 0)
        || (samples[index - 1] >= 0 && samples[index] < 0)) crossings += 1;
  }
  assert.ok(rms > 1000);
  assert.ok(crossings >= 630 && crossings <= 690);
});

test('renders source-only media without inventing an audio track', {
  skip: process.env.SRT_REAL_REMOTION !== '1', timeout: 180000
}, async (t) => {
  const ffmpegPath = process.env.SRT_FFMPEG_PATH
    || '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg';
  const ffprobePath = process.env.SRT_FFPROBE_PATH
    || '/opt/homebrew/opt/ffmpeg-full/bin/ffprobe';
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'srt-real-remotion-silent-'));
  const sourcePath = path.join(directory, 'silent-source.mp4');
  const outputPath = path.join(directory, 'silent-output.mp4');
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await execFileAsync(ffmpegPath, [
    '-v', 'error', '-n', '-f', 'lavfi', '-i', 'color=c=0x224466:s=320x240:r=24',
    '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', sourcePath
  ]);
  const service = createRemotionExportService({
    getExportTools: async () => ({ ffmpegPath, ffprobePath })
  });

  const result = await service.start({
    jobId: 'real-remotion-silent', videoPath: sourcePath, outputPath,
    snapshot: snapshotFixture({ duration: 4, width: 320, height: 240 })
  });
  assert.deepEqual(result, {
    jobId: 'real-remotion-silent', status: 'completed', outputPath
  });
  const facts = await readMediaFacts(outputPath, { ffprobePath });
  assert.equal(facts.width, 320);
  assert.equal(facts.height, 240);
  assert.equal(facts.fps, 24);
  assert.equal(facts.hasAudio, false);
  assert.ok(Math.abs(facts.duration - 4) <= 1 / 24);
});
