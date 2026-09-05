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
  }
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
  }
};
app.__srtE2EState = state;
startApplication({ environmentModule, localCliService });
