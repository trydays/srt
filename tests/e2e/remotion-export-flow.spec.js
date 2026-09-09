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
const frameExpectations = [
  { time: 0.5, rgb: [22, 102, 204] },
  { time: 1, rgb: [22, 102, 204] },
  { time: 1.5, rgb: [113, 77, 119] },
  { time: 3.458333, rgb: [204, 51, 34] },
  { time: 3.5, rgb: [22, 102, 204] }
];
const terminalExportMessages = [
  '导出完成', '已取消', '当前视频路径不可用', '已有视频正在导出',
  '当前编辑暂不支持导出', '导出工具尚未准备好', '当前字幕无法导出',
  '目标文件已存在', '不能覆盖源视频', '视频文件不可用', '视频保存失败',
  '导出失败', '项目已变化，请重新导出', '当前编辑仍在处理中', '请先应用字幕修改'
];
const terminalExportPattern = new RegExp(`^(?:${terminalExportMessages.join('|')})$`);

async function makeVideo(file, target) {
  await run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `color=c=0x1666CC:s=${target.width}x${target.height}:r=24:d=4`,
    '-f', 'lavfi', '-i', `sine=frequency=${target.tone}:sample_rate=48000:duration=4`,
    '-shortest', '-c:v', 'libx264', '-crf', '9', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', file
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

async function submitGroup(window) {
  await window.locator('.input-editor').fill('添加组合动画');
  await window.locator('#generateBtn').click();
  const card = window.getByTestId('request-status-card').last();
  await expect(card.getByTestId('timeline-status')).toHaveAttribute('data-state', 'success');
  await expect(window.locator('#remotionPreview')).toHaveAttribute('data-state', 'ready');
  return card;
}

async function exportAndPreserve(window, readScenarioState, testInfo, artifactName) {
  await window.getByTestId('video-export-button').click();
  const status = window.getByTestId('video-export-status');
  await expect.poll(async () => (await status.textContent() || '').trim(), {
    timeout: 180000,
    message: 'Remotion export did not reach a terminal UI state'
  }).toMatch(terminalExportPattern);
  const terminalMessage = (await status.textContent() || '').trim();
  const scenarioState = await readScenarioState();
  const failureDetail = [
    `Remotion export ended with UI status: ${terminalMessage}`,
    `exportResults: ${JSON.stringify(scenarioState.exportResults || [])}`,
    `remotionErrors: ${JSON.stringify(scenarioState.remotionErrors || [])}`
  ].join('\n');
  expect(terminalMessage, failureDetail)
    .toBe('导出完成');
  const outputPath = scenarioState.exportOutputPath;
  const artifactPath = testInfo.outputPath(artifactName);
  await fs.copyFile(outputPath, artifactPath);
  await testInfo.attach(artifactName, { path: artifactPath, contentType: 'video/mp4' });
  return { outputPath, artifactPath };
}

async function probe(file) {
  const { stdout } = await run(ffprobe, [
    '-v', 'error', '-show_streams', '-show_format', '-of', 'json', file
  ]);
  return JSON.parse(stdout);
}

async function pixel(file, x, y, time = 2.5) {
  const { stdout } = await run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-ss', String(time), '-i', file,
    '-vf', `format=rgb24,crop=1:1:${x}:${y}`, '-frames:v', '1',
    '-f', 'rawvideo', 'pipe:1'
  ], { encoding: 'buffer' });
  return Array.from(stdout.subarray(0, 3));
}

async function expectAbsent(file) {
  let outcome = 'present';
  try {
    await fs.access(file);
  } catch (error) {
    outcome = error && error.code;
  }
  expect(outcome, `unexpected export target state for ${file}`).toBe('ENOENT');
}

function expectRgbNear(actual, expected, tolerance = 12) {
  expect(actual).toHaveLength(3);
  expect(Math.max(...actual.map((value, index) => Math.abs(value - expected[index]))))
    .toBeLessThanOrEqual(tolerance);
}

function streamFps(video) {
  const [numerator, denominator] = video.avg_frame_rate.split('/').map(Number);
  return numerator / denominator;
}

function expectPlayableMedia(media, target) {
  const video = media.streams.find((stream) => stream.codec_type === 'video');
  const audio = media.streams.find((stream) => stream.codec_type === 'audio');
  expect(video, 'export must contain a video stream').toBeTruthy();
  expect(audio, 'export must retain the source audio stream').toBeTruthy();
  expect([video.width, video.height]).toEqual([target.width, target.height]);
  const fps = streamFps(video);
  expect(fps).toBeCloseTo(24, 6);
  expect(Math.abs(Number(video.duration) - 4), 'video stream duration drift')
    .toBeLessThanOrEqual(1 / fps);
  expect(Math.abs(Number(audio.start_time)), 'audio stream start-time drift')
    .toBeLessThanOrEqual(1 / fps);
  expect(Math.abs(Number(audio.duration) - 4), 'audio stream duration drift')
    .toBeLessThanOrEqual(1 / fps);
}

