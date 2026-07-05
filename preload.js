const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('srtAPI', {
  openVideo: () => ipcRenderer.invoke('dialog:openVideo'),
  execCommand: (cmd, timeout) => ipcRenderer.invoke('cli:exec', cmd, timeout),
  installTool: (tool) => ipcRenderer.invoke('tools:install', tool),
  queryBundledTools: () => ipcRenderer.invoke('tools:queryBundled'),
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
