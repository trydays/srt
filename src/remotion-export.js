const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRenderInput } = require('./remotion-input');
const { createRenderAssetSession } = require('./remotion-assets');

const execFileAsync = promisify(execFile);

function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function positiveRatio(value) {
  const match = /^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(String(value));
  if (!match) return null;
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  const ratio = numerator / denominator;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
}

async function readMediaFacts(videoPath, {
  ffprobePath,
  timeoutInMilliseconds = 15000,
  signal
} = {}) {
  if (typeof videoPath !== 'string' || !videoPath
      || typeof ffprobePath !== 'string' || !ffprobePath
      || !Number.isFinite(timeoutInMilliseconds) || timeoutInMilliseconds <= 0) {
    throw codedError('EXPORT_INVALID_MEDIA');
  }
  let stdout;
  try {
    ({ stdout } = await execFileAsync(ffprobePath, [
      '-v', 'error', '-show_format', '-show_streams', '-of', 'json', videoPath
    ], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: timeoutInMilliseconds,
      signal
    }));
  } catch (_) {
    throw codedError('EXPORT_INVALID_MEDIA');
  }
  let probe;
  try {
    probe = JSON.parse(stdout);
  } catch (_) {
    throw codedError('EXPORT_INVALID_MEDIA');
  }
  const streams = Array.isArray(probe.streams) ? probe.streams : [];
  const video = streams.find((stream) => stream && stream.codec_type === 'video');
  const streamDuration = Number(video && video.duration);
  const duration = Number.isFinite(streamDuration) && streamDuration > 0
    ? streamDuration : Number(probe.format && probe.format.duration);
  const codedWidth = Number(video && video.width);
  const codedHeight = Number(video && video.height);
  const fps = video && (positiveRatio(video.avg_frame_rate)
    || positiveRatio(video.r_frame_rate));
  if (!video || !Number.isFinite(duration) || duration <= 0
      || !Number.isSafeInteger(codedWidth) || codedWidth <= 0
      || !Number.isSafeInteger(codedHeight) || codedHeight <= 0
      || !fps) {
    throw codedError('EXPORT_INVALID_MEDIA');
  }
  const sideRotation = Array.isArray(video.side_data_list)
    ? video.side_data_list.find((item) => Number.isFinite(Number(item && item.rotation)))
    : null;
  const rotation = Number(sideRotation && sideRotation.rotation
    || video.tags && video.tags.rotate || 0);
  const rotated = Math.abs(rotation) % 180 === 90;
  return {
    duration,
    width: rotated ? codedHeight : codedWidth,
    height: rotated ? codedWidth : codedHeight,
    fps,
    hasAudio: streams.some((stream) => stream && stream.codec_type === 'audio')
  };
}

function validMediaFacts(facts) {
  return facts && Number.isFinite(facts.duration) && facts.duration > 0
    && Number.isSafeInteger(facts.width) && facts.width > 0
    && Number.isSafeInteger(facts.height) && facts.height > 0
    && Number.isFinite(facts.fps) && facts.fps > 0
    && typeof facts.hasAudio === 'boolean';
}

