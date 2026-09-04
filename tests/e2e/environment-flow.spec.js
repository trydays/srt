const { test, expect } = require('./electron.fixture');

test.describe('macOS ready', () => {
  test.use({ scenario: 'mac-ready' });

  test('首次启动显示真实语义的环境报告', async ({ window }) => {
    await expect(window.getByTestId('platform-summary')).toContainText('macOS');
    await expect(window.getByTestId('platform-summary')).toContainText('Apple M4');
    await expect(window.getByTestId('row-graphics')).toContainText('Metal');
    await expect(window.getByTestId('row-node')).toHaveAttribute('data-status', 'ready');
    await expect(window.getByTestId('row-python')).toHaveAttribute('data-status', 'ready');
    await expect(window.getByTestId('continue')).toBeEnabled();
  });
});
