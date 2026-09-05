const { test, expect } = require('./electron.fixture');

async function openEditorWithCodex(window) {
  await window.getByTestId('local-cli-codex').click();
  await window.getByTestId('continue').click();
  await window.getByTestId('video-input').setInputFiles({
    name: 'local-cli-effect.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from('local CLI effect test video')
  });
  await window.getByTestId('start-editing').click();
  await expect(window.getByTestId('editor-page')).toBeVisible();
}

test.describe('local CLI effect instructions', () => {
  test.use({ localCliMode: 'two' });

  test('shows a fade-in timeline marker for a valid local CLI instruction', async ({ window }) => {
    await openEditorWithCodex(window);
    await window.locator('.input-editor').fill('添加淡入');
    await window.locator('#generateBtn').click();

    await expect(window.getByTestId('effect-status')).toHaveText('已生成编辑指令');
    await expect(window.getByTestId('timeline-effect-fade-in')).toHaveCount(1);
  });

  test.describe('invalid local CLI output', () => {
    test.use({ localCliEffectResult: 'invalid' });

    test('shows an error and adds no marker', async ({ window }) => {
      await openEditorWithCodex(window);
      await window.locator('.input-editor').fill('添加淡入');
      await window.locator('#generateBtn').click();

      await expect(window.getByTestId('effect-status')).toHaveText('未能生成编辑指令，请先选择可用的本地 CLI 或重试。');
      await expect(window.getByTestId('timeline-effect-fade-in')).toHaveCount(0);
    });
  });
});
