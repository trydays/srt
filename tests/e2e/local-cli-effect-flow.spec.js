const { test, expect } = require('./electron.fixture');
const fs = require('node:fs');

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

async function openEditorWithCodex(window, testInfo) {
  await window.getByTestId('local-cli-codex').click();
  await window.getByTestId('continue').click();
  const videoPath = testInfo.outputPath('local-cli-effect.mp4');
  await fs.promises.writeFile(videoPath, Buffer.from('local CLI effect test video'));
  await window.getByTestId('video-input').setInputFiles(videoPath);
  await window.getByTestId('start-editing').click();
  await expect(window.getByTestId('editor-page')).toBeVisible();
  await setUsableMetadata(window);
}

test.describe('local CLI effect instructions', () => {
  test.use({ localCliMode: 'two' });

  test('keeps one message and one card, then adds one fade-in marker', async ({ window }, testInfo) => {
    await openEditorWithCodex(window, testInfo);
    await window.locator('.input-editor').fill('给片头添加一个淡入效果');
    await window.locator('#generateBtn').click();
    await expect(window.getByTestId('request-user-message')).toHaveCount(1);
    await expect(window.getByTestId('request-status-card')).toHaveCount(1);
    await expect(window.getByTestId('instruction-status')).toHaveAttribute('data-state', 'success');
    await expect(window.getByTestId('timeline-status')).toHaveAttribute('data-state', 'success');
    await expect(window.getByTestId('timeline-effect-fade-in')).toHaveCount(1);
    await expect(window.getByTestId('effect-status')).toHaveCount(0);
    const card = window.getByTestId('request-status-card');
    await expect(card.getByTestId('request-status-summary')).toHaveText(/^✓ 这次编辑已完成 · \d{2}:\d{2}$/);
    await expect(card.getByTestId('request-status-details')).toBeHidden();
    await card.getByTestId('request-status-summary').click();
    await expect(card.getByTestId('request-status-details')).toBeVisible();
    await expect(card.getByTestId('instruction-status')).toHaveAttribute('data-state', 'success');
    await expect(card.getByTestId('timeline-status')).toHaveAttribute('data-state', 'success');
  });

  test.describe('invalid local CLI output', () => {
    test.use({ localCliEffectResult: 'invalid' });

    test('shows failed and not run in the same card without a marker', async ({ window }, testInfo) => {
      await openEditorWithCodex(window, testInfo);
      await window.locator('.input-editor').fill('添加淡入');
      await window.locator('#generateBtn').click();
      await expect(window.getByTestId('request-status-card')).toHaveCount(1);
      await expect(window.getByTestId('instruction-status')).toHaveAttribute('data-state', 'failed');
      await expect(window.getByTestId('timeline-status')).toHaveAttribute('data-state', 'not_run');
      await expect(window.getByTestId('timeline-effect-fade-in')).toHaveCount(0);
    });
  });

  test.describe('multi-turn clarify', () => {
    test.use({ localCliEffectResult: 'clarify-once' });

    test('asks a follow-up then converges after the reply', async ({ window }, testInfo) => {
      await openEditorWithCodex(window, testInfo);
      await window.locator('.input-editor').fill('做个效果');
      await window.locator('#generateBtn').click();
      await expect(window.getByTestId('instruction-status')).toHaveAttribute('data-state', 'clarifying');
      await expect(window.getByTestId('request-clarify')).toHaveText(/你想要字幕还是淡入/);
      await window.locator('.input-editor').fill('要淡入');
      await window.locator('#generateBtn').click();
      await expect(window.getByTestId('instruction-status')).toHaveAttribute('data-state', 'success');
      await expect(window.getByTestId('timeline-status')).toHaveAttribute('data-state', 'success');
      await expect(window.getByTestId('timeline-effect-fade-in')).toHaveCount(1);
      await expect(window.getByTestId('request-user-message')).toHaveCount(2);
    });
  });

  test.describe('multi-step ranged instruction', () => {
    test.use({ localCliEffectResult: 'multi-step' });

    test('generates subtitles and adds a fade-out marker in one request', async ({ window }, testInfo) => {
      await openEditorWithCodex(window, testInfo);
      await window.locator('.input-editor').fill('从 12 到 18 秒加字幕，片尾淡出');
      await window.locator('#generateBtn').click();
      await expect(window.getByTestId('subtitle-status')).toHaveAttribute('data-state', 'success');
      await expect(window.getByTestId('timeline-effect-fade-out')).toHaveCount(1);
    });
  });
});
