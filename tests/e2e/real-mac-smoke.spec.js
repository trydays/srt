const { test, expect } = require('./electron.fixture');

test.describe('current Mac read-only smoke', () => {
  test.skip(
    process.platform !== 'darwin' || process.env.SRT_REAL_MAC_SMOKE !== '1',
    'requires an explicit opt-in on macOS'
  );
  test.use({ realEnvironment: true });

  test('detects this Mac without invoking installation', async ({ window, readScenarioState }) => {
    const report = await window.evaluate(() => window.srtAPI.detectEnvironment());

    expect(report.platform.os).toBe('darwin');
    expect(report.tools.node.status).not.toBe('missing');
    expect(report.tools.python.status).not.toBe('missing');
    expect(report.hardware.disk.path).not.toMatch(/^[A-Za-z]:[\\/]/);
    expect(report.hardware.graphics.name).toMatch(/Apple/i);
    expect(report.hardware.graphics.metal).toBe(true);
    expect(report.hardware.graphics.supported).toBe(true);
    expect(report.hardware.graphics.reason).not.toBe('probe_error');

    const state = await readScenarioState();
    expect(state.environmentKind).toBe('production');
    expect(state.installMethodCount).toBe(0);
  });
});
