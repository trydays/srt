const { test, expect } = require('./electron.fixture');
const fixedRecipe = require('./remotion-source-recipe');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs/promises');

const run = promisify(execFile);
const ffmpeg = process.env.SRT_FFMPEG_PATH || '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg';
const ffprobe = process.env.SRT_FFPROBE_PATH || '/opt/homebrew/opt/ffmpeg-full/bin/ffprobe';
const prompt = '固定 R3 本地配方（非真实 AI）：同时应用八种编辑能力';
const targets = [
  { key: 'landscape', width: 640, height: 360, audio: true, tone: 640 },
  { key: 'portrait', width: 360, height: 640, audio: false }
];
const samplePoints = [
  { key: 'bottom-left', xRatio: .16, yRatio: .67 },
  { key: 'bottom-right', xRatio: .84, yRatio: .67 }
];
const noisePoints = [
  ...[.12, .18, .24, .3].map((xRatio, index) => ({ key: `left-${index}`, xRatio, yRatio: .62 + index * .035 })),
  ...[.7, .76, .82, .88].map((xRatio, index) => ({ key: `right-${index}`, xRatio, yRatio: .62 + index * .035 }))
];
const graphTypes = [
  'source.video@1', 'video.color@1', 'video.transform@1', 'video.noise@1',
  'video.vignette@1', 'visual.shape@1', 'visual.text@1', 'visual.group@1',
  'visual.subtitle@1'
];
const terminalExportMessages = [
  '导出完成', '已取消', '当前视频路径不可用', '已有视频正在导出', '当前编辑暂不支持导出',
  '导出工具尚未准备好', '当前字幕无法导出', '目标文件已存在', '不能覆盖源视频',
  '视频文件不可用', '视频保存失败', '导出失败', '项目已变化，请重新导出',
  '当前编辑仍在处理中', '请先应用字幕修改'
];
const terminalExportPattern = new RegExp(`^(?:${terminalExportMessages.join('|')})$`);

async function makeAsymmetricVideo(file, target) {
  const source = [
    `color=c=0x172033:s=${target.width}x${target.height}:r=24:d=4`,
    'drawbox=x=0:y=0:w=iw/2:h=ih/2:color=0xD94A3A:t=fill',
    'drawbox=x=iw/2:y=0:w=iw-iw/2:h=ih/2:color=0x299D58:t=fill',
    'drawbox=x=0:y=ih/2:w=iw/2:h=ih-ih/2:color=0x285CC4:t=fill',
    'drawbox=x=iw/2:y=ih/2:w=iw-iw/2:h=ih-ih/2:color=0xE0AF24:t=fill',
    'drawbox=x=iw*0.06:y=ih*0.06:w=iw*0.12:h=ih*0.1:color=0xF7F4E8:t=fill'
  ].join(',');
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', source];
  if (target.audio) {
    args.push('-f', 'lavfi', '-i', `sine=frequency=${target.tone}:sample_rate=48000:duration=4`);
  }
  args.push('-map', '0:v:0');
  if (target.audio) args.push('-map', '1:a:0');
  args.push('-t', '4', '-c:v', 'libx264', '-crf', '9', '-pix_fmt', 'yuv420p',
    '-g', '24', '-keyint_min', '24');
  if (target.audio) args.push('-c:a', 'aac', '-b:a', '128k', '-shortest');
  else args.push('-an');
  args.push('-movflags', '+faststart', file);
  await run(ffmpeg, args);
}

async function makeReplacementVideo(file, target) {
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i',
    `color=c=0x7B2CBF:s=${target.width}x${target.height}:r=24:d=4,drawbox=x=iw*.7:y=ih*.7:w=iw*.2:h=ih*.2:color=0xF4E04D:t=fill`,
    '-t', '4', '-c:v', 'libx264', '-crf', '9', '-pix_fmt', 'yuv420p', '-an', file]);
}

