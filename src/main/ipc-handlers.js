import { app, ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

// --- Mock data for Phase 3 ---

const dockerStatus = {
  installed: true,
  running: true,
  version: '24.0.0-mock',
  platform: process.platform,
}

/** @type {import('../shared/types').ModuleInfo[]} */
let modules = [
  {
    id: 'n8n',
    name: 'n8n',
    description: '工作流自动化与编排引擎',
    category: 'core',
    enabled: true,
    status: 'running',
    port: 5678,
    webUrl: 'http://localhost:5678',
    tags: ['workflow'],
  },
  {
    id: 'dify',
    name: 'Dify',
    description: 'AI 应用与工作流开发平台',
    category: 'feature',
    enabled: true,
    status: 'stopped',
    port: 8081,
    webUrl: null,
    tags: ['app'],
  },
  {
    id: 'oneapi',
    name: 'OneAPI',
    description: '统一 AI API 网关与配额管理',
    category: 'core',
    enabled: true,
    status: 'running',
    port: 3000,
    webUrl: 'http://localhost:3000',
    tags: ['gateway'],
  },
  {
    id: 'ragflow',
    name: 'RagFlow',
    description: 'RAG 知识库问答与文档检索系统',
    category: 'feature',
    enabled: true,
    status: 'error',
    port: 9500,
    webUrl: null,
    tags: ['rag'],
  },
]

/** @type {import('../shared/types').AppSettings} */
const defaultAppSettings = {
  systemName: 'AI-Server 管理平台',
  language: 'auto',
  logLevel: 'info',
  autoStartOnBoot: false,
  docker: {
    mirrorUrls: ['https://registry.docker-cn.com'],
    proxy: {
      proxyMode: 'direct',
      proxyHost: '',
      proxyPort: null,
    },
  },
  modules: {
    n8n: {
      enabled: true,
      port: 5678,
      databaseUrl: '',
      env: {},
    },
    dify: {
      enabled: true,
      port: 8081,
      databaseUrl: '',
      env: {},
    },
    oneapi: {
      enabled: true,
      port: 3000,
      databaseUrl: '',
      env: {},
    },
    ragflow: {
      enabled: true,
      port: 9500,
      databaseUrl: '',
      env: {},
    },
  },
}

let appSettings = defaultAppSettings

function getSettingsFilePath() {
  const userDataDir = app.getPath('userData')
  return path.join(userDataDir, 'settings.json')
}

function loadSettingsFromDisk() {
  try {
    const filePath = getSettingsFilePath()
    if (!fs.existsSync(filePath)) {
      return null
    }
    const raw = fs.readFileSync(filePath, 'utf-8')
    if (!raw.trim()) {
      return null
    }
    const parsed = JSON.parse(raw)
    return parsed
  } catch {
    return null
  }
}

function saveSettingsToDisk(settings) {
  try {
    const filePath = getSettingsFilePath()
    const dir = path.dirname(filePath)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf-8')
  } catch {
  }
}

function mergeAppSettings(base, patch) {
  return {
    ...base,
    ...(patch ?? {}),
    docker: {
      ...base.docker,
      ...(patch?.docker ?? {}),
    },
    modules: {
      ...base.modules,
      ...(patch?.modules ?? {}),
    },
  }
}

/** @type {import('../shared/types').LogItem[]} */
const logs = [
  {
    id: 1,
    timestamp: '2025-09-16 19:22:10',
    level: 'info',
    module: 'client',
    service: 'ui-shell',
    message: '应用启动完成，用时 1324ms。',
  },
  {
    id: 2,
    timestamp: '2025-09-16 19:22:12',
    level: 'info',
    module: 'n8n',
    service: 'container-n8n',
    message: '容器启动，监听端口 5678。',
  },
  {
    id: 3,
    timestamp: '2025-09-16 19:22:20',
    level: 'warn',
    module: 'dify',
    service: 'container-dify',
    message: '检测到本地端口 8081 已被占用，尝试使用 8082。',
  },
  {
    id: 4,
    timestamp: '2025-09-16 19:22:35',
    level: 'error',
    module: 'ragflow',
    service: 'container-ragflow',
    message: '数据库连接失败，请检查 RAG_FLOW_DB_URL 配置。',
  },
]

export function setupIpcHandlers() {
  const diskSettings = loadSettingsFromDisk()
  if (diskSettings) {
    appSettings = mergeAppSettings(defaultAppSettings, diskSettings)
  } else {
    appSettings = defaultAppSettings
  }

  // Docker status
  ipcMain.handle('docker:getStatus', async () => {
    return dockerStatus
  })

  // Modules
  ipcMain.handle('modules:list', async () => {
    return modules
  })

  ipcMain.handle('modules:start', async (_event, payload) => {
    
    const target = modules.find((m) => m.id === payload?.moduleId)
    if (!target) return { success: false, error: '模块不存在' }

    if (target.status === 'running' || target.status === 'starting') {
      return { success: true }
    }

    target.status = 'starting'

    setTimeout(() => {
      target.status = 'running'
    }, 1500)

    return { success: true }
  })

  ipcMain.handle('modules:stop', async (_event, payload) => {
    const target = modules.find((m) => m.id === payload?.moduleId)
    if (!target) return { success: false, error: '模块不存在' }

    if (target.status === 'stopped' || target.status === 'stopping') {
      return { success: true }
    }

    target.status = 'stopping'

    setTimeout(() => {
      target.status = 'stopped'
    }, 1500)

    return { success: true }
  })

  // Logs
  ipcMain.handle('logs:list', async (_event, payload) => {
    const moduleFilter = payload?.module ?? 'all'
    const levelFilter = payload?.level ?? 'all'
    const page = payload?.page ?? 1
    const pageSize = payload?.pageSize ?? 20

    let filtered = logs.slice()
    if (moduleFilter !== 'all') {
      filtered = filtered.filter((log) => log.module === moduleFilter)
    }
    if (levelFilter !== 'all') {
      filtered = filtered.filter((log) => log.level === levelFilter)
    }

    const total = filtered.length
    const start = (page - 1) * pageSize
    const items = filtered.slice(start, start + pageSize)

    return { items, total }
  })

  ipcMain.handle('logs:export', async () => {
    // 暂时不做真实导出，返回 mock 结果
    return { success: true, path: 'mock-logs.log' }
  })

  // Settings
  ipcMain.handle('settings:get', async () => {
    return appSettings
  })

  ipcMain.handle('settings:update', async (_event, patch) => {
    appSettings = mergeAppSettings(appSettings, patch)
    saveSettingsToDisk(appSettings)
    return appSettings
  })
}
