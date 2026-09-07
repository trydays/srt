const { test, expect } = require('./electron.fixture');
const fs = require('node:fs');

async function createVideoFixture(testInfo, name) {
  const file = testInfo.outputPath(name);
  await fs.promises.writeFile(file, Buffer.from(name));
  return file;
}

async function setUsableMetadata(window) {
  await window.evaluate(() => {
    const video = document.getElementById('previewVideo');
    Object.defineProperties(video, {
      duration: { configurable: true, value: 4 },
      videoWidth: { configurable: true, value: 640 },
      videoHeight: { configurable: true, value: 360 }
    });
    video.dispatchEvent(new Event('loadedmetadata'));
  });
}

async function openUsableEditor(window, testInfo, name) {
  const source = await createVideoFixture(testInfo, name);
  await window.getByTestId('local-cli-codex').click();
  await window.getByTestId('continue').click();
  await window.getByTestId('video-input').setInputFiles(source);
  await window.getByTestId('start-editing').click();
  await expect(window.getByTestId('editor-page')).toBeVisible();
  await expect.poll(() => window.locator('#previewVideo').getAttribute('src')).toBeTruthy();
  await setUsableMetadata(window);
  await expect.poll(() => window.evaluate(() => window.currentProjectVideoPath)).toBe(source);
  return source;
}

async function generateAppliedSubtitles(window) {
  await window.locator('.input-editor').fill('给视频加字幕');
  await window.locator('#generateBtn').click();
  await expect(window.getByTestId('subtitle-status')).toHaveAttribute('data-state', 'success');
}

