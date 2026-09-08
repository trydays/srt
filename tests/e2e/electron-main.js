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
    if (process.env.SRT_E2E_EFFECT_RESULT === 'transform-transactions-success') {
      if (/下一步/.test(text)) return { kind: 'clarify', message: '请说明下一步编辑。' };
      const transform = { capability: 'video.transform@1', range: { start: 1, end: 3 },
        params: { flipHorizontal: true, scale: 1.25 } };
      if (/错误第二步/.test(text)) return { kind: 'instruction', steps: [transform,
        { capability: 'video.transform@1', params: { flipVertical: 'true' } }] };
      if (/仅字幕/.test(text)) return { kind: 'instruction', steps: [{ capability: 'subtitle.generate@1', params: {} }] };
      return { kind: 'instruction', steps: /字幕/.test(text) ? [transform,
        { capability: 'video.color.adjust@1', range: { start: 1, end: 3 }, params: { brightness: 0.2 } },
        { capability: 'subtitle.generate@1', params: {} }] : [transform] };
    }
    if (process.env.SRT_E2E_EFFECT_RESULT === 'texture-transactions-success') {
      if (/下一步/.test(text)) return { kind: 'clarify', message: '请说明下一步编辑。' };
      const color = { capability: 'video.color.adjust@1', range: { start: 0, end: 3 },
        params: { brightness: 0.1 } };
      const noise = { capability: 'video.noise@1', range: { start: 0, end: 3 }, params: { amount: 0.6 } };
      const vignette = { capability: 'video.vignette@1', range: { start: 1, end: 3 }, params: { strength: 0.8 } };
      if (/错误第二步/.test(text)) return { kind: 'instruction', steps: [noise,
        { capability: 'video.vignette@1', params: { strength: 2 } }] };
      if (/仅字幕/.test(text)) return { kind: 'instruction', steps: [{ capability: 'subtitle.generate@1', params: {} }] };
      if (/新增矩形/.test(text)) return { kind: 'instruction', steps: [{ capability: 'visual.shape@1',
        range: { start: 0, end: 3 }, params: { x: .2, y: .2, width: .4, height: .4, color: '#12CC56' } }] };
      if (/新增文字/.test(text)) return { kind: 'instruction', steps: [{ capability: 'visual.text@1',
        range: { start: 0, end: 3 }, params: { text: '纹理之上', x: .1, y: .1, fontSize: .08 } }] };
      return { kind: 'instruction', steps: [color, noise, vignette] };
    }
    if (process.env.SRT_E2E_EFFECT_RESULT === 'group-transactions-success') {
      if (/下一步/.test(text)) return { kind: 'clarify', message: '请说明下一步编辑。' };
      if (/修改已有/.test(text)) return { kind: 'clarify', message: '当前能力未接通原位修改已有图层；只能新增组合。' };
      const group = { capability: 'visual.group@1', range: { start: 1, end: 3.5 }, params: {
        layers: [
          { kind: 'shape', params: { x: .2, y: .2, width: .5, height: .5, color: '#CC3322' } },
          { kind: 'text', params: { text: '重点', x: .25, y: .3, fontSize: .08, color: '#FFFFFF' } },
          { kind: 'text', params: { text: 'MMMMMMMM\nMMMMMMMM', x: .9, y: .8, fontSize: .2, color: '#11CC33' } }
        ], pivotX: .5, pivotY: .5,
        opacity: { keyframes: [{ time: 0, value: 0 }, { time: 1, value: 1 }] },
        scale: { keyframes: [{ time: 0, value: .5 }, { time: 1, value: 1, easing: 'back-out' }] }
      } };
      const second = { capability: 'visual.group@1', range: { start: 2, end: 4 }, params: {
        layers: [
          { kind: 'shape', params: { x: .4, y: .4, width: .25, height: .25, color: '#2244CC' } },
          { kind: 'text', params: { text: '上层', x: .42, y: .42, fontSize: .06 } }
        ]
      } };
      if (/错误第二步/.test(text)) return { kind: 'instruction', steps: [group,
        { ...second, params: { ...second.params, scale: { keyframes: [{ time: 0, value: 1 }, { time: 0, value: 2 }] } } }] };
      if (/仅字幕/.test(text)) return { kind: 'instruction', steps: [{ capability: 'subtitle.generate@1', params: {} }] };
      return { kind: 'instruction', steps: /新增/.test(text) ? [second] : /两个/.test(text) ? [group, second] : [group] };
    }
    if (process.env.SRT_E2E_EFFECT_RESULT === 'layer-transactions-success') {
      if (/下一步/.test(text)) return { kind: 'clarify', message: '请说明下一步编辑。' };
      const first = [
        { capability: 'visual.shape@1', range: { start: 1, end: 3 },
          params: { x: .1, y: .1, width: .4, height: .25, color: '#112233' } },
        { capability: 'visual.text@1', range: { start: 1, end: 3 },
          params: { text: '<b>第一张</b>', x: .12, y: .12, fontSize: .08, color: '#FFFFFF' } }
      ];
      if (/错误第二步/.test(text)) return { kind: 'instruction', steps: [first[0],
        { capability: 'visual.text@1', range: { start: 1, end: 3 }, params: { text: '   ' } }] };
      if (/仅字幕/.test(text)) return { kind: 'instruction', steps: [{ capability: 'subtitle.generate@1', params: {} }] };
      return { kind: 'instruction', steps: first.concat([
        { capability: 'visual.shape@1', range: { start: 2, end: 4 },
          params: { x: .3, y: .3, width: .4, height: .25, color: '#CC3322' } },
        { capability: 'visual.text@1', range: { start: 2, end: 4 },
          params: { text: '第二张', x: .32, y: .32, fontSize: .08, color: '#FFFFFF' } }
      ]) };
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
      if (['color-transactions-success', 'transform-transactions-success', 'texture-transactions-success', 'layer-transactions-success', 'group-transactions-success'].includes(process.env.SRT_E2E_EFFECT_RESULT)) {
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
