const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { validateRenderRecipe, SUBTITLE_STYLE } = require('./render-recipe');
const videoTransform = require('./video-transform');
const visualLayers = require('./visual-layers');
const { buildGroupFilter, groupTextFiles } = require('./visual-group-export');

function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

// The recipe has already crossed the strict export validator. Only numeric
// values enter these fixed filter templates; ASS uses a service-owned filename.
function buildVideoFilters(recipe, media) {
  const filters = [];
  let transformIndex = 0;
  for (const [stepIndex, step] of recipe.steps.entries()) {
    if (step.capability === 'video.color.adjust@1') {
      const { temperature, brightness, saturation, contrast } = step.params;
      const enable = `enable='gte(t,${step.range.start})*lt(t,${step.range.end})'`;
      filters.push(`colorchannelmixer=rr=${1 + 0.2 * temperature}:gg=1:bb=${1 - 0.2 * temperature}:${enable}`);
      filters.push(`eq=brightness=${0.25 * brightness}:saturation=${saturation}:contrast=${contrast}:${enable}`);
    } else if (step.capability === 'video.transform@1') {
      const g = videoTransform.geometry(step.params, media.displayWidth, media.displayHeight);
      const index = transformIndex++;
      const changed = [];
      if (g.params.flipHorizontal) changed.push('hflip');
      if (g.params.flipVertical) changed.push('vflip');
      changed.push(`scale=${g.scaledWidth}:${g.scaledHeight}:flags=bilinear`,
        `pad=${g.padWidth}:${g.padHeight}:${g.padX}:${g.padY}:color=black`,
        `crop=${media.displayWidth}:${media.displayHeight}:${g.cropX}:${g.cropY}:exact=1`,
        `setsar=${media.sampleAspectRatio}`);
      // A complete opaque frame on the second branch preserves clipping and
      // black margins independently at every step. Only overlay supports enable.
      filters.push(`format=yuv444p,split=2[base${index}][work${index}];`
        + `[work${index}]${changed.join(',')}[changed${index}];`
        + `[base${index}][changed${index}]overlay=0:0:format=auto:`
        + `enable='gte(t,${step.range.start})*lt(t,${step.range.end})'`);
    } else if (step.capability === 'visual.shape@1') {
      const g=visualLayers.geometry('shape',step.params,media.displayWidth,media.displayHeight);
      filters.push(`drawbox=x=${g.x}:y=${g.y}:w=${g.width}:h=${g.height}:color=0x${g.color.slice(1)}:t=fill:enable='gte(t,${step.range.start})*lt(t,${step.range.end})'`);
    } else if (step.capability === 'visual.text@1') {
      const g=visualLayers.geometry('text',step.params,media.displayWidth,media.displayHeight);
      g.lines.forEach((line,lineIndex)=>{ if(line.text) filters.push(`drawtext=font='${visualLayers.FONT_FAMILY}':textfile=layer-${stepIndex}-${lineIndex}.txt:expansion=none:fontsize=${g.fontSize}:x=${line.x}:y=${line.baseline}:y_align=baseline:fontcolor=0x${g.color.slice(1)}:enable='gte(t,${step.range.start})*lt(t,${step.range.end})'`); });
    } else if (step.capability === 'visual.group@1') {
      filters.push(buildGroupFilter(step, stepIndex, media));
    } else if (step.capability === 'subtitle.burn@1') {
      filters.push('ass=captions.ass');
    }
  }
  return filters.join(',');
}

