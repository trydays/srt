const { test, expect } = require('./electron.fixture');
const fs = require('node:fs/promises');
const { runTransformPreviewCases } = require('./transform-preview-cases');

async function metadata(window) {
  await window.evaluate(async () => {
    const video = document.getElementById('previewVideo');
    Object.defineProperties(video, {
      duration: { configurable: true, value: 4 }, videoWidth: { configurable: true, value: 96 },
      videoHeight: { configurable: true, value: 64 }
    });
    video.dispatchEvent(new Event('loadedmetadata')); await window.projectEditingReady;
  });
}
async function openEditor(window, testInfo) {
  const source = testInfo.outputPath('transform.mp4'); await fs.writeFile(source, 'metadata fixture');
  await window.getByTestId('local-cli-codex').click(); await window.getByTestId('continue').click();
  await window.getByTestId('video-input').setInputFiles(source); await window.getByTestId('start-editing').click();
  await expect(window.getByTestId('editor-page')).toBeVisible();
  await expect.poll(() => window.locator('#previewVideo').getAttribute('src')).toBeTruthy();
  await metadata(window);
}
async function submit(window, text, { instruction = 'success', timeline = 'success' } = {}) {
  await window.locator('.input-editor').fill(text); await window.locator('#generateBtn').click();
  const card = window.getByTestId('request-status-card').last();
  await expect(card.getByTestId('instruction-status')).toHaveAttribute('data-state', instruction);
  await expect(card.locator('[data-testid="timeline-status"], [data-testid="subtitle-status"]'))
    .toHaveAttribute('data-state', timeline);
  if (instruction === 'success' && timeline === 'success') await expect(card).toHaveClass(/is-collapsed/);
  else await expect(card).not.toHaveClass(/is-collapsed/);
}
function business(document) { const { revision, ...rest } = document; return rest; }