async function enterHome(window) {
  await window.getByTestId('local-cli-codex').click();
  await window.getByTestId('continue').click();
  await expect(window.getByTestId('home-page')).toBeVisible();
}

async function openProject(window, source) {
  await window.getByTestId('video-input').setInputFiles(source);
  await window.getByTestId('start-editing').click();
  await expect(window.getByTestId('editor-page')).toBeVisible();
  await window.waitForFunction(() => window.projectEditingState === 'ready'
    && window.currentProjectVideoPath && window.editorPlayback);
  await expect(window.locator('#previewArea')).toHaveAttribute('data-render-engine', 'remotion');
  await expect(window.locator('#remotionPreview')).toHaveAttribute('data-state', 'ready');
}

async function seek(window, seconds, { sourceEffects = true } = {}) {
  const expectedFrame = Math.round(seconds * 24);
  await window.evaluate(value => window.editorPlayback.seekSeconds(value), expectedFrame / 24);
  await expect.poll(() => window.evaluate(() => window.editorPlayback.getState().currentTime), {
    message: `playback controller did not settle on frame ${expectedFrame}`
  }).toBeCloseTo(expectedFrame / 24, 6);
  await expect.poll(() => window.locator('#remotionPreview video').evaluate(video => {
    const state = window.editorPlayback.getState();
    if (video.seeking || video.readyState < 2) return 9999;
    return Math.abs(video.currentTime - state.currentTime);
  }), { message: `OffthreadVideo did not settle on frame ${expectedFrame}` }).toBeLessThanOrEqual(1 / 24);
  if (sourceEffects) {
    await expect(window.locator('#remotionPreview canvas[data-source-effects]'))
      .toHaveAttribute('data-drawn-frame', String(expectedFrame));
  }
  await window.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return expectedFrame;
}

async function sourceCanvasSamples(window, target, points) {
  return window.locator('#remotionPreview canvas[data-source-effects]').evaluate((canvas, input) => {
    const context = canvas.getContext('2d', { colorSpace: 'srgb' });
    return {
      width: canvas.width,
      height: canvas.height,
      drawnFrame: Number(canvas.dataset.drawnFrame),
      pixels: input.points.map(point => {
        const x = Math.floor(input.width * point.xRatio);
        const y = Math.floor(input.height * point.yRatio);
        return { ...point, x, y,
          rgb: Array.from(context.getImageData(x, y, 1, 1).data.slice(0, 3)) };
      })
    };
  }, { width: target.width, height: target.height, points });
}

function colorDistance(left, right) {
  return Math.max(...left.map((value, index) => Math.abs(value - right[index])));
}

function expectRgbNear(actual, expected, tolerance = 12) {
  expect(colorDistance(actual, expected)).toBeLessThanOrEqual(tolerance);
}

function pixelsByKey(sample) {
  return Object.fromEntries(sample.pixels.map(pixel => [pixel.key, pixel.rgb]));
}

async function submitFixedRecipe(window) {
  await window.locator('.input-editor').fill(prompt);
  await window.locator('#generateBtn').click();
  const card = window.getByTestId('request-status-card').last();
  await expect(card.getByTestId('instruction-status')).toHaveAttribute('data-state', 'success');
  await expect(card.getByTestId('subtitle-status')).toHaveAttribute('data-state', 'success');
  await expect(window.locator('#remotionPreview')).toHaveAttribute('data-state', 'ready');
  return card;
}

async function editAndApplySubtitle(window) {
  const segments = window.getByTestId('subtitle-document-segment');
  await expect(segments).toHaveCount(2);
  await segments.nth(1).fill('R3 已应用字幕');
  await window.getByTestId('subtitle-document-save').click();
  await expect(window.getByTestId('subtitle-document-status')).toHaveText('草稿已保存 · 尚未应用');
  await window.getByTestId('subtitle-document-apply').click();
  await expect(window.getByTestId('subtitle-document-status')).toHaveText('所有修改已应用');
}

