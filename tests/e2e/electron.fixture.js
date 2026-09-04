const fs = require('fs');
const os = require('os');
const path = require('path');
const { test: base, expect, _electron: electron } = require('@playwright/test');

const test = base.extend({
  scenario: ['mac-ready', { option: true }],
  window: async ({ scenario }, use, testInfo) => {
    const userDataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'srt-e2e-'));
    const diagnostics = [];
    let electronApp;
    let window;
    let setupError;

    try {
      electronApp = await electron.launch({
        args: [path.join(__dirname, 'electron-main.js')],
        env: {
          ...process.env,
          SRT_E2E_SCENARIO: scenario,
          SRT_E2E_USER_DATA: userDataDir
        }
      });

      const child = electronApp.process();
      if (child && child.stderr) {
        child.stderr.on('data', (chunk) => diagnostics.push(`[electron:stderr] ${chunk.toString()}`));
      }

      window = await electronApp.firstWindow();
      window.on('console', (message) => diagnostics.push(`[renderer:${message.type()}] ${message.text()}`));
      window.on('pageerror', (error) => diagnostics.push(`[renderer:pageerror] ${error.stack || error.message}`));
      await window.locator('[data-testid="environment-page"][data-state="loaded"]').waitFor();
      await use(window);
    } catch (error) {
      setupError = error;
      throw error;
    } finally {
      const unexpectedFailure = Boolean(setupError) || (
        testInfo.status && testInfo.status !== testInfo.expectedStatus
      );
      if (unexpectedFailure && window && !window.isClosed()) {
        const screenshotPath = testInfo.outputPath('failure.png');
        await window.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
        if (fs.existsSync(screenshotPath)) {
          await testInfo.attach('failure-screenshot', { path: screenshotPath, contentType: 'image/png' });
        }
      }
      if (unexpectedFailure && diagnostics.length) {
        await testInfo.attach('electron-diagnostics', {
          body: Buffer.from(diagnostics.join('\n')),
          contentType: 'text/plain'
        });
      }
      if (electronApp) await electronApp.close().catch(() => {});
      await fs.promises.rm(userDataDir, { recursive: true, force: true });
    }
  }
});

module.exports = { test, expect };
