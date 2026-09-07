const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('srtAPI', {
  getPathForFile: (file) => webUtils.getPathForFile(file),
  openVideo: () => ipcRenderer.invoke('dialog:openVideo'),
  execCommand: (cmd, timeout) => ipcRenderer.invoke('cli:exec', cmd, timeout),
  detectEnvironment: () => ipcRenderer.invoke('environment:detect'),
  getLocalCliState: () => ipcRenderer.invoke('local-cli:get-state'),
  rescanLocalCli: () => ipcRenderer.invoke('local-cli:rescan'),
  selectLocalCli: (id) => ipcRenderer.invoke('local-cli:select', id),
  translateInstruction: (text, history, context) =>
    ipcRenderer.invoke('local-cli:translate-instruction', { text, history, context }),
  generateSubtitles: (request) => ipcRenderer.invoke('subtitles:generate', request),
  resolveVideoSource: (videoPath) => ipcRenderer.invoke('video:resolve-source', videoPath),
  startVideoExport: (request) => ipcRenderer.invoke('video-export:start', request),
  cancelVideoExport: (jobId) => ipcRenderer.invoke('video-export:cancel', jobId),
  onVideoExportProgress: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('video-export:progress', listener);
    return () => ipcRenderer.removeListener('video-export:progress', listener);
  },
  describeInstall: (toolId) => ipcRenderer.invoke('installation:describe', toolId),
  installTool: (toolId, confirmationId) => ipcRenderer.invoke(
    'installation:execute',
    { toolId, confirmationId }
  ),
  queryAIConfig: () => ipcRenderer.invoke('ai:config:query'),
  detectOllama: () => ipcRenderer.invoke('ai:ollama:detect'),
  translateCloud: (text, provider, key, endpoint, model) =>
    ipcRenderer.invoke('ai:translate:cloud', text, provider, key, endpoint, model),
  translateOllama: (text, model) =>
    ipcRenderer.invoke('ai:translate:ollama', text, model),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onDownloadProgress: (callback) => {
    ipcRenderer.on('download:progress', (_event, data) => callback(data));
  }
});
