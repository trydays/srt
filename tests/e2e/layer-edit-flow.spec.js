const { test, expect } = require('./electron.fixture');
const fs = require('node:fs/promises');

async function metadata(window, width = 96, height = 64) {
  await window.evaluate(async ({ width, height }) => {
    const video = document.getElementById('previewVideo');
    Object.defineProperties(video, { duration: { configurable: true, value: 4 },
      videoWidth: { configurable: true, value: width }, videoHeight: { configurable: true, value: height },
      readyState: { configurable: true, value: 2 } });
    video.dispatchEvent(new Event('loadedmetadata')); await window.projectEditingReady;
  }, { width, height });
}
async function openEditor(window, testInfo) {
  const source = testInfo.outputPath('layer.mp4'); await fs.writeFile(source, 'metadata fixture');
  await window.getByTestId('local-cli-codex').click(); await window.getByTestId('continue').click();
  await window.getByTestId('video-input').setInputFiles(source); await window.getByTestId('start-editing').click();
  await expect(window.getByTestId('editor-page')).toBeVisible(); await metadata(window);
}
async function submit(window, text, state = 'success') {
  await window.locator('.input-editor').fill(text); await window.locator('#generateBtn').click();
  const card = window.getByTestId('request-status-card').last();
  await expect(card.getByTestId('instruction-status')).toHaveAttribute('data-state', state);
  return card;
}

