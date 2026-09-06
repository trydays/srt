const { test, expect } = require('./electron.fixture');
const fs = require('node:fs');

async function createVideoFixture(testInfo) {
  const file = testInfo.outputPath('subtitle-surface.mp4');
  await fs.promises.writeFile(file, Buffer.from('subtitle surface fixture'));
  return file;
}

async function openEditor(window, videoFixturePath) {
  await window.getByTestId('local-cli-codex').click();
  await window.getByTestId('continue').click();
  await window.getByTestId('video-input').setInputFiles(videoFixturePath);
  await window.getByTestId('start-editing').click();
  await expect(window.getByTestId('editor-page')).toBeVisible();
}

async function seedExistingSubtitle(window) {
  await window.evaluate(() => {
    const store = window.SRTSubtitleState.createSubtitleStore(
      localStorage,
      () => 'seed-segment'
    );
    store.replace(getActiveProjectId(), 'seed-request', [
      { start: 0, end: 1, text: '原字幕不能丢失' }
    ]);
    window.subtitleController.render();
  });
}

test.describe('subtitle surface', () => {
  test.use({ localCliMode: 'two' });

  test('shows fixed segments in one track and the preview', async ({ window }, testInfo) => {
    const videoFixturePath = await createVideoFixture(testInfo);
    await openEditor(window, videoFixturePath);
    await window.evaluate(() => {
      let id = 0;
      const store = window.SRTSubtitleState.createSubtitleStore(
        localStorage,
        () => `fixture-segment-${++id}`
      );
      store.replace(getActiveProjectId(), 'fixture-request', [
        { start: 0.2, end: 1.4, text: '大家好' },
        { start: 1.6, end: 3.0, text: '欢迎测试自动字幕' }
      ]);
      window.subtitleController.render();
    });
    await expect(window.getByTestId('subtitle-block')).toHaveCount(2);
    await window.evaluate(() => {
      const video = document.getElementById('previewVideo');
      video.currentTime = 0.5;
      video.dispatchEvent(new Event('timeupdate'));
    });
    await expect(window.getByTestId('preview-subtitle')).toHaveText('大家好');
    await expect(window.getByTestId('preview-subtitle')).toBeVisible();
    await window.evaluate(() => {
      const video = document.getElementById('previewVideo');
      video.currentTime = 1.5;
      video.dispatchEvent(new Event('timeupdate'));
    });
    await expect(window.getByTestId('preview-subtitle')).toBeHidden();
  });
});

