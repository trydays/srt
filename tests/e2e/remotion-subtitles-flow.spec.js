const { test, expect } = require('./electron.fixture');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs/promises');

const run = promisify(execFile);
const ffmpeg = process.env.SRT_FFMPEG_PATH || '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg';
const ffprobe = process.env.SRT_FFPROBE_PATH || '/opt/homebrew/opt/ffmpeg-full/bin/ffprobe';
const targets = [
  { key: 'landscape', width: 640, height: 360, tone: 660 },
  { key: 'portrait', width: 360, height: 640, tone: 770 }
];
const terminalExportMessages = [
  '导出完成', '已取消', '当前视频路径不可用', '已有视频正在导出', '当前编辑暂不支持导出',
  '导出工具尚未准备好', '当前字幕无法导出', '目标文件已存在', '不能覆盖源视频',
  '视频文件不可用', '视频保存失败', '导出失败', '项目已变化，请重新导出',
  '当前编辑仍在处理中', '请先应用字幕修改'
];
const terminalExportPattern = new RegExp(`^(?:${terminalExportMessages.join('|')})$`);

async function makeVideo(file, target) {
  await run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `color=c=0x1666CC:s=${target.width}x${target.height}:r=24:d=4`,
    '-f', 'lavfi', '-i', `sine=frequency=${target.tone}:sample_rate=48000:duration=4`,
    '-shortest', '-c:v', 'libx264', '-crf', '9', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file
  ]);
}

async function openEditor(window, source) {
  await window.getByTestId('local-cli-codex').click();
  await window.getByTestId('continue').click();
  await window.getByTestId('video-input').setInputFiles(source);
  await window.getByTestId('start-editing').click();
  await expect(window.getByTestId('editor-page')).toBeVisible();
  await window.waitForFunction(() => window.projectEditingState === 'ready'
    && window.currentProjectVideoPath && window.editorPlayback);
  await expect(window.locator('#previewArea')).toHaveAttribute('data-render-engine', 'remotion');
  await expect(window.locator('#remotionPreview')).toHaveAttribute('data-state', 'ready');
}

async function seek(window, seconds) {
  await window.evaluate((value) => window.editorPlayback.seekSeconds(value), seconds);
  await expect.poll(() => window.evaluate(() => window.editorPlayback.getState().currentTime))
    .toBeCloseTo(seconds, 1);
  await window.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function exportVideo(window, readScenarioState, testInfo, name) {
  await window.getByTestId('video-export-button').click();
  const status = window.getByTestId('video-export-status');
  await expect.poll(async () => (await status.textContent() || '').trim(), { timeout: 180000,
    message: 'Remotion export did not reach a terminal UI state' }).toMatch(terminalExportPattern);
  const state = await readScenarioState();
  const terminalMessage = (await status.textContent() || '').trim();
  expect(terminalMessage, [
    `Remotion export ended with UI status: ${terminalMessage}`,
    `exportResults: ${JSON.stringify(state.exportResults || [])}`,
    `remotionErrors: ${JSON.stringify(state.remotionErrors || [])}`
  ].join('\n')).toBe('导出完成');
  const artifact = testInfo.outputPath(name);
  await fs.copyFile(state.exportOutputPath, artifact);
  await testInfo.attach(name, { path: artifact, contentType: 'video/mp4' });
  return { artifact, output: state.exportOutputPath };
}

async function mediaInfo(file) {
  const { stdout } = await run(ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', file]);
  return JSON.parse(stdout);
}

async function frame(file, time, destination) {
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(time), '-i', file,
    '-frames:v', '1', destination]);
  return fs.readFile(destination);
}

async function subtitleRegion(file, time, target) {
  const top = Math.floor(target.height * .7);
  const { stdout } = await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', String(time),
    '-i', file, '-vf', `crop=${target.width}:${target.height - top}:0:${top},format=rgb24`,
    '-frames:v', '1', '-f', 'rawvideo', 'pipe:1'], { encoding: 'buffer' });
  return stdout;
}

async function pixel(file, time, target, xRatio, yRatio) {
  const x = Math.floor(target.width * xRatio), y = Math.floor(target.height * yRatio);
  const { stdout } = await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', String(time),
    '-i', file, '-vf', `format=rgb24,crop=1:1:${x}:${y}`, '-frames:v', '1',
    '-f', 'rawvideo', 'pipe:1'], { encoding: 'buffer' });
  return Array.from(stdout.subarray(0, 3));
}

