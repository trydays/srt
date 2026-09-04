const { app } = require('electron');
const userDataDir = process.env.SRT_E2E_USER_DATA;
if (!userDataDir) throw new Error('SRT_E2E_USER_DATA is required');
app.setPath('userData', userDataDir);

const { createEnvironmentModule } = require('../../src/environment');
const { startApplication } = require('../../main');
const { dependencies, state } = require('./scenario-dependencies')
  .createScenarioDependencies(process.env.SRT_E2E_SCENARIO);
const environmentModule = createEnvironmentModule({ ...dependencies, targetPath: userDataDir, userDataDir });
app.__srtE2EState = state;
startApplication({ environmentModule });
