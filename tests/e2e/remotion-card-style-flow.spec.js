const { test, expect } = require('./electron.fixture');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs/promises');

const run = promisify(execFile);
const ffmpeg = process.env.SRT_FFMPEG_PATH || '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg';
const ffprobe = process.env.SRT_FFPROBE_PATH || '/opt/homebrew/opt/ffmpeg-full/bin/ffprobe';
const targets = [{ key: 'landscape', width: 640, height: 360, tone: 880 },
  { key: 'portrait', width: 360, height: 640, tone: 990 }];

async function makeVideo(file, target) {
  await run(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i',
    `color=c=0x1666CC:s=${target.width}x${target.height}:r=24:d=4`, '-f', 'lavfi', '-i',
    `sine=frequency=${target.tone}:sample_rate=48000:duration=4`, '-shortest',
    '-c:v', 'libx264', '-crf', '9', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file]);
}

async function enterAndOpen(window, source) {
  if (await window.getByTestId('environment-page').isVisible()) {
    await window.getByTestId('local-cli-codex').click();
    await window.getByTestId('continue').click();
  }
  await window.getByTestId('video-input').setInputFiles(source);
  await window.getByTestId('start-editing').click();
  await expect(window.getByTestId('editor-page')).toBeVisible();
  await window.waitForFunction(() => window.projectEditingState === 'ready' && window.editorPlayback);
  await expect(window.locator('#remotionPreview')).toHaveAttribute('data-state', 'ready');
}

async function submit(window, text) {
  await window.locator('.input-editor').fill(text);
  await window.locator('#generateBtn').click();
  const card = window.getByTestId('request-status-card').last();
  await expect(card.getByTestId('timeline-status')).toHaveAttribute('data-state', 'success');
  await expect(window.locator('#remotionPreview')).toHaveAttribute('data-state', 'ready');
  return card;
}

async function seek(window, seconds) {
  await window.evaluate(value => window.editorPlayback.seekSeconds(value), seconds);
  await expect.poll(() => window.evaluate(() => window.editorPlayback.getState().currentTime))
    .toBeCloseTo(seconds, 1);
  await window.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function mountedRgb(window, xRatio, yRatio) {
  return window.evaluate(async ({ xRatio, yRatio }) => {
    const sceneVideo = document.querySelector('#remotionPreview video');
    const canvas = document.createElement('canvas');
    canvas.width = sceneVideo.videoWidth; canvas.height = sceneVideo.videoHeight;
    const context = canvas.getContext('2d'); context.drawImage(sceneVideo, 0, 0);
    for (const mounted of document.querySelectorAll('#remotionPreview svg[data-group-id]')) {
      const svg = mounted.cloneNode(true); svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
      const image = new Image(); image.src = url;
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; });
      context.drawImage(image, 0, 0, canvas.width, canvas.height); URL.revokeObjectURL(url);
    }
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let whiteInk = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] >= 245 && pixels[index + 1] >= 245 && pixels[index + 2] >= 245) whiteInk++;
    }
    const offset = (Math.floor(canvas.height * yRatio) * canvas.width
      + Math.floor(canvas.width * xRatio)) * 4;
    return { rgb: Array.from(pixels.slice(offset, offset + 3)), whiteInk };
  }, { xRatio, yRatio });
}

function near(actual, expected, tolerance = 12) {
  expect(Math.max(...actual.map((value, index) => Math.abs(value - expected[index]))))
    .toBeLessThanOrEqual(tolerance);
}

async function exportedRgb(file, target, xRatio, yRatio, time) {
  const x = Math.floor(target.width * xRatio), y = Math.floor(target.height * yRatio);
  const { stdout } = await run(ffmpeg, ['-v', 'error', '-ss', String(time), '-i', file,
    '-vf', `format=rgb24,crop=1:1:${x}:${y}`, '-frames:v', '1', '-f', 'rawvideo', 'pipe:1'],
  { encoding: 'buffer' });
  return Array.from(stdout.subarray(0, 3));
}

async function decodedTone(file) {
  const { stdout } = await run(ffmpeg, ['-v', 'error', '-ss', '1', '-i', file,
    '-map', '0:a:0', '-t', '0.5', '-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1'],
  { encoding: 'buffer' });
  const samples = new Int16Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.length / 2));
  const rms = Math.sqrt(Array.from(samples).reduce((sum, value) => sum + value * value, 0)
    / samples.length);
  let crossings = 0;
  for (let index = 1; index < samples.length; index++) {
    if ((samples[index - 1] < 0 && samples[index] >= 0)
        || (samples[index - 1] >= 0 && samples[index] < 0)) crossings++;
  }
  // Two zero crossings per cycle over the decoded half-second makes this
  // count numerically approximate the source frequency in hertz.
  return { rms, frequencyHz: crossings };
}