async function saveViewAndSelectSkill(window, card) {
  const save = card.getByTestId('save-as-skill');
  if (!await save.isVisible()) await card.getByTestId('request-status-summary').click();
  await expect(save).toBeVisible();
  await save.click();
  const dialog = window.getByTestId('skill-save-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByTestId('skill-name').fill('R3 八项混合编辑');
  await dialog.getByTestId('skill-intent').fill('保留源画面效果、可视图层和已应用字幕');
  await dialog.getByTestId('skill-preferences').fill('根据横竖屏选用可读布局');
  await dialog.getByTestId('skill-save').click();
  await expect(dialog).toBeHidden();

  await window.getByTestId('personal-skills-button').click();
  const item = window.getByTestId('personal-skill-item');
  await expect(item).toHaveCount(1);
  await item.getByTestId('skill-view').click();
  await expect(item).toContainText('R3 八项混合编辑');
  for (const label of ['画面调色', '画面变换', '画面颗粒', '画面暗角', '动画图层']) {
    await expect(item).toContainText(label);
  }
  await item.getByTestId('skill-use').click();
  await expect(window.getByTestId('personal-skills-dialog')).toBeHidden();
  await expect(window.getByTestId('selected-skill')).toContainText('R3 八项混合编辑');
}

function expectNormalGraph(snapshot) {
  expect(snapshot.graph.nodes.map(node => node.type)).toEqual(graphTypes);
  const nodes = snapshot.graph.nodes;
  for (let index = 1; index < nodes.length; index += 1) {
    expect(nodes[index].inputs).toEqual([{ port: 'base', nodeId: nodes[index - 1].id }]);
  }
  expect(snapshot.document.edits).toHaveLength(8);
  expect(snapshot.graph.documentRevision).toBe(snapshot.document.revision);
}

async function expectMountedVisuals(window, snapshot, target) {
  const canvas = window.locator('#remotionPreview canvas[data-source-effects]');
  await expect(window.locator('#remotionPreview video')).toHaveCount(1);
  await expect(canvas).toHaveCount(1);
  await expect(canvas).toHaveAttribute('width', String(target.width));
  await expect(canvas).toHaveAttribute('height', String(target.height));
  await expect(window.locator('#previewVideo')).toBeHidden();
  await expect(window.locator('#previewLayerCanvas')).toBeHidden();
  await expect(window.locator('#previewSubtitle')).toBeHidden();

  const shape = snapshot.graph.nodes.find(node => node.type === 'visual.shape@1');
  const text = snapshot.graph.nodes.find(node => node.type === 'visual.text@1');
  const group = snapshot.graph.nodes.find(node => node.type === 'visual.group@1');
  const subtitle = snapshot.graph.nodes.find(node => node.type === 'visual.subtitle@1');
  const shapeRect = window.locator(`svg[data-layer-id="${shape.id}"] rect`);
  await expect(shapeRect).toHaveCount(1);
  const geometry = await shapeRect.evaluate(rect => ['x', 'y', 'width', 'height']
    .map(name => Number(rect.getAttribute(name))));
  const expectedGeometry = [shape.props.x * target.width, shape.props.y * target.height,
    shape.props.width * target.width, shape.props.height * target.height].map(Math.round);
  expect(Math.max(...geometry.map((value, index) => Math.abs(value - expectedGeometry[index]))))
    .toBeLessThanOrEqual(1);
  await expect(window.locator(`svg[data-layer-id="${text.id}"]`)).toContainText(target.key === 'portrait'
    ? '竖屏八项编辑' : '横屏八项编辑');
  await expect(window.locator(`svg[data-group-id="${group.id}"]`)).toContainText('混合效果');
  await expect(window.locator(`div[data-subtitle-id="${subtitle.id}"]`)).toContainText('R3 已应用字幕');

  const readableLabels = [target.key === 'portrait' ? '竖屏八项编辑' : '横屏八项编辑', '混合效果'];
  for (const label of readableLabels) {
    const bounds = await window.locator('#remotionPreview text').filter({ hasText: label }).first()
      .evaluate(element => {
        const box = element.getBoundingClientRect();
        const preview = document.getElementById('remotionPreview').getBoundingClientRect();
        return { left: box.left - preview.left, top: box.top - preview.top,
          right: box.right - preview.left, bottom: box.bottom - preview.top,
          width: box.width, height: box.height, previewWidth: preview.width, previewHeight: preview.height };
      });
    expect(bounds.left).toBeGreaterThanOrEqual(-1);
    expect(bounds.top).toBeGreaterThanOrEqual(-1);
    expect(bounds.right).toBeLessThanOrEqual(bounds.previewWidth + 1);
    expect(bounds.bottom).toBeLessThanOrEqual(bounds.previewHeight + 1);
    expect(bounds.width).toBeGreaterThan(8);
    expect(bounds.height).toBeGreaterThan(5);
  }
}

async function playAndPause(window) {
  const before = await window.evaluate(() => window.editorPlayback.getState().currentTime);
  await window.locator('#tlPlayBtn').click();
  await expect.poll(() => window.evaluate(() => window.editorPlayback.getState().currentTime), {
    timeout: 5000
  }).toBeGreaterThan(before + .1);
  await window.locator('#tlPlayBtn').click();
  const paused = await window.evaluate(() => window.editorPlayback.getState().currentTime);
  await window.waitForTimeout(120);
  const held = await window.evaluate(() => window.editorPlayback.getState().currentTime);
  expect(Math.abs(held - paused)).toBeLessThanOrEqual(1 / 24);
}

async function exportVideo(window, readScenarioState, testInfo, name) {
  await window.getByTestId('video-export-button').click();
  const status = window.getByTestId('video-export-status');
  await expect.poll(async () => (await status.textContent() || '').trim(), {
    timeout: 180000,
    message: 'Remotion export did not reach a terminal UI state'
  }).toMatch(terminalExportPattern);
  const state = await readScenarioState();
  const message = (await status.textContent() || '').trim();
  expect(message, [
    `Remotion export ended with UI status: ${message}`,
    `exportResults: ${JSON.stringify(state.exportResults || [])}`,
    `remotionErrors: ${JSON.stringify(state.remotionErrors || [])}`
  ].join('\n')).toBe('导出完成');
  const artifact = testInfo.outputPath(name);
  await fs.copyFile(state.exportOutputPath, artifact);
  await testInfo.attach(name, { path: artifact, contentType: 'video/mp4' });
  return { artifact, output: state.exportOutputPath, state };
}

async function cancelExport(window, readScenarioState) {
  const output = (await readScenarioState()).exportOutputPath;
  await expectAbsent(output);
  await window.getByTestId('video-export-button').click();
  await expect(window.getByTestId('video-export-status')).toHaveText(/^导出中 \d+%$/, { timeout: 180000 });
  await expect(window.getByTestId('video-export-cancel')).toBeEnabled();
  await window.getByTestId('video-export-cancel').click();
  await expect(window.getByTestId('video-export-status')).toHaveText('已取消', { timeout: 180000 });
  await expect(window.getByTestId('video-export-button')).toBeEnabled();
  await expectAbsent(output);
  const state = await readScenarioState();
  expect(state.exportCancels).toContain(state.exportRequests.at(-1).jobId);
  expect(state.exportResults.at(-1)).toMatchObject({ status: 'cancelled' });
}

async function expectAbsent(file) {
  let result = 'present';
  try { await fs.access(file); } catch (error) { result = error && error.code; }
  expect(result, `unexpected export target state for ${file}`).toBe('ENOENT');
}

async function mediaInfo(file) {
  const { stdout } = await run(ffprobe, [
    '-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', file
  ]);
  return JSON.parse(stdout);
}

function streamFps(video) {
  const [numerator, denominator] = video.avg_frame_rate.split('/').map(Number);
  return numerator / denominator;
}

function expectPlayable(info, target) {
  const video = info.streams.find(stream => stream.codec_type === 'video');
  const audio = info.streams.find(stream => stream.codec_type === 'audio');
  expect(video, 'export must contain video').toBeTruthy();
  expect([video.width, video.height]).toEqual([target.width, target.height]);
  const fps = streamFps(video);
  expect(fps).toBeCloseTo(24, 6);
  const duration = Number(video.duration || info.format.duration);
  expect(Math.abs(duration - 4), 'video duration drift').toBeLessThanOrEqual(1 / fps);
  const frames = Number(video.nb_read_frames || video.nb_frames);
  expect(Math.abs(frames - 96), 'encoded frame-count drift').toBeLessThanOrEqual(1);
  expect(Boolean(audio), 'audio presence must follow the source').toBe(target.audio);
  if (audio) {
    expect(Math.abs(Number(audio.start_time || 0)), 'audio start-time drift').toBeLessThanOrEqual(1 / fps);
    expect(Math.abs(Number(audio.duration) - 4), 'audio duration drift').toBeLessThanOrEqual(1 / fps);
  }
}

async function decodedFrame(file, target, frameIndex) {
  const { stdout } = await run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-i', file,
    '-vf', `select=eq(n\\,${frameIndex}),format=rgb24`, '-frames:v', '1',
    '-f', 'rawvideo', 'pipe:1'
  ], { encoding: 'buffer', maxBuffer: target.width * target.height * 4 });
  expect(stdout.length).toBe(target.width * target.height * 3);
  return stdout;
}

