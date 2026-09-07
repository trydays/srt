const { test, expect } = require('./electron.fixture');
const fs = require('node:fs/promises');

async function metadata(window) {
  await window.evaluate(async () => {
    const video = document.getElementById('previewVideo');
    Object.defineProperties(video, {
      duration: { configurable: true, value: 4 },
      videoWidth: { configurable: true, value: 640 },
      videoHeight: { configurable: true, value: 360 }
    });
    video.dispatchEvent(new Event('loadedmetadata'));
    await window.projectEditingReady;
  });
}

async function seek(window, time) {
  await window.evaluate(time => {
    const video = document.getElementById('previewVideo');
    Object.defineProperty(video, 'currentTime', { configurable: true, value: time });
    video.dispatchEvent(new Event('seeked'));
    video.dispatchEvent(new Event('timeupdate'));
  }, time);
}

function businessState(document) {
  const { revision, ...business } = document;
  return business;
}

test.describe('complete color and subtitle transaction', () => {
  test.use({ localCliMode: 'two', localCliEffectResult: 'color-transactions-success' });

  test('commits once, previews by range, reloads, exports and restores the prior business state with one undo', async ({
    window, readScenarioState
  }, testInfo) => {
    const fixturePath = testInfo.outputPath('color-transaction.mp4');
    await fs.writeFile(fixturePath, 'deterministic metadata fixture');
    const source = await fs.realpath(fixturePath);
    await window.getByTestId('local-cli-codex').click();
    await window.getByTestId('continue').click();
    await window.getByTestId('video-input').setInputFiles(source);
    await window.getByTestId('start-editing').click();
    await expect(window.getByTestId('editor-page')).toBeVisible();
    await expect.poll(() => window.locator('#previewVideo').getAttribute('src')).toBeTruthy();
    await metadata(window);
    const before = await window.evaluate(() => projectEditing.load(getActiveProjectId()));

    await window.locator('.input-editor').fill('1 到 3 秒调冷、提亮并增强对比度，同时生成字幕');
    await window.locator('#generateBtn').click();
    await expect(window.getByTestId('subtitle-status')).toHaveAttribute('data-state', 'success');
    const applied = await window.evaluate(() => projectEditing.load(getActiveProjectId()));
    expect(applied.document.revision).toBe(before.document.revision + 1);
    expect(applied.document.edits.map(edit => edit.type)).toEqual([
      'video.color.adjustment@1', 'subtitle.track@1'
    ]);
    expect(new Set(applied.document.edits.map(edit => edit.transactionId)).size).toBe(1);
    expect(applied.graph.documentRevision).toBe(applied.document.revision);
    await expect(window.getByTestId('request-status-card')).toHaveCount(1);
    await expect(window.locator('.tl-marker')).toHaveCount(2);
    for (const time of [0.5, 1, 2, 3, 3.5]) {
      await seek(window, time);
      await expect(window.locator('#previewVideo')).toHaveCSS('filter',
        time >= 1 && time < 3 ? /previewColorFilter/ : 'none');
    }
    await window.reload();
    await metadata(window);
    expect(await window.evaluate(() => projectEditing.load(getActiveProjectId()))).toEqual(applied);
    await seek(window, 2);
    await expect(window.locator('#previewVideo')).toHaveCSS('filter', /previewColorFilter/);
    await expect(window.locator('#previewSubtitle')).toBeVisible();
    await expect(window.locator('#previewSubtitle')).toHaveCSS('filter', 'none');

    await window.getByTestId('video-export-button').click();
    await expect(window.getByTestId('video-export-status')).toHaveText('导出完成');
    await expect(window.getByTestId('video-export-button')).toBeEnabled();
    const exported = (await readScenarioState()).exportRequests.at(-1);
    expect(exported.videoPath).toBe(source);
    expect(exported.recipe.steps.map(step => step.capability)).toEqual([
      'video.color.adjust@1', 'subtitle.burn@1'
    ]);
    expect(exported.recipe.steps[0]).toEqual({ capability: 'video.color.adjust@1',
      range: applied.document.edits[0].range, params: applied.document.edits[0].payload });
    expect(exported.recipe.steps[1].params.segments).toEqual(applied.document.edits[1].payload.segments);
    expect(await window.evaluate(() => projectEditing.load(getActiveProjectId()))).toEqual(applied);

    await window.getByTestId('request-status-summary').click();
    await window.getByRole('button', { name: '撤销本次编辑', exact: true }).click();
    const undone = await window.evaluate(() => projectEditing.load(getActiveProjectId()));
    expect(businessState(undone.document)).toEqual(businessState(before.document));
    expect(undone.document.revision).toBe(applied.document.revision + 1);
    await expect(window.locator('.tl-marker')).toHaveCount(0);
    await expect(window.locator('#previewVideo')).toHaveCSS('filter', 'none');
    await expect(window.locator('[data-subtitle-document]')).toBeHidden();
    await window.reload();
    await metadata(window);
    expect(await window.evaluate(() => projectEditing.load(getActiveProjectId()))).toEqual(undone);
  });
});
