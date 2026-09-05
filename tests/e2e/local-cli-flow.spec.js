const { test, expect } = require('./electron.fixture');

test('empty local CLI result uses the exact copy and remains optional', async ({ window }) => {
  await expect(window.getByTestId('local-cli-results')).toHaveText('未扫描到可用本地 CLI');
  await expect(window.getByTestId('local-cli-codex')).toHaveCount(0);
  await window.getByTestId('continue').click();
  await expect(window.getByTestId('home-page')).toBeVisible();
});

test.describe('two available CLIs', () => {
  test.use({ localCliMode: 'two' });

  test('visible explicit choice persists across a rescan', async ({ window }) => {
    await expect(window.getByTestId('local-cli-codex')).toContainText('可用');
    await expect(window.getByTestId('local-cli-claude')).toContainText('可用');
    await window.getByTestId('local-cli-claude').click();
    await expect(window.getByTestId('local-cli-claude')).toContainText('已选为默认');
    await window.getByTestId('local-cli-rescan').click();
    await expect(window.getByTestId('local-cli-claude')).toContainText('已选为默认');
  });
});