function createRemotionExportService(options) {
  if (!options || typeof options.getExportTools !== 'function') {
    throw new TypeError('getExportTools is required');
  }
  const getExportTools = options.getExportTools;
  const getMediaFacts = options.getMediaFacts || readMediaFacts;
  const getBundlePath = options.getBundlePath
    || (async () => path.join(__dirname, '../app/remotion-built/render'));
  const createAssetSession = options.createAssetSession || createRenderAssetSession;
  const renderer = options.renderer || require('@remotion/renderer');
  let current = null;

  async function waitForPreparing(active, operation, {
    timeoutInMilliseconds = 30000,
    onLateValue
  } = {}) {
    const settledOperation = Promise.resolve(operation).then(
      (value) => ({ kind: 'value', value }),
      (error) => ({ kind: 'error', error })
    );
    let timeoutId;
    const timeout = new Promise((resolve) => {
      timeoutId = setTimeout(() => resolve({ kind: 'timeout' }), timeoutInMilliseconds);
    });
    const result = await Promise.race([
      settledOperation,
      active.cancelledPromise.then(() => ({ kind: 'cancelled' })),
      timeout
    ]);
    clearTimeout(timeoutId);
    if (result.kind === 'value') return result.value;
    if (result.kind === 'error') throw result.error;
    if (typeof onLateValue === 'function') {
      const cleanup = settledOperation.then((late) => {
        if (late.kind === 'value') return onLateValue(late.value);
        return undefined;
      }).catch(() => {});
      active.pendingLateCleanups.add(cleanup);
      cleanup.finally(() => active.pendingLateCleanups.delete(cleanup));
    }
    if (result.kind === 'cancelled') throw codedError('EXPORT_CANCELLED');
    throw codedError('EXPORT_RENDER_FAILED');
  }

  async function waitForLateCleanups(active) {
    const pending = Array.from(active.pendingLateCleanups);
    if (!pending.length) return;
    let timeoutId;
    await Promise.race([
      Promise.allSettled(pending),
      new Promise((resolve) => {
        timeoutId = setTimeout(resolve, 1000);
      })
    ]);
    clearTimeout(timeoutId);
  }

  function sendProgress(onProgress, event) {
    if (typeof onProgress !== 'function') return;
    try {
      const pending = onProgress(event);
      if (pending && typeof pending.then === 'function') {
        Promise.resolve(pending).catch(() => {});
      }
    } catch (_) {}
  }

  async function resolveSourceAndProtectTarget(job) {
    let sourcePath;
    let sourceStat;
    try {
      sourcePath = await fs.realpath(job.videoPath);
      sourceStat = await fs.stat(sourcePath);
    } catch (_) {
      throw codedError('EXPORT_INVALID_MEDIA');
    }
    if (!sourceStat.isFile()) throw codedError('EXPORT_INVALID_MEDIA');
    if (typeof job.outputPath !== 'string' || !job.outputPath
        || path.resolve(job.videoPath) === path.resolve(job.outputPath)) {
      throw codedError('EXPORT_SOURCE_OVERWRITE');
    }
    try {
      const targetPath = await fs.realpath(job.outputPath);
      if (targetPath === sourcePath) throw codedError('EXPORT_SOURCE_OVERWRITE');
      throw codedError('EXPORT_TARGET_EXISTS');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    return sourcePath;
  }

  function sourceAssetId(snapshot) {
    try {
      const source = snapshot.document.sources[0];
      if (source.kind !== 'video' || typeof source.assetId !== 'string' || !source.assetId) {
        throw new Error('invalid source');
      }
      return source.assetId;
    } catch (_) {
      throw codedError('REMOTION_INPUT_INVALID');
    }
  }

  function validateSourceMatch(snapshot, facts) {
    if (!validMediaFacts(facts)) throw codedError('EXPORT_INVALID_MEDIA');
    let canvas;
    let duration;
    try {
      canvas = snapshot.document.timeline.canvas;
      duration = snapshot.document.timeline.duration;
    } catch (_) {
      throw codedError('REMOTION_INPUT_INVALID');
    }
    const tolerance = 1 / facts.fps + Number.EPSILON * Math.max(1, facts.duration);
    if (canvas.width !== facts.width || canvas.height !== facts.height
        || !Number.isFinite(duration) || Math.abs(duration - facts.duration) > tolerance) {
      throw codedError('EXPORT_INVALID_MEDIA');
    }
  }

  function validateRenderedMedia(output, source, input) {
    if (!validMediaFacts(output)) throw codedError('EXPORT_RENDER_FAILED');
    const expectedDuration = input.durationInFrames / input.fps;
    const frameTolerance = 1 / input.fps
      + Number.EPSILON * Math.max(1, expectedDuration);
    const fpsTolerance = Math.max(0.001, input.fps * 0.001);
    if (output.width !== input.width || output.height !== input.height
        || Math.abs(output.duration - expectedDuration) > frameTolerance
        || Math.abs(output.fps - input.fps) > fpsTolerance
        || output.hasAudio !== source.hasAudio) {
      throw codedError('EXPORT_RENDER_FAILED');
    }
  }

  async function execute(job, onProgress, active) {
    let taskDir;
    let assetSession;
    let terminal;
    let outputCommitted = false;
    let closeBrowser;
    try {
      const sourcePath = await resolveSourceAndProtectTarget(job);
      if (active.cancelled) throw codedError('EXPORT_CANCELLED');

      const tools = await waitForPreparing(active, getExportTools());
      if (active.cancelled) throw codedError('EXPORT_CANCELLED');
      if (!tools || typeof tools.ffprobePath !== 'string' || !tools.ffprobePath) {
        throw codedError('EXPORT_INVALID_MEDIA');
      }
      const source = await waitForPreparing(active, getMediaFacts(sourcePath, {
        ffprobePath: tools.ffprobePath,
        signal: active.abortController.signal
      }));
      if (active.cancelled) throw codedError('EXPORT_CANCELLED');
      validateSourceMatch(job.snapshot, source);

      const assetId = sourceAssetId(job.snapshot);
      try {
        assetSession = await waitForPreparing(active,
          createAssetSession({ assetId, videoPath: sourcePath }), {
            timeoutInMilliseconds: 10000,
            onLateValue: (session) => session && session.close && session.close()
          });
      } catch (error) {
        if (error && error.code) throw error;
        throw codedError('EXPORT_INVALID_MEDIA');
      }
      if (active.cancelled) throw codedError('EXPORT_CANCELLED');
      const input = createRenderInput(job.snapshot, { fps: source.fps, assets: assetSession.assets });
      const bundlePath = tools.bundlePath || await waitForPreparing(active, getBundlePath());
      if (active.cancelled) throw codedError('EXPORT_CANCELLED');
      if (typeof bundlePath !== 'string' || !bundlePath) throw codedError('EXPORT_RENDER_FAILED');

      taskDir = await fs.mkdtemp(path.join(os.tmpdir(), 'srt-remotion-export-'));
      const stagedPath = path.join(taskDir, 'staged.mp4');
      const controller = renderer.makeCancelSignal();
      if (!controller || typeof controller.cancel !== 'function'
          || typeof controller.cancelSignal !== 'function') {
        throw codedError('EXPORT_RENDER_FAILED');
      }
      active.cancel = controller.cancel;
      let browser;
      if (typeof renderer.openBrowser === 'function') {
        const browserPromise = renderer.openBrowser('chrome',
          tools.browserExecutable ? { browserExecutable: tools.browserExecutable } : undefined);
        browser = await waitForPreparing(active, browserPromise, {
          timeoutInMilliseconds: 60000,
          onLateValue: (lateBrowser) => lateBrowser.close({ silent: true })
        });
        let browserClosePromise;
        closeBrowser = () => {
          if (!browserClosePromise) {
            browserClosePromise = Promise.resolve(browser.close({ silent: true }));
          }
          return browserClosePromise;
        };
        active.closeBrowser = closeBrowser;
      }
      let selected;
      try {
        const selectionOptions = {
          serveUrl: bundlePath,
          id: 'SrtProject',
          inputProps: input,
          timeoutInMilliseconds: 30000
        };
        if (browser) selectionOptions.puppeteerInstance = browser;
        selected = await waitForPreparing(active,
          renderer.selectComposition(selectionOptions));
      } catch (_) {
        if (active.cancelled) throw codedError('EXPORT_CANCELLED');
        throw codedError('EXPORT_RENDER_FAILED');
      }
      if (active.cancelled) throw codedError('EXPORT_CANCELLED');
      const composition = {
        ...selected,
        id: 'SrtProject',
        width: input.width,
        height: input.height,
        fps: input.fps,
        durationInFrames: input.durationInFrames,
        defaultProps: input,
        props: input
      };

      active.phase = 'rendering';
      sendProgress(onProgress, { jobId: job.jobId, phase: 'rendering', percent: 0 });
      try {
        const renderOptions = {
          composition,
          serveUrl: bundlePath,
          codec: 'h264',
          pixelFormat: 'yuv420p',
          audioCodec: 'aac',
          x264Preset: 'veryfast',
          outputLocation: stagedPath,
          overwrite: false,
          inputProps: input,
          enforceAudioTrack: source.hasAudio,
          muted: !source.hasAudio,
          ffmpegOverride: ({ type, args }) => type === 'stitcher'
            ? [...args.slice(0, -1), '-t', String(input.durationInFrames / input.fps), args.at(-1)]
            : args,
          cancelSignal: controller.cancelSignal,
          onProgress: (progress) => {
            const value = Number(progress && progress.progress);
            if (!Number.isFinite(value)) return;
            const percent = Math.min(99, Math.max(0, Math.floor(value * 100)));
            sendProgress(onProgress, { jobId: job.jobId, phase: 'rendering', percent });
          }
        };
        if (browser) renderOptions.puppeteerInstance = browser;
        await renderer.renderMedia(renderOptions);
      } catch (_) {
        if (active.cancelled) throw codedError('EXPORT_CANCELLED');
        throw codedError('EXPORT_RENDER_FAILED');
      }
      if (active.cancelled) throw codedError('EXPORT_CANCELLED');

      active.phase = 'finalizing';
      sendProgress(onProgress, { jobId: job.jobId, phase: 'finalizing', percent: 99 });
      let stagedStat;
      try {
        stagedStat = await fs.stat(stagedPath);
      } catch (_) {
        throw codedError('EXPORT_RENDER_FAILED');
      }
      if (!stagedStat.isFile() || stagedStat.size <= 0) throw codedError('EXPORT_RENDER_FAILED');
      let output;
      try {
        output = await getMediaFacts(stagedPath, { ffprobePath: tools.ffprobePath });
      } catch (_) {
        throw codedError('EXPORT_RENDER_FAILED');
      }
      validateRenderedMedia(output, source, input);

      if (closeBrowser) {
        await closeBrowser();
        closeBrowser = null;
        active.closeBrowser = null;
      }
      await assetSession.close();
      assetSession = null;
      try {
        await fs.copyFile(stagedPath, job.outputPath, constants.COPYFILE_EXCL);
        outputCommitted = true;
      } catch (error) {
        if (error.code === 'EEXIST') throw codedError('EXPORT_TARGET_EXISTS');
        throw codedError('EXPORT_WRITE_FAILED');
      }
      terminal = { jobId: job.jobId, status: 'completed', outputPath: job.outputPath };
    } catch (error) {
      terminal = active.cancelled
        ? { jobId: job.jobId, status: 'cancelled' }
        : { jobId: job.jobId, status: 'failed', errorCode: error.code || 'EXPORT_FAILED' };
    }

    let cleanupFailed = false;
    try {
      if (closeBrowser) await closeBrowser();
    } catch (_) {
      cleanupFailed = true;
    }
    try {
      if (assetSession) await assetSession.close();
    } catch (_) {
      cleanupFailed = true;
    }
    try {
      if (taskDir) await fs.rm(taskDir, { recursive: true, force: true });
    } catch (_) {
      cleanupFailed = true;
    }
    await waitForLateCleanups(active);
    if (cleanupFailed) {
      if (outputCommitted) await fs.unlink(job.outputPath).catch(() => {});
      terminal = active.cancelled
        ? { jobId: job.jobId, status: 'cancelled' }
        : { jobId: job.jobId, status: 'failed', errorCode: 'EXPORT_WRITE_FAILED' };
    }
    if (current === active) current = null;
    return terminal;
  }

  function start(job, onProgress) {
    if (current) {
      return Promise.resolve({
        jobId: job && job.jobId, status: 'failed', errorCode: 'EXPORT_BUSY'
      });
    }
    let frozenSnapshot;
    try {
      frozenSnapshot = JSON.parse(JSON.stringify(job.snapshot));
    } catch (_) {
      return Promise.resolve({
        jobId: job && job.jobId, status: 'failed', errorCode: 'REMOTION_INPUT_INVALID'
      });
    }
    const frozenJob = {
      jobId: job.jobId,
      videoPath: job.videoPath,
      outputPath: job.outputPath,
      snapshot: frozenSnapshot
    };
    const active = {
      jobId: frozenJob.jobId,
      phase: 'preparing',
      cancelled: false,
      cancel: null,
      completion: null,
      closeBrowser: null,
      abortController: new AbortController(),
      cancelledPromise: null,
      markCancelled: null,
      pendingLateCleanups: new Set()
    };
    active.cancelledPromise = new Promise((resolve) => {
      active.markCancelled = resolve;
    });
    current = active;
    sendProgress(onProgress, {
      jobId: frozenJob.jobId, phase: 'preparing', percent: null
    });
    active.completion = Promise.resolve().then(() => execute(frozenJob, onProgress, active));
    return active.completion;
  }

  async function cancel(jobId) {
    const active = current;
    if (!active || active.jobId !== jobId) return;
    if (active.phase !== 'finalizing') {
      active.cancelled = true;
      active.markCancelled();
      active.abortController.abort();
      if (active.cancel) active.cancel();
      if (active.phase === 'preparing' && active.closeBrowser) {
        Promise.resolve(active.closeBrowser()).catch(() => {});
      }
    }
    await active.completion;
  }

  return { start, cancel };
}

module.exports = { readMediaFacts, createRemotionExportService };
