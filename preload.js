const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('srtAPI', {
  getPathForFile: (file) => webUtils.getPathForFile(file),
  openVideo: () => ipcRenderer.invoke('dialog:openVideo'),
  execCommand: (cmd, timeout) => ipcRenderer.invoke('cli:exec', cmd, timeout),
  detectEnvironment: () => ipcRenderer.invoke('environment:detect'),
  getLocalCliState: () => ipcRenderer.invoke('local-cli:get-state'),
  rescanLocalCli: () => ipcRenderer.invoke('local-cli:rescan'),
  selectLocalCli: (id) => ipcRenderer.invoke('local-cli:select', id),
  translateLocalCliEffect: (text) => ipcRenderer.invoke('local-cli:translate-effect', text),
  translateSubtitleOrFadeIn: (text) => ipcRenderer.invoke('local-cli:translate-subtitle-or-fade-in', text),
  generateSubtitles: (request) => ipcRenderer.invoke('subtitles:generate', request),
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