function sampleDecodedFrame(frame, target, points) {
  return points.map(point => {
    const x = Math.floor(target.width * point.xRatio);
    const y = Math.floor(target.height * point.yRatio);
    const offset = (y * target.width + x) * 3;
    return { ...point, x, y, rgb: Array.from(frame.subarray(offset, offset + 3)) };
  });
}

async function attachFrame(file, testInfo, name, frameIndex) {
  const destination = testInfo.outputPath(name);
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', file,
    '-vf', `select=eq(n\\,${frameIndex})`, '-frames:v', '1', destination]);
  await testInfo.attach(name, { path: destination, contentType: 'image/png' });
}

async function expectPreviewExportParity(window, exported, target, inactive, active, testInfo) {
  const inactiveExport = sampleDecodedFrame(await decodedFrame(exported, target, 12), target, samplePoints);
  const activeExport = sampleDecodedFrame(await decodedFrame(exported, target, 48), target, samplePoints);
  const inactivePreview = pixelsByKey(inactive);
  const activePreview = pixelsByKey(active);
  inactiveExport.forEach(pixel => expectRgbNear(pixel.rgb, inactivePreview[pixel.key]));
  activeExport.forEach(pixel => expectRgbNear(pixel.rgb, activePreview[pixel.key]));
  const evidence = { target, tolerance: 12,
    inactive: { frame: 12, preview: inactive.pixels, exported: inactiveExport },
    active: { frame: 48, preview: active.pixels, exported: activeExport } };
  await testInfo.attach(`r3-${target.key}-source-region-rgb`, {
    body: Buffer.from(JSON.stringify(evidence, null, 2)), contentType: 'application/json'
  });
}

