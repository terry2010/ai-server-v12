const { contextBridge, ipcRenderer } = require('electron')

const api = {
  ping: () => 'pong',

  getDockerStatus: () => ipcRenderer.invoke('docker:getStatus', {}),

  listModules: () => ipcRenderer.invoke('modules:list', {}),

  startModule: (moduleId) =>
    ipcRenderer.invoke('modules:start', {
      moduleId,
    }),

  stopModule: (moduleId) =>
    ipcRenderer.invoke('modules:stop', {
      moduleId,
    }),

  getLogs: (params = {}) =>
    ipcRenderer.invoke('logs:list', {
      module: params.module ?? 'all',
      level: params.level ?? 'all',
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 20,
    }),

  exportLogs: (params = {}) =>
    ipcRenderer.invoke('logs:export', {
      filename: params.filename,
      module: params.module,
      level: params.level,
    }),

  getSettings: () => ipcRenderer.invoke('settings:get', {}),

  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch ?? {}),
}

contextBridge.exposeInMainWorld('api', api)
