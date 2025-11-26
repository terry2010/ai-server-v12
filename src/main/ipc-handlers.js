import { app, ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import Docker from 'dockerode'

// --- Docker status (real detection) + mock data for Phase 3 (modules & logs) ---

const execAsync = promisify(exec)

let dockerClient = null

function getDockerClient() {
  if (!dockerClient) {
    if (process.platform === 'win32') {
      dockerClient = new Docker({
        socketPath: '//./pipe/docker_engine',
      })
    } else {
      dockerClient = new Docker({
        socketPath: '/var/run/docker.sock',
      })
    }
  }
  return dockerClient
}

/**
 * @returns {Promise<import('../shared/types').DockerStatus>}
 */
async function detectDockerStatus() {
  try {
    const docker = getDockerClient()
    const versionInfo = await docker.version()

    const version =
      (versionInfo && (versionInfo.Version || versionInfo.version)) || undefined

    return {
      installed: true,
      running: true,
      version,
      platform: process.platform,
    }
  } catch (error) {
    // dockerode 无法连接到 Docker 引擎时的处理
    if (process.platform !== 'win32') {
      return {
        installed: false,
        running: false,
        error: '未检测到 Docker 守护进程，请确认已在本机安装并运行 Docker。',
        platform: process.platform,
      }
    }

    let dockerDesktopProcessRunning = false
    let dockerDesktopInstalled = false

    // Windows: 检查 Docker Desktop 进程是否存在（判断是否正在启动中）
    try {
      const { stdout: taskListOut } = await execAsync(
        'tasklist /FI "IMAGENAME eq Docker Desktop.exe" /FI "IMAGENAME eq com.docker.backend.exe" /FO CSV /NH',
        { shell: 'cmd.exe' },
      )
      const out = (taskListOut || '').toString().trim()

      if (out && !out.toLowerCase().startsWith('info: no tasks')) {
        dockerDesktopProcessRunning = true
      }
    } catch {
      dockerDesktopProcessRunning = false
    }

    // Windows: 通过快捷方式 / 默认安装路径判断是否安装了 Docker Desktop
    const programData = process.env.ProgramData || 'C:\\ProgramData'
    const appData = process.env.APPDATA

    /** @type {string[]} */
    const candidates = []

    candidates.push(
      path.join(programData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Docker', 'Docker Desktop.lnk'),
    )
    if (appData) {
      candidates.push(
        path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Docker Desktop.lnk'),
      )
      candidates.push(
        path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Docker', 'Docker Desktop.lnk'),
      )
    }

    candidates.push(
      'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe',
      'C:\\Program Files (x86)\\Docker\\Docker\\Docker Desktop.exe',
    )

    dockerDesktopInstalled = candidates.some((p) => {
      try {
        return fs.existsSync(p)
      } catch {
        return false
      }
    })

    if (!dockerDesktopInstalled) {
      return {
        installed: false,
        running: false,
        error: '未检测到 Docker Desktop 安装，请先安装 Docker Desktop。',
        platform: process.platform,
      }
    }

    return {
      installed: true,
      running: false,
      error: dockerDesktopProcessRunning
        ? 'Docker Desktop 正在启动中，Docker 守护进程尚未就绪…'
        : 'Docker 已安装但当前未运行，或无法连接到 Docker 守护进程。',
      platform: process.platform,
    }
  }
}

/**
 * @returns {Promise<{ success: boolean; error?: string }>}
 */
async function startDockerDesktop() {
  const platform = process.platform

  if (platform === 'win32') {
    const programData = process.env.ProgramData || 'C:\\ProgramData'
    const appData = process.env.APPDATA

    /** @type {string[]} */
    const candidates = []

    // Start Menu shortcuts (优先使用 .lnk，兼容自定义安装路径)
    candidates.push(
      path.join(programData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Docker', 'Docker Desktop.lnk'),
    )
    if (appData) {
      candidates.push(
        path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Docker Desktop.lnk'),
      )
      candidates.push(
        path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Docker', 'Docker Desktop.lnk'),
      )
    }

    // 常见默认安装路径（如果用户没有改安装目录）
    candidates.push(
      'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe',
      'C:\\Program Files (x86)\\Docker\\Docker\\Docker Desktop.exe',
    )

    const targetPath = candidates.find((p) => {
      try {
        return fs.existsSync(p)
      } catch {
        return false
      }
    })

    try {
      if (targetPath) {
        await execAsync(`start "" "${targetPath}"`, { shell: 'cmd.exe' })
        return { success: true }
      }

      // 最后兜底：尝试通过名称启动（依赖系统关联/快捷方式），可能并不总是成功
      await execAsync('start "" "Docker Desktop"', { shell: 'cmd.exe' })
      return { success: true }
    } catch (error) {
      const message = error && error.message ? error.message : String(error)
      return {
        success: false,
        error: `无法启动 Docker Desktop：${message}`,
      }
    }
  }

  return {
    success: false,
    error: '当前平台暂未实现一键启动 Docker。',
  }
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
      proxyMode: 'system',
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
  debug: {
    showDebugTools: false,
    verboseLogging: false,
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
    debug: {
      ...base.debug,
      ...(patch?.debug ?? {}),
    },
    modules: {
      ...base.modules,
      ...(patch?.modules ?? {}),
    },
  }
}

function isVerboseLoggingEnabled() {
  return !!(appSettings && appSettings.debug && appSettings.debug.verboseLogging)
}

async function ensureDockerAvailableForDebug() {
  const status = await detectDockerStatus()
  if (!status.installed || !status.running) {
    return {
      ok: false,
      errorResult: {
        success: false,
        error: status.error || 'Docker 未安装或未运行，无法执行调试操作。',
      },
    }
  }

  return { ok: true }
}

async function execDockerCommand(command) {
  if (isVerboseLoggingEnabled()) {
    console.log('[debug-docker] exec:', command)
  }

  const result = await execAsync(command)

  if (isVerboseLoggingEnabled()) {
    if (result.stdout) {
      console.log('[debug-docker] stdout:', String(result.stdout))
    }
    if (result.stderr) {
      console.log('[debug-docker] stderr:', String(result.stderr))
    }
  }

  return result
}

function buildDockerActionError(defaultMessage, error) {
  const anyErr = error
  let exitCode

  if (anyErr && typeof anyErr.code === 'number') {
    exitCode = anyErr.code
  }

  let stderrText = ''
  if (anyErr && typeof anyErr.stderr === 'string') {
    stderrText = anyErr.stderr
  } else if (anyErr && typeof anyErr.message === 'string') {
    stderrText = anyErr.message
  }

  const snippet = stderrText
    .split(/\r?\n/)
    .slice(0, 5)
    .join('\n')
    .trim()

  const message = snippet ? `${defaultMessage}：${snippet}` : defaultMessage

  return {
    success: false,
    error: message,
    exitCode,
    stderrSnippet: snippet || undefined,
  }
}

async function dockerStopAllContainers() {
  const check = await ensureDockerAvailableForDebug()
  if (!check.ok) {
    return check.errorResult
  }

  try {
    const docker = getDockerClient()
    const containers = await docker.listContainers({ all: true })

    if (!containers || containers.length === 0) {
      return { success: true }
    }

    await Promise.all(
      containers.map((info) =>
        docker
          .getContainer(info.Id)
          .stop()
          .catch(() => undefined),
      ),
    )

    return { success: true }
  } catch (error) {
    return buildDockerActionError('停止所有容器失败', error)
  }
}

async function dockerRemoveAllContainers() {
  const check = await ensureDockerAvailableForDebug()
  if (!check.ok) {
    return check.errorResult
  }

  try {
    const docker = getDockerClient()
    const containers = await docker.listContainers({ all: true })

    if (!containers || containers.length === 0) {
      return { success: true }
    }

    await Promise.all(
      containers.map((info) =>
        docker
          .getContainer(info.Id)
          .remove({ force: true })
          .catch(() => undefined),
      ),
    )

    return { success: true }
  } catch (error) {
    return buildDockerActionError('删除所有容器失败', error)
  }
}

async function dockerPruneVolumes() {
  const check = await ensureDockerAvailableForDebug()
  if (!check.ok) {
    return check.errorResult
  }

  try {
    const docker = getDockerClient()
    await docker.pruneVolumes()
    return { success: true }
  } catch (error) {
    return buildDockerActionError('清空所有数据卷失败', error)
  }
}

async function dockerFullCleanup() {
  const stopResult = await dockerStopAllContainers()
  if (!stopResult.success) {
    return {
      success: false,
      error: stopResult.error,
      exitCode: stopResult.exitCode,
      stderrSnippet: stopResult.stderrSnippet,
    }
  }

  const removeResult = await dockerRemoveAllContainers()
  if (!removeResult.success) {
    return {
      success: false,
      error: removeResult.error,
      exitCode: removeResult.exitCode,
      stderrSnippet: removeResult.stderrSnippet,
    }
  }

  const pruneResult = await dockerPruneVolumes()
  if (!pruneResult.success) {
    return {
      success: false,
      error: pruneResult.error,
      exitCode: pruneResult.exitCode,
      stderrSnippet: pruneResult.stderrSnippet,
    }
  }

  return { success: true }
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
    return detectDockerStatus()
  })

  ipcMain.handle('docker:startDesktop', async () => {
    return startDockerDesktop()
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

  ipcMain.handle('debug:dockerStopAll', async () => {
    return dockerStopAllContainers()
  })

  ipcMain.handle('debug:dockerRemoveAll', async () => {
    return dockerRemoveAllContainers()
  })

  ipcMain.handle('debug:dockerPruneVolumes', async () => {
    return dockerPruneVolumes()
  })

  ipcMain.handle('debug:dockerFullCleanup', async () => {
    return dockerFullCleanup()
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