async function expectReplacementOnly(window, replacement, oldProjectId, target) {
  const canonicalReplacement = await fs.realpath(replacement);
  await window.locator('.wtab.is-pinned .wtab__main').click();
  await expect(window.getByTestId('home-page')).toBeVisible();
  await openProject(window, replacement);
  await expect.poll(() => window.evaluate(() => window.currentProjectVideoPath)).toBe(canonicalReplacement);
  await expect.poll(() => window.evaluate(() => getActiveProjectId())).not.toBe(oldProjectId);
  const snapshot = await window.evaluate(() => projectEditing.load(getActiveProjectId()));
  expect(snapshot.graph.nodes.map(node => node.type)).toEqual(['source.video@1']);
  await expect(window.locator('#remotionPreview canvas[data-source-effects]')).toHaveCount(0);
  await expect(window.locator('#remotionPreview')).not.toContainText('八项编辑');
  await expect(window.locator('#remotionPreview')).not.toContainText('混合效果');
  await expect(window.locator('#remotionPreview')).not.toContainText('R3 已应用字幕');
  await seek(window, .5, { sourceEffects: false });
  const rgb = await window.locator('#remotionPreview video').evaluate((video, dimensions) => {
    const canvas = document.createElement('canvas');
    canvas.width = dimensions.width; canvas.height = dimensions.height;
    const context = canvas.getContext('2d', { colorSpace: 'srgb' });
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return Array.from(context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1)
      .data.slice(0, 3));
  }, target);
  expectRgbNear(rgb, [123, 44, 191]);
}