test.describe('video export flow', () => {
  test.use({ localCliMode: 'two', subtitleResult: 'success' });

  test('exports only applied subtitles from the resolved project source and restores the editor', async ({
    window, readScenarioState
  }, testInfo) => {
    const sourceA = await createVideoFixture(testInfo, 'source-a.mp4');
    const sourceB = await createVideoFixture(testInfo, 'source-b.mp4');
    await window.getByTestId('local-cli-codex').click();
    await window.getByTestId('continue').click();
    await window.getByTestId('video-input').setInputFiles(sourceA);
    await window.getByTestId('start-editing').click();
    await expect(window.getByTestId('editor-page')).toBeVisible();

    await window.getByTestId('video-export-button').click();
    await expect(window.getByTestId('video-export-status')).toHaveText('当前视频路径不可用');
    expect((await readScenarioState()).exportRequests || []).toHaveLength(0);

    await window.evaluate(async (replacementPath) => {
      const replacement = new File(['replacement'], 'source-b.mp4', { type: 'video/mp4' });
      Object.defineProperty(replacement, 'path', { value: replacementPath });
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('srt_store', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise((resolve, reject) => {
        const request = db.transaction('files', 'readwrite').objectStore('files')
          .put(replacement, 'current_video');
        request.onsuccess = resolve;
        request.onerror = () => reject(request.error);
      });
    }, sourceB);
    await window.reload();
    await expect(window.getByTestId('editor-page')).toBeVisible();
    await expect.poll(() => window.locator('#previewVideo').getAttribute('src'))
      .toContain('source-a.mp4');
    await setUsableMetadata(window);
    await expect.poll(() => window.evaluate(() => window.currentProjectVideoPath)).toBe(sourceA);

    await window.evaluate(() => {
      const store = window.SRTSubtitleState.createSubtitleStore(localStorage, () => 'applied-segment');
      store.replace(getActiveProjectId(), 'seed-request', [
        { start: 0.2, end: 1.4, text: '已应用字幕' }
      ]);
      subtitleController.openAfter(null);
    });
    const segment = window.getByTestId('subtitle-document-segment');
    await segment.fill('尚未应用的草稿');
    await window.getByTestId('subtitle-document-save').click();
    await window.getByTestId('video-export-button').click();
    await expect(window.getByTestId('subtitle-document-surface')).toBeVisible();
    expect((await readScenarioState()).exportRequests || []).toHaveLength(0);
    await window.getByTestId('subtitle-document-apply').click();

    await window.evaluate(() => applyLocalCliEffect({ type: 'add_effect', effect: 'fade_in' }));
    await window.getByTestId('video-export-button').click();
    await expect(window.getByTestId('video-export-status')).toContainText('淡入');
    expect((await readScenarioState()).exportRequests || []).toHaveLength(0);
    await window.getByTestId('timeline-effect-fade-in').dispatchEvent('contextmenu');
    await window.locator('.input-editor').fill('保留这段输入');

    await window.getByTestId('video-export-button').click();
    await expect(window.getByTestId('video-export-progress')).toHaveText('42%');
    await expect(window.getByTestId('video-export-status')).toHaveText('导出失败');
    await expect(window.getByTestId('video-export-button')).toBeEnabled();
    await expect(window.locator('#generateBtn')).toBeEnabled();
    await expect(window.locator('#tabsBar')).not.toHaveAttribute('inert');

    await window.getByTestId('video-export-button').click();
    await expect(window.getByTestId('video-export-progress')).toHaveText('42%');
    await expect(window.getByTestId('video-export-target')).toContainText('export.mp4');
    await expect(window.getByTestId('video-export-button')).toBeDisabled();
    await expect(window.locator('#generateBtn')).toBeDisabled();
    await expect(window.getByTestId('subtitle-document-save')).toBeDisabled();
    await expect(window.getByTestId('subtitle-document-apply')).toBeDisabled();
    await expect(window.locator('#reupload')).toBeDisabled();
    await expect(window.locator('.input-editor')).toHaveAttribute('contenteditable', 'false');
    await expect(segment).toHaveAttribute('contenteditable', 'false');
    await expect(window.locator('#tabsBar')).toHaveAttribute('inert');
    await expect(window.locator('#tlPlayBtn')).toBeEnabled();

    const activeRequest = (await readScenarioState()).exportRequests.at(-1);
    expect(activeRequest.videoPath).toBe(sourceA);
    expect(activeRequest.recipe.steps[0].params.segments[0].text).toBe('尚未应用的草稿');
    await window.getByTestId('video-export-cancel').click();
    await expect(window.getByTestId('video-export-status')).toHaveText('已取消');
    const state = await readScenarioState();
    expect(state.exportCancels).toContain(activeRequest.jobId);
    await expect(window.getByTestId('video-export-button')).toBeEnabled();
    await expect(window.locator('#generateBtn')).toBeEnabled();
    await expect(window.locator('#tabsBar')).not.toHaveAttribute('inert');
  });

  test('keeps an unsaved subtitle candidate intact when export asks for applied text', async ({
    window, readScenarioState
  }, testInfo) => {
    await openUsableEditor(window, testInfo, 'unsaved-candidate.mp4');
    await generateAppliedSubtitles(window);
    const firstSegment = window.getByTestId('subtitle-document-segment').first();
    await firstSegment.fill('尚未保存也尚未应用');

    await window.getByTestId('video-export-button').click();

    await expect(window.getByTestId('video-export-status')).toHaveText('请先应用字幕修改');
    await expect(window.getByTestId('subtitle-document-surface')).toBeVisible();
    await expect(firstSegment).toHaveText('尚未保存也尚未应用');
    expect((await readScenarioState()).exportRequests || []).toHaveLength(0);
  });

  test('keeps a history-created undo action frozen when its card rerenders during export', async ({
    window
  }, testInfo) => {
    await openUsableEditor(window, testInfo, 'history-rerender.mp4');
    await generateAppliedSubtitles(window);
    const historyCard = window.getByTestId('request-status-card').last();
    const historySummary = historyCard.getByTestId('request-status-summary');
    await expect(historyCard).toHaveClass(/is-collapsed/);

    await window.getByTestId('video-export-button').click();
    await expect(window.getByTestId('video-export-status')).toHaveText('导出失败');
    await window.getByTestId('video-export-button').click();
    await expect(window.getByTestId('video-export-progress')).toHaveText('42%');

    await historySummary.click();
    await expect(historyCard).not.toHaveClass(/is-collapsed/);
    await expect(historyCard.getByTestId('subtitle-undo')).toBeDisabled();
    await window.getByTestId('video-export-cancel').click();
    await expect(window.getByTestId('video-export-status')).toHaveText('已取消');
    await expect(historyCard.getByTestId('subtitle-undo')).toBeEnabled();
  });
});