test.describe('Remotion production export from the desktop (fixed local recipe, not real AI)', () => {
  test.use({
    localCliMode: 'two',
    localCliEffectResult: 'group-transactions-success',
    remotionRendering: true
  });
  test.setTimeout(240000);

  for (const target of targets) {
    test(`exports the frozen ${target.key} group snapshot, then source-only after undo`, async ({
      window,
      readScenarioState
    }, testInfo) => {
      const source = testInfo.outputPath(`remotion-export-${target.key}-source.mp4`);
      await makeVideo(source, target);
      await openEditor(window, source);
      const card = await submitGroup(window);
      const withGroup = await window.evaluate(() => projectEditing.load(getActiveProjectId()));

      await window.evaluate(() => {
        window.SRTRenderRecipe.buildRenderRecipe = function() {
          throw new Error('legacy render recipe path must not run for a Remotion project');
        };
      });
      const first = await exportAndPreserve(
        window, readScenarioState, testInfo, `remotion-export-${target.key}-with-card.mp4`
      );
      const firstRequest = (await readScenarioState()).exportRequests.at(-1);
      expect(firstRequest.snapshot).toEqual(withGroup);
      expect(firstRequest).not.toHaveProperty('recipe');
      expect(await window.evaluate(() => projectEditing.load(getActiveProjectId()))).toEqual(withGroup);

      expectPlayableMedia(await probe(first.artifactPath), target);
      const sampleX = Math.floor(target.width * 0.6);
      const sampleY = Math.floor(target.height * 0.6);
      const renderedPixels = [];
      for (const expectation of frameExpectations) {
        const actual = await pixel(first.artifactPath, sampleX, sampleY, expectation.time);
        renderedPixels.push(actual);
        expectRgbNear(actual, expectation.rgb);
      }
      const cardPixel = renderedPixels[3];

      await card.getByTestId('request-status-summary').click();
      await card.getByRole('button', { name: '撤销本次编辑', exact: true }).click();
      const sourceOnly = await window.evaluate(() => projectEditing.load(getActiveProjectId()));
      expect(sourceOnly.document.edits).toHaveLength(0);
      expect(sourceOnly.graph.nodes.map((node) => node.type)).toEqual(['source.video@1']);
      await expect(window.locator('#previewArea')).toHaveAttribute('data-render-engine', 'remotion');
      await expect(window.locator('#remotionPreview')).toHaveAttribute('data-state', 'ready');

      // The injected destination belongs to this test's disposable userData. Remove
      // only that completed output so the production no-overwrite guard can admit
      // the second export without weakening source/target protection.
      await fs.unlink(first.outputPath);
      const second = await exportAndPreserve(
        window, readScenarioState, testInfo, `remotion-export-${target.key}-after-undo.mp4`
      );
      const secondRequest = (await readScenarioState()).exportRequests.at(-1);
      expect(secondRequest.snapshot).toEqual(sourceOnly);
      expect(secondRequest).not.toHaveProperty('recipe');

      expectPlayableMedia(await probe(second.artifactPath), target);
      const cleanPixel = await pixel(second.artifactPath, sampleX, sampleY);
      expectRgbNear(cleanPixel, [22, 102, 204]);
      expect(cleanPixel).not.toEqual(cardPixel);
    });
  }

  test('cancels one real render and restores the desktop without leaving a target', async ({
    window,
    readScenarioState
  }, testInfo) => {
    const target = targets[0];
    const source = testInfo.outputPath('remotion-export-cancel-source.mp4');
    await makeVideo(source, target);
    await openEditor(window, source);
    const card = await submitGroup(window);
    await card.getByTestId('request-status-summary').click();
    const undo = card.getByRole('button', { name: '撤销本次编辑', exact: true });
    await window.locator('.input-editor').fill('取消后保留这段输入');

    const outputPath = (await readScenarioState()).exportOutputPath;
    await expectAbsent(outputPath);
    await window.getByTestId('video-export-button').click();
    await expect(window.getByTestId('video-export-status')).toHaveText(/^导出中 \d+%$/, {
      timeout: 180000
    });
    await expect(window.getByTestId('video-export-cancel')).toBeEnabled();
    await expect(window.getByTestId('video-export-button')).toBeDisabled();
    await expect(window.locator('#generateBtn')).toBeDisabled();
    await expect(window.locator('#tabsBar')).toHaveAttribute('inert');
    await expect(undo).toBeDisabled();
    await window.getByTestId('video-export-cancel').click();

    await expect(window.getByTestId('video-export-status')).toHaveText('已取消', { timeout: 180000 });
    await expect(window.getByTestId('video-export-button')).toBeEnabled();
    await expect(window.locator('#generateBtn')).toBeEnabled();
    await expect(window.locator('#tabsBar')).not.toHaveAttribute('inert');
    await expect(undo).toBeEnabled();
    await expect(window.locator('.input-editor')).toHaveAttribute('contenteditable', 'true');
    await expect(window.locator('.input-editor')).toHaveText('取消后保留这段输入');
    await expectAbsent(outputPath);
    const scenarioState = await readScenarioState();
    expect(scenarioState.exportCancels).toContain(scenarioState.exportRequests.at(-1).jobId);
    expect(scenarioState.exportResults.at(-1)).toMatchObject({ status: 'cancelled' });
  });
});
