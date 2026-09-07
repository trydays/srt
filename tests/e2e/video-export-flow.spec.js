const { test, expect } = require('./electron.fixture');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const fixtureDirectories = new Set();

test.afterEach(async () => {
  await Promise.all(Array.from(fixtureDirectories, (directory) =>
    fs.promises.rm(directory, { recursive: true, force: true })));
  fixtureDirectories.clear();
});

test.describe('color graph export projection', () => {
  test.use({ localCliMode: 'two', localCliEffectResult: 'color-transactions' });

  test('exports the same mixed transaction and revision used by the preview', async ({ window, readScenarioState }, testInfo) => {
    await openUsableEditor(window, testInfo, 'color-and-subtitles.mp4');
    await window.locator('.input-editor').fill('调冷并生成字幕');
    await window.locator('#generateBtn').click();
    await expect(window.getByTestId('subtitle-status')).toHaveAttribute('data-state', 'success');
    await window.evaluate(() => {
      const video = document.getElementById('previewVideo');
      Object.defineProperty(video, 'currentTime', { configurable: true, value: 2 });
      video.dispatchEvent(new Event('timeupdate'));
      const build = SRTRenderRecipe.buildRenderRecipe;
      SRTRenderRecipe.buildRenderRecipe = function(graph, registry) {
        window.__exportGraph = graph;
        return build(graph, registry);
      };
    });
    await expect(window.locator('#previewVideo')).toHaveCSS('filter', /previewColorFilter/);
    await window.getByTestId('video-export-button').click();
    await expect(window.getByTestId('video-export-status')).toHaveText('导出失败');
    const snapshot = await window.evaluate(() => projectEditing.load(getActiveProjectId()));
    expect(await window.evaluate(() => window.__exportGraph)).toEqual(snapshot.graph);
    const request = (await readScenarioState()).exportRequests.at(-1);
    expect(request.recipe.steps.map(step => step.capability)).toEqual(['video.color.adjust@1', 'subtitle.burn@1']);
    expect(request.recipe.steps[0].range).toEqual({ start: 1, end: 3 });
    expect(request.recipe.steps[0].params).toEqual({ temperature: -0.6, brightness: 0.2, saturation: 1, contrast: 1.3 });
  });
});

async function createVideoFixture(testInfo, name) {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'srt-export-e2e-'));
  fixtureDirectories.add(directory);
  const file = path.join(directory, name);
  await fs.promises.writeFile(file, Buffer.from(name));
  return fs.promises.realpath(file);
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

    await window.getByTestId('video-export-button').click();
    await expect(window.getByTestId('video-export-status')).toHaveText('当前字幕无法导出');
    expect((await readScenarioState()).exportRequests || []).toHaveLength(0);

    await generateAppliedSubtitles(window);
    await window.evaluate(() => subtitleController.openAfter(null));
    const segment = window.getByTestId('subtitle-document-segment').first();
    await segment.fill('尚未应用的草稿');
    await window.getByTestId('subtitle-document-save').click();
    await window.getByTestId('video-export-button').click();
    await expect(window.getByTestId('subtitle-document-surface')).toBeVisible();
    expect((await readScenarioState()).exportRequests || []).toHaveLength(0);
    await window.getByTestId('subtitle-document-apply').click();

    await window.evaluate(() => {
      window.__buildRenderRecipeCalls = 0;
      const build = window.SRTRenderRecipe.buildRenderRecipe;
      window.SRTRenderRecipe.buildRenderRecipe = function(graph, registry) {
        window.__buildRenderRecipeCalls += 1;
        window.__exportGraph = graph;
        return build(graph, registry);
      };
      window.SRTRenderRecipe.buildSubtitleRecipe = function() {
        throw new Error('legacy subtitle export path used');
      };
    });
    await window.locator('.input-editor').fill('保留这段输入');

    await window.getByTestId('video-export-button').click();
    await expect(window.getByTestId('video-export-progress')).toHaveText('42%');
    await expect(window.getByTestId('video-export-status')).toHaveText('导出失败');
    await expect(window.getByTestId('video-export-button')).toBeEnabled();
    await expect(window.locator('#generateBtn')).toBeEnabled();
    await expect(window.locator('#tabsBar')).not.toHaveAttribute('inert');
    expect(await window.evaluate(() => window.__buildRenderRecipeCalls)).toBe(1);
    expect(await window.evaluate(() => window.__exportGraph.documentRevision))
      .toBe(await window.evaluate(() => projectEditing.load(getActiveProjectId()).document.revision));

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

  test('rechecks drafts restored while export waits for readiness and releases its button', async ({ window, readScenarioState }, testInfo) => {
    await openUsableEditor(window, testInfo, 'readiness-draft.mp4');
    await generateAppliedSubtitles(window);
    await window.evaluate(() => {
      window.projectEditingReady = new Promise(resolve => { window.__resolveExportReadiness = resolve; });
      const button = document.querySelector('[data-testid="video-export-button"]');
      button.dispatchEvent(new Event('click'));
      button.dispatchEvent(new Event('click'));
    });
    const segment = window.getByTestId('subtitle-document-segment').first();
    await segment.fill('等待期间恢复的草稿');
    await window.getByTestId('subtitle-document-save').click();
    await window.evaluate(() => window.__resolveExportReadiness());
    await expect(window.getByTestId('video-export-status')).toHaveText('请先应用字幕修改');
    await expect(window.getByTestId('video-export-button')).toBeEnabled();
    await expect(segment).toHaveText('等待期间恢复的草稿');
    expect((await readScenarioState()).exportRequests || []).toHaveLength(0);
  });

  test('admits only one export when two clicks arrive during readiness', async ({ window, readScenarioState }, testInfo) => {
    await openUsableEditor(window, testInfo, 'readiness-double-click.mp4');
    await generateAppliedSubtitles(window);
    await window.evaluate(() => {
      window.projectEditingReady = new Promise(resolve => { window.__resolveExportReadiness = resolve; });
      window.__exportBuildCount = 0;
      const build = SRTRenderRecipe.buildRenderRecipe;
      SRTRenderRecipe.buildRenderRecipe = function(graph, registry) {
        window.__exportBuildCount += 1;
        return build(graph, registry);
      };
      const button = document.querySelector('[data-testid="video-export-button"]');
      button.dispatchEvent(new Event('click'));
      button.dispatchEvent(new Event('click'));
      window.__resolveExportReadiness();
    });
    await expect(window.getByTestId('video-export-status')).toHaveText('导出失败');
    await expect(window.getByTestId('video-export-button')).toBeEnabled();
    expect(await window.evaluate(() => window.__exportBuildCount)).toBe(1);
    expect((await readScenarioState()).exportRequests).toHaveLength(1);
    await expect(window.locator('#tabsBar')).not.toHaveAttribute('inert');
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