test.describe('static visual layer editing', () => {
  test.use({ localCliMode: 'two', localCliEffectResult: 'layer-transactions-success' });

  test('one request persists four edits but presents one visual timeline envelope', async ({ window, readScenarioState }, testInfo) => {
    await openEditor(window, testInfo); const before = await window.evaluate(() => projectEditing.load(getActiveProjectId()));
    const card = await submit(window, '做两张重叠卡片');
    await expect(card.getByTestId('timeline-status')).toHaveAttribute('data-state', 'success');
    const saved = await window.evaluate(() => projectEditing.load(getActiveProjectId()));
    expect(saved.document.edits).toHaveLength(4);
    expect(saved.document.edits.map(e => e.type)).toEqual(['visual.shape.layer@1', 'visual.text.layer@1', 'visual.shape.layer@1', 'visual.text.layer@1']);
    expect(new Set(saved.document.edits.map(e => e.transactionId)).size).toBe(1);
    expect(new Set(saved.document.edits.map(e => e.id)).size).toBe(4);
    await expect(window.locator('.tl-marker[data-lane="visual"]')).toHaveCount(1);
    await expect(window.locator('.tl-marker[data-lane="visual"]')).toHaveText('静态图层 · 4 个元素');
    await expect(window.locator('.property-panel, [data-testid="layer-property-panel"]')).toHaveCount(0);
    await expect(card.getByTestId('request-status-summary')).toContainText('静态图层 · 4 个元素');

    await window.getByTestId('video-export-button').click();
    await expect(window.getByTestId('video-export-status')).toHaveText('导出完成');
    const recipe = (await readScenarioState()).exportRequests.at(-1).recipe;
    expect(recipe.steps.map(step => step.capability)).toEqual(['visual.shape@1', 'visual.text@1', 'visual.shape@1', 'visual.text@1']);
    await submit(window, '下一步', 'clarifying');
    const context = (await readScenarioState()).translationCalls.at(-1).context;
    expect(context.operations.map(item => item.params)).toEqual(recipe.steps.map(item => item.params));

    await window.getByTestId('request-status-summary').first().click();
    await window.getByRole('button', { name: '撤销本次编辑', exact: true }).click();
    expect((await window.evaluate(() => projectEditing.load(getActiveProjectId()))).document.edits).toHaveLength(0);
    await expect(window.locator('#previewLayerCanvas')).toBeHidden();
    await window.reload(); await metadata(window);
    expect((await window.evaluate(() => projectEditing.load(getActiveProjectId()))).document.edits).toHaveLength(0);
    expect(before.document.edits).toHaveLength(0);
  });

  test('canvas uses graph order, half-open timing, portrait geometry, literal text and subtitle top layer', async ({ window }, testInfo) => {
    await openEditor(window, testInfo); await submit(window, '做两张重叠卡片');
    const evidence = await window.evaluate(() => {
      const canvas = document.getElementById('previewLayerCanvas');
      const graph = projectEditing.load(getActiveProjectId()).graph;
      const sample = (x, y) => Array.from(canvas.getContext('2d').getImageData(x, y, 1, 1).data);
      const states = {};
      [0.999, 1, 1.999, 2, 3, 3.999, 4].forEach(time => {
        SRTLayerPreview.drawGraph(canvas, graph, time, 96, 64);
        states[time] = { first: sample(11, 8), overlap: sample(30, 20), second: sample(31, 21), hidden: canvas.hidden };
      });
      SRTLayerPreview.drawGraph(canvas, graph, 1, 96, 64);
      let textInk = 0;
      for (let y = 8; y < 16; y++) for (let x = 11; x < 48; x++) {
        const pixel = sample(x, y);
        if (pixel[3] > 0 && (pixel[0] !== 17 || pixel[1] !== 34 || pixel[2] !== 51)) textInk++;
      }
      const video = document.getElementById('previewVideo');
      Object.defineProperties(video, { videoWidth: { configurable: true, value: 64 },
        videoHeight: { configurable: true, value: 96 }, currentTime: { configurable: true, value: 2 } });
      layerPreviewController.render(2);
      const portrait = { width: canvas.width, height: canvas.height, first: sample(7, 10), clipped: sample(63, 95) };
      const containRect = (element, intrinsicWidth, intrinsicHeight) => {
        const bounds = element.getBoundingClientRect();
        const scale = Math.min(bounds.width / intrinsicWidth, bounds.height / intrinsicHeight);
        const width = intrinsicWidth * scale, height = intrinsicHeight * scale;
        return { left: bounds.left + (bounds.width - width) / 2, top: bounds.top + (bounds.height - height) / 2, width, height };
      };
      const subtitle = document.getElementById('previewSubtitle');
      subtitle.hidden = false; subtitle.textContent = '字幕在最上层';
      subtitle.style.left = '50%'; subtitle.style.top = '38%'; subtitle.style.bottom = 'auto';
      subtitle.style.transform = 'translate(-50%, -50%)';
      const videoContent = containRect(video, 64, 96), canvasContent = containRect(canvas, canvas.width, canvas.height);
      const subtitleRect = subtitle.getBoundingClientRect();
      const secondShapeRect = { left: canvasContent.left + .3 * canvasContent.width,
        top: canvasContent.top + .3 * canvasContent.height,
        right: canvasContent.left + .7 * canvasContent.width,
        bottom: canvasContent.top + .55 * canvasContent.height };
      return { states, portrait, textInk, text: graph.nodes.find(node => node.type === 'visual.text@1').props.text,
        videoContent, canvasContent, subtitleRect: { left: subtitleRect.left, top: subtitleRect.top,
          right: subtitleRect.right, bottom: subtitleRect.bottom }, secondShapeRect,
        frameOverflow: getComputedStyle(document.getElementById('previewArea')).overflow,
        z: [getComputedStyle(canvas).zIndex, getComputedStyle(subtitle).zIndex] };
    });
    expect(evidence.states['0.999'].hidden).toBe(true); expect(evidence.states['1'].hidden).toBe(false);
    expect(evidence.states['2'].overlap.slice(0, 3)).toEqual([204, 51, 34]);
    expect(evidence.states['3'].first[3]).toBe(0); expect(evidence.states['3.999'].hidden).toBe(false); expect(evidence.states['4'].hidden).toBe(true);
    expect(evidence.portrait).toMatchObject({ width: 64, height: 96 });
    expect(evidence.portrait.first.slice(0, 3)).toEqual([17, 34, 51]);
    expect(evidence.portrait.clipped[3]).toBe(0); expect(evidence.textInk).toBeGreaterThan(0);
    expect(evidence.text).toBe('<b>第一张</b>'); expect(Number(evidence.z[0])).toBeLessThan(Number(evidence.z[1]));
    expect(evidence.frameOverflow).toBe('hidden');
    expect(evidence.canvasContent.left).toBeCloseTo(evidence.videoContent.left, 4);
    expect(evidence.canvasContent.top).toBeCloseTo(evidence.videoContent.top, 4);
    expect(evidence.canvasContent.width).toBeCloseTo(evidence.videoContent.width, 4);
    expect(evidence.canvasContent.height).toBeCloseTo(evidence.videoContent.height, 4);
    expect(evidence.subtitleRect.right).toBeGreaterThan(evidence.secondShapeRect.left);
    expect(evidence.subtitleRect.left).toBeLessThan(evidence.secondShapeRect.right);
    expect(evidence.subtitleRect.bottom).toBeGreaterThan(evidence.secondShapeRect.top);
    expect(evidence.subtitleRect.top).toBeLessThan(evidence.secondShapeRect.bottom);
    const withSubtitle = await window.locator('#previewArea').screenshot();
    await window.locator('#previewSubtitle').evaluate(element => { element.hidden = true; });
    const withoutSubtitle = await window.locator('#previewArea').screenshot();
    expect(withSubtitle.equals(withoutSubtitle)).toBe(false);
    await window.locator('#previewSubtitle').evaluate(element => { element.hidden = false; });
    const screenshot = await window.locator('#previewArea').screenshot({ path: testInfo.outputPath('layer-preview.png') });
    await testInfo.attach('layer-preview', { body: screenshot, contentType: 'image/png' });
  });

  test('malformed second step is atomic and old subtitle drafts remain editable', async ({ window }, testInfo) => {
    await openEditor(window, testInfo); const before = await window.evaluate(() => ({
      storage: localStorage.getItem('srt_project_edit_state'), snapshot: projectEditing.load(getActiveProjectId())
    }));
    const failed = await submit(window, '错误第二步');
    await expect(failed.locator('[data-testid="timeline-status"]')).toHaveAttribute('data-state', 'failed');
    const after = await window.evaluate(() => ({ storage: localStorage.getItem('srt_project_edit_state'),
      snapshot: projectEditing.load(getActiveProjectId()) }));
    expect(after).toEqual(before); expect(after.snapshot.document.edits).toHaveLength(0);
    await submit(window, '仅字幕'); const field = window.getByTestId('subtitle-document-segment').first();
    await field.fill('图层前草稿'); await window.getByTestId('subtitle-document-save').click();
    await submit(window, '做两张重叠卡片'); await window.getByTestId('subtitle-document-toggle').click();
    await expect(field).toHaveText('图层前草稿'); await field.fill('图层后仍可改');
    await window.getByTestId('subtitle-document-apply').click();
    await expect(window.getByTestId('subtitle-block').first()).toHaveText('图层后仍可改');
  });
});