function expectRgbNear(actual, expected, tolerance = 12) {
  expect(Math.max(...actual.map((value, index) => Math.abs(value - expected[index]))))
    .toBeLessThanOrEqual(tolerance);
}

function expectPlayable(info, target) {
  const video = info.streams.find(stream => stream.codec_type === 'video');
  const audio = info.streams.find(stream => stream.codec_type === 'audio');
  expect(video).toMatchObject({ width: target.width, height: target.height });
  expect(audio, 'source audio must be retained').toBeTruthy();
  expect(Number(video.duration)).toBeCloseTo(4, 1);
  expect(Number(video.avg_frame_rate.split('/')[0]) / Number(video.avg_frame_rate.split('/')[1]))
    .toBeCloseTo(24, 6);
  expect(Number(audio.duration)).toBeCloseTo(4, 1);
}

async function expectFourVisualTypes(window, firstSubtitle) {
  const snapshot = await window.evaluate(() => projectEditing.load(getActiveProjectId()));
  expect(snapshot.graph.nodes.map(node => node.type)).toEqual([
    'source.video@1', 'visual.shape@1', 'visual.text@1', 'visual.group@1', 'visual.subtitle@1'
  ]);
  expect(snapshot.graph.nodes.find(node => node.type === 'visual.text@1').props.text)
    .toBe('独立文字\n第二行');
  expect(snapshot.graph.nodes.find(node => node.type === 'visual.subtitle@1').props.segments[0].text)
    .toBe(firstSubtitle);
  await expect(window.locator('#remotionPreview')).toContainText('独立文字');
  await expect(window.locator('#remotionPreview')).toContainText('第二行');
  await expect(window.locator('#remotionPreview')).toContainText('组合动画');
  await expect(window.locator('#remotionPreview')).toContainText(firstSubtitle);
  for (const label of ['独立文字', '第二行', '组合动画']) {
    const bounds = await window.locator('#remotionPreview text').filter({ hasText: label }).first()
      .evaluate((element) => {
        const box = element.getBoundingClientRect();
        const preview = document.getElementById('remotionPreview').getBoundingClientRect();
        return { left: box.left - preview.left, top: box.top - preview.top,
          right: box.right - preview.left, bottom: box.bottom - preview.top,
          width: preview.width, height: preview.height };
      });
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.top).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(bounds.width);
    expect(bounds.bottom).toBeLessThanOrEqual(bounds.height);
  }
  await expect(window.locator('#previewVideo')).toBeHidden();
  await expect(window.locator('#previewLayerCanvas')).toBeHidden();
  await expect(window.locator('#previewSubtitle')).toBeHidden();
  return snapshot;
}