test.describe('auto subtitle conversation', () => {
  test.use({ localCliMode: 'two', subtitleResult: 'success' });

  test('generates, edits, persists and undoes the one subtitle track', async ({ window }, testInfo) => {
    const videoFixturePath = await createVideoFixture(testInfo);
    await openEditor(window, videoFixturePath);
    await expect(window.locator('#generateBtn')).toHaveText('发送');
    await window.locator('.input-editor').fill('给这个视频加上字幕');
    await window.locator('#generateBtn').click();
    await expect(window.getByTestId('request-user-message')).toHaveCount(1);
    await expect(window.getByTestId('request-status-card')).toHaveCount(1);
    await expect(window.getByTestId('instruction-status')).toHaveAttribute('data-state', 'success');
    await expect(window.getByTestId('subtitle-status')).toHaveAttribute('data-state', 'success');
    await expect(window.getByTestId('subtitle-block')).toHaveCount(2);
    const firstRequestCard = window.getByTestId('request-status-card').last();
    await window.evaluate((card) => subtitleController.openAfter(card), await firstRequestCard.elementHandle());
    const documentEditor = window.getByTestId('subtitle-document');
    await expect(documentEditor).toHaveCount(1);
    await expect(window.getByTestId('subtitle-document-toggle')).toHaveText('编辑全部字幕 · 2 段');
    await expect(firstRequestCard.locator('xpath=following-sibling::*[1][@data-subtitle-document]')).toHaveCount(1);
    await expect(window.getByTestId('subtitle-document-segment')).toHaveCount(2);
    await expect(window.getByTestId('subtitle-document-time')).toHaveText(['00:00', '00:01']);
    await expect(window.locator('#subtitleTextEditor, #subtitleTextSave')).toHaveCount(0);
    await window.getByTestId('subtitle-undo').click();
    await expect(window.getByTestId('subtitle-block')).toHaveCount(0);
    await window.locator('.input-editor').fill('重新生成字幕');
    await window.locator('#generateBtn').click();
    await expect(window.getByTestId('subtitle-block')).toHaveCount(2);
    await expect(window.getByTestId('subtitle-undo')).toHaveCount(1);
    const secondRequestCard = window.getByTestId('request-status-card').last();
    await window.evaluate((card) => subtitleController.openAfter(card), await secondRequestCard.elementHandle());
    const segments = window.getByTestId('subtitle-document-segment');
    await segments.nth(0).fill('大家好，已经修改');
    await segments.nth(1).fill('欢迎测试统一文稿');
    await expect(documentEditor).toContainText('有未保存更改');
    await segments.nth(0).press('Tab');
    await expect(segments.nth(1)).toBeFocused();
    await segments.nth(1).press('Shift+Tab');
    await expect(segments.nth(0)).toBeFocused();
    const enterEvents = await window.evaluate(() => {
      const segment = document.querySelector('[data-testid="subtitle-document-segment"]');
      const composing = new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true });
      const ordinary = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      return {
        composingAllowed: segment.dispatchEvent(composing),
        ordinaryPrevented: !segment.dispatchEvent(ordinary)
      };
    });
    expect(enterEvents).toEqual({ composingAllowed: true, ordinaryPrevented: true });
    await window.evaluate(() => {
      const segment = document.querySelector('[data-testid="subtitle-document-segment"]');
      const paste = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(paste, 'clipboardData', { value: { getData: () => '一行\n二行' } });
      segment.dispatchEvent(paste);
      const video = document.getElementById('previewVideo');
      video.dispatchEvent(new Event('loadedmetadata'));
    });
    await expect(segments.nth(0)).toContainText('一行 二行');
    await expect(segments.nth(1)).toHaveText('欢迎测试统一文稿');
    await window.getByTestId('subtitle-document-save').click();
    await expect(documentEditor).toContainText('草稿已保存 · 尚未应用');
    await window.evaluate(() => {
      const video = document.getElementById('previewVideo');
      video.currentTime = 0.5;
      video.dispatchEvent(new Event('timeupdate'));
    });
    await expect(window.getByTestId('preview-subtitle')).toHaveText('大家好');
    await window.reload();
    const restoredCard = window.getByTestId('request-status-card').last();
    await window.evaluate((card) => subtitleController.restoreAfter(card), await restoredCard.elementHandle());
    await expect(window.getByTestId('subtitle-document-toggle')).toHaveText('编辑字幕 · 2 段');
    await expect(window.getByTestId('subtitle-document-surface')).toBeHidden();
    await expect(window.getByTestId('subtitle-document-status')).toBeHidden();
    await expect(window.getByTestId('subtitle-document-save')).toBeHidden();
    await expect(window.getByTestId('subtitle-document-apply')).toBeHidden();
    await window.getByTestId('subtitle-document-toggle').click();
    await expect(segments.nth(0)).toContainText('一行 二行');
    await expect(window.getByTestId('subtitle-block').first()).toHaveText('大家好');
    await window.getByTestId('subtitle-document-apply').click();
    await expect(documentEditor).toContainText('所有修改已应用');
    await expect(window.getByTestId('subtitle-block').first()).toContainText('一行 二行');
    await window.evaluate(() => {
      const video = document.getElementById('previewVideo');
      video.currentTime = 0.5;
      video.dispatchEvent(new Event('timeupdate'));
    });
    await expect(window.getByTestId('preview-subtitle')).toContainText('一行 二行');
    await segments.nth(0).fill('一行 二行（已存草稿）');
    await window.getByTestId('subtitle-document-save').click();
    await expect(documentEditor).toContainText('草稿已保存 · 尚未应用');
    await expect(window.getByTestId('subtitle-block').first()).toContainText('一行 二行');
    await window.locator('.input-editor').fill('再生成一次字幕');
    await window.locator('#generateBtn').click();
    await expect(window.getByTestId('request-status-card')).toHaveCount(3);
    const latestRequestCard = window.getByTestId('request-status-card').last();
    await expect(latestRequestCard.getByTestId('subtitle-status')).toHaveAttribute('data-state', 'success');
    await expect(window.getByTestId('subtitle-undo')).toHaveCount(1);
    await window.evaluate((card) => subtitleController.openAfter(card), await latestRequestCard.elementHandle());
    await segments.nth(0).fill('这版有草稿');
    await window.getByTestId('subtitle-document-save').click();
    await window.evaluate(() => { window.confirm = () => false; });
    await expect.poll(() => window.evaluate(() => subtitleController.confirmUndo())).toBe(false);
    await expect(window.getByTestId('subtitle-block').first()).toHaveText('大家好');
    await window.evaluate(() => { window.confirm = () => true; });
    await expect.poll(() => window.evaluate(() => subtitleController.confirmUndo())).toBe(true);
    await window.evaluate((requestId) => subtitleController.undo(requestId), await latestRequestCard.getAttribute('data-request-id'));
    await expect(window.getByTestId('subtitle-block').first()).toContainText('一行 二行');
    await expect(documentEditor).toContainText('草稿已保存 · 尚未应用');
    await expect(segments.nth(0)).toContainText('一行 二行（已存草稿）');
  });

  test('rejects subtitles after an editor re-upload clears the managed video path', async ({ window }, testInfo) => {
    const videoFixturePath = await createVideoFixture(testInfo);
    await openEditor(window, videoFixturePath);
    const replacementPath = testInfo.outputPath('editor-reupload.mp4');
    await fs.promises.writeFile(replacementPath, Buffer.from('editor re-upload fixture'));
    await window.locator('#reupload').setInputFiles(replacementPath);

    await window.locator('.input-editor').fill('给视频加字幕');
    await window.locator('#generateBtn').click();

    const requestCard = window.getByTestId('request-status-card').last();
    await expect(requestCard.getByTestId('instruction-status')).toHaveAttribute('data-state', 'success');
    await expect(requestCard.getByTestId('subtitle-status')).toHaveAttribute('data-state', 'failed');
    await expect(requestCard).toContainText('当前视频路径不可用，请返回首页重新导入视频。');
  });

  test('preserves the previous track and undo when final status persistence fails', async ({ window }, testInfo) => {
    const videoFixturePath = await createVideoFixture(testInfo);
    await openEditor(window, videoFixturePath);
    await seedExistingSubtitle(window);
    await expect.poll(() => window.evaluate(() => subtitleController.canUndo('seed-request'))).toBe(true);
    await window.evaluate(() => {
      const originalSetItem = Storage.prototype.setItem;
      let failedOnce = false;
      Storage.prototype.setItem = function(key, value) {
        if (!failedOnce
            && key === STORAGE_KEYS.PROJECT_CONVERSATIONS
            && String(value).includes('"timelineStatus":"success"')) {
          failedOnce = true;
          throw new Error('forced conversation persistence failure');
        }
        return originalSetItem.call(this, key, value);
      };
    });

    await window.locator('.input-editor').fill('给视频重新生成字幕');
    await window.locator('#generateBtn').click();

    const requestCard = window.getByTestId('request-status-card').last();
    await expect(requestCard.getByTestId('subtitle-status')).toHaveAttribute('data-state', 'failed');
    await expect(window.getByTestId('subtitle-block')).toHaveCount(1);
    await expect(window.getByTestId('subtitle-block')).toHaveText('原字幕不能丢失');
    await expect.poll(() => window.evaluate(() => subtitleController.canUndo('seed-request'))).toBe(true);

    await window.reload();
    const persistedFailureCard = window.getByTestId('request-status-card').last();
    await expect(persistedFailureCard.getByTestId('subtitle-status')).toHaveAttribute('data-state', 'failed');
    await expect(persistedFailureCard).toContainText('字幕暂时无法保存，请重试。');
    await expect(window.getByTestId('subtitle-block')).toHaveText('原字幕不能丢失');
    await expect.poll(() => window.evaluate(() => subtitleController.canUndo('seed-request'))).toBe(true);

    await window.evaluate(() => {
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key === STORAGE_KEYS.PROJECT_CONVERSATIONS) {
          throw new Error('forced persistent conversation failure');
        }
        return originalSetItem.call(this, key, value);
      };
    });
    await window.locator('.input-editor').fill('再生成一次字幕');
    await window.locator('#generateBtn').click();
    const currentFailureCard = window.getByTestId('request-status-card').last();
    await expect(currentFailureCard.getByTestId('subtitle-status')).toHaveAttribute('data-state', 'failed');
    await expect(currentFailureCard).toContainText('字幕暂时无法保存，请重试。');
    await expect(window.getByTestId('subtitle-block')).toHaveText('原字幕不能丢失');
    await expect.poll(() => window.evaluate(() => subtitleController.canUndo('seed-request'))).toBe(true);
  });
});

test.describe('auto subtitles without speech', () => {
  test.use({ localCliMode: 'two', subtitleResult: 'no-speech' });

  test('shows a readable result and preserves the old track', async ({ window }, testInfo) => {
    const videoFixturePath = await createVideoFixture(testInfo);
    await openEditor(window, videoFixturePath);
    await seedExistingSubtitle(window);
    await window.locator('.input-editor').fill('给视频加字幕');
    await window.locator('#generateBtn').click();
    await expect(window.getByTestId('subtitle-status')).toHaveAttribute('data-state', 'failed');
    await expect(window.getByText('未检测到可生成字幕的清晰人声')).toBeVisible();
    await expect(window.getByTestId('subtitle-block')).toHaveCount(1);
    await expect(window.getByTestId('subtitle-block')).toHaveText('原字幕不能丢失');
  });
});
