import { app, ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import crypto from 'node:crypto'
import http from 'node:http'
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

/** @type {Record<import('../shared/types').ModuleId, { containerNames: string[] }>}*/
const moduleDockerConfig = {
  n8n: { containerNames: ['ai-server-n8n', 'n8n'] },
  dify: { containerNames: ['ai-server-dify', 'dify'] },
  oneapi: { containerNames: ['ai-server-oneapi', 'oneapi'] },
  ragflow: { containerNames: ['ai-server-ragflow', 'ragflow'] },
}

const moduleImageMap = {
  n8n: 'docker.n8n.io/n8nio/n8n',
  oneapi: 'docker.io/justsong/one-api:latest',
}

const MANAGED_NETWORK_NAME = 'ai-server-net'
const N8N_DB_IMAGE = 'postgres:16'
const N8N_DB_CONTAINER_NAME = 'ai-server-postgres'
const N8N_DATA_VOLUME_NAME = 'ai-server-n8n-data'
const N8N_DB_VOLUME_NAME = 'ai-server-postgres-data'
const MYSQL_DB_IMAGE = 'mysql:8.2.0'
const MYSQL_DB_CONTAINER_NAME = 'ai-server-mysql'
const MYSQL_DB_VOLUME_NAME = 'ai-server-mysql-data'
const ONEAPI_DATA_VOLUME_NAME = 'ai-server-oneapi-data'
const REDIS_IMAGE = 'redis:latest'
const REDIS_CONTAINER_NAME = 'ai-server-redis'
const REDIS_DATA_VOLUME_NAME = 'ai-server-redis-data'

const moduleBaseServiceContainers = {
  n8n: [N8N_DB_CONTAINER_NAME],
  oneapi: [MYSQL_DB_CONTAINER_NAME, REDIS_CONTAINER_NAME],
}

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

function generateRandomPassword(length) {
  const size = Math.max(16, length)
  return crypto.randomBytes(size).toString('hex').slice(0, length)
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getMirrorPrefixesFromSettings() {
  const mirrors =
    (appSettings &&
      appSettings.docker &&
      Array.isArray(appSettings.docker.mirrorUrls)
      ? appSettings.docker.mirrorUrls
      : []) || []

  const result = []

  for (const raw of mirrors) {
    if (!raw || typeof raw !== 'string') continue
    let value = raw.trim()
    if (!value) continue

    try {
      if (value.startsWith('http://') || value.startsWith('https://')) {
        const url = new URL(value)
        const path = url.pathname.replace(/\/+$/, '')
        const hostAndPath = path ? `${url.host}${path}` : url.host
        if (hostAndPath) {
          result.push(hostAndPath)
        }
      } else {
        value = value.replace(/^[\/]+/, '').replace(/\/+$/, '')
        if (value) {
          result.push(value)
        }
      }
    } catch {
      const sanitized = value.replace(/^[a-z]+:\/\//i, '').replace(/\/+$/, '')
      if (sanitized) {
        result.push(sanitized)
      }
    }
  }

  return Array.from(new Set(result))
}

function splitImageName(image) {
  const trimmed = (image || '').trim()
  if (!trimmed) {
    return { pathWithTag: '' }
  }

  const lastSlash = trimmed.lastIndexOf('/')
  const lastColon = trimmed.lastIndexOf(':')
  let namePart = trimmed
  let tagPart = ''

  if (lastColon > -1 && lastColon > lastSlash) {
    namePart = trimmed.slice(0, lastColon)
    tagPart = trimmed.slice(lastColon)
  }

  const firstSlash = namePart.indexOf('/')
  let pathPart = namePart
  if (firstSlash > 0) {
    pathPart = namePart.slice(firstSlash + 1)
  }

  return { pathWithTag: `${pathPart}${tagPart}` }
}

function buildImageCandidates(image) {
  const candidates = []
  const mirrors = getMirrorPrefixesFromSettings()
  const split = splitImageName(image)
  const pathWithTag = split.pathWithTag

  if (pathWithTag) {
    for (const prefix of mirrors) {
      if (!prefix) continue
      candidates.push(`${prefix}/${pathWithTag}`)
    }
  }

  if (image && !candidates.includes(image)) {
    candidates.push(image)
  }

  return candidates
}

async function resolveLocalImageReference(image) {
  const candidates = buildImageCandidates(image)
  if (candidates.length === 0) {
    return image
  }

  try {
    if (isVerboseLoggingEnabled()) {
      console.log('[modules] 尝试解析本地镜像引用', { image, candidates })
    }

    const docker = getDockerClient()
    const images = await docker.listImages({
      filters: {
        reference: candidates,
      },
    })

    if (!Array.isArray(images) || images.length === 0) {
      if (isVerboseLoggingEnabled()) {
        console.log('[modules] 未在本地找到候选镜像', { image, candidates })
      }
      return image
    }

    if (isVerboseLoggingEnabled()) {
      const allTags = images
        .map((info) => (Array.isArray(info.RepoTags) ? info.RepoTags : []))
        .flat()
      console.log('[modules] 本地可用镜像标签', allTags)
    }

    for (const candidate of candidates) {
      const matched = images.find((info) => {
        const tags = Array.isArray(info.RepoTags) ? info.RepoTags : []
        return tags.some((tag) => {
          if (typeof tag !== 'string') return false
          if (tag === candidate) return true
          if (candidate && tag.startsWith(`${candidate}:`)) return true
          return false
        })
      })

      if (matched) {
        const tags = Array.isArray(matched.RepoTags) ? matched.RepoTags : []
        const exact =
          tags.find((tag) => tag === candidate) ||
          tags.find((tag) =>
            typeof tag === 'string' && candidate && tag.startsWith(`${candidate}:`),
          ) ||
          candidate

        if (isVerboseLoggingEnabled()) {
          console.log('[modules] 解析本地镜像引用成功', {
            image,
            candidate,
            resolved: exact,
            tags,
          })
        }

        return exact
      }
    }

    if (isVerboseLoggingEnabled()) {
      console.log('[modules] 未匹配到候选镜像标记，保持原始镜像引用', {
        image,
        candidates,
      })
    }

    return image
  } catch (error) {
    if (isVerboseLoggingEnabled()) {
      console.error('[modules] 解析本地镜像引用失败', error)
    }
    return image
  }
}

async function ensureNetworkExists() {
  const docker = getDockerClient()
  try {
    const networks = await docker.listNetworks({
      filters: {
        name: [MANAGED_NETWORK_NAME],
      },
    })
    if (Array.isArray(networks) && networks.length > 0) {
      return
    }
  } catch (error) {
    if (isVerboseLoggingEnabled()) {
      console.error('[n8n] 检查网络失败', error)
    }
  }

  try {
    await docker.createNetwork({
      Name: MANAGED_NETWORK_NAME,
    })
  } catch (error) {
    if (isVerboseLoggingEnabled()) {
      console.error('[n8n] 创建网络失败', error)
    }
    throw error
  }
}

async function ensureVolumeExists(volumeName) {
  const docker = getDockerClient()
  try {
    const result = await docker.listVolumes({
      filters: {
        name: [volumeName],
      },
    })
    if (result && Array.isArray(result.Volumes) && result.Volumes.length > 0) {
      return
    }
  } catch (error) {
    if (isVerboseLoggingEnabled()) {
      console.error('[n8n] 检查数据卷失败', error)
    }
  }

  try {
    await docker.createVolume({
      Name: volumeName,
    })
  } catch (error) {
    if (isVerboseLoggingEnabled()) {
      console.error('[n8n] 创建数据卷失败', error)
    }
    throw error
  }
}

async function ensureImagePresent(image) {
  if (!image) {
    return { ok: true }
  }

  try {
    const docker = getDockerClient()
    const images = await docker.listImages({
      filters: {
        reference: buildImageCandidates(image),
      },
    })

    if (Array.isArray(images) && images.length > 0) {
      if (isVerboseLoggingEnabled()) {
        console.log('[modules] 镜像已存在，无需拉取', {
          image,
          candidates: buildImageCandidates(image),
        })
      }
      return { ok: true }
    }
  } catch (error) {
    if (isVerboseLoggingEnabled()) {
      console.error('[modules] 检查本地镜像失败', error)
    }
  }

  if (isVerboseLoggingEnabled()) {
    console.log('[modules] 本地未找到镜像，准备拉取', {
      image,
      candidates: buildImageCandidates(image),
    })
  }

  const result = await pullDockerImage(image)
  if (!result || !result.success) {
    if (isVerboseLoggingEnabled()) {
      console.error('[modules] 拉取镜像失败', {
        image,
        candidates: buildImageCandidates(image),
        result,
      })
    }
    return {
      ok: false,
      errorResult: {
        success: false,
        error: (result && result.error) || '拉取镜像失败，无法启动模块。',
      },
    }
  }

  if (isVerboseLoggingEnabled()) {
    console.log('[modules] 镜像拉取成功', {
      image,
      candidates: buildImageCandidates(image),
    })
  }

  return { ok: true }
}

async function ensureImagePresentForModule(moduleId) {
  const image = moduleImageMap[moduleId]
  return ensureImagePresent(image)
}

async function waitForN8nReady(port, timeoutMs = 60000, intervalMs = 1000) {
  const start = Date.now()

  while (true) {
    try {
      const result = await new Promise((resolve, reject) => {
        const req = http.request(
          {
            host: '127.0.0.1',
            port,
            path: '/',
            method: 'GET',
            timeout: 5000,
          },
          (res) => {
            let data = ''
            res.on('data', (chunk) => {
              data += chunk
            })
            res.on('end', () => {
              resolve({
                statusCode: res.statusCode || 0,
                body: data,
              })
            })
          },
        )

        req.on('error', (err) => {
          reject(err)
        })
        req.on('timeout', () => {
          req.destroy(new Error('Request timeout'))
        })
        req.end()
      })

      const statusCode = result.statusCode
      const body = typeof result.body === 'string' ? result.body : String(result.body || '')
      const startingUp = /n8n is starting up/i.test(body)

      if (statusCode >= 200 && statusCode < 300 && !startingUp) {
        if (isVerboseLoggingEnabled()) {
          console.log('[n8n] HTTP 就绪检查通过', { port, statusCode })
        }
        return
      }

      if (isVerboseLoggingEnabled()) {
        console.log('[n8n] HTTP 仍在启动中', {
          port,
          statusCode,
          startingUp,
        })
      }
    } catch (error) {
      if (isVerboseLoggingEnabled()) {
        console.log('[n8n] HTTP 就绪检查重试中', {
          port,
          error: String(error),
        })
      }
    }

    if (Date.now() - start >= timeoutMs) {
      throw new Error('n8n HTTP ready timeout')
    }

    await delay(intervalMs)
  }
}

async function ensureN8nPostgres() {
  const docker = getDockerClient()

  let volumeExists = false
  try {
    const volResult = await docker.listVolumes({
      filters: {
        name: [N8N_DB_VOLUME_NAME],
      },
    })
    if (volResult && Array.isArray(volResult.Volumes) && volResult.Volumes.length > 0) {
      volumeExists = true
    }
  } catch (error) {
    if (isVerboseLoggingEnabled()) {
      console.error('[n8n] 检查 Postgres 数据卷状态失败', error)
    }
  }

  if (isVerboseLoggingEnabled()) {
    console.log('[n8n] ensureN8nPostgres: checking existing Postgres 容器', {
      containerName: N8N_DB_CONTAINER_NAME,
      volume: N8N_DB_VOLUME_NAME,
      volumeExists,
    })
  }

  let containers
  try {
    containers = await docker.listContainers({
      all: true,
      filters: {
        name: [N8N_DB_CONTAINER_NAME],
      },
    })
  } catch (error) {
    const message = error && error.message ? error.message : String(error)
    return {
      success: false,
      error: `检查 n8n 依赖的 Postgres 容器失败：${message}`,
    }
  }

  if (Array.isArray(containers) && containers.length > 0) {
    const info = containers[0]
    const container = docker.getContainer(info.Id)

    if (isVerboseLoggingEnabled()) {
      console.log('[n8n] 复用已有 Postgres 容器', {
        containerName: N8N_DB_CONTAINER_NAME,
        state: info.State,
      })
    }

    let dbUser = 'n8n'
    let dbName = 'n8n'
    let dbPassword = 'n8n'

    try {
      const inspectInfo = await container.inspect()
      const envArr =
        inspectInfo &&
        inspectInfo.Config &&
        Array.isArray(inspectInfo.Config.Env)
          ? inspectInfo.Config.Env
          : []
      const envMap = {}
      for (const item of envArr) {
        if (typeof item === 'string') {
          const index = item.indexOf('=')
          if (index > 0) {
            const key = item.slice(0, index)
            const value = item.slice(index + 1)
            envMap[key] = value
          }
        }
      }
      if (envMap.POSTGRES_USER) dbUser = envMap.POSTGRES_USER
      if (envMap.POSTGRES_DB) dbName = envMap.POSTGRES_DB
      if (envMap.POSTGRES_PASSWORD) dbPassword = envMap.POSTGRES_PASSWORD
    } catch (error) {
      if (isVerboseLoggingEnabled()) {
        console.error('[n8n] 读取 Postgres 环境变量失败', error)
      }
    }

    try {
      await ensureNetworkExists()
      const network = docker.getNetwork(MANAGED_NETWORK_NAME)
      await network.connect({ Container: info.Id }).catch(() => undefined)
    } catch (error) {
      if (isVerboseLoggingEnabled()) {
        console.error('[n8n] 连接 Postgres 容器到网络失败', error)
      }
    }

    const state = String(info.State || '').toLowerCase()
    if (state !== 'running') {
      try {
        await container.start()
      } catch (error) {
        const message = error && error.message ? error.message : String(error)
        return {
          success: false,
          error: `启动 n8n 依赖的 Postgres 容器失败：${message}`,
        }
      }
    }

    if (isVerboseLoggingEnabled()) {
      console.log('[n8n] Postgres 容器已就绪', {
        host: N8N_DB_CONTAINER_NAME,
        database: dbName,
        user: dbUser,
      })
    }

    return {
      success: true,
      dbConfig: {
        host: N8N_DB_CONTAINER_NAME,
        port: 5432,
        database: dbName,
        user: dbUser,
        password: dbPassword,
      },
    }
  }

  if (volumeExists) {
    try {
      if (isVerboseLoggingEnabled()) {
        console.log('[n8n] 检测到无 Postgres 容器但存在数据卷，将删除孤立数据卷后重建数据库', {
          volume: N8N_DB_VOLUME_NAME,
        })
      }
      await docker.getVolume(N8N_DB_VOLUME_NAME).remove({ force: true })
      volumeExists = false
    } catch (error) {
      if (isVerboseLoggingEnabled()) {
        console.error('[n8n] 删除孤立 Postgres 数据卷失败，将尝试继续复用该数据卷', error)
      }
    }
  }

  await ensureVolumeExists(N8N_DB_VOLUME_NAME)

  const imageEnsure = await ensureImagePresent(N8N_DB_IMAGE)
  if (!imageEnsure.ok) {
    const message =
      imageEnsure.errorResult && imageEnsure.errorResult.error
        ? imageEnsure.errorResult.error
        : '拉取 Postgres 镜像失败，无法启动 n8n。'
    return {
      success: false,
      error: message,
    }
  }

  const dbUser = 'n8n'
  const dbName = 'n8n'
  const dbPassword = generateRandomPassword(24)

  try {
    await ensureNetworkExists()
    const imageRef = await resolveLocalImageReference(N8N_DB_IMAGE)
    if (isVerboseLoggingEnabled()) {
      console.log('[n8n] 准备创建新的 Postgres 容器', {
        containerName: N8N_DB_CONTAINER_NAME,
        imageRef,
        volume: N8N_DB_VOLUME_NAME,
      })
    }
    const container = await docker.createContainer({
      name: N8N_DB_CONTAINER_NAME,
      Image: imageRef,
      Env: [
        `POSTGRES_USER=${dbUser}`,
        `POSTGRES_PASSWORD=${dbPassword}`,
        `POSTGRES_DB=${dbName}`,
      ],
      HostConfig: {
        RestartPolicy: {
          Name: 'always',
        },
        Binds: [`${N8N_DB_VOLUME_NAME}:/var/lib/postgresql/data`],
      },
      NetworkingConfig: {
        EndpointsConfig: {
          [MANAGED_NETWORK_NAME]: {
            Aliases: [N8N_DB_CONTAINER_NAME],
          },
        },
      },
    })

    await container.start()

    if (isVerboseLoggingEnabled()) {
      console.log('[n8n] 新的 Postgres 容器创建并启动成功', {
        containerName: N8N_DB_CONTAINER_NAME,
        imageRef,
      })
    }

    return {
      success: true,
      dbConfig: {
        host: N8N_DB_CONTAINER_NAME,
        port: 5432,
        database: dbName,
        user: dbUser,
        password: dbPassword,
      },
    }
  } catch (error) {
    const message = error && error.message ? error.message : String(error)
    return {
      success: false,
      error: `创建 n8n 依赖的 Postgres 容器失败：${message}`,
    }
  }
}

async function ensureN8nContainer(dbConfig) {
  const docker = getDockerClient()
  const containerName =
    (moduleDockerConfig.n8n && moduleDockerConfig.n8n.containerNames[0]) ||
    'ai-server-n8n'

  if (isVerboseLoggingEnabled()) {
    console.log('[n8n] ensureN8nContainer: checking existing n8n 容器', {
      containerName,
    })
  }

  let containers
  try {
    containers = await docker.listContainers({
      all: true,
      filters: {
        name: [containerName],
      },
    })
  } catch (error) {
    const message = error && error.message ? error.message : String(error)
    return {
      success: false,
      error: `检查 n8n 容器失败：${message}`,
    }
  }

  if (Array.isArray(containers) && containers.length > 0) {
    const info = containers[0]
    const container = docker.getContainer(info.Id)

    try {
      await ensureNetworkExists()
      const network = docker.getNetwork(MANAGED_NETWORK_NAME)
      await network.connect({ Container: info.Id }).catch(() => undefined)
    } catch (error) {
      if (isVerboseLoggingEnabled()) {
        console.error('[n8n] 连接 n8n 容器到网络失败', error)
      }
    }

    const state = String(info.State || '').toLowerCase()
    if (state === 'running') {
      if (isVerboseLoggingEnabled()) {
        console.log('[n8n] n8n 容器已在运行中，无需重新启动', {
          containerName,
        })
      }
      return { success: true }
    }

    try {
      await container.start()
      if (isVerboseLoggingEnabled()) {
        console.log('[n8n] 已启动已有 n8n 容器', {
          containerName,
        })
      }
      return { success: true }
    } catch (error) {
      const message = error && error.message ? error.message : String(error)
      return {
        success: false,
        error: `启动 n8n 容器失败：${message}`,
      }
    }
  }

  await ensureNetworkExists()
  await ensureVolumeExists(N8N_DATA_VOLUME_NAME)

  const exposedPortKey = '5678/tcp'
  const basePort =
    (appSettings &&
      appSettings.modules &&
      appSettings.modules.n8n &&
      appSettings.modules.n8n.port) ||
    defaultAppSettings.modules.n8n.port
  const env = [
    'DB_TYPE=postgresdb',
    `DB_POSTGRESDB_HOST=${dbConfig.host}`,
    `DB_POSTGRESDB_PORT=${dbConfig.port}`,
    `DB_POSTGRESDB_DATABASE=${dbConfig.database}`,
    `DB_POSTGRESDB_USER=${dbConfig.user}`,
    `DB_POSTGRESDB_PASSWORD=${dbConfig.password}`,
    'N8N_PORT=5678',
  ]

  const extraEnv =
    (appSettings &&
      appSettings.modules &&
      appSettings.modules.n8n &&
      appSettings.modules.n8n.env) ||
    {}
  for (const key of Object.keys(extraEnv)) {
    const value = extraEnv[key]
    if (typeof value === 'string') {
      env.push(`${key}=${value}`)
    }
  }

  try {
    const imageRef = await resolveLocalImageReference(moduleImageMap.n8n)
    if (isVerboseLoggingEnabled()) {
      console.log('[n8n] 准备创建新的 n8n 容器', {
        containerName,
        imageRef,
        basePort,
      })
    }
    const container = await docker.createContainer({
      name: containerName,
      Image: imageRef,
      Env: env,
      ExposedPorts: {
        [exposedPortKey]: {},
      },
      HostConfig: {
        RestartPolicy: {
          Name: 'always',
        },
        PortBindings: {
          [exposedPortKey]: [
            {
              HostPort: String(basePort),
            },
          ],
        },
        Binds: [`${N8N_DATA_VOLUME_NAME}:/home/node/.n8n`],
      },
      NetworkingConfig: {
        EndpointsConfig: {
          [MANAGED_NETWORK_NAME]: {
            Aliases: [containerName],
          },
        },
      },
    })

    await container.start()

    if (isVerboseLoggingEnabled()) {
      console.log('[n8n] 新的 n8n 容器创建并启动成功', {
        containerName,
        imageRef,
        hostPort: basePort,
      })
    }

    return { success: true }
  } catch (error) {
    const message = error && error.message ? error.message : String(error)
    if (isVerboseLoggingEnabled()) {
      console.error('[n8n] 创建 n8n 容器失败', error)
    }
    return {
      success: false,
      error: `创建 n8n 容器失败：${message}`,
    }
  }
}

async function ensureN8nRuntime() {
  if (isVerboseLoggingEnabled()) {
    console.log('[n8n] ensureN8nRuntime: start')
  }

  const dbResult = await ensureN8nPostgres()
  if (!dbResult || !dbResult.success) {
    if (isVerboseLoggingEnabled()) {
      console.error('[n8n] ensureN8nRuntime: Postgres 准备失败', dbResult && dbResult.error)
    }
    return {
      success: false,
      error: (dbResult && dbResult.error) || '启动 n8n 依赖的数据库失败。',
    }
  }

  if (isVerboseLoggingEnabled()) {
    console.log('[n8n] ensureN8nRuntime: Postgres 就绪，准备确保 n8n 容器')
  }

  const appResult = await ensureN8nContainer(dbResult.dbConfig)
  if (!appResult || !appResult.success) {
    if (isVerboseLoggingEnabled()) {
      console.error('[n8n] ensureN8nRuntime: n8n 容器启动失败', appResult && appResult.error)
    }
    return {
      success: false,
      error: (appResult && appResult.error) || '启动 n8n 容器失败。',
    }
  }

  const hostPort =
    (appSettings &&
      appSettings.modules &&
      appSettings.modules.n8n &&
      appSettings.modules.n8n.port) ||
    defaultAppSettings.modules.n8n.port

  try {
    if (isVerboseLoggingEnabled()) {
      console.log('[n8n] ensureN8nRuntime: n8n 容器已启动，开始 HTTP 就绪检查', {
        hostPort,
      })
    }

    await waitForN8nReady(hostPort)
  } catch (error) {
    if (isVerboseLoggingEnabled()) {
      console.error('[n8n] ensureN8nRuntime: n8n HTTP 就绪检查失败', error)
    }
    return {
      success: false,
      error: 'n8n 容器已启动，但在预期时间内未完成初始化，请检查 5678 端口页面或日志。',
    }
  }

  if (isVerboseLoggingEnabled()) {
    console.log('[n8n] ensureN8nRuntime: n8n 容器已就绪')
  }

  return { success: true }
}

async function ensureOneApiMysql() {
  const docker = getDockerClient()

  let volumeExists = false
  try {
    const volResult = await docker.listVolumes({
      filters: {
        name: [MYSQL_DB_VOLUME_NAME],
      },
    })
    if (volResult && Array.isArray(volResult.Volumes) && volResult.Volumes.length > 0) {
      volumeExists = true
    }
  } catch (error) {
    if (isVerboseLoggingEnabled()) {
      console.error('[oneapi] 检查 MySQL 数据卷状态失败', error)
    }
  }

  if (isVerboseLoggingEnabled()) {
    console.log('[oneapi] ensureOneApiMysql: checking existing MySQL 容器', {
      containerName: MYSQL_DB_CONTAINER_NAME,
      volume: MYSQL_DB_VOLUME_NAME,
      volumeExists,
    })
  }

  let containers
  try {
    containers = await docker.listContainers({
      all: true,
      filters: {
        name: [MYSQL_DB_CONTAINER_NAME],
      },
    })
  } catch (error) {
    const message = error && error.message ? error.message : String(error)
    return {
      success: false,
      error: `检查 OneAPI 依赖的 MySQL 容器失败：${message}`,
    }
  }

  if (Array.isArray(containers) && containers.length > 0) {
    const info = containers[0]
    const container = docker.getContainer(info.Id)

    let dbUser = 'oneapi'
    let dbName = 'one-api'
    let dbPassword = 'oneapi'

    try {
      const inspectInfo = await container.inspect()
      const envArr =
        inspectInfo &&
        inspectInfo.Config &&
        Array.isArray(inspectInfo.Config.Env)
          ? inspectInfo.Config.Env
          : []
      const envMap = {}
      for (const item of envArr) {
        if (typeof item === 'string') {
          const index = item.indexOf('=')
          if (index > 0) {
            const key = item.slice(0, index)
            const value = item.slice(index + 1)
            envMap[key] = value
          }
        }
      }
      if (envMap.MYSQL_USER) dbUser = envMap.MYSQL_USER
      if (envMap.MYSQL_DATABASE) dbName = envMap.MYSQL_DATABASE
      if (envMap.MYSQL_PASSWORD) dbPassword = envMap.MYSQL_PASSWORD
    } catch (error) {
      if (isVerboseLoggingEnabled()) {
        console.error('[oneapi] 读取 MySQL 环境变量失败', error)
      }
    }

    try {
      await ensureNetworkExists()
      const network = docker.getNetwork(MANAGED_NETWORK_NAME)
      await network.connect({ Container: info.Id }).catch(() => undefined)
    } catch (error) {
      if (isVerboseLoggingEnabled()) {
        console.error('[oneapi] 连接 MySQL 容器到网络失败', error)
      }
    }

    const state = String(info.State || '').toLowerCase()
    if (state !== 'running') {
      try {
        await container.start()
      } catch (error) {
        const message = error && error.message ? error.message : String(error)
        return {
          success: false,
          error: `启动 OneAPI 依赖的 MySQL 容器失败：${message}`,
        }
      }
    }

    if (isVerboseLoggingEnabled()) {
      console.log('[oneapi] MySQL 容器已就绪', {
        host: MYSQL_DB_CONTAINER_NAME,
        database: dbName,
        user: dbUser,
      })
    }

    return {
      success: true,
      dbConfig: {
        host: MYSQL_DB_CONTAINER_NAME,
        port: 3306,
        database: dbName,
        user: dbUser,
        password: dbPassword,
      },
    }
  }

  if (volumeExists) {
    try {
      if (isVerboseLoggingEnabled()) {
        console.log('[oneapi] 检测到无 MySQL 容器但存在数据卷，将删除孤立数据卷后重建数据库', {
          volume: MYSQL_DB_VOLUME_NAME,
        })
      }
      await docker.getVolume(MYSQL_DB_VOLUME_NAME).remove({ force: true })
      volumeExists = false
    } catch (error) {
      if (isVerboseLoggingEnabled()) {
        console.error('[oneapi] 删除孤立 MySQL 数据卷失败，将尝试继续复用该数据卷', error)
      }
    }
  }

  await ensureVolumeExists(MYSQL_DB_VOLUME_NAME)

  const imageEnsure = await ensureImagePresent(MYSQL_DB_IMAGE)
  if (!imageEnsure.ok) {
    const message =
      imageEnsure.errorResult && imageEnsure.errorResult.error
        ? imageEnsure.errorResult.error
        : '拉取 MySQL 镜像失败，无法启动 OneAPI。'
    return {
      success: false,
      error: message,
    }
  }

  const dbUser = 'oneapi'
  const dbName = 'one-api'
  const dbPassword = generateRandomPassword(24)

  try {
    await ensureNetworkExists()
    const imageRef = await resolveLocalImageReference(MYSQL_DB_IMAGE)
    if (isVerboseLoggingEnabled()) {
      console.log('[oneapi] 准备创建新的 MySQL 容器', {
        containerName: MYSQL_DB_CONTAINER_NAME,
        imageRef,
        volume: MYSQL_DB_VOLUME_NAME,
      })
    }
    const container = await docker.createContainer({
      name: MYSQL_DB_CONTAINER_NAME,
      Image: imageRef,
      Env: [
        `MYSQL_ROOT_PASSWORD=${generateRandomPassword(24)}`,
        `MYSQL_USER=${dbUser}`,
        `MYSQL_PASSWORD=${dbPassword}`,
        `MYSQL_DATABASE=${dbName}`,
        'TZ=Asia/Shanghai',
      ],
      HostConfig: {
        RestartPolicy: {
          Name: 'always',
        },
        Binds: [`${MYSQL_DB_VOLUME_NAME}:/var/lib/mysql`],
      },
      NetworkingConfig: {
        EndpointsConfig: {
          [MANAGED_NETWORK_NAME]: {
            Aliases: [MYSQL_DB_CONTAINER_NAME],
          },
        },
      },
    })

    await container.start()

    if (isVerboseLoggingEnabled()) {
      console.log('[oneapi] 新的 MySQL 容器创建并启动成功', {
        containerName: MYSQL_DB_CONTAINER_NAME,
        imageRef,
      })
    }

    return {
      success: true,
      dbConfig: {
        host: MYSQL_DB_CONTAINER_NAME,
        port: 3306,
        database: dbName,
        user: dbUser,
        password: dbPassword,
      },
    }
  } catch (error) {
    const message = error && error.message ? error.message : String(error)
    return {
      success: false,
      error: `创建 OneAPI 依赖的 MySQL 容器失败：${message}`,
    }
  }
}

async function ensureOneApiRedis() {
  const docker = getDockerClient()

  let volumeExists = false
  try {
    const volResult = await docker.listVolumes({
      filters: {
        name: [REDIS_DATA_VOLUME_NAME],
      },
    })
    if (volResult && Array.isArray(volResult.Volumes) && volResult.Volumes.length > 0) {
      volumeExists = true
    }
  } catch (error) {
    if (isVerboseLoggingEnabled()) {
      console.error('[oneapi] 检查 Redis 数据卷状态失败', error)
    }
  }

  if (isVerboseLoggingEnabled()) {
    console.log('[oneapi] ensureOneApiRedis: checking existing Redis 容器', {
      containerName: REDIS_CONTAINER_NAME,
      volume: REDIS_DATA_VOLUME_NAME,
      volumeExists,
    })
  }

  let containers
  try {
    containers = await docker.listContainers({
      all: true,
      filters: {
        name: [REDIS_CONTAINER_NAME],
      },
    })
  } catch (error) {
    const message = error && error.message ? error.message : String(error)
    return {
      success: false,
      error: `检查 OneAPI 依赖的 Redis 容器失败：${message}`,
    }
  }

  if (Array.isArray(containers) && containers.length > 0) {
    const info = containers[0]
    const container = docker.getContainer(info.Id)

    try {
      await ensureNetworkExists()
      const network = docker.getNetwork(MANAGED_NETWORK_NAME)
      await network.connect({ Container: info.Id }).catch(() => undefined)
    } catch (error) {
      if (isVerboseLoggingEnabled()) {
        console.error('[oneapi] 连接 Redis 容器到网络失败', error)
      }
    }

    const state = String(info.State || '').toLowerCase()
    if (state !== 'running') {
      try {
        await container.start()
      } catch (error) {
        const message = error && error.message ? error.message : String(error)
        return {
          success: false,
          error: `启动 OneAPI 依赖的 Redis 容器失败：${message}`,
        }
      }
    }

    if (isVerboseLoggingEnabled()) {
      console.log('[oneapi] Redis 容器已就绪', {
        host: REDIS_CONTAINER_NAME,
        port: 6379,
      })
    }

    return {
      success: true,
      redisConfig: {
        host: REDIS_CONTAINER_NAME,
        port: 6379,
      },
    }
  }

  if (volumeExists) {
    try {
      if (isVerboseLoggingEnabled()) {
        console.log('[oneapi] 检测到无 Redis 容器但存在数据卷，将删除孤立数据卷后重建 Redis', {
          volume: REDIS_DATA_VOLUME_NAME,
        })
      }
      await docker.getVolume(REDIS_DATA_VOLUME_NAME).remove({ force: true })
      volumeExists = false
    } catch (error) {
      if (isVerboseLoggingEnabled()) {
        console.error('[oneapi] 删除孤立 Redis 数据卷失败，将尝试继续复用该数据卷', error)
      }
    }
  }

  await ensureVolumeExists(REDIS_DATA_VOLUME_NAME)

  const imageEnsure = await ensureImagePresent(REDIS_IMAGE)
  if (!imageEnsure.ok) {
    const message =
      imageEnsure.errorResult && imageEnsure.errorResult.error
        ? imageEnsure.errorResult.error
        : '拉取 Redis 镜像失败，无法启动 OneAPI。'
    return {
      success: false,
      error: message,
    }
  }

  try {
    await ensureNetworkExists()
    const imageRef = await resolveLocalImageReference(REDIS_IMAGE)
    if (isVerboseLoggingEnabled()) {
      console.log('[oneapi] 准备创建新的 Redis 容器', {
        containerName: REDIS_CONTAINER_NAME,
        imageRef,
        volume: REDIS_DATA_VOLUME_NAME,
      })
    }
    const container = await docker.createContainer({
      name: REDIS_CONTAINER_NAME,
      Image: imageRef,
      HostConfig: {
        RestartPolicy: {
          Name: 'always',
        },
        Binds: [`${REDIS_DATA_VOLUME_NAME}:/data`],
      },
      NetworkingConfig: {
        EndpointsConfig: {
          [MANAGED_NETWORK_NAME]: {
            Aliases: [REDIS_CONTAINER_NAME],
          },
        },
      },
    })

    await container.start()

    if (isVerboseLoggingEnabled()) {
      console.log('[oneapi] 新的 Redis 容器创建并启动成功', {
        containerName: REDIS_CONTAINER_NAME,
        imageRef,
      })
    }

    return {
      success: true,
      redisConfig: {
        host: REDIS_CONTAINER_NAME,
        port: 6379,
      },
    }
  } catch (error) {
    const message = error && error.message ? error.message : String(error)
    return {
      success: false,
      error: `创建 OneAPI 依赖的 Redis 容器失败：${message}`,
    }
  }
}

async function ensureOneApiContainer(dbConfig, redisConfig) {
  const docker = getDockerClient()
  const containerName =
    (moduleDockerConfig.oneapi && moduleDockerConfig.oneapi.containerNames[0]) ||
    'ai-server-oneapi'

  if (isVerboseLoggingEnabled()) {
    console.log('[oneapi] ensureOneApiContainer: checking existing OneAPI 容器', {
      containerName,
    })
  }

  let containers
  try {
    containers = await docker.listContainers({
      all: true,
      filters: {
        name: [containerName],
      },
    })
  } catch (error) {
    const message = error && error.message ? error.message : String(error)
    return {
      success: false,
      error: `检查 OneAPI 容器失败：${message}`,
    }
  }

  if (Array.isArray(containers) && containers.length > 0) {
    const info = containers[0]
    const container = docker.getContainer(info.Id)

    try {
      await ensureNetworkExists()
      const network = docker.getNetwork(MANAGED_NETWORK_NAME)
      await network.connect({ Container: info.Id }).catch(() => undefined)
    } catch (error) {
      if (isVerboseLoggingEnabled()) {
        console.error('[oneapi] 连接 OneAPI 容器到网络失败', error)
      }
    }

    const state = String(info.State || '').toLowerCase()
    if (state === 'running') {
      if (isVerboseLoggingEnabled()) {
        console.log('[oneapi] OneAPI 容器已在运行中，无需重新启动', {
          containerName,
        })
      }
      return { success: true }
    }

    try {
      await container.start()
      if (isVerboseLoggingEnabled()) {
        console.log('[oneapi] 已启动已有 OneAPI 容器', {
          containerName,
        })
      }
      return { success: true }
    } catch (error) {
      const message = error && error.message ? error.message : String(error)
      return {
        success: false,
        error: `启动 OneAPI 容器失败：${message}`,
      }
    }
  }

  await ensureNetworkExists()
  await ensureVolumeExists(ONEAPI_DATA_VOLUME_NAME)

  const exposedPortKey = '3000/tcp'
  const basePort =
    (appSettings &&
      appSettings.modules &&
      appSettings.modules.oneapi &&
      appSettings.modules.oneapi.port) ||
    defaultAppSettings.modules.oneapi.port

  const dsn = `${dbConfig.user}:${dbConfig.password}@tcp(${dbConfig.host}:${
    dbConfig.port || 3306
  })/${dbConfig.database}`

  const redisHost =
    redisConfig && redisConfig.host ? redisConfig.host : REDIS_CONTAINER_NAME
  const redisPort = redisConfig && redisConfig.port ? redisConfig.port : 6379

  const env = [
    `SQL_DSN=${dsn}`,
    'TZ=Asia/Shanghai',
    `SESSION_SECRET=${generateRandomPassword(32)}`,
    `REDIS_CONN_STRING=redis://${redisHost}:${redisPort}`,
    'SYNC_FREQUENCY=60',
  ]

  const extraEnv =
    (appSettings &&
      appSettings.modules &&
      appSettings.modules.oneapi &&
      appSettings.modules.oneapi.env) ||
    {}
  for (const key of Object.keys(extraEnv)) {
    const value = extraEnv[key]
    if (typeof value === 'string') {
      env.push(`${key}=${value}`)
    }
  }

  try {
    const imageRef = await resolveLocalImageReference(moduleImageMap.oneapi)
    if (isVerboseLoggingEnabled()) {
      console.log('[oneapi] 准备创建新的 OneAPI 容器', {
        containerName,
        imageRef,
        basePort,
      })
    }
    const container = await docker.createContainer({
      name: containerName,
      Image: imageRef,
      Env: env,
      ExposedPorts: {
        [exposedPortKey]: {},
      },
      HostConfig: {
        RestartPolicy: {
          Name: 'always',
        },
        PortBindings: {
          [exposedPortKey]: [
            {
              HostPort: String(basePort),
            },
          ],
        },
        Binds: [`${ONEAPI_DATA_VOLUME_NAME}:/data`],
      },
      NetworkingConfig: {
        EndpointsConfig: {
          [MANAGED_NETWORK_NAME]: {
            Aliases: [containerName],
          },
        },
      },
    })

    await container.start()

    if (isVerboseLoggingEnabled()) {
      console.log('[oneapi] 新的 OneAPI 容器创建并启动成功', {
        containerName,
        imageRef,
        hostPort: basePort,
      })
    }

    return { success: true }
  } catch (error) {
    const message = error && error.message ? error.message : String(error)
    if (isVerboseLoggingEnabled()) {
      console.error('[oneapi] 创建 OneAPI 容器失败', error)
    }
    return {
      success: false,
      error: `创建 OneAPI 容器失败：${message}`,
    }
  }
}

async function waitForOneApiReady(port, timeoutMs = 60000, intervalMs = 2000) {
  const start = Date.now()

  while (true) {
    try {
      const result = await new Promise((resolve, reject) => {
        const req = http.request(
          {
            host: '127.0.0.1',
            port,
            path: '/api/status',
            method: 'GET',
            timeout: 5000,
          },
          (res) => {
            let data = ''
            res.on('data', (chunk) => {
              data += chunk
            })
            res.on('end', () => {
              resolve({
                statusCode: res.statusCode || 0,
                body: data,
              })
            })
          },
        )

        req.on('error', (err) => {
          reject(err)
        })
        req.on('timeout', () => {
          req.destroy(new Error('Request timeout'))
        })
        req.end()
      })

      const statusCode = result.statusCode
      const body = typeof result.body === 'string' ? result.body : String(result.body || '')
      const successMatch = /"success"\s*:\s*true/.test(body)

      if (statusCode >= 200 && statusCode < 300 && successMatch) {
        if (isVerboseLoggingEnabled()) {
          console.log('[oneapi] HTTP 就绪检查通过', { port, statusCode })
        }
        return
      }

      if (isVerboseLoggingEnabled()) {
        console.log('[oneapi] HTTP 仍在启动中', {
          port,
          statusCode,
          successMatch,
        })
      }
    } catch (error) {
      if (isVerboseLoggingEnabled()) {
        console.log('[oneapi] HTTP 就绪检查重试中', {
          port,
          error: String(error),
        })
      }
    }

    if (Date.now() - start >= timeoutMs) {
      throw new Error('OneAPI HTTP ready timeout')
    }

    await delay(intervalMs)
  }
}

async function ensureOneApiRuntime() {
  if (isVerboseLoggingEnabled()) {
    console.log('[oneapi] ensureOneApiRuntime: start')
  }

  const dbResult = await ensureOneApiMysql()
  if (!dbResult || !dbResult.success) {
    if (isVerboseLoggingEnabled()) {
      console.error('[oneapi] ensureOneApiRuntime: MySQL 准备失败', dbResult && dbResult.error)
    }
    return {
      success: false,
      error: (dbResult && dbResult.error) || '启动 OneAPI 依赖的数据库失败。',
    }
  }

  const redisResult = await ensureOneApiRedis()
  if (!redisResult || !redisResult.success) {
    if (isVerboseLoggingEnabled()) {
      console.error('[oneapi] ensureOneApiRuntime: Redis 准备失败', redisResult && redisResult.error)
    }
    return {
      success: false,
      error: (redisResult && redisResult.error) || '启动 OneAPI 依赖的 Redis 失败。',
    }
  }

  if (isVerboseLoggingEnabled()) {
    console.log('[oneapi] ensureOneApiRuntime: MySQL 和 Redis 就绪，准备确保 OneAPI 容器')
  }

  const appResult = await ensureOneApiContainer(dbResult.dbConfig, redisResult.redisConfig)
  if (!appResult || !appResult.success) {
    if (isVerboseLoggingEnabled()) {
      console.error('[oneapi] ensureOneApiRuntime: OneAPI 容器启动失败', appResult && appResult.error)
    }
    return {
      success: false,
      error: (appResult && appResult.error) || '启动 OneAPI 容器失败。',
    }
  }

  const hostPort =
    (appSettings &&
      appSettings.modules &&
      appSettings.modules.oneapi &&
      appSettings.modules.oneapi.port) ||
    defaultAppSettings.modules.oneapi.port

  try {
    if (isVerboseLoggingEnabled()) {
      console.log('[oneapi] ensureOneApiRuntime: OneAPI 容器已启动，开始 HTTP 就绪检查', {
        hostPort,
      })
    }

    await waitForOneApiReady(hostPort)
  } catch (error) {
    if (isVerboseLoggingEnabled()) {
      console.error('[oneapi] ensureOneApiRuntime: OneAPI HTTP 就绪检查失败', error)
    }
    return {
      success: false,
      error: 'OneAPI 容器已启动，但在预期时间内未完成初始化，请检查 3000 端口页面或日志。',
    }
  }

  if (isVerboseLoggingEnabled()) {
    console.log('[oneapi] ensureOneApiRuntime: OneAPI 容器已就绪')
  }

  return { success: true }
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
    const result = await docker.listVolumes()
    const volumes = result && Array.isArray(result.Volumes) ? result.Volumes : []

    const targets = volumes.filter((v) => {
      const name = v && typeof v.Name === 'string' ? v.Name : ''
      return name.startsWith('ai-server-')
    })

    if (isVerboseLoggingEnabled()) {
      console.log('[debug-docker] 准备删除数据卷', targets.map((v) => v.Name))
    }

    await Promise.all(
      targets.map((v) => {
        const name = v && typeof v.Name === 'string' ? v.Name : ''
        if (!name) return Promise.resolve()
        return docker
          .getVolume(name)
          .remove({ force: true })
          .catch((err) => {
            if (isVerboseLoggingEnabled()) {
              console.error('[debug-docker] 删除数据卷失败', name, err)
            }
            return undefined
          })
      }),
    )

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

/**
 * 使用 CLI 执行 docker pull，代理配置来源于 appSettings.docker.proxy
 * @param {string} image
 * @returns {Promise<import('../shared/types').DockerActionResult>}
 */
async function pullDockerImage(image) {
  if (!image || typeof image !== 'string') {
    return {
      success: false,
      error: '镜像名称不能为空。',
    }
  }

  const status = await detectDockerStatus()
  if (!status.installed || !status.running) {
    return {
      success: false,
      error: status.error || 'Docker 未安装或未运行，无法拉取镜像。',
    }
  }

  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env }

  const proxy = appSettings?.docker?.proxy
  const mode = proxy?.proxyMode ?? 'system'

  if (mode === 'direct') {
    delete env.HTTP_PROXY
    delete env.HTTPS_PROXY
  } else if (mode === 'manual') {
    const host = proxy?.proxyHost
    const port = proxy?.proxyPort
    if (!host || !port) {
      return {
        success: false,
        error: '已选择手动代理，但代理主机或端口未正确配置。',
      }
    }
    const addr = `http://${host}:${port}`
    env.HTTP_PROXY = addr
    env.HTTPS_PROXY = addr
  } else {
    // system: 保持现有环境变量，不做修改
  }

  const candidates = buildImageCandidates(image)

  if (isVerboseLoggingEnabled()) {
    console.log('[docker-pull] candidates:', candidates)
    console.log('[docker-pull] HTTP_PROXY:', env.HTTP_PROXY || '(none)')
    console.log('[docker-pull] HTTPS_PROXY:', env.HTTPS_PROXY || '(none)')
  }

  /** @type {unknown} */
  let lastError = null

  for (const ref of candidates) {
    const cmd = `docker pull ${ref}`

    if (isVerboseLoggingEnabled()) {
      console.log('[docker-pull] trying:', cmd)
    }

    try {
      const result = await execAsync(cmd, { env })

      if (isVerboseLoggingEnabled()) {
        if (result.stdout) {
          console.log('[docker-pull] stdout:', String(result.stdout))
        }
        if (result.stderr) {
          console.log('[docker-pull] stderr:', String(result.stderr))
        }
      }

      return { success: true }
    } catch (error) {
      lastError = error
      if (isVerboseLoggingEnabled()) {
        console.error('[docker-pull] failed for', ref, error)
      }
    }
  }

  if (lastError) {
    return buildDockerActionError(`拉取镜像失败 (${image})`, lastError)
  }

  return {
    success: false,
    error: `拉取镜像失败 (${image})` ,
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
    return detectDockerStatus()
  })

  ipcMain.handle('docker:startDesktop', async () => {
    return startDockerDesktop()
  })

  // Modules
  ipcMain.handle('modules:list', async () => {
    let containers = []
    try {
      const docker = getDockerClient()
      containers = await docker.listContainers({ all: true })
    } catch {
      // Docker 不可用时，将所有模块视为已停止
      return modules.map((m) => ({
        ...m,
        status: 'stopped',
      }))
    }

    return modules.map((m) => {
      const config = moduleDockerConfig[m.id]
      if (!config) {
        return {
          ...m,
          status: 'error',
        }
      }

      const info =
        containers.find((c) => {
          if (!Array.isArray(c.Names)) return false
          return c.Names.some((name) =>
            config.containerNames.some(
              (needle) => typeof name === 'string' && name.includes(needle),
            ),
          )
        }) || null

      if (!info) {
        return {
          ...m,
          status: 'stopped',
        }
      }

      const state = String(info.State || '').toLowerCase()
      /** @type {import('../shared/types').ModuleStatus} */
      let moduleStatus = 'stopped'
      if (state === 'running') moduleStatus = 'running'
      else if (state === 'restarting') moduleStatus = 'starting'
      else if (state === 'dead') moduleStatus = 'error'
      else moduleStatus = 'stopped'

      let port = m.port
      if (Array.isArray(info.Ports) && info.Ports.length > 0) {
        const withPublic = info.Ports.find((p) => typeof p.PublicPort === 'number')
        if (withPublic && typeof withPublic.PublicPort === 'number') {
          port = withPublic.PublicPort
        }
      }

      return {
        ...m,
        status: moduleStatus,
        port,
      }
    })
  })

  ipcMain.handle('modules:start', async (_event, payload) => {
    const moduleId = payload?.moduleId
    const config = moduleDockerConfig[moduleId]
    if (!moduleId || !config) {
      return { success: false, error: '模块不存在或未配置容器信息' }
    }

    const dockerStatus = await detectDockerStatus()
    if (!dockerStatus.installed || !dockerStatus.running) {
      return {
        success: false,
        error: dockerStatus.error || 'Docker 未安装或未运行，无法启动模块。',
      }
    }

    const ensureImageResult = await ensureImagePresentForModule(moduleId)
    if (!ensureImageResult.ok) {
      return ensureImageResult.errorResult
    }

    if (moduleId === 'n8n') {
      const runtimeResult = await ensureN8nRuntime()
      if (!runtimeResult || !runtimeResult.success) {
        return {
          success: false,
          error: (runtimeResult && runtimeResult.error) || '启动 n8n 运行环境失败。',
        }
      }

      return { success: true }
    }

    if (moduleId === 'oneapi') {
      const runtimeResult = await ensureOneApiRuntime()
      if (!runtimeResult || !runtimeResult.success) {
        return {
          success: false,
          error: (runtimeResult && runtimeResult.error) || '启动 OneAPI 运行环境失败。',
        }
      }

      return { success: true }
    }

    try {
      const docker = getDockerClient()
      const containers = await docker.listContainers({
        all: true,
        filters: {
          name: config.containerNames,
        },
      })

      if (!containers || containers.length === 0) {
        return {
          success: false,
          error: '未找到对应模块容器，请先通过 docker-compose 或其他方式创建容器。',
        }
      }

      const info = containers[0]
      const state = String(info.State || '').toLowerCase()
      if (state === 'running') {
        return { success: true }
      }

      const container = docker.getContainer(info.Id)
      await container.start()

      return { success: true }
    } catch (error) {
      const message =
        (error && error.message) || (typeof error === 'string' ? error : '启动模块失败')
      return {
        success: false,
        error: `启动模块失败：${message}`,
      }
    }
  })

  ipcMain.handle('modules:stop', async (_event, payload) => {
    const moduleId = payload?.moduleId
    const config = moduleDockerConfig[moduleId]
    if (!moduleId || !config) {
      return { success: false, error: '模块不存在或未配置容器信息' }
    }

    const dockerStatus = await detectDockerStatus()
    if (!dockerStatus.installed || !dockerStatus.running) {
      return {
        success: false,
        error: dockerStatus.error || 'Docker 未安装或未运行，无法停止模块。',
      }
    }

    try {
      const docker = getDockerClient()
      const containers = await docker.listContainers({
        all: true,
        filters: {
          name: config.containerNames,
        },
      })

      if (!containers || containers.length === 0) {
        return {
          success: false,
          error: '未找到对应模块容器，请确认容器是否已经创建。',
        }
      }

      const info = containers[0]
      const state = String(info.State || '').toLowerCase()
      if (state !== 'running') {
        await maybeStopBaseServicesForModule(moduleId, docker)
        return { success: true }
      }

      const container = docker.getContainer(info.Id)
      await container.stop()

      await maybeStopBaseServicesForModule(moduleId, docker)

      return { success: true }
    } catch (error) {
      const message =
        (error && error.message) || (typeof error === 'string' ? error : '停止模块失败')
      return {
        success: false,
        error: `停止模块失败：${message}`,
      }
    }
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

  ipcMain.handle('docker:pullImage', async (_event, payload) => {
    return pullDockerImage(payload?.image)
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