function createVideoExportService(options) {
  const getExportTools = options.getExportTools;
  const spawnImpl = options.spawnImpl || spawn;
  const fsApi = options.fsApi || fs;
  let current = null;

  function getState() {
    return current ? { jobId: current.jobId, phase: current.phase } : { phase: 'idle' };
  }

  function sendProgress(onProgress, event) {
    if (!onProgress) return;
    try {
      const pending = onProgress(event);
      if (pending && typeof pending.then === 'function') {
        Promise.resolve(pending).catch(() => {});
      }
    } catch (_) {}
  }

  function runProcess(command, args, spawnOptions, onStdout) {
    return new Promise((resolve) => {
      let child;
      try {
        child = spawnImpl(command, args, spawnOptions);
      } catch (error) {
        resolve({ code: null, signal: null, stdout: '', stderr: '', error });
        return;
      }
      current.child = child;
      let stdout = '';
      let stderr = '';
      let processError = null;
      if (child.stdout) child.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        stdout += text;
        if (onStdout) onStdout(text);
      });
      if (child.stderr) child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      child.once('error', (error) => { processError = error; });
      child.once('close', (code, signal) => {
        if (current && current.child === child) current.child = null;
        resolve({ code, signal, stdout, stderr, error: processError });
      });
    });
  }

  async function probeMedia(ffprobePath, mediaPath) {
    const result = await runProcess(ffprobePath, [
      '-v', 'error', '-show_format', '-show_streams', '-of', 'json', mediaPath
    ], { shell: false });
    if (result.error || result.code !== 0) throw codedError('EXPORT_INVALID_MEDIA');
    let probe;
    try {
      probe = JSON.parse(result.stdout);
    } catch (_) {
      throw codedError('EXPORT_INVALID_MEDIA');
    }
    const streams = Array.isArray(probe.streams) ? probe.streams : [];
    const video = streams.find((stream) => stream.codec_type === 'video');
    const audio = streams.find((stream) => stream.codec_type === 'audio');
    const duration = Number(probe.format && probe.format.duration || video && video.duration);
    if (!video || !Number.isFinite(duration) || duration <= 0
        || !Number.isSafeInteger(Number(video.width)) || Number(video.width) <= 0
        || !Number.isSafeInteger(Number(video.height)) || Number(video.height) <= 0) {
      throw codedError('EXPORT_INVALID_MEDIA');
    }
    const sideRotation = Array.isArray(video.side_data_list)
      ? video.side_data_list.find((item) => Number.isFinite(Number(item.rotation)))
      : null;
    const rotation = Number(sideRotation && sideRotation.rotation || video.tags && video.tags.rotate || 0);
    const rotated = Math.abs(rotation) % 180 === 90;
    const sar = /^(\d+):(\d+)$/.exec(String(video.sample_aspect_ratio));
    const validSar = sar && [Number(sar[1]), Number(sar[2])].every(v => Number.isSafeInteger(v) && v > 0);
    const sampleAspectRatio = validSar
      ? (rotated ? Number(sar[2]) + '/' + Number(sar[1]) : Number(sar[1]) + '/' + Number(sar[2])) : '1/1';
    return {
      duration,
      hasAudio: Boolean(audio),
      sampleAspectRatio,
      displayWidth: Number(rotated ? video.height : video.width),
      displayHeight: Number(rotated ? video.width : video.height)
    };
  }

  function assTime(seconds) {
    const centiseconds = Math.max(0, Math.round(seconds * 100));
    const hours = Math.floor(centiseconds / 360000);
    const minutes = Math.floor(centiseconds / 6000) % 60;
    const secs = Math.floor(centiseconds / 100) % 60;
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centiseconds % 100).padStart(2, '0')}`;
  }

  function assColor(hexColor, opacity) {
    const red = hexColor.slice(1, 3);
    const green = hexColor.slice(3, 5);
    const blue = hexColor.slice(5, 7);
    const alpha = Math.round((1 - opacity) * 255).toString(16).padStart(2, '0');
    return `&H${alpha}${blue}${green}${red}`.toUpperCase();
  }

  function buildAss(subtitleStep, media) {
    const fontSize = media.displayHeight * SUBTITLE_STYLE.fontSize / SUBTITLE_STYLE.referenceHeight;
    const marginH = Math.round(media.displayWidth * (100 - SUBTITLE_STYLE.maxWidthPercent) / 200);
    const marginV = Math.round(media.displayHeight * SUBTITLE_STYLE.bottomPercent / 100);
    const textColor = assColor(SUBTITLE_STYLE.textColor, 1);
    const boxColor = assColor(SUBTITLE_STYLE.backgroundColor, SUBTITLE_STYLE.backgroundOpacity);
    const dialogue = subtitleStep.params.segments.map((segment) => {
      const text = segment.text
        .replace(/\\/g, `\\\u2060`)
        .replace(/{/g, '\\{')
        .replace(/\r\n?|\n/g, '\\N');
      return `Dialogue: 0,${assTime(segment.start)},${assTime(segment.end)},Default,,0,0,0,,${text}`;
    });
    return [
      '[Script Info]',
      'ScriptType: v4.00+',
      `PlayResX: ${media.displayWidth}`,
      `PlayResY: ${media.displayHeight}`,
      'WrapStyle: 0',
      '',
      '[V4+ Styles]',
      'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
      `Style: Default,${SUBTITLE_STYLE.fontFamily},${fontSize},${textColor},${textColor},${boxColor},${boxColor},0,0,0,0,100,100,0,0,3,1,0,2,${marginH},${marginH},${marginV},1`,
      '',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      ...dialogue,
      ''
    ].join('\n');
  }

  async function execute(job, onProgress) {
    let taskDir;
    let terminal;
    try {
      const recipe = validateRenderRecipe(job.recipe);
      let sourcePath;
      let sourceStat;
      try {
        sourcePath = await fsApi.realpath(job.videoPath);
        sourceStat = await fsApi.stat(sourcePath);
      } catch (_) {
        throw codedError('EXPORT_INVALID_MEDIA');
      }
      if (!sourceStat.isFile()) throw codedError('EXPORT_INVALID_MEDIA');
      if (path.resolve(job.videoPath) === path.resolve(job.outputPath)) {
        throw codedError('EXPORT_SOURCE_OVERWRITE');
      }
      try {
        const targetPath = await fsApi.realpath(job.outputPath);
        if (targetPath === sourcePath) throw codedError('EXPORT_SOURCE_OVERWRITE');
        throw codedError('EXPORT_TARGET_EXISTS');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (current.cancelled) throw codedError('EXPORT_CANCELLED');
      const tools = await getExportTools();
      if (current.cancelled) throw codedError('EXPORT_CANCELLED');
      const source = await probeMedia(tools.ffprobePath, sourcePath);
      if (current.cancelled) throw codedError('EXPORT_CANCELLED');
      if (recipe.steps.some((step) => {
        const isSourceEffect = step.capability !== 'subtitle.burn@1';
        const ranges = isSourceEffect ? [step.range] : step.params.segments;
        return ranges.some((range) => range.start >= source.duration
          || range.end > source.duration + (isSourceEffect ? 0 : 0.001));
      })) {
        throw codedError('EXPORT_INVALID_MEDIA');
      }
      taskDir = await fsApi.mkdtemp(path.join(os.tmpdir(), 'srt-video-export-'));
      const assPath = path.join(taskDir, 'captions.ass');
      const stagedPath = path.join(taskDir, 'staged.mp4');
      const subtitleStep = recipe.steps.find((step) => step.capability === 'subtitle.burn@1');
      if (subtitleStep) await fsApi.writeFile(assPath, buildAss(subtitleStep, source), 'utf8');
      for (const [stepIndex, step] of recipe.steps.entries()) {
        if (step.capability === 'visual.text@1') {
          const lines = visualLayers.geometry('text',step.params,source.displayWidth,source.displayHeight).lines;
          for (const [lineIndex,line] of lines.entries()) if(line.text) {
            await fsApi.writeFile(path.join(taskDir,`layer-${stepIndex}-${lineIndex}.txt`),line.text,'utf8');
          }
        } else if (step.capability === 'visual.group@1') {
          const files = groupTextFiles(step, stepIndex, source);
          for (const file of files) {
            await fsApi.writeFile(path.join(taskDir, file.filename), file.text, 'utf8');
          }
        }
      }
      current.phase = 'rendering';
      sendProgress(onProgress, { jobId: job.jobId, phase: 'rendering', percent: 0 });
      if (current.cancelled) throw codedError('EXPORT_CANCELLED');
      const renderArgs = [
        '-hide_banner', '-nostdin', '-n', '-i', sourcePath,
        '-map', '0:v:0', '-map', '0:a:0?', '-vf', buildVideoFilters(recipe, source),
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
        '-pix_fmt', 'yuv420p', '-fps_mode', 'passthrough',
        '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
        '-progress', 'pipe:1', '-nostats', stagedPath
      ];
      let progressBuffer = '';
      const rendered = await runProcess(tools.ffmpegPath, renderArgs,
        { cwd: taskDir, shell: false }, (chunk) => {
          progressBuffer += chunk;
          const lines = progressBuffer.split(/\r?\n/);
          progressBuffer = lines.pop();
          for (const line of lines) {
            const match = /^out_time_us=(\d+)$/.exec(line);
            if (!match) continue;
            const percent = Math.min(99, Math.max(0,
              Math.floor(Number(match[1]) / (source.duration * 1000000) * 100)));
            sendProgress(onProgress, { jobId: job.jobId, phase: 'rendering', percent });
          }
        });
      if (current.cancelled) throw codedError('EXPORT_CANCELLED');
      if (rendered.error || rendered.code !== 0) throw codedError('EXPORT_RENDER_FAILED');
      current.phase = 'finalizing';
      sendProgress(onProgress, { jobId: job.jobId, phase: 'finalizing', percent: 99 });
      let output;
      try {
        output = await probeMedia(tools.ffprobePath, stagedPath);
      } catch (_) {
        throw codedError('EXPORT_RENDER_FAILED');
      }
      if (output.displayWidth !== source.displayWidth || output.displayHeight !== source.displayHeight
          || Math.abs(output.duration - source.duration) > 0.25
          || (source.hasAudio && !output.hasAudio)) {
        throw codedError('EXPORT_RENDER_FAILED');
      }
      try {
        await fsApi.copyFile(stagedPath, job.outputPath, constants.COPYFILE_EXCL);
      } catch (error) {
        if (error.code === 'EEXIST') throw codedError('EXPORT_TARGET_EXISTS');
        throw codedError('EXPORT_WRITE_FAILED');
      }
      terminal = { jobId: job.jobId, status: 'completed', outputPath: job.outputPath };
    } catch (error) {
      if (current && current.cancelled) {
        terminal = { jobId: job.jobId, status: 'cancelled' };
      } else {
        terminal = { jobId: job.jobId, status: 'failed', errorCode: error.code || 'EXPORT_FAILED' };
      }
    }
    let cleanupFailed = false;
    try {
      if (taskDir) await fsApi.rm(taskDir, { recursive: true, force: true });
    } catch (_) {
      cleanupFailed = true;
    } finally {
      current = null;
    }
    if (cleanupFailed) {
      return { jobId: job.jobId, status: 'failed', errorCode: 'EXPORT_WRITE_FAILED' };
    }
    return terminal;
  }

  function start(job, onProgress) {
    if (current) {
      return Promise.resolve({ jobId: job.jobId, status: 'failed', errorCode: 'EXPORT_BUSY' });
    }
    current = { jobId: job.jobId, phase: 'preparing', child: null, cancelled: false };
    const completion = Promise.resolve().then(() => execute(job, onProgress));
    current.completion = completion;
    sendProgress(onProgress, { jobId: job.jobId, phase: 'preparing', percent: null });
    return completion;
  }

  async function cancel(jobId) {
    const active = current;
    if (!active || active.jobId !== jobId) return;
    if (active.phase !== 'finalizing') {
      active.cancelled = true;
      if (active.child) active.child.kill();
    }
    await active.completion;
  }

  return { start, cancel, getState };
}

module.exports = { createVideoExportService, buildVideoFilters };