test.describe('ranged transform editing', () => {
  test.use({ localCliMode: 'two', localCliEffectResult: 'transform-transactions-success' });
  test('actual browser pixels preserve geometry, clipping, effect order and portrait frames', async ({ window }, testInfo) => {
    await openEditor(window, testInfo);
    const evidence = await window.evaluate(runTransformPreviewCases);
    expect(evidence.length).toBeGreaterThanOrEqual(16);
    await testInfo.attach('transform-preview-pixels', { body: Buffer.from(JSON.stringify(evidence, null, 2)), contentType: 'application/json' });
  });
  test('portrait pixels stay in the video content rectangle within the editor chrome', async ({ window }, testInfo) => {
    await openEditor(window, testInfo);
    const box = await window.evaluate(() => {
      const source = document.createElement('canvas'); source.width = 64; source.height = 96;
      const ctx = source.getContext('2d'); ctx.fillStyle = '#d02020'; ctx.fillRect(0, 0, 32, 96);
      ctx.fillStyle = '#20c040'; ctx.fillRect(32, 0, 32, 96);
      const canvas = document.getElementById('previewSourceCanvas');
      const compositor = SRTSourcePreview.createCompositor(canvas, document.getElementById('previewColorFilter').parentNode);
      const registration = editCapabilityRegistry.get('video.transform@1');
      const node = registration.toGraph({ id: 'portrait', range: { start: 1, end: 3 },
        payload: SRTVideoTransform.normalizeParams({ flipHorizontal: true, scale: 0.5 }, true) }, { videoHead: 'source' });
      compositor.render(source, { nodes: [node] }, 2, 64, 96);
      document.getElementById('previewOverlay').style.display = 'none';
      const pixel = (x, y) => Array.from(canvas.getContext('2d').getImageData(x, y, 1, 1).data);
      const intrinsic = [pixel(8, 48), pixel(25, 48), pixel(39, 48)];
      // Keep reference colors in the same Canvas-to-display-to-screenshot path:
      // display color conversion can shift screenshot RGB from intrinsic RGB.
      source.style.cssText = 'position:absolute;left:8px;top:8px;width:32px;height:48px;z-index:3;pointer-events:none';
      const preview = document.getElementById('previewArea'); preview.appendChild(source);
      const bounds = preview.getBoundingClientRect(), reference = source.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height, intrinsic,
        reference: { left: reference.left - bounds.left, top: reference.top - bounds.top,
          width: reference.width, height: reference.height } };
    });
    expect(box.intrinsic).toEqual([[0, 0, 0, 255], [32, 192, 64, 255], [208, 32, 32, 255]]);
    const screenshot = await window.locator('#previewArea').screenshot({ path: testInfo.outputPath('portrait-in-editor.png') });
    const samples = await window.evaluate(async ({ data, box }) => {
      const image = new Image(); image.src = 'data:image/png;base64,' + data; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      // The intrinsic portrait frame spans H*2/3 inside a W-wide 16:9 container.
      const contentWidth = (box.height - 2) * 2 / 3;
      const at = (x, y = box.height / 2) => Array.from(ctx.getImageData(
        Math.round(x / box.width * image.width), Math.round(y / box.height * image.height), 1, 1).data);
      const referenceY = box.reference.top + box.reference.height / 2;
      return { preview: [at(box.width * 0.1), at(box.width / 2 - contentWidth * 0.4),
        at(box.width / 2 - contentWidth * 0.1), at(box.width / 2 + contentWidth * 0.1)],
        red: at(box.reference.left + box.reference.width * 0.25, referenceY),
        green: at(box.reference.left + box.reference.width * 0.75, referenceY) };
    }, { data: screenshot.toString('base64'), box });
    expect(samples.red).not.toEqual(samples.green);
    expect([samples.red[3], samples.green[3]]).toEqual([255, 255]);
    expect(samples.preview).toEqual([[0, 0, 0, 255], [0, 0, 0, 255], samples.green, samples.red]);
    await testInfo.attach('portrait-in-editor', { body: screenshot, contentType: 'image/png' });
  });
  for (const mixed of [false, true]) {
    test(`one transaction persists, exports, supplies typed context and undoes; mixed=${mixed}`, async ({ window, readScenarioState }, testInfo) => {
      await openEditor(window, testInfo);
      const before = await window.evaluate(() => projectEditing.load(getActiveProjectId()));
      await submit(window, mixed ? '1到3秒水平翻转并放大1.25倍，调色并生成字幕' : '1到3秒水平翻转并放大1.25倍');
      await expect(window.getByTestId(mixed ? 'subtitle-status' : 'timeline-status').last())
        .toHaveAttribute('data-state', 'success');
      const saved = await window.evaluate(() => projectEditing.load(getActiveProjectId()));
      expect(saved.document.revision).toBe(before.document.revision + 1);
      expect(saved.graph.documentRevision).toBe(saved.document.revision);
      expect(saved.document.edits.map(e => e.type)).toEqual(mixed
        ? ['video.transform.operation@1', 'video.color.adjustment@1', 'subtitle.track@1'] : ['video.transform.operation@1']);
      expect(new Set(saved.document.edits.map(e => e.transactionId)).size).toBe(1);
      await expect(window.locator('.tl-marker')).toHaveCount(mixed ? 3 : 1);
      const bounds = await window.locator('.tl-marker').first().evaluate(el => ({ left: parseFloat(el.style.left),
        width: parseFloat(el.style.width), track: document.getElementById('tlTrack').getBoundingClientRect().width }));
      expect(bounds.left).toBeCloseTo(16 + (bounds.track - 32) / 4, 1);
      expect(bounds.width).toBeCloseTo((bounds.track - 32) / 2, 1);
      await window.reload(); await metadata(window);
      expect(await window.evaluate(() => projectEditing.load(getActiveProjectId()))).toEqual(saved);
      await window.getByTestId('video-export-button').click();
      await expect(window.getByTestId('video-export-status')).toHaveText('导出完成');
      const recipe = (await readScenarioState()).exportRequests.at(-1).recipe;
      expect(recipe.steps[0]).toEqual({ capability: 'video.transform@1', range: { start: 1, end: 3 },
        params: { flipHorizontal: true, flipVertical: false, scale: 1.25 } });
      expect(recipe.steps.map(s => s.capability)).toEqual(mixed
        ? ['video.transform@1', 'video.color.adjust@1', 'subtitle.burn@1'] : ['video.transform@1']);
      await submit(window, '下一步', { instruction: 'clarifying', timeline: 'waiting' });
      const context = (await readScenarioState()).translationCalls.at(-1).context;
      expect(context.revision).toBe(saved.document.revision); expect(context.operations[0]).toEqual(recipe.steps[0]);
      await window.getByTestId('request-status-summary').first().click();
      await window.getByRole('button', { name: '撤销本次编辑', exact: true }).click();
      const undone = await window.evaluate(() => projectEditing.load(getActiveProjectId()));
      expect(business(undone.document)).toEqual(business(before.document));
      expect(undone.document.revision).toBe(saved.document.revision + 1);
      await expect(window.locator('.tl-marker')).toHaveCount(0);
      await expect(window.locator('#previewSourceCanvas')).toBeHidden();
      await window.reload(); await metadata(window);
      expect(await window.evaluate(() => projectEditing.load(getActiveProjectId()))).toEqual(undone);
    });
  }
  test('malformed second step does not partially commit the transform', async ({ window }, testInfo) => {
    await openEditor(window, testInfo);
    const before = await window.evaluate(() => localStorage.getItem('srt_project_edit_state'));
    await submit(window, '错误第二步', { instruction: 'failed', timeline: 'not_run' });
    expect(await window.evaluate(() => localStorage.getItem('srt_project_edit_state'))).toBe(before);
    await expect(window.locator('.tl-marker')).toHaveCount(0);
  });
  test('saved subtitle drafts remain editable after a pure transform', async ({ window }, testInfo) => {
    await openEditor(window, testInfo); await submit(window, '仅字幕');
    const field = window.getByTestId('subtitle-document-segment').first();
    await field.fill('变换前保存的草稿'); await window.getByTestId('subtitle-document-save').click();
    await submit(window, '1到3秒水平翻转并放大1.25倍');
    await window.getByTestId('subtitle-document-toggle').click(); await expect(field).toHaveText('变换前保存的草稿');
    await field.fill('变换后继续修改'); await window.getByTestId('subtitle-document-apply').click();
    await expect(window.getByTestId('subtitle-block').first()).toHaveText('变换后继续修改');
  });
});
