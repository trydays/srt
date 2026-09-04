const { test, expect, E2E_CLOUD_KEY } = require('./electron.fixture');

test.describe('macOS ready journey', () => {
  test.use({ scenario: 'mac-ready' });

  test('首次启动检测后可上传内存视频并进入编辑器', async ({ window }) => {
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

    await window.getByTestId('continue').click();
    await expect(window.getByTestId('home-page')).toBeVisible();
    await window.getByTestId('video-input').setInputFiles({
      name: 'deterministic-e2e.mp4',
      mimeType: 'video/mp4',
      buffer: Buffer.from('srt deterministic in-memory video')
    });
    await expect(window.getByTestId('start-editing')).toBeVisible();
    await window.getByTestId('start-editing').click();
    await expect(window.getByTestId('editor-page')).toBeVisible();
  });
});

test.describe('Windows ready journey', () => {
  test.use({ scenario: 'windows-ready' });

  test('显示 Windows 的处理器、图形和磁盘语义', async ({ window }) => {
    await expect(window.getByTestId('platform-summary')).toContainText('Windows');
    await expect(window.getByTestId('platform-summary')).toContainText('AMD Ryzen 9 9950X');
    await expect(window.getByTestId('row-chip')).toContainText('AMD Ryzen 9 9950X');
    await expect(window.getByTestId('row-graphics')).toContainText('NVIDIA GeForce RTX 4090');
    await expect(window.getByTestId('row-graphics')).toContainText('图形加速可用');
    await expect(window.getByTestId('row-disk')).toContainText('可用 240 GB / 共 953 GB');
    await expect(window.locator('body')).not.toContainText('Apple');
    await expect(window.locator('body')).not.toContainText('Metal');
    await expect(window.getByTestId('continue')).toBeEnabled();
  });
});

test.describe('Windows missing npm journey', () => {
  test.use({ scenario: 'windows-npm-missing' });

  test('npm 缺失时提供现有的 Node.js 白名单安装方案', async ({ window }) => {
    const npmRow = window.getByTestId('row-npm');
    await expect(npmRow).toHaveAttribute('data-status', 'missing');
    await npmRow.getByRole('button', { name: '查看安装方案' }).click();
    await expect(window.getByTestId('install-dialog')).toBeVisible();
    await expect(window.locator('#installTitle')).toHaveText('安装 Node.js');
    await expect(window.getByTestId('install-dialog')).toContainText('Node.js 将通过 winget 安装');
  });
});

test.describe('missing FFmpeg journey', () => {
  test.use({ scenario: 'mac-missing' });

  test('取消不安装，新确认只安装一次并完成全量重检', async ({ window, readScenarioState }) => {
    const ffmpegRow = window.getByTestId('row-ffmpeg');
    const dialog = window.getByTestId('install-dialog');
    const installCalls = (state) => state.calls.filter(({ program, args }) =>
      program === 'brew' && JSON.stringify(args) === JSON.stringify(['install', 'ffmpeg']));

    await expect(ffmpegRow).toHaveAttribute('data-status', 'missing');
    await ffmpegRow.getByRole('button', { name: '查看安装方案' }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Homebrew');
    await expect(window.getByTestId('install-confirm')).toBeEnabled();
    await window.getByTestId('install-cancel').click();
    await expect(dialog).not.toBeVisible();

    let state = await readScenarioState();
    expect(state.installMethodCount).toBe(0);
    expect(installCalls(state)).toHaveLength(0);
    await expect(ffmpegRow).toHaveAttribute('data-status', 'missing');

    await ffmpegRow.getByRole('button', { name: '查看安装方案' }).click();
    await expect(dialog).toBeVisible();
    await expect(window.getByTestId('install-confirm')).toBeEnabled();
    await window.getByTestId('install-confirm').click();
    await expect(dialog).not.toBeVisible();
    await expect(ffmpegRow).toHaveAttribute('data-status', 'ready');
    await expect(window.getByTestId('mode-ffmpeg')).toHaveAttribute('data-status', 'ready');

    state = await readScenarioState();
    expect(state.confirmationCount).toBe(2);
    expect(state.installMethodCount).toBe(1);
    expect(installCalls(state)).toEqual([{ program: 'brew', args: ['install', 'ffmpeg'] }]);
    expect(state.ffmpegInstallCount).toBe(1);
    expect(state.detectionCount).toBe(2);
  });
});

test.describe('degraded macOS journey', () => {
  test.use({ scenario: 'mac-degraded' });

  test('区分资源不足与图形探测失败且仍可继续', async ({ window }) => {
    await expect(window.getByTestId('row-memory')).toHaveAttribute('data-status', 'missing');
    await expect(window.getByTestId('row-memory')).toContainText('可用内存低于 8 GB');
    await expect(window.getByTestId('row-disk')).toHaveAttribute('data-status', 'missing');
    await expect(window.getByTestId('row-disk')).toContainText('可用空间低于 10 GB');
    await expect(window.getByTestId('row-graphics')).toHaveAttribute('data-status', 'missing');
    await expect(window.getByTestId('row-graphics')).toContainText('检测失败，请重试或手动确认');
    await expect(window.getByTestId('environment-page')).toHaveAttribute('data-state', 'loaded');
    await expect(window.getByTestId('continue')).toBeEnabled();

    await window.getByTestId('continue').click();
    await expect(window.getByTestId('home-page')).toBeVisible();
  });
});