test.describe('R3 production-default Remotion source effects workflow (fixed local recipe, not real AI)', () => {
  test.use({ localCliMode: 'two', localCliEffectResult: 'remotion-source-effects-flow',
    subtitleResult: 'success', remotionRendering: 'default' });
  test.setTimeout(420000);

  for (const target of targets) {
    test(`${target.key}: applies, reopens, exports, reexports and undoes all eight abilities`, async ({
      window, readScenarioState
    }, testInfo) => {
      const source = testInfo.outputPath(`r3-${target.key}-asymmetric-source.mp4`);
      const replacement = testInfo.outputPath(`r3-${target.key}-replacement-source.mp4`);
      await makeAsymmetricVideo(source, target);
      await makeReplacementVideo(replacement, target);
      await enterHome(window);
      await openProject(window, source);
      const projectId = await window.evaluate(() => getActiveProjectId());
      const card = await submitFixedRecipe(window);
      const call = (await readScenarioState()).translationCalls.at(-1);
      expect(call.text).toBe(prompt);
      expect(call.context.video).toEqual({ durationSeconds: 4, width: target.width, height: target.height });
      expect(fixedRecipe(prompt, call.context).steps.map(step => step.capability)).toEqual([
        'video.color.adjust@1', 'video.transform@1', 'video.noise@1', 'video.vignette@1',
        'visual.shape@1', 'visual.text@1', 'visual.group@1', 'subtitle.generate@1'
      ]);

      await editAndApplySubtitle(window);
      await seek(window, .5);
      const inactive = await sourceCanvasSamples(window, target, samplePoints);
      expect(inactive.drawnFrame).toBe(12);
      await playAndPause(window);
      await seek(window, 2);
      const active = await sourceCanvasSamples(window, target, samplePoints);
      const firstNoise = await sourceCanvasSamples(window, target, noisePoints);
      expect(active.drawnFrame).toBe(48);
      const inactivePixels = pixelsByKey(inactive), activePixels = pixelsByKey(active);
      expect(colorDistance(inactivePixels['bottom-left'], inactivePixels['bottom-right']))
        .toBeGreaterThan(40);
      expect(colorDistance(activePixels['bottom-left'], activePixels['bottom-right']))
        .toBeGreaterThan(40);
      expect(colorDistance(activePixels['bottom-left'], inactivePixels['bottom-right']))
        .toBeLessThan(colorDistance(activePixels['bottom-left'], inactivePixels['bottom-left']));
      expect(colorDistance(activePixels['bottom-right'], inactivePixels['bottom-left']))
        .toBeLessThan(colorDistance(activePixels['bottom-right'], inactivePixels['bottom-right']));
      await seek(window, 2 + 2 / 24);
      const nextNoise = await sourceCanvasSamples(window, target, noisePoints);
      expect(nextNoise.pixels.map(pixel => pixel.rgb)).not.toEqual(firstNoise.pixels.map(pixel => pixel.rgb));
      await seek(window, 2.5);
      await seek(window, 2);
      const repeatedNoise = await sourceCanvasSamples(window, target, noisePoints);
      expect(repeatedNoise.pixels.map(pixel => pixel.rgb)).toEqual(firstNoise.pixels.map(pixel => pixel.rgb));

      const applied = await window.evaluate(() => projectEditing.load(getActiveProjectId()));
      expectNormalGraph(applied);
      await expectMountedVisuals(window, applied, target);
      const previewPath = testInfo.outputPath(`r3-${target.key}-mixed-preview.png`);
      await window.locator('#remotionPreview').screenshot({ path: previewPath });
      await testInfo.attach(`r3-${target.key}-mixed-preview`, { path: previewPath, contentType: 'image/png' });
      if (target.key === 'landscape') await saveViewAndSelectSkill(window, card);

      const savedBytes = await window.evaluate(() => localStorage.getItem(STORAGE_KEYS.PROJECT_EDIT_STATE));
      await window.reload();
      await window.waitForFunction(() => window.projectEditingState === 'ready'
        && window.currentProjectVideoPath && window.editorPlayback);
      await expect(window.locator('#previewArea')).toHaveAttribute('data-render-engine', 'remotion');
      await expect(window.locator('#remotionPreview')).toHaveAttribute('data-state', 'ready');
      expect(await window.evaluate(() => localStorage.getItem(STORAGE_KEYS.PROJECT_EDIT_STATE))).toBe(savedBytes);
      const reopened = await window.evaluate(() => projectEditing.load(getActiveProjectId()));
      expect(reopened).toEqual(applied);
      await seek(window, 2);
      const reopenedActive = await sourceCanvasSamples(window, target, samplePoints);
      expect(reopenedActive.pixels.map(pixel => pixel.rgb)).toEqual(active.pixels.map(pixel => pixel.rgb));
      await expectMountedVisuals(window, reopened, target);

      const first = await exportVideo(window, readScenarioState, testInfo,
        `r3-${target.key}-first-export.mp4`);
      expectPlayable(await mediaInfo(first.artifact), target);
      const firstRequest = first.state.exportRequests.at(-1);
      expect(firstRequest.snapshot).toEqual(reopened);
      expect(firstRequest).not.toHaveProperty('recipe');
      expect(first.state.exportResults.at(-1)).toMatchObject({ status: 'completed' });
      expect(first.state.remotionErrors || []).toEqual([]);
      await expectPreviewExportParity(window, first.artifact, target, inactive, reopenedActive, testInfo);
      await attachFrame(first.artifact, testInfo, `r3-${target.key}-mixed-export-frame.png`, 48);

      await fs.unlink(first.output);
      if (target.key === 'landscape') await cancelExport(window, readScenarioState);
      const second = await exportVideo(window, readScenarioState, testInfo,
        `r3-${target.key}-successful-reexport.mp4`);
      expectPlayable(await mediaInfo(second.artifact), target);
      expect(second.state.exportRequests.at(-1).snapshot).toEqual(reopened);
      expect(second.state.exportRequests.at(-1)).not.toHaveProperty('recipe');

      const restoredCard = window.getByTestId('request-status-card').last();
      const undo = restoredCard.getByRole('button', { name: '撤销本次编辑', exact: true });
      if (!await undo.isVisible()) await restoredCard.getByTestId('request-status-summary').click();
      await expect(undo).toBeVisible();
      await undo.click();
      const undone = await window.evaluate(() => projectEditing.load(getActiveProjectId()));
      expect(undone.document.edits).toHaveLength(0);
      expect(undone.graph.nodes.map(node => node.type)).toEqual(['source.video@1']);
      await expect(window.locator('#remotionPreview canvas[data-source-effects]')).toHaveCount(0);
      await expect(window.locator('#remotionPreview')).not.toContainText('R3 已应用字幕');

      await expectReplacementOnly(window, replacement, projectId, target);
    });
  }
});
