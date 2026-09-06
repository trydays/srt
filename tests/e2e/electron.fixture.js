const fs = require('fs');
const os = require('os');
const path = require('path');
const { test: base, expect, _electron: electron } = require('@playwright/test');

const E2E_CLOUD_KEY = 'sk-e2e-cloud-config-not-a-real-secret';

function errorDetail(error) {
  if (error && error.stack) return error.stack;
  if (error && error.message) return error.message;
  return String(error);
}

function registerRendererDiagnostics(electronApp, diagnostics, { includeConsole = true } = {}) {
  const observed = new WeakSet();
  const registrations = [];

  function registerWindow(page) {
    if (!page || observed.has(page)) return;
    observed.add(page);

    const onConsole = (message) => {
      try {
        diagnostics.push(`[renderer:${message.type()}] ${message.text()}`);
      } catch (error) {
        diagnostics.push(`[fixture:renderer-console] ${errorDetail(error)}`);
      }
    };
    const onPageError = (error) => {
      diagnostics.push(`[renderer:pageerror] ${errorDetail(error)}`);
    };
    if (includeConsole) page.on('console', onConsole);
    page.on('pageerror', onPageError);
    registrations.push({ page, onConsole, onPageError });
  }

  electronApp.on('window', registerWindow);
  electronApp.windows().forEach(registerWindow);

  return function detachRendererDiagnostics() {
    if (typeof electronApp.off === 'function') electronApp.off('window', registerWindow);
    registrations.forEach(({ page, onConsole, onPageError }) => {
      if (typeof page.off !== 'function') return;
      if (includeConsole) page.off('console', onConsole);
      page.off('pageerror', onPageError);
    });
  };
}

function cleanupError(operation, error) {
  const wrapped = new Error(`${operation}: ${error && error.message ? error.message : String(error)}`);
  wrapped.cause = error;
  return wrapped;
}

async function cleanupElectronFixture({
  unexpectedFailure,
  window,
  testInfo,
  diagnostics,
  detachDiagnostics,
  electronApp,
  userDataDir
}) {
  const errors = [];

  async function attempt(operation, action) {
    try {
      await action();
      return true;
    } catch (error) {
      errors.push(cleanupError(operation, error));
      return false;
    }
  }

  try {
    if (unexpectedFailure) {
      let screenshotPath;
      if (window) {
        await attempt('failure screenshot', async () => {
          if (window.isClosed()) return;
          screenshotPath = testInfo.outputPath('failure.png');
          await window.screenshot({ path: screenshotPath, fullPage: true });
        });
      }
      if (screenshotPath && fs.existsSync(screenshotPath)) {
        await attempt('failure screenshot attachment', () => testInfo.attach('failure-screenshot', {
          path: screenshotPath,
          contentType: 'image/png'
        }));
      }
      if (diagnostics.length) {
        await attempt('Electron diagnostics attachment', () => testInfo.attach('electron-diagnostics', {
          body: Buffer.from(diagnostics.join('\n')),
          contentType: 'text/plain; charset=utf-8'
        }));
      }
    }
  } finally {
    try {
      if (detachDiagnostics) {
        await attempt('renderer diagnostic listener cleanup', async () => detachDiagnostics());
      }
    } finally {
      try {
        if (electronApp) await attempt('Electron close', () => electronApp.close());
      } finally {
        if (userDataDir) {
          await attempt('temporary directory removal', () => fs.promises.rm(userDataDir, {
            recursive: true,
            force: true
          }));
        }
      }
    }
  }

  if (errors.length) {
    diagnostics.push(...errors.map((error) => `[fixture:cleanup] ${error.message}`));
    await attempt('cleanup diagnostics attachment', () => testInfo.attach('fixture-cleanup-diagnostics', {
      body: Buffer.from(diagnostics.join('\n')),
      contentType: 'text/plain; charset=utf-8'
    }));
  }

  return errors;
}

const test = base.extend({
  scenario: ['mac-ready', { option: true }],
  realEnvironment: [false, { option: true }],
  localCliMode: ['empty', { option: true }],
  localCliEffectResult: ['valid', { option: true }],
  subtitleResult: ['success', { option: true }],
  electronContext: async ({ scenario, realEnvironment, localCliMode, localCliEffectResult, subtitleResult }, use, testInfo) => {
    const userDataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'srt-e2e-'));
    const diagnostics = [];
    let electronApp;
    let window;
    let detachDiagnostics;
    let primaryError;

    try {
      electronApp = await electron.launch({
        args: [path.join(__dirname, 'electron-main.js')],
        env: {
          ...process.env,
          SRT_E2E_USER_DATA: userDataDir,
          SRT_E2E_LOCAL_CLI: localCliMode,
          SRT_E2E_EFFECT_RESULT: localCliEffectResult,
          SRT_E2E_SUBTITLE_RESULT: subtitleResult,
          SRT_E2E_REAL_MAC: realEnvironment ? '1' : '0',
          SRT_E2E_SCENARIO: realEnvironment ? '' : scenario,
          ...(!realEnvironment && scenario === 'mac-ready' ? {
            PATH: '/usr/bin:/bin',
            SRT_AI_KEY: E2E_CLOUD_KEY,
            SRT_AI_PROVIDER: 'openai',
            SRT_AI_ENDPOINT: 'https://e2e.invalid/v1',
            SRT_AI_MODEL: 'e2e-model'
          } : {})
        }
      });

      detachDiagnostics = registerRendererDiagnostics(electronApp, diagnostics, { includeConsole: false });
      const child = electronApp.process();
      if (child && child.stderr) {
        child.stderr.on('data', (chunk) => diagnostics.push(`[electron:stderr] ${chunk.toString()}`));
      }

      window = await electronApp.firstWindow();
      await window.locator('[data-testid="environment-page"][data-state="loaded"]').waitFor();
      await use({ electronApp, window });
    } catch (error) {
      primaryError = error;
      throw error;
    } finally {
      const unexpectedFailure = Boolean(primaryError) || (
        testInfo.status && testInfo.status !== testInfo.expectedStatus
      );
      const cleanupErrors = await cleanupElectronFixture({
        unexpectedFailure,
        window,
        testInfo,
        diagnostics,
        detachDiagnostics,
        electronApp,
        userDataDir
      });
      if (cleanupErrors.length) {
        console.error(cleanupErrors.map((error) => `[electron fixture cleanup] ${error.message}`).join('\n'));
        if (!primaryError && !unexpectedFailure) {
          throw new AggregateError(cleanupErrors, 'Electron fixture cleanup failed');
        }
      }
    }
  },
  window: async ({ electronContext }, use) => {
    await use(electronContext.window);
  },
  readScenarioState: async ({ electronContext }, use) => {
    await use(() => electronContext.electronApp.evaluate(({ app }) => app.__srtE2EState));
  }
});

module.exports = {
  test,
  expect,
  E2E_CLOUD_KEY,
  __private: { cleanupElectronFixture, registerRendererDiagnostics }
};