test.describe('Remotion standalone layers and applied subtitles (fixed recipe, not real AI)', () => {
  test.use({ localCliMode: 'two', localCliEffectResult: 'remotion-subtitles-flow',
    subtitleResult: 'success', remotionRendering: true });
  test.setTimeout(360000);

  for (const target of targets) {
    test(`${target.key}: edits one applied subtitle snapshot across preview, reload, export and undo`, async ({
      window, readScenarioState
    }, testInfo) => {
      const source = testInfo.outputPath(`r2-${target.key}-source.mp4`);
      await makeVideo(source, target);
      await openEditor(window, source);
      await window.locator('.input-editor').fill('固定 R2 配方：独立矩形、独立多行文字、组合动画和字幕');
      await window.locator('#generateBtn').click();
      const card = window.getByTestId('request-status-card').last();
      await expect(card.getByTestId('subtitle-status')).toHaveAttribute('data-state', 'success');

      await seek(window, 1.2);
      const applied = await expectFourVisualTypes(window, '大家好');
      await window.getByTestId('subtitle-block').first().click();
      await expect(window.locator('#previewSubtitle')).toBeHidden();
      await expect(window.locator('#remotionPreview')).toContainText('大家好');
      await seek(window, 1.2);
      const originalShot = testInfo.outputPath(`r2-${target.key}-original-preview.png`);
      await window.locator('#remotionPreview').screenshot({ path: originalShot });
      await testInfo.attach(`r2-${target.key}-original-preview`, { path: originalShot, contentType: 'image/png' });

      const originalExport = await exportVideo(window, readScenarioState, testInfo,
        `r2-${target.key}-original.mp4`);
      expectPlayable(await mediaInfo(originalExport.artifact), target);
      const originalFramePath = testInfo.outputPath(`r2-${target.key}-original-frame.png`);
      const originalFrame = await frame(originalExport.artifact, 1.2, originalFramePath);
      await testInfo.attach(`r2-${target.key}-original-frame`, { path: originalFramePath, contentType: 'image/png' });
      expectRgbNear(await pixel(originalExport.artifact, 1.2, target, .09, .13), [23, 184, 144]);
      const originalSubtitleRegion = await subtitleRegion(originalExport.artifact, 1.2, target);

      const segments = window.getByTestId('subtitle-document-segment');
      await segments.nth(0).fill('已修改字幕');
      await segments.nth(1).fill('第二段已修改');
      await window.getByTestId('subtitle-document-save').click();
      await expect(window.getByTestId('subtitle-document')).toContainText('草稿已保存 · 尚未应用');
      await expect(window.locator('#remotionPreview')).toContainText('大家好');
      await window.getByTestId('video-export-button').click();
      await expect(window.getByTestId('video-export-status')).toHaveText('请先应用字幕修改');

      await window.reload();
      await window.waitForFunction(() => window.projectEditingState === 'ready'
        && window.currentProjectVideoPath && window.editorPlayback);
      await expect(window.locator('#remotionPreview')).toHaveAttribute('data-state', 'ready');
      await window.getByTestId('subtitle-document-toggle').click();
      await expect(segments.nth(0)).toHaveText('已修改字幕');
      await seek(window, 1.2);
      await expectFourVisualTypes(window, '大家好');

      await window.getByTestId('subtitle-document-apply').click();
      await expect(window.getByTestId('subtitle-document')).toContainText('所有修改已应用');
      await seek(window, 1.2);
      const edited = await expectFourVisualTypes(window, '已修改字幕');
      expect(edited.document.revision).toBe(applied.document.revision + 1);
      expect(await window.evaluate(() => currentSubtitleState().draft)).toBeNull();
      const editedShot = testInfo.outputPath(`r2-${target.key}-edited-preview.png`);
      await window.locator('#remotionPreview').screenshot({ path: editedShot });
      await testInfo.attach(`r2-${target.key}-edited-preview`, { path: editedShot, contentType: 'image/png' });

      await fs.unlink(originalExport.output);
      const editedExport = await exportVideo(window, readScenarioState, testInfo,
        `r2-${target.key}-edited.mp4`);
      expectPlayable(await mediaInfo(editedExport.artifact), target);
      const editedFramePath = testInfo.outputPath(`r2-${target.key}-edited-frame.png`);
      const editedFrame = await frame(editedExport.artifact, 1.2, editedFramePath);
      await testInfo.attach(`r2-${target.key}-edited-frame`, { path: editedFramePath, contentType: 'image/png' });
      const editedSubtitleRegion = await subtitleRegion(editedExport.artifact, 1.2, target);
      expect(editedSubtitleRegion.equals(originalSubtitleRegion),
        'the encoded pixels in the subtitle region must change').toBe(false);
      expect(editedFrame.equals(originalFrame), 'the retained full-frame evidence must change').toBe(false);
      expect((await fs.stat(editedExport.artifact)).size).toBeGreaterThan(0);

      await window.reload();
      await window.waitForFunction(() => window.projectEditingState === 'ready'
        && window.currentProjectVideoPath && window.editorPlayback);
      await seek(window, 1.2);
      await expectFourVisualTypes(window, '已修改字幕');
      const restoredCard = window.getByTestId('request-status-card').last();
      await restoredCard.getByTestId('request-status-summary').click();
      await restoredCard.getByRole('button', { name: '撤销本次编辑', exact: true }).click();
      const undone = await window.evaluate(() => projectEditing.load(getActiveProjectId()));
      expect(undone.document.edits).toHaveLength(0);
      expect(undone.graph.nodes.map(node => node.type)).toEqual(['source.video@1']);
      await expect(window.locator('#remotionPreview')).not.toContainText('已修改字幕');
    });
  }
});