async function exportVideo(window, readScenarioState, testInfo, name) {
  const result = (await readScenarioState()).exportOutputPath;
  await fs.rm(result, { force: true });
  await window.getByTestId('video-export-button').click();
  await expect(window.getByTestId('video-export-status')).toHaveText('导出完成', { timeout: 180000 });
  const kept = testInfo.outputPath(name); await fs.copyFile(result, kept);
  await testInfo.attach(name, { path: kept, contentType: 'video/mp4' });
  return kept;
}

test.describe('R4 card styles through the desktop (fixed parsed fixture, not real AI)', () => {
  test.use({ localCliMode: 'two', localCliEffectResult: 'remotion-card-style-flow', remotionRendering: true });
  test.setTimeout(420000);

  test('renders, persists, appends and exports reference-like cards in both aspect ratios', async ({ window, readScenarioState }, testInfo) => {
    for (const target of targets) {
      const source = testInfo.outputPath(`${target.key}-source.mp4`); await makeVideo(source, target);
      if (target.key === 'portrait') { await window.locator('.wtab.is-pinned .wtab__main').click(); }
      await enterAndOpen(window, source);
      const firstCard = await submit(window, '固定 R4 四张信息卡');
      let initial = await window.evaluate(() => projectEditing.load(getActiveProjectId()));
      expect(initial.document.edits).toHaveLength(5);
      expect(initial.document.edits.at(-1).payload).toMatchObject({ cornerRadius: 0, borderWidth: 0,
        borderColor: '#FFFFFF', fillOpacity: 1 });
      // Recreate the pre-R4 persisted shape, then prove the actual loader accepts it
      // without migrating or writing the missing optional fields back.
      const oldBytes = await window.evaluate(() => {
        const key = STORAGE_KEYS.PROJECT_EDIT_STATE;
        const stored = JSON.parse(localStorage.getItem(key));
        const visit = value => {
          if (!value || typeof value !== 'object') return;
          if (value.color === '#8844AA') {
            delete value.cornerRadius; delete value.borderWidth;
            delete value.borderColor; delete value.fillOpacity;
          }
          Object.values(value).forEach(visit);
        };
        visit(stored); const bytes = JSON.stringify(stored); localStorage.setItem(key, bytes); return bytes;
      });
      await window.reload();
      await window.waitForFunction(() => window.projectEditingState === 'ready' && window.editorPlayback);
      initial = await window.evaluate(() => projectEditing.load(getActiveProjectId()));
      expect(initial.document.edits.at(-1).payload).not.toHaveProperty('cornerRadius');
      expect(await window.evaluate(() => localStorage.getItem(STORAGE_KEYS.PROJECT_EDIT_STATE))).toBe(oldBytes);

      await seek(window, 1.6);
      const previewPath = testInfo.outputPath(`${target.key}-r4-preview.png`);
      await window.locator('#remotionPreview').screenshot({ path: previewPath });
      await testInfo.attach(`${target.key}-r4-preview`, { path: previewPath, contentType: 'image/png' });
      const firstShape = window.locator('#remotionPreview svg[data-group-id]').first().locator('rect');
      await expect(firstShape).toHaveCount(2);
      expect(Number(await firstShape.first().getAttribute('rx'))).toBeGreaterThan(4);
      await expect(firstShape.first()).toHaveAttribute('fill-opacity', '0.5');
      await expect(firstShape.nth(1)).toHaveAttribute('stroke', '#268AFF');
      const points = target.key === 'portrait' ? {
        fill: [.25, .16], corner: [.083, .083], border: [.275, .086],
        clear: [.725, .4], clearBorder: [.725, .326]
      } : {
        fill: [.12, .25], corner: [.032, .123], border: [.125, .13],
        clear: [.875, .25], clearBorder: [.875, .13]
      };
      const preview = {};
      for (const [key, point] of Object.entries(points)) preview[key] = (await mountedRgb(window, ...point)).rgb;
      near(preview.fill, [113, 77, 119]);
      near(preview.corner, [22, 102, 204]);
      near(preview.border, [38, 138, 255]);
      near(preview.clear, [22, 102, 204]);
      near(preview.clearBorder, [34, 204, 136]);
      expect((await mountedRgb(window, ...points.fill)).whiteInk).toBeGreaterThan(10);
      const textPaint = window.locator('#remotionPreview svg[data-group-id]').first().locator('g[fill="#FFFFFF"]');
      await expect(textPaint).toHaveCount(1);
      await expect(textPaint).not.toHaveAttribute('opacity', '0.5');
      const transparentBorder = window.locator('#remotionPreview svg[data-group-id]').nth(3).locator('rect');
      await expect(transparentBorder.first()).toHaveAttribute('fill-opacity', '0');
      await expect(transparentBorder.nth(1)).toHaveAttribute('stroke', '#22CC88');

      if (target.key === 'landscape') {
        await firstCard.getByTestId('request-status-summary').click();
        await firstCard.getByTestId('save-as-skill').click();
        await window.getByTestId('skill-name').fill('R4 信息卡');
        await window.getByTestId('skill-save').click();
        const reference = await window.evaluate(() => JSON.parse(localStorage.getItem(STORAGE_KEYS.PERSONAL_SKILLS)).skills[0].referenceRecipe);
        expect(reference.steps[0].params.layers[0].params).toMatchObject({ cornerRadius: .18,
          borderWidth: .08, borderColor: '#268AFF', fillOpacity: .5 });
      }

      await submit(window, '第二请求：新增不同文案和样式');
      const appended = await window.evaluate(() => projectEditing.load(getActiveProjectId()));
      expect(appended.document.edits).toHaveLength(6);
      expect(appended.document.edits.slice(0, 5)).toEqual(initial.document.edits);
      await window.reload();
      await window.waitForFunction(() => window.projectEditingState === 'ready' && window.editorPlayback);
      expect((await window.evaluate(() => projectEditing.load(getActiveProjectId()))).document).toEqual(appended.document);
      if (target.key === 'landscape') {
        await window.getByTestId('personal-skills-button').click();
        const skillItem = window.getByTestId('personal-skill-item');
        await expect(skillItem).toContainText('R4 信息卡');
        await skillItem.getByTestId('skill-view').click();
        await expect(skillItem.locator('.skill-item__details')).toBeVisible();
        await expect(skillItem).toContainText('动画图层');
        const viewedReference = await window.evaluate(() => JSON.parse(
          localStorage.getItem(STORAGE_KEYS.PERSONAL_SKILLS)).skills[0].referenceRecipe);
        expect(viewedReference.steps[0].params.layers[0].params).toMatchObject({
          cornerRadius: .18, borderWidth: .08, borderColor: '#268AFF', fillOpacity: .5
        });
        await skillItem.getByTestId('skill-use').click();
        await expect(window.getByTestId('selected-skill')).toBeVisible();
        await expect(window.locator('.input-editor')).toContainText('使用「R4 信息卡」');
        await window.getByTestId('selected-skill-clear').click();
        await expect(window.getByTestId('selected-skill')).toBeHidden();
      }
      await seek(window, 3.4);
      await expect(window.locator('#remotionPreview svg[data-group-id]')).toHaveCount(1);
      await window.getByTestId('request-status-card').last().getByTestId('request-status-summary').click();
      await window.getByTestId('request-status-card').last().getByRole('button', { name: '撤销本次编辑', exact: true }).click();
      expect((await window.evaluate(() => projectEditing.load(getActiveProjectId()))).document.edits)
        .toEqual(initial.document.edits);
      await seek(window, .25); await expect(window.locator('#remotionPreview svg[data-group-id]')).toHaveCount(0);
      await seek(window, 1.6);
      const output = await exportVideo(window, readScenarioState, testInfo, `${target.key}-r4-export.mp4`);
      const probe = JSON.parse((await run(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output])).stdout);
      const video = probe.streams.find(stream => stream.codec_type === 'video');
      const audio = probe.streams.find(stream => stream.codec_type === 'audio');
      expect([video.width, video.height]).toEqual([target.width, target.height]);
      expect(Number(video.avg_frame_rate.split('/')[0]) / Number(video.avg_frame_rate.split('/')[1])).toBe(24);
      expect(Number(probe.format.duration)).toBeCloseTo(4, 1);
      expect(audio, 'export must contain the synthetic source audio').toBeTruthy();
      expect(Math.abs(Number(audio.duration) - 4)).toBeLessThanOrEqual(1 / 24);
      const tone = await decodedTone(output);
      expect(tone.rms).toBeGreaterThan(1000);
      expect(Math.abs(tone.frequencyHz - target.tone)).toBeLessThanOrEqual(30);
      for (const [key, point] of Object.entries(points)) {
        near(await exportedRgb(output, target, ...point, 1.6), preview[key]);
      }
    }
  });
});
