const { test, expect, E2E_CLOUD_KEY } = require('./electron.fixture');

test.describe('macOS ready', () => {
  test.use({ scenario: 'mac-ready' });

  test('首次启动显示真实语义的环境报告', async ({ window }) => {
    await expect(window.getByTestId('platform-summary')).toContainText('macOS');
    await expect(window.getByTestId('platform-summary')).toContainText('Apple M4');
    await expect(window.getByTestId('row-graphics')).toContainText('Metal');
    await expect(window.getByTestId('row-node')).toHaveAttribute('data-status', 'ready');
    await expect(window.getByTestId('row-python')).toHaveAttribute('data-status', 'ready');
    await expect.soft(window.locator('#cliBadge')).toHaveText('✅ 可用');
    await expect.soft(window.locator('#cliBadge')).toHaveClass(/\bok\b/);

    await expect.soft(window.locator('#aiStatusTitle')).toContainText('检测到 1 个可用 AI 配置来源');
    await expect.soft(window.locator('#aiSourceList')).toContainText('已配置的云端 AI（openai）');
    await expect.soft(window.locator('#aiSourceList')).toContainText('✅ 已配置');
    await expect.soft(window.locator('#aiSourceList')).not.toContainText('OpenAI API Key');
    await expect.soft(window.locator('#aiSourceList')).not.toContainText('Claude Code 凭证');
    await expect.soft(window.locator('#aiSourceList')).not.toContainText('环境变量 SRT_AI_KEY');
    await expect.soft(window.locator('#aiSourceList')).not.toContainText('配置文件 .srt.config.json');
    await expect.soft(window.locator('#aiCollapseBadge')).toHaveText('✅ 已就绪');
    await expect(window.locator('#aiStatus')).toContainText('当前 Key: ' + E2E_CLOUD_KEY.slice(0, 7) + '... (openai)');
    await expect(window.locator('body')).not.toContainText(E2E_CLOUD_KEY);
    const remoteResources = await window.evaluate(() => performance.getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((name) => /^https?:/i.test(name)));
    expect(remoteResources).toEqual([]);
    await expect(window.getByTestId('continue')).toBeEnabled();
  });
});
