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
  async translateInstruction(text, history, context) {
    state.translationCalls = (state.translationCalls || []).concat([{ text, history, context }]);
    if (process.env.SRT_E2E_EFFECT_RESULT === 'invalid') {
      const error = new Error('Invalid local CLI instruction output');
      error.code = 'LOCAL_CLI_INVALID_INSTRUCTION_OUTPUT';
      throw error;
    }
    if (process.env.SRT_E2E_EFFECT_RESULT === 'clarify-once') {
      if (!Array.isArray(history) || history.length <= 1) {
        return { kind: 'clarify', message: '你是想为整段视频生成字幕吗？' };
      }
      return { kind: 'instruction', steps: [{ capability: 'subtitle.generate@1', params: {} }] };
    }
    if (process.env.SRT_E2E_EFFECT_RESULT === 'multi-step') {
      return { kind: 'instruction', steps: [
        { capability: 'subtitle.generate@1', params: { start: 12, end: 18 } },
        { capability: 'fade.out@1', params: { start: 18, end: 20 } }
      ] };
    }
    if (['color-transactions', 'color-transactions-success'].includes(process.env.SRT_E2E_EFFECT_RESULT)) {
      if (/下一步/.test(text)) return { kind: 'clarify', message: '请说明下一步编辑。' };
      const color = { capability: 'video.color.adjust@1', range: { start: 1, end: 3 },
        params: { temperature: -0.6, brightness: 0.2, contrast: 1.3 } };
      if (/叠加/.test(text)) return { kind: 'instruction', steps: [color,
        { capability: 'video.color.adjust@1', range: { start: 2, end: 4 },
          params: { temperature: 0.4, saturation: 0.7 } }
      ] };
      return { kind: 'instruction', steps: /字幕/.test(text)
        ? [color, { capability: 'subtitle.generate@1', params: {} }] : [color] };
    }
    if (/字幕/.test(text)) {
      return { kind: 'instruction', steps: [{ capability: 'subtitle.generate@1', params: {} }] };
    }
    return { kind: 'clarify', message: '当前可以为整段视频生成字幕。你需要生成字幕吗？' };
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
      if (process.env.SRT_E2E_EFFECT_RESULT === 'color-transactions-success') {
        return { jobId: request.jobId, status: 'completed', outputPath: request.outputPath };
      }
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
