const { app } = require('electron');
const path = require('node:path');
const userDataDir = process.env.SRT_E2E_USER_DATA;
if (!userDataDir) throw new Error('SRT_E2E_USER_DATA is required');
app.setPath('userData', userDataDir);

const { createEnvironmentModule } = require('../../src/environment');
const { createProductionEnvironment } = require('../../src/environment/node-adapter');
const { startApplication } = require('../../main');
const useProductionEnvironment = process.env.SRT_E2E_REAL_MAC === '1';
let state;
let baseEnvironment;

if (useProductionEnvironment) {
  state = { environmentKind: 'production' };
  baseEnvironment = createProductionEnvironment({
    targetPath: userDataDir,
    userDataDir,
    bundledRoot: path.join(__dirname, '..', '..', 'resources', 'tools')
  });
} else {
  const scenario = require('./scenario-dependencies')
    .createScenarioDependencies(process.env.SRT_E2E_SCENARIO);
  state = scenario.state;
  state.environmentKind = 'scenario';
  baseEnvironment = createEnvironmentModule({
    ...scenario.dependencies,
    targetPath: userDataDir,
    userDataDir
  });
}

state.detectionCount = 0;
state.installMethodCount = 0;
const environmentModule = {
  detectEnvironment: (...args) => {
    state.detectionCount += 1;
    return baseEnvironment.detectEnvironment(...args);
  },
  describeInstall: (...args) => baseEnvironment.describeInstall(...args),
  installTool: (...args) => {
    state.installMethodCount += 1;
    return baseEnvironment.installTool(...args);
  },
  getExportTools: (...args) => baseEnvironment.getExportTools(...args)
};
const localCliStates = process.env.SRT_E2E_LOCAL_CLI === 'two'
  ? [{ id: 'codex', label: 'Codex CLI' }, { id: 'claude', label: 'Claude Code' }]
  : [];
let selectedCliId = null;
const localCliService = {
  async getState() {
    return { available: localCliStates, selectedCliId };
  },
  async rescan() {
    return { available: localCliStates, selectedCliId };
  },
  async select(id) {
    if (!localCliStates.some((item) => item.id === id)) {
      const error = new Error('Local CLI unavailable');
      error.code = 'LOCAL_CLI_NOT_AVAILABLE';
      throw error;
    }
    selectedCliId = id;
    return { available: localCliStates, selectedCliId };
  },
  async translateEffect() {
    if (process.env.SRT_E2E_EFFECT_RESULT === 'invalid') {
      const error = new Error('Invalid local CLI effect output');
      error.code = 'LOCAL_CLI_INVALID_EFFECT_OUTPUT';
      throw error;
    }
    return { type: 'add_effect', effect: 'fade_in' };
  },
  async translateSubtitleOrFadeIn(text) {
    if (process.env.SRT_E2E_EFFECT_RESULT === 'invalid') {
      const error = new Error('Invalid local CLI instruction output');
      error.code = 'LOCAL_CLI_INVALID_INSTRUCTION_OUTPUT';
      throw error;
    }
    if (/字幕/.test(text)) return { type: 'generate_subtitles' };
    return { type: 'add_effect', effect: 'fade_in' };
  }
};
const subtitleService = {
  async generate(request) {
    state.subtitleCalls = (state.subtitleCalls || []).concat([request]);
    if (process.env.SRT_E2E_SUBTITLE_RESULT === 'no-speech') {
      const error = new Error('no speech');
      error.code = 'SUBTITLE_NO_SPEECH';
      throw error;
    }
    return { segments: [
      { start: 0.2, end: 1.4, text: '大家好' },
      { start: 1.6, end: 3.0, text: '欢迎测试自动字幕' }
    ] };
  }
};
let videoExportService;
let showSaveDialog;
if (!useProductionEnvironment) {
  let exportStartCount = 0;
  let pendingExport = null;
  videoExportService = {
    async start(request, onProgress) {
      exportStartCount += 1;
      state.exportRequests = (state.exportRequests || []).concat([request]);
      onProgress({ jobId: request.jobId, phase: 'rendering', percent: 42 });
      if (exportStartCount === 1) {
        await new Promise((resolve) => setTimeout(resolve, 80));
        return { jobId: request.jobId, status: 'failed', errorCode: 'EXPORT_RENDER_FAILED' };
      }
      return new Promise((resolve) => {
        pendingExport = { jobId: request.jobId, resolve };
      });
    },
    async cancel(jobId) {
      state.exportCancels = (state.exportCancels || []).concat([jobId]);
      if (pendingExport && pendingExport.jobId === jobId) {
        const current = pendingExport;
        pendingExport = null;
        current.resolve({ jobId, status: 'cancelled' });
      }
    }
  };
  showSaveDialog = async () => ({
    canceled: false,
    filePath: path.join(userDataDir, 'export.mp4')
  });
}
app.__srtE2EState = state;
startApplication({ environmentModule, localCliService, subtitleService,
  ...(useProductionEnvironment ? {} : { videoExportService, showSaveDialog }) });
