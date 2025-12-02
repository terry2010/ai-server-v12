import { app, ipcMain, shell, dialog, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { getLogsDir } from './app-paths.js'
import http from 'node:http'
import si from 'systeminformation'
import { PassThrough } from 'node:stream'
import {
  setAppSettings,
  defaultAppSettings,
  loadSettingsFromDisk,
  mergeAppSettings,
  saveSettingsToDisk,
} from './app-settings.js'
import { startBrowserAgentServer, stopBrowserAgentServer } from './browser-agent-server.js'
import {
  modules,
  moduleDockerConfig,
  N8N_DB_CONTAINER_NAME,
  MYSQL_DB_CONTAINER_NAME,
} from './config.js'
import { getDockerClient, detectDockerStatus, startDockerDesktop } from './docker-client.js'
import {
  ensureImagePresentForModule,
  maybeStopBaseServicesForModule,
  dockerStopAllContainers,
  dockerRemoveAllContainers,
  dockerPruneVolumes,
  dockerFullCleanup,
  pullDockerImage,
  delay,
} from './docker-utils.js'
import { ensureN8nRuntime, ensureN8nPostgres } from './runtime-n8n.js'
import {
  ensureOneApiRuntime as ensureOneApiRuntimeExt,
  ensureOneApiMysql,
} from './runtime-oneapi.js'
import { ensureDifyRuntime } from './runtime-dify.js'
import { ensureRagflowRuntime } from './runtime-ragflow.js'
import {
  openModuleBrowserView,
  closeBrowserView,
  controlModuleBrowserView,
} from './browserview-manager.js'
import { readNdjson, getBrowserAgentDataRootDir } from './browser-agent-storage.js'
import {
  getSession as getBrowserAgentSession,
  showSession as showBrowserAgentSession,
  listSessions as listBrowserAgentSessions,
} from './browser-agent-core.js'

// --- Docker status (real detection) + mock data for Phase 3 (modules & logs) ---

/** @type {import('../shared/types').AppSettings} */
let appSettings = defaultAppSettings

/** @type {number} */
let logsClearSinceUnix = 0

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

function getBrowserWindowById(id) {
  try {
    if (typeof id !== 'number' || !Number.isFinite(id) || id <= 0) return null
    const win = BrowserWindow.fromId(id)
    if (!win || win.isDestroyed()) return null
    return win
  } catch {
    return null
  }
}

async function backupN8nDatabaseToFile(filePath) {
  const dbResult = await ensureN8nPostgres()
  if (!dbResult || !dbResult.success || !dbResult.dbConfig) {
    const message = (dbResult && dbResult.error) || '准备 n8n 依赖的数据库失败。'
    throw new Error(message)
  }

  const docker = getDockerClient()
  const container = docker.getContainer(N8N_DB_CONTAINER_NAME)

  const dbConfig = dbResult.dbConfig
  const user = dbConfig.user || 'n8n'
  const database = dbConfig.database || 'n8n'
  const password = dbConfig.password || ''

  const exec = await container.exec({
    // 在容器内部直接连接本地 Postgres，避免依赖外部主机名解析
    Cmd: ['pg_dump', '-U', user, database],
    Env: [`PGPASSWORD=${password}`],
    AttachStdout: true,
    AttachStderr: true,
  })

  const stream = await exec.start({ hijack: true, stdin: false })

  const fileStream = fs.createWriteStream(filePath)
  const stderrStream = new PassThrough()

  let stderrText = ''
  stderrStream.on('data', (chunk) => {
    try {
      if (!chunk) return
      if (Buffer.isBuffer(chunk)) {
        stderrText += chunk.toString('utf-8')
      } else {
        stderrText += String(chunk)
      }
    } catch {}
  })

  container.modem.demuxStream(stream, fileStream, stderrStream)

  const waitForExecN8n = new Promise((resolve, reject) => {
    let finished = false
    const done = () => {
      if (finished) return
      finished = true
      resolve()
    }
    const fail = (err) => {
      if (finished) return
      finished = true
      reject(err)
    }

    // 以 Docker exec 主 stream 的结束作为完成信号
    stream.on('end', done)
    stream.on('close', done)
    stream.on('error', fail)

    // 仍然监听文件流和 stderr 流的错误
    fileStream.on('error', fail)
    stderrStream.on('error', fail)
  })

  const execTimeoutMsN8n = 2 * 60 * 1000
  await Promise.race([
    waitForExecN8n,
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error('n8n 数据库备份执行超时。'))
      }, execTimeoutMsN8n)
    }),
  ])

  // 备份进程已结束，检查输出文件和错误信息
  try {
    const stats = await fs.promises.stat(filePath)
    if (!stats || !stats.size) {
      const tail = stderrText ? stderrText.replace(/\s+$/g, '').slice(-500) : ''
      const detail = tail || 'pg_dump 未产生任何输出。'
      throw new Error(`n8n 数据库备份失败：${detail}`)
    }
  } catch (statError) {
    const tail = stderrText ? stderrText.replace(/\s+$/g, '').slice(-500) : ''
    const detail =
      tail || (statError && statError.message) || '无法读取备份文件信息。'
    throw new Error(`n8n 数据库备份失败：${detail}`)
  }

  const stderrLower = stderrText.toLowerCase()
  if (stderrLower.includes('error') || stderrLower.includes('fatal')) {
    const tail = stderrText ? stderrText.replace(/\s+$/g, '').slice(-500) : ''
    throw new Error(`n8n 数据库备份可能失败：${tail}`)
  }
}

async function backupOneApiDatabaseToFile(filePath) {
  const dbInstanceResult = await ensureOneApiMysql()
  if (!dbInstanceResult || !dbInstanceResult.success || !dbInstanceResult.dbConfig) {
    const message = (dbInstanceResult && dbInstanceResult.error) || '准备 OneAPI 依赖的 MySQL 实例失败。'
    throw new Error(message)
  }

  const adminConfig = dbInstanceResult.dbConfig
  const docker = getDockerClient()
  const container = docker.getContainer(MYSQL_DB_CONTAINER_NAME)

  const user = adminConfig.user || 'root'
  const password = adminConfig.password || ''

  const exec = await container.exec({
    Cmd: [
      'mysqldump',
      `-u${user}`,
      `-p${password}`,
      '--single-transaction',
      '--quick',
      '--routines',
      'oneapi',
    ],
    AttachStdout: true,
    AttachStderr: true,
  })

  const stream = await exec.start({ hijack: true, stdin: false })

  const fileStream = fs.createWriteStream(filePath)
  const stderrStream = new PassThrough()

  let stderrText = ''
  stderrStream.on('data', (chunk) => {
    try {
      if (!chunk) return
      if (Buffer.isBuffer(chunk)) {
        stderrText += chunk.toString('utf-8')
      } else {
        stderrText += String(chunk)
      }
    } catch {}
  })

  container.modem.demuxStream(stream, fileStream, stderrStream)

  const waitForExecOneApi = new Promise((resolve, reject) => {
    let finished = false
    const done = () => {
      if (finished) return
      finished = true
      resolve()
    }
    const fail = (err) => {
      if (finished) return
      finished = true
      reject(err)
    }

    // 以 Docker exec 主 stream 的结束作为完成信号
    stream.on('end', done)
    stream.on('close', done)
    stream.on('error', fail)

    // 仍然监听文件流和 stderr 流的错误
    fileStream.on('error', fail)
    stderrStream.on('error', fail)
  })

  const execTimeoutMsOneApi = 2 * 60 * 1000
  await Promise.race([
    waitForExecOneApi,
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error('OneAPI 数据库备份执行超时。'))
      }, execTimeoutMsOneApi)
    }),
  ])

  // 备份进程已结束，检查输出文件和错误信息
  try {
    const stats = await fs.promises.stat(filePath)
    if (!stats || !stats.size) {
      const tail = stderrText ? stderrText.replace(/\s+$/g, '').slice(-500) : ''
      const detail = tail || 'mysqldump 未产生任何输出。'
      throw new Error(`OneAPI 数据库备份失败：${detail}`)
    }
  } catch (statError) {
    const tail = stderrText ? stderrText.replace(/\s+$/g, '').slice(-500) : ''
    const detail =
      tail || (statError && statError.message) || '无法读取备份文件信息。'
    throw new Error(`OneAPI 数据库备份失败：${detail}`)
  }

  const stderrLower = stderrText.toLowerCase()
  if (stderrLower.includes('error') || stderrLower.includes('fatal')) {
    const tail = stderrText ? stderrText.replace(/\s+$/g, '').slice(-500) : ''
    throw new Error(`OneAPI 数据库备份可能失败：${tail}`)
  }
}

async function restoreN8nDatabaseFromFile(filePath) {
  const dbResult = await ensureN8nPostgres()
  if (!dbResult || !dbResult.success || !dbResult.dbConfig) {
    const message = (dbResult && dbResult.error) || '准备 n8n 依赖的数据库失败。'
    throw new Error(message)
  }

  const docker = getDockerClient()
  const container = docker.getContainer(N8N_DB_CONTAINER_NAME)

  const dbConfig = dbResult.dbConfig
  const user = dbConfig.user || 'n8n'
  const database = dbConfig.database || 'n8n'
  const password = dbConfig.password || ''

  const quotedDb = String(database).replace(/"/g, '""')
  const quotedUser = String(user).replace(/"/g, '""')
  const dropSql = `DROP DATABASE IF EXISTS "${quotedDb}";`
  const createSql = `CREATE DATABASE "${quotedDb}" OWNER "${quotedUser}";`

  // 第一步：在 postgres 系统库中删除旧数据库（如果存在）
  {
    const exec = await container.exec({
      Cmd: ['psql', '-U', user, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', dropSql],
      Env: [`PGPASSWORD=${password}`],
      AttachStdout: true,
      AttachStderr: true,
    })

    const stream = await exec.start({ hijack: true, stdin: false })

    let output = ''
    stream.on('data', (chunk) => {
      try {
        if (!chunk) return
        if (Buffer.isBuffer(chunk)) {
          output += chunk.toString('utf-8')
        } else {
          output += String(chunk)
        }
      } catch {}
    })

    const dropTimeoutMs = 60 * 1000
    await new Promise((resolve, reject) => {
      let finished = false
      const done = () => {
        if (finished) return
        finished = true
        resolve()
      }
      const fail = (err) => {
        if (finished) return
        finished = true
        reject(err)
      }

      stream.on('end', done)
      stream.on('close', done)
      stream.on('error', fail)

      setTimeout(() => {
        if (finished) return
        finished = true
        fail(new Error('n8n 数据库删除超时，请稍后重试。'))
      }, dropTimeoutMs)
    })

    const inspect = await exec.inspect()
    if (typeof inspect.ExitCode === 'number' && inspect.ExitCode !== 0) {
      const tail = output ? output.replace(/\s+$/g, '').slice(-500) : ''
      const message =
        tail || `n8n 数据库删除失败（退出码 ${inspect.ExitCode}）。`
      throw new Error(message)
    }
  }

  // 第二步：创建新的目标数据库
  {
    const exec = await container.exec({
      Cmd: ['psql', '-U', user, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', createSql],
      Env: [`PGPASSWORD=${password}`],
      AttachStdout: true,
      AttachStderr: true,
    })

    const stream = await exec.start({ hijack: true, stdin: false })

    let output = ''
    stream.on('data', (chunk) => {
      try {
        if (!chunk) return
        if (Buffer.isBuffer(chunk)) {
          output += chunk.toString('utf-8')
        } else {
          output += String(chunk)
        }
      } catch {}
    })

    const createTimeoutMs = 60 * 1000
    await new Promise((resolve, reject) => {
      let finished = false
      const done = () => {
        if (finished) return
        finished = true
        resolve()
      }
      const fail = (err) => {
        if (finished) return
        finished = true
        reject(err)
      }

      stream.on('end', done)
      stream.on('close', done)
      stream.on('error', fail)

      setTimeout(() => {
        if (finished) return
        finished = true
        fail(new Error('n8n 数据库创建超时，请稍后重试。'))
      }, createTimeoutMs)
    })

    const inspect = await exec.inspect()
    if (typeof inspect.ExitCode === 'number' && inspect.ExitCode !== 0) {
      const tail = output ? output.replace(/\s+$/g, '').slice(-500) : ''
      const message =
        tail || `n8n 数据库创建失败（退出码 ${inspect.ExitCode}）。`
      throw new Error(message)
    }
  }

  // 第二步：将备份 SQL 导入新建的数据库
  const sqlBuffer = await fs.promises.readFile(filePath)

  const execImport = await container.exec({
    Cmd: ['psql', '-U', user, '-d', database, '-v', 'ON_ERROR_STOP=1'],
    Env: [`PGPASSWORD=${password}`],
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
  })

  const importStream = await execImport.start({ hijack: true, stdin: true })

  let importOutput = ''
  importStream.on('data', (chunk) => {
    try {
      if (!chunk) return
      if (Buffer.isBuffer(chunk)) {
        importOutput += chunk.toString('utf-8')
      } else {
        importOutput += String(chunk)
      }
    } catch {}
  })

  // 将备份内容通过 stdin 写入 psql
  importStream.write(sqlBuffer)
  importStream.end()

  const importTimeoutMs = 10 * 60 * 1000
  await new Promise((resolve, reject) => {
    let finished = false
    const done = () => {
      if (finished) return
      finished = true
      resolve()
    }
    const fail = (err) => {
      if (finished) return
      finished = true
      reject(err)
    }

    importStream.on('end', done)
    importStream.on('close', done)
    importStream.on('error', fail)

    setTimeout(() => {
      if (finished) return
      finished = true
      fail(new Error('n8n 数据库导入超时，请稍后重试。'))
    }, importTimeoutMs)
  })

  const inspectImport = await execImport.inspect()
  if (typeof inspectImport.ExitCode === 'number' && inspectImport.ExitCode !== 0) {
    const tail = importOutput ? importOutput.replace(/\s+$/g, '').slice(-500) : ''
    const message =
      tail || `n8n 数据库恢复失败（退出码 ${inspectImport.ExitCode}）。`
    throw new Error(message)
  }
}

async function restoreOneApiDatabaseFromFile(filePath) {
  const dbInstanceResult = await ensureOneApiMysql()
  if (!dbInstanceResult || !dbInstanceResult.success || !dbInstanceResult.dbConfig) {
    const message = (dbInstanceResult && dbInstanceResult.error) || '准备 OneAPI 依赖的 MySQL 实例失败。'
    throw new Error(message)
  }

  const adminConfig = dbInstanceResult.dbConfig
  const docker = getDockerClient()
  const container = docker.getContainer(MYSQL_DB_CONTAINER_NAME)

  const user = adminConfig.user || 'root'
  const password = adminConfig.password || ''
  const dbName = adminConfig.database || 'oneapi'

  // 第一步：重建 oneapi 数据库
  {
    const ddlSql = `DROP DATABASE IF EXISTS \`${dbName}\`; CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`

    const exec = await container.exec({
      Cmd: ['mysql', `-u${user}`, `-p${password}`, '-e', ddlSql],
      AttachStdout: true,
      AttachStderr: true,
    })

    const stream = await exec.start({ hijack: true, stdin: false })

    let output = ''
    stream.on('data', (chunk) => {
      try {
        if (!chunk) return
        if (Buffer.isBuffer(chunk)) {
          output += chunk.toString('utf-8')
        } else {
          output += String(chunk)
        }
      } catch {}
    })

    const rebuildTimeoutMs = 60 * 1000
    await new Promise((resolve, reject) => {
      let finished = false
      const done = () => {
        if (finished) return
        finished = true
        resolve()
      }
      const fail = (err) => {
        if (finished) return
        finished = true
        reject(err)
      }

      stream.on('end', done)
      stream.on('close', done)
      stream.on('error', fail)

      setTimeout(() => {
        if (finished) return
        finished = true
        fail(new Error('OneAPI 数据库重建超时，请稍后重试。'))
      }, rebuildTimeoutMs)
    })

    const inspect = await exec.inspect()
    if (typeof inspect.ExitCode === 'number' && inspect.ExitCode !== 0) {
      const tail = output ? output.replace(/\s+$/g, '').slice(-500) : ''
      const message =
        tail || `OneAPI 数据库重建失败（退出码 ${inspect.ExitCode}）。`
      throw new Error(message)
    }
  }

  // 第二步：将备份 SQL 导入新建的 oneapi 数据库
  const sqlBuffer = await fs.promises.readFile(filePath)

  const execImport = await container.exec({
    Cmd: ['mysql', `-u${user}`, `-p${password}`, dbName],
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
  })

  const importStream = await execImport.start({ hijack: true, stdin: true })

  let importOutput = ''
  importStream.on('data', (chunk) => {
    try {
      if (!chunk) return
      if (Buffer.isBuffer(chunk)) {
        importOutput += chunk.toString('utf-8')
      } else {
        importOutput += String(chunk)
      }
    } catch {}
  })

  importStream.write(sqlBuffer)
  importStream.end()

  const importTimeoutMs = 10 * 60 * 1000
  await new Promise((resolve, reject) => {
    let finished = false
    const done = () => {
      if (finished) return
      finished = true
      resolve()
    }
    const fail = (err) => {
      if (finished) return
      finished = true
      reject(err)
    }

    importStream.on('end', done)
    importStream.on('close', done)
    importStream.on('error', fail)

    setTimeout(() => {
      if (finished) return
      finished = true
      fail(new Error('OneAPI 数据库导入超时，请稍后重试。'))
    }, importTimeoutMs)
  })

  const inspectImport = await execImport.inspect()
  if (typeof inspectImport.ExitCode === 'number' && inspectImport.ExitCode !== 0) {
    const tail = importOutput ? importOutput.replace(/\s+$/g, '').slice(-500) : ''
    const message =
      tail || `OneAPI 数据库恢复失败（退出码 ${inspectImport.ExitCode}）。`
    throw new Error(message)
  }
}

async function checkRagflowHttpHealthy(port) {
  return new Promise((resolve) => {
    if (!port || typeof port !== 'number') {
      resolve({ ok: false, statusCode: 0 })
      return
    }

    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        // 与 waitForRagflowReady 一致，使用根路径作为健康检查
        path: '/',
        method: 'GET',
        timeout: 5000,
      },
      (res) => {
        const statusCode = res.statusCode || 0
        if (statusCode >= 200 && statusCode < 500) {
          resolve({ ok: true, statusCode })
        } else {
          resolve({ ok: false, statusCode })
        }
      },
    )

    req.on('error', () => {
      resolve({ ok: false, statusCode: 0 })
    })

    req.on('timeout', () => {
      try {
        req.destroy()
      } catch {}
      resolve({ ok: false, statusCode: 0 })
    })

    req.end()
  })
}

export function setupIpcHandlers() {
  const diskSettings = loadSettingsFromDisk()
  if (diskSettings) {
    appSettings = mergeAppSettings(defaultAppSettings, diskSettings)
  } else {
    appSettings = defaultAppSettings
  }

  setAppSettings(appSettings)

  // Docker status
  ipcMain.handle('docker:getStatus', async () => {
    return detectDockerStatus()
  })

  ipcMain.handle('docker:startDesktop', async () => {
    return startDockerDesktop()
  })

  // Modules
  ipcMain.handle('modules:list', async () => {
    const getModuleEnabled = (moduleInfo) => {
      try {
        if (
          appSettings &&
          appSettings.modules &&
          appSettings.modules[moduleInfo.id] &&
          typeof appSettings.modules[moduleInfo.id].enabled === 'boolean'
        ) {
          return appSettings.modules[moduleInfo.id].enabled
        }
      } catch {
        // ignore
      }
      return moduleInfo.enabled
    }

    let containers = []
    try {
      const docker = getDockerClient()
      containers = await docker.listContainers({ all: true })
    } catch {
      return modules.map((m) => ({
        ...m,
        enabled: getModuleEnabled(m),
        status: 'stopped',
      }))
    }

    const results = []

    for (const m of modules) {
      const config = moduleDockerConfig[m.id]
      if (!config) {
        results.push({
          ...m,
          enabled: getModuleEnabled(m),
          status: 'error',
          port: m.port,
        })
        continue
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
        results.push({
          ...m,
          enabled: getModuleEnabled(m),
          status: 'stopped',
          port: m.port,
        })
        continue
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

      if (m.id === 'ragflow' && moduleStatus === 'running' && typeof port === 'number') {
        try {
          const health = await checkRagflowHttpHealthy(port)
          if (!health.ok) {
            moduleStatus = 'starting'
          }
        } catch {}
      }

      results.push({
        ...m,
        enabled: getModuleEnabled(m),
        status: moduleStatus,
        port,
      })
    }

    return results
  })

  ipcMain.handle('modules:start', async (_event, payload) => {
    const moduleId = payload && typeof payload.moduleId !== 'undefined' ? payload.moduleId : undefined
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
      const runtimeResult = await ensureOneApiRuntimeExt()
      if (!runtimeResult || !runtimeResult.success) {
        return {
          success: false,
          error: (runtimeResult && runtimeResult.error) || '启动 OneAPI 运行环境失败。',
        }
      }

      return { success: true }
    }

    if (moduleId === 'dify') {
      const runtimeResult = await ensureDifyRuntime()
      if (!runtimeResult || !runtimeResult.success) {
        return {
          success: false,
          error: (runtimeResult && runtimeResult.error) || '启动 Dify 运行环境失败。',
        }
      }

      return { success: true }
    }

    if (moduleId === 'ragflow') {
      const runtimeResult = await ensureRagflowRuntime()
      if (!runtimeResult || !runtimeResult.success) {
        return {
          success: false,
          error: (runtimeResult && runtimeResult.error) || '启动 RagFlow 运行环境失败。',
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

  ipcMain.handle('dify:restart', async () => {
    const dockerStatus = await detectDockerStatus()
    if (!dockerStatus.installed || !dockerStatus.running) {
      return {
        success: false,
        error: dockerStatus.error || 'Docker 未安装或未运行，无法重启 Dify 模块。',
      }
    }

    try {
      const docker = getDockerClient()
      const config = moduleDockerConfig.dify
      const containers = await docker.listContainers({
        all: true,
        filters: {
          name: config.containerNames,
        },
      })

      for (const info of containers) {
        const container = docker.getContainer(info.Id)
        const state = String(info.State || '').toLowerCase()
        if (state === 'running' || state === 'restarting') {
          await container.stop()
        }
        await container.remove({ force: true })
      }
    } catch (error) {
      const message =
        (error && error.message) || (typeof error === 'string' ? error : '重启前清理旧 Dify 容器失败')
      return {
        success: false,
        error: `重启前清理旧 Dify 容器失败：${message}`,
      }
    }

    const result = await ensureDifyRuntime()
    if (!result || !result.success) {
      return {
        success: false,
        error: (result && result.error) || '重启 Dify 运行环境失败。',
      }
    }

    return { success: true }
  })

  ipcMain.handle('ragflow:restart', async () => {
    const dockerStatus = await detectDockerStatus()
    if (!dockerStatus.installed || !dockerStatus.running) {
      return {
        success: false,
        error: dockerStatus.error || 'Docker 未安装或未运行，无法重启 RagFlow 模块。',
      }
    }

    try {
      const docker = getDockerClient()
      const config = moduleDockerConfig.ragflow
      const containers = await docker.listContainers({
        all: true,
        filters: {
          name: config.containerNames,
        },
      })

      for (const info of containers) {
        const container = docker.getContainer(info.Id)
        const state = String(info.State || '').toLowerCase()
        if (state === 'running' || state === 'restarting') {
          await container.stop()
        }
        await container.remove({ force: true })
      }
    } catch (error) {
      const message =
        (error && error.message) || (typeof error === 'string' ? error : '重启前清理旧 RagFlow 容器失败')
      return {
        success: false,
        error: `重启前清理旧 RagFlow 容器失败：${message}`,
      }
    }

    const runtimeResult = await ensureRagflowRuntime()
    if (!runtimeResult || !runtimeResult.success) {
      return {
        success: false,
        error: (runtimeResult && runtimeResult.error) || '重启 RagFlow 运行环境失败。',
      }
    }

    return { success: true }
  })

  ipcMain.handle('modules:stop', async (_event, payload) => {
    const moduleId = payload && typeof payload.moduleId !== 'undefined' ? payload.moduleId : undefined
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

      // 对同一模块关联的所有容器逐一停止（例如 Dify 的 api 与 web 容器）
      for (const info of containers) {
        const state = String(info.State || '').toLowerCase()
        if (state === 'running' || state === 'restarting') {
          const container = docker.getContainer(info.Id)
          await container.stop().catch(() => undefined)
        }
      }

      // 在确认模块容器已停止后，再根据依赖关系尝试停止基础服务
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

  ipcMain.handle('modules:backupData', async (_event, payload) => {
    const moduleId =
      payload && typeof payload.moduleId === 'string' ? payload.moduleId : undefined

    if (!moduleId) {
      return { success: false, error: '模块 ID 无效，无法执行备份。' }
    }

    const dockerStatus = await detectDockerStatus()
    if (!dockerStatus.installed || !dockerStatus.running) {
      return {
        success: false,
        error: dockerStatus.error || 'Docker 未安装或未运行，无法执行备份。',
      }
    }

    const now = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    const yyyy = now.getFullYear()
    const MM = pad(now.getMonth() + 1)
    const dd = pad(now.getDate())
    const hh = pad(now.getHours())
    const mm = pad(now.getMinutes())
    const ss = pad(now.getSeconds())
    const defaultName = `${moduleId}-db-backup-${yyyy}${MM}${dd}-${hh}${mm}${ss}.sql`

    let defaultDir = ''
    try {
      defaultDir = app.getPath('documents')
    } catch {
      try {
        defaultDir = app.getPath('downloads')
      } catch {
        defaultDir = ''
      }
    }

    const defaultPath = defaultDir ? path.join(defaultDir, defaultName) : defaultName

    const dialogResult = await dialog.showSaveDialog({
      title: '选择备份文件保存位置',
      defaultPath,
      filters: [
        { name: '数据库备份文件', extensions: ['sql'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    })

    if (dialogResult.canceled || !dialogResult.filePath) {
      return { success: false, cancelled: true }
    }

    const filePath = dialogResult.filePath

    try {
      if (moduleId === 'n8n') {
        await backupN8nDatabaseToFile(filePath)
      } else if (moduleId === 'oneapi') {
        await backupOneApiDatabaseToFile(filePath)
      } else {
        return { success: false, error: '当前版本暂不支持该模块的数据备份。' }
      }

      return { success: true, path: filePath }
    } catch (error) {
      const message = error && error.message ? error.message : String(error)
      try {
        // 输出详细错误日志便于排查
        // eslint-disable-next-line no-console
        console.error('[backup] modules:backupData 失败', {
          moduleId,
          filePath,
          error: message,
        })
      } catch {}
      return { success: false, error: message }
    }
  })

  ipcMain.handle('modules:restoreData', async (_event, payload) => {
    const moduleId =
      payload && typeof payload.moduleId === 'string' ? payload.moduleId : undefined

    if (!moduleId) {
      return { success: false, error: '模块 ID 无效，无法执行恢复。' }
    }

    const dockerStatus = await detectDockerStatus()
    if (!dockerStatus.installed || !dockerStatus.running) {
      return {
        success: false,
        error: dockerStatus.error || 'Docker 未安装或未运行，无法执行数据恢复。',
      }
    }

    // 恢复前确保对应业务模块未在运行，避免运行时占用数据库导致不一致
    try {
      const config = moduleDockerConfig[moduleId]
      if (config) {
        const docker = getDockerClient()
        const containers = await docker.listContainers({
          all: true,
          filters: {
            name: config.containerNames,
          },
        })

        const hasRunning = containers.some((info) => {
          const state = String(info.State || '').toLowerCase()
          return state === 'running' || state === 'restarting'
        })

        if (hasRunning) {
          const friendlyName = moduleId === 'n8n' ? 'n8n' : moduleId === 'oneapi' ? 'OneAPI' : moduleId
          return {
            success: false,
            error: `${friendlyName} 模块正在运行，无法执行数据恢复。请先在首页停止该模块后重试。`,
          }
        }
      }
    } catch {
      // 如果状态检查失败，不阻止恢复，由后续步骤决定是否报错
    }

    let defaultDir = ''
    try {
      defaultDir = app.getPath('documents')
    } catch {
      try {
        defaultDir = app.getPath('downloads')
      } catch {
        defaultDir = ''
      }
    }

    const dialogResult = await dialog.showOpenDialog({
      title: '选择要恢复的备份文件',
      defaultPath: defaultDir || undefined,
      filters: [
        { name: '数据库备份文件', extensions: ['sql'] },
        { name: '所有文件', extensions: ['*'] },
      ],
      properties: ['openFile'],
    })

    if (dialogResult.canceled || !dialogResult.filePaths || !dialogResult.filePaths[0]) {
      return { success: false, cancelled: true }
    }

    const filePath = dialogResult.filePaths[0]

    try {
      const stats = await fs.promises.stat(filePath)
      if (!stats || !stats.size) {
        return { success: false, error: '选中的备份文件为空，请确认文件是否正确。' }
      }

      if (moduleId === 'n8n') {
        await restoreN8nDatabaseFromFile(filePath)
      } else if (moduleId === 'oneapi') {
        await restoreOneApiDatabaseFromFile(filePath)
      } else {
        return { success: false, error: '当前版本暂不支持该模块的数据恢复。' }
      }

      return { success: true }
    } catch (error) {
      const message = error && error.message ? error.message : String(error)
      try {
        // 输出详细错误日志便于排查
        // eslint-disable-next-line no-console
        console.error('[restore] modules:restoreData 失败', {
          moduleId,
          filePath,
          error: message,
        })
      } catch {}

      return { success: false, error: message }
    }
  })

  ipcMain.handle('n8n:restart', async () => {
    const dockerStatus = await detectDockerStatus()
    if (!dockerStatus.installed || !dockerStatus.running) {
      return {
        success: false,
        error: dockerStatus.error || 'Docker 未安装或未运行，无法重启 n8n 模块。',
      }
    }

    try {
      const docker = getDockerClient()
      const config = moduleDockerConfig.n8n
      const containers = await docker.listContainers({
        all: true,
        filters: {
          name: config.containerNames,
        },
      })

      for (const info of containers) {
        const container = docker.getContainer(info.Id)
        const state = String(info.State || '').toLowerCase()
        if (state === 'running' || state === 'restarting') {
          await container.stop()
        }
        await container.remove({ force: true })
      }
    } catch (error) {
      const message =
        (error && error.message) || (typeof error === 'string' ? error : '重启前清理旧 n8n 容器失败')
      return {
        success: false,
        error: `重启前清理旧 n8n 容器失败：${message}`,
      }
    }

    const runtimeResult = await ensureN8nRuntime()
    if (!runtimeResult || !runtimeResult.success) {
      return {
        success: false,
        error: (runtimeResult && runtimeResult.error) || '重启 n8n 运行环境失败。',
      }
    }

    return { success: true }
  })

  ipcMain.handle('oneapi:restart', async () => {
    const dockerStatus = await detectDockerStatus()
    if (!dockerStatus.installed || !dockerStatus.running) {
      return {
        success: false,
        error: dockerStatus.error || 'Docker 未安装或未运行，无法重启 OneAPI 模块。',
      }
    }

    try {
      const docker = getDockerClient()
      const config = moduleDockerConfig.oneapi
      const containers = await docker.listContainers({
        all: true,
        filters: {
          name: config.containerNames,
        },
      })

      for (const info of containers) {
        const container = docker.getContainer(info.Id)
        const state = String(info.State || '').toLowerCase()
        if (state === 'running' || state === 'restarting') {
          await container.stop()
        }
        await container.remove({ force: true })
      }
    } catch (error) {
      const message =
        (error && error.message) || (typeof error === 'string' ? error : '重启前清理旧 OneAPI 容器失败')
      return {
        success: false,
        error: `重启前清理旧 OneAPI 容器失败：${message}`,
      }
    }

    const runtimeResult = await ensureOneApiRuntimeExt()
    if (!runtimeResult || !runtimeResult.success) {
      return {
        success: false,
        error: (runtimeResult && runtimeResult.error) || '重启 OneAPI 运行环境失败。',
      }
    }

    return { success: true }
  })

  // Logs
  async function collectAllLogsForQuery(moduleFilter, levelFilter, startTime, endTime) {
    /** @type {import('../shared/types').LogItem[]} */
    let all = logsClearSinceUnix > 0 ? [] : logs.slice()

    const getNextId = () => {
      if (!all.length) return 1
      let maxId = 0
      for (const item of all) {
        if (typeof item.id === 'number' && item.id > maxId) {
          maxId = item.id
        }
      }
      return maxId + 1
    }

    const formatIsoToLogTimestamp = (value) => {
      try {
        if (value == null) return ''
        const raw = String(value)
        const isoString = raw.replace(/^[^\d]*/, '').trim()

        const direct = isoString.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/)
        if (direct) {
          return `${direct[1]} ${direct[2]}`
        }

        const d = new Date(isoString)
        if (!Number.isNaN(d.getTime())) {
          const pad = (n) => String(n).padStart(2, '0')
          const yyyy = d.getFullYear()
          const MM = pad(d.getMonth() + 1)
          const dd = pad(d.getDate())
          const hh = pad(d.getHours())
          const mm = pad(d.getMinutes())
          const ss = pad(d.getSeconds())
          return `${yyyy}-${MM}-${dd} ${hh}:${mm}:${ss}`
        }

        return isoString
      } catch {
        return value == null ? '' : String(value)
      }
    }

    /** @type {import('../shared/types').LogModule | 'all'} */
    const moduleFilterValue = moduleFilter || 'all'

    /** @type {import('../shared/types').ModuleId[]} */
    const containerModules =
      moduleFilterValue === 'all'
        ? ['n8n', 'dify', 'oneapi', 'ragflow']
        : moduleFilterValue === 'client' || moduleFilterValue === 'system'
        ? []
        : [moduleFilterValue]

    if (containerModules.length > 0) {
      let docker = null
      try {
        const dockerStatus = await detectDockerStatus()
        if (dockerStatus.installed && dockerStatus.running) {
          docker = getDockerClient()
        }
      } catch {
        docker = null
      }

      if (docker) {
        let containers = []
        try {
          containers = await docker.listContainers({ all: true })
        } catch {
          containers = []
        }

        let nextId = getNextId()

        const sinceOpt = logsClearSinceUnix > 0 ? logsClearSinceUnix : undefined

        for (const moduleId of containerModules) {
          const config = moduleDockerConfig[moduleId]
          if (!config) continue

          const matched = containers.filter((c) => {
            if (!Array.isArray(c.Names)) return false
            return c.Names.some((name) =>
              config.containerNames.some(
                (needle) => typeof name === 'string' && name.includes(needle),
              ),
            )
          })

          for (const info of matched) {
            const container = docker.getContainer(info.Id)

            const pushFromLogs = (raw, level) => {
              if (!raw) return

              let lastTimestamp = ''

              const processText = (text) => {
                const lines = String(text || '').split(/\r?\n/)
                for (const rawLine of lines) {
                  const cleaned = String(rawLine || '')
                    .replace(/^[^\d]*(\d{4}-\d{2}-\d{2}T)/, '$1')
                    .trim()
                  const line = cleaned
                  if (!line) continue

                  // 1) 纯 ISO 时间头（只有时间，没有正文）
                  const tsOnly = line.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.\d+)?Z?$/)
                  if (tsOnly) {
                    lastTimestamp = formatIsoToLogTimestamp(line)
                    continue
                  }

                  let ts = ''
                  let msg = ''

                  // 2) 同一行里既有 ISO 时间又有正文
                  const withTs = line.match(
                    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\s+(.*)$/,
                  )
                  if (withTs) {
                    ts = formatIsoToLogTimestamp(withTs[1])
                    msg = withTs[2]
                    lastTimestamp = ts
                  } else if (lastTimestamp) {
                    // 3) 继承上一行时间头
                    ts = lastTimestamp
                    msg = line
                  } else {
                    // 4) 兜底：尝试把前半段当作时间
                    const index = line.indexOf(' ')
                    if (index > 0) {
                      ts = formatIsoToLogTimestamp(line.slice(0, index))
                      msg = line.slice(index + 1)
                    } else {
                      ts = formatIsoToLogTimestamp(new Date().toISOString())
                      msg = line
                    }
                  }

                  // 去掉 ANSI 颜色码
                  msg = msg.replace(/\u001b\[[0-9;]*m/g, '')

                  // 去掉消息开头形如 "YYYY/MM/DD HH:mm:ss " 的时间前缀
                  msg = msg.replace(/^(\d{4}\/\d{2}\/\d{2})\s+\d{2}:\d{2}:\d{2}\s+/, '')

                  // 去掉 OneAPI 日志里的 "[INFO] 2025/11/28 - 04:34:24 |" 这一类前缀
                  const oneApiPrefix = msg.match(
                    /^\[[A-Z]+\]\s+\d{4}\/\d{2}\/\d{2}\s*-\s*\d{2}:\d{2}:\d{2}\s*\|\s*(.*)$/,
                  )
                  if (oneApiPrefix) {
                    msg = oneApiPrefix[1]
                  }

                  // 去掉 pm2 / Dify 这类 "HH:mm:ss 0|service-name  |" 的时间和进程前缀
                  msg = msg.replace(/^\d{2}:\d{2}:\d{2}\s+\d+\|[^|]+\|\s*/, '')

                  // 再兜底去掉简单的 "HH:mm:ss " 时间前缀
                  msg = msg.replace(/^\d{2}:\d{2}:\d{2}\s+/, '')

                  /** @type {import('../shared/types').LogItem} */
                  const item = {
                    id: nextId++,
                    timestamp: ts,
                    level,
                    module: moduleId,
                    service:
                      (Array.isArray(info.Names) && info.Names[0]) ||
                      (config.containerNames && config.containerNames[0]) ||
                      moduleId,
                    message: msg,
                  }

                  all.push(item)
                }
              }

              if (Buffer.isBuffer(raw) && raw.length >= 8) {
                let offset = 0
                let usedDemux = false
                while (offset + 8 <= raw.length) {
                  const streamType = raw[offset]
                  const isHeader =
                    (streamType === 0 || streamType === 1 || streamType === 2) &&
                    raw[offset + 1] === 0 &&
                    raw[offset + 2] === 0 &&
                    raw[offset + 3] === 0
                  const size = raw.readUInt32BE(offset + 4)
                  if (!isHeader || size <= 0 || offset + 8 + size > raw.length) {
                    break
                  }
                  usedDemux = true
                  offset += 8
                  const chunk = raw.slice(offset, offset + size).toString('utf-8')
                  offset += size
                  processText(chunk)
                }

                if (usedDemux) return
              }

              processText(raw.toString('utf-8'))
            }

            try {
              const stdout = await container.logs({
                stdout: true,
                stderr: false,
                timestamps: true,
                since: sinceOpt,
              })
              pushFromLogs(stdout, 'info')
            } catch {}

            try {
              const stderr = await container.logs({
                stdout: false,
                stderr: true,
                timestamps: true,
                since: sinceOpt,
              })
              pushFromLogs(stderr, 'error')
            } catch {}
          }
        }
      }
    }

    if (moduleFilterValue !== 'all') {
      all = all.filter((log) => log.module === moduleFilterValue)
    }

    const levelFilterValue = levelFilter || 'all'
    if (levelFilterValue !== 'all') {
      all = all.filter((log) => log.level === levelFilterValue)
    }

    let start = typeof startTime === 'string' ? startTime.trim() : ''
    let end = typeof endTime === 'string' ? endTime.trim() : ''
    if (start && end && start > end) {
      const tmp = start
      start = end
      end = tmp
    }

    if (start || end) {
      all = all.filter((log) => {
        const ts = typeof log.timestamp === 'string' ? log.timestamp : ''
        if (!ts) return false
        if (start && ts < start) return false
        if (end && ts > end) return false
        return true
      })
    }

    all.sort((a, b) => {
      if (a.timestamp === b.timestamp) return 0
      return a.timestamp < b.timestamp ? 1 : -1
    })

    return all
  }

  ipcMain.handle('logs:list', async (_event, payload) => {
    const moduleFilter =
      payload && typeof payload.module !== 'undefined' ? payload.module : 'all'
    const levelFilter =
      payload && typeof payload.level !== 'undefined' ? payload.level : 'all'
    const page = payload && typeof payload.page === 'number' ? payload.page : 1
    const pageSize =
      payload && typeof payload.pageSize === 'number' ? payload.pageSize : 20
    const startTime = payload && payload.startTime ? payload.startTime : ''
    const endTime = payload && payload.endTime ? payload.endTime : ''

    const all = await collectAllLogsForQuery(moduleFilter, levelFilter, startTime, endTime)
    const total = all.length
    const start = (page - 1) * pageSize
    const items = all.slice(start, start + pageSize)

    return { items, total }
  })

  ipcMain.handle('logs:export', async (_event, payload) => {
    const moduleFilter =
      payload && typeof payload.module !== 'undefined' ? payload.module : 'all'
    const levelFilter =
      payload && typeof payload.level !== 'undefined' ? payload.level : 'all'
    const startTime = payload && payload.startTime ? payload.startTime : ''
    const endTime = payload && payload.endTime ? payload.endTime : ''

    const all = await collectAllLogsForQuery(moduleFilter, levelFilter, startTime, endTime)

    try {
      const logsDir = getLogsDir()
      fs.mkdirSync(logsDir, { recursive: true })

      const now = new Date()
      const pad = (n) => String(n).padStart(2, '0')
      const yyyy = now.getFullYear()
      const MM = pad(now.getMonth() + 1)
      const dd = pad(now.getDate())
      const hh = pad(now.getHours())
      const mm = pad(now.getMinutes())
      const ss = pad(now.getSeconds())
      const defaultName = `logs-${yyyy}${MM}${dd}-${hh}${mm}${ss}.json`

      let filename = payload && payload.filename ? payload.filename : defaultName
      if (!filename.toLowerCase().endsWith('.json')) {
        filename += '.json'
      }

      const fullPath = path.join(logsDir, filename)
      fs.writeFileSync(fullPath, JSON.stringify(all, null, 2), 'utf-8')

      try {
        shell.showItemInFolder(fullPath)
      } catch {
        // ignore
      }

      return { success: true, path: fullPath }
    } catch (error) {
      const message = error && error.message ? error.message : String(error)
      return { success: false, error: `导出日志失败：${message}` }
    }
  })

  ipcMain.handle('logs:clear', async () => {
    try {
      logsClearSinceUnix = Math.floor(Date.now() / 1000)
      return { success: true }
    } catch {
      logsClearSinceUnix = 0
      return { success: false }
    }
  })

  // Browser Agent UI：基于 NDJSON 的会话查询与截图打开

  ipcMain.handle('browserAgent:listSessions', async (_event, payload) => {
    try {
      const date =
        payload && typeof payload.date === 'string' && payload.date.trim()
          ? payload.date.trim()
          : undefined
      const profileFilter =
        payload && typeof payload.profile === 'string' && payload.profile.trim()
          ? payload.profile.trim()
          : ''
      const clientIdFilter =
        payload && typeof payload.clientId === 'string' && payload.clientId.trim()
          ? payload.clientId.trim()
          : ''
      const statusFilterRaw = payload && typeof payload.status === 'string' ? payload.status : 'all'
      const statusFilter = statusFilterRaw === 'running' || statusFilterRaw === 'closed' ? statusFilterRaw : 'all'

      /** @type {any[]} */
      const sessionRecords = readNdjson('sessions', date)
      /** @type {any[]} */
      const actionRecords = readNdjson('actions', date)

      const normalizeStatus = (value) => {
        const raw = typeof value === 'string' ? value.toLowerCase() : ''
        if (raw === 'running') return 'running'
        if (raw === 'closed') return 'closed'
        return 'error'
      }

      /** @type {Map<string, import('../shared/types').BrowserAgentSessionSummary>} */
      const map = new Map()

      for (const rec of sessionRecords) {
        if (!rec || typeof rec !== 'object') continue
        const rawId = rec.sessionId
        const sessionId = typeof rawId === 'string' && rawId.trim() ? rawId.trim() : ''
        if (!sessionId) continue

        let summary = map.get(sessionId)
        if (!summary) {
          summary = {
            sessionId,
            profile: null,
            clientId: null,
            status: 'error',
            createdAt: null,
            finishedAt: null,
            lastErrorCode: null,
            lastErrorMessage: null,
            actionsCount: 0,
            lastActionAt: null,
            lastActionType: null,
            domain: null,
          }
          map.set(sessionId, summary)
        }

        if (typeof rec.profile === 'string') {
          summary.profile = rec.profile || null
        }
        if (typeof rec.clientId === 'string') {
          summary.clientId = rec.clientId || null
        }

        const createdAt = typeof rec.createdAt === 'string' && rec.createdAt ? rec.createdAt : null
        if (createdAt && (!summary.createdAt || createdAt < summary.createdAt)) {
          summary.createdAt = createdAt
        }

        const finishedAt = typeof rec.finishedAt === 'string' && rec.finishedAt ? rec.finishedAt : null
        if (finishedAt && (!summary.finishedAt || finishedAt > summary.finishedAt)) {
          summary.finishedAt = finishedAt
        }

        const status = normalizeStatus(rec.status)

        // 规则：
        // 1. 一旦出现 closed 记录，最终状态锁定为 closed；
        // 2. 在没有 closed 的前提下，如果有 running 则为 running；
        // 3. 没有 running/closed 时为 error。
        if (status === 'closed') {
          summary.status = 'closed'
        } else if (status === 'running' && summary.status !== 'closed') {
          summary.status = 'running'
        }

        if (typeof rec.lastErrorCode === 'string') {
          summary.lastErrorCode = rec.lastErrorCode || null
        }
        if (typeof rec.lastErrorMessage === 'string') {
          summary.lastErrorMessage = rec.lastErrorMessage || null
        }
      }

      for (const rec of actionRecords) {
        if (!rec || typeof rec !== 'object') continue
        const rawId = rec.sessionId
        const sessionId = typeof rawId === 'string' && rawId.trim() ? rawId.trim() : ''
        if (!sessionId) continue

        let summary = map.get(sessionId)
        if (!summary) {
          summary = {
            sessionId,
            profile: null,
            clientId: null,
            status: 'error',
            createdAt: null,
            finishedAt: null,
            lastErrorCode: null,
            lastErrorMessage: null,
            actionsCount: 0,
            lastActionAt: null,
            lastActionType: null,
            domain: null,
          }
          map.set(sessionId, summary)
        }

        summary.actionsCount += 1

        const startAt = typeof rec.startAt === 'string' && rec.startAt ? rec.startAt : null
        const endAt = typeof rec.endAt === 'string' && rec.endAt ? rec.endAt : null
        const ts = endAt || startAt
        if (ts && (!summary.lastActionAt || ts > summary.lastActionAt)) {
          summary.lastActionAt = ts
          summary.lastActionType = typeof rec.type === 'string' ? rec.type : null
        }

        // 提取域名：优先使用 navigate 动作中的 URL
        try {
          const rawType = typeof rec.type === 'string' ? rec.type.toLowerCase() : ''
          if (!summary.domain && rawType === 'navigate') {
            const params = rec && typeof rec.params === 'object' ? rec.params : null
            const rawUrl = params && typeof params.url === 'string' ? params.url.trim() : ''
            if (rawUrl) {
              let domain = ''
              try {
                const u = new URL(rawUrl)
                domain = u.hostname || ''
              } catch {
                domain = rawUrl
              }
              if (domain) {
                summary.domain = domain
              }
            }
          }
        } catch {}
      }

      let items = Array.from(map.values())

      // 如果某个 session 在 NDJSON 中仍为 running，但当前内存中已经没有对应 session，
      // 则将其视为已结束的历史会话，状态标记为 closed，避免显示为“运行中”。
      try {
        items.forEach((s) => {
          if (!s || s.status !== 'running') return
          try {
            const live = getBrowserAgentSession(s.sessionId)
            if (!live) {
              s.status = 'closed'
            }
          } catch {}
        })
      } catch {}

      if (profileFilter) {
        items = items.filter((s) => s.profile === profileFilter)
      }
      if (clientIdFilter) {
        items = items.filter((s) => s.clientId === clientIdFilter)
      }
      if (statusFilter !== 'all') {
        items = items.filter((s) => s.status === statusFilter)
      }

      items.sort((a, b) => {
        const aKey = a.lastActionAt || a.createdAt || ''
        const bKey = b.lastActionAt || b.createdAt || ''
        if (!aKey && !bKey) return 0
        if (!aKey) return 1
        if (!bKey) return -1
        if (aKey === bKey) return 0
        return aKey < bKey ? 1 : -1
      })

      return { items }
    } catch {
      return { items: [] }
    }
  })

  ipcMain.handle('browserAgent:getSessionDetail', async (_event, payload) => {
    try {
      const sessionId =
        payload && typeof payload.sessionId === 'string' && payload.sessionId.trim()
          ? payload.sessionId.trim()
          : ''
      if (!sessionId) return null

      const date =
        payload && typeof payload.date === 'string' && payload.date.trim()
          ? payload.date.trim()
          : undefined

      /** @type {any[]} */
      const sessionRecords = readNdjson('sessions', date)
      /** @type {any[]} */
      const actionRecords = readNdjson('actions', date)
      /** @type {any[]} */
      const snapshotRecords = readNdjson('snapshots', date)
      /** @type {any[]} */
      const fileRecords = readNdjson('files', date)

      const normalizeStatus = (value) => {
        const raw = typeof value === 'string' ? value.toLowerCase() : ''
        if (raw === 'running') return 'running'
        if (raw === 'closed') return 'closed'
        return 'error'
      }

      /** @type {import('../shared/types').BrowserAgentSessionSummary | null} */
      let summary = null

      for (const rec of sessionRecords) {
        if (!rec || typeof rec !== 'object') continue
        const rawId = rec.sessionId
        const sid = typeof rawId === 'string' && rawId.trim() ? rawId.trim() : ''
        if (!sid || sid !== sessionId) continue

        if (!summary) {
          summary = {
            sessionId,
            profile: null,
            clientId: null,
            status: 'error',
            createdAt: null,
            finishedAt: null,
            lastErrorCode: null,
            lastErrorMessage: null,
            actionsCount: 0,
            lastActionAt: null,
            lastActionType: null,
            domain: null,
          }
        }

        if (typeof rec.profile === 'string') {
          summary.profile = rec.profile || null
        }
        if (typeof rec.clientId === 'string') {
          summary.clientId = rec.clientId || null
        }

        const createdAt = typeof rec.createdAt === 'string' && rec.createdAt ? rec.createdAt : null
        if (createdAt && (!summary.createdAt || createdAt < summary.createdAt)) {
          summary.createdAt = createdAt
        }

        const finishedAt = typeof rec.finishedAt === 'string' && rec.finishedAt ? rec.finishedAt : null
        if (finishedAt && (!summary.finishedAt || finishedAt > summary.finishedAt)) {
          summary.finishedAt = finishedAt
        }

        const status = normalizeStatus(rec.status)
        if (summary.status !== 'closed') {
          if (summary.status === 'error') {
            if (status === 'running' || status === 'closed') {
              summary.status = status
            }
          } else if (status === 'closed') {
            summary.status = 'closed'
          } else if (status === 'running') {
            summary.status = 'running'
          }
        }

        if (typeof rec.lastErrorCode === 'string') {
          summary.lastErrorCode = rec.lastErrorCode || null
        }
        if (typeof rec.lastErrorMessage === 'string') {
          summary.lastErrorMessage = rec.lastErrorMessage || null
        }
      }

      /** @type {Map<string, any>} */
      const snapshotById = new Map()
      for (const rec of snapshotRecords) {
        if (!rec || typeof rec !== 'object') continue
        const rawId = rec.snapshotId
        const sid = typeof rawId === 'string' && rawId.trim() ? rawId.trim() : ''
        if (!sid) continue
        snapshotById.set(sid, rec)
      }

      /** @type {Map<string, any>} */
      const fileByPath = new Map()
      for (const rec of fileRecords) {
        if (!rec || typeof rec !== 'object') continue
        const rawPath = rec.path
        const p = typeof rawPath === 'string' && rawPath.trim() ? rawPath.trim() : ''
        if (!p) continue
        fileByPath.set(p, rec)
      }

      /** @type {import('../shared/types').BrowserAgentActionTimelineItem[]} */
      const actions = []

      for (const rec of actionRecords) {
        if (!rec || typeof rec !== 'object') continue
        const rawSessionId = rec.sessionId
        const sid = typeof rawSessionId === 'string' && rawSessionId.trim() ? rawSessionId.trim() : ''
        if (!sid || sid !== sessionId) continue

        const rawId = rec.id
        const id = typeof rawId === 'string' && rawId.trim() ? rawId.trim() : ''
        if (!id) continue

        const type = typeof rec.type === 'string' ? rec.type : ''
        const params = rec && typeof rec.params === 'object' ? rec.params : null
        const startAt = typeof rec.startAt === 'string' && rec.startAt ? rec.startAt : null
        const endAt = typeof rec.endAt === 'string' && rec.endAt ? rec.endAt : null

        let durationMs = null
        if (startAt && endAt) {
          const startMs = Date.parse(startAt)
          const endMs = Date.parse(endAt)
          if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs) {
            durationMs = endMs - startMs
          }
        }

        const rawStatus = typeof rec.status === 'string' ? rec.status.toLowerCase() : ''
        const status = rawStatus === 'error' ? 'error' : 'ok'
        const errorCode = typeof rec.errorCode === 'string' ? rec.errorCode || null : null
        const errorMessage = typeof rec.errorMessage === 'string' ? rec.errorMessage || null : null
        let httpStatus = null
        if (
          rec &&
          rec.network &&
          typeof rec.network === 'object' &&
          typeof rec.network.httpStatus === 'number' &&
          Number.isFinite(rec.network.httpStatus)
        ) {
          // 优先展示真实站点的 HTTP 状态码（记录在 network.httpStatus 中）
          httpStatus = rec.network.httpStatus
        } else if (typeof rec.httpStatus === 'number' && Number.isFinite(rec.httpStatus)) {
          // 回退到外层 API 映射后的状态码，如 502/504
          httpStatus = rec.httpStatus
        }
        const network =
          rec && rec.network && typeof rec.network === 'object' ? rec.network : null
        const snapshotId =
          typeof rec.snapshotId === 'string' && rec.snapshotId.trim()
            ? rec.snapshotId.trim()
            : null

        /** @type {import('../shared/types').BrowserAgentActionTimelineItem['screenshot']} */
        let screenshot = null
        if (snapshotId) {
          const snap = snapshotById.get(snapshotId)
          if (snap && typeof snap === 'object') {
            const rawPath = snap.path
            const relPath = typeof rawPath === 'string' && rawPath.trim() ? rawPath.trim() : ''
            const file = relPath ? fileByPath.get(relPath) : null

            screenshot = {
              snapshotId,
              description:
                typeof snap.description === 'string' && snap.description
                  ? snap.description
                  : null,
              path: relPath,
              fileSize:
                file && typeof file.size === 'number' && Number.isFinite(file.size)
                  ? file.size
                  : null,
              mimeType:
                file && typeof file.mimeType === 'string' && file.mimeType
                  ? file.mimeType
                  : null,
            }
          }
        }

        actions.push({
          id,
          sessionId,
          type,
          params,
          startAt,
          endAt,
          durationMs,
          status,
          errorCode,
          errorMessage,
          snapshotId,
          screenshot,
          httpStatus,
          network,
        })
      }

      actions.sort((a, b) => {
        const aKey = a.startAt || a.endAt || ''
        const bKey = b.startAt || b.endAt || ''
        if (!aKey && !bKey) return 0
        if (!aKey) return 1
        if (!bKey) return -1
        if (aKey === bKey) return 0
        return aKey < bKey ? -1 : 1
      })

      if (!summary && actions.length === 0 && (!fileRecords || fileRecords.length === 0)) {
        return null
      }

      if (!summary) {
        summary = {
          sessionId,
          profile: null,
          clientId: null,
          status: 'error',
          createdAt: null,
          finishedAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          actionsCount: 0,
          lastActionAt: null,
          lastActionType: null,
          domain: null,
        }
      }

      summary.actionsCount = actions.length
      if (actions.length > 0) {
        const last = actions[actions.length - 1]
        summary.lastActionAt = last.endAt || last.startAt || summary.lastActionAt
        summary.lastActionType = last.type || summary.lastActionType
      }

      const files = []
      for (const rec of fileRecords) {
        if (!rec || typeof rec !== 'object') continue
        const rawSessionId = rec.sessionId
        const sid = typeof rawSessionId === 'string' && rawSessionId.trim() ? rawSessionId.trim() : ''
        if (!sid || sid !== sessionId) continue

        const rawFileId = rec.fileId
        const fileId = typeof rawFileId === 'string' && rawFileId.trim() ? rawFileId.trim() : null
        if (!fileId) continue

        const name =
          typeof rec.name === 'string' && rec.name.trim() ? rec.name.trim() : null
        const size =
          typeof rec.size === 'number' && Number.isFinite(rec.size) && rec.size >= 0
            ? rec.size
            : null
        const mimeType =
          typeof rec.mimeType === 'string' && rec.mimeType.trim()
            ? rec.mimeType.trim()
            : null
        const pathValue =
          typeof rec.path === 'string' && rec.path.trim() ? rec.path.trim() : null
        const createdAt =
          typeof rec.createdAt === 'string' && rec.createdAt.trim()
            ? rec.createdAt.trim()
            : null

        files.push({
          fileId,
          sessionId,
          name,
          size,
          mimeType,
          path: pathValue,
          createdAt,
        })
      }

      return {
        session: summary,
        actions,
        files,
      }
    } catch {
      return null
    }
  })

  ipcMain.handle('browserAgent:showSessionWindow', async (_event, payload) => {
    try {
      const sessionId =
        payload && typeof payload.sessionId === 'string' && payload.sessionId.trim()
          ? payload.sessionId.trim()
          : ''
      if (!sessionId) {
        return { success: false, reason: 'invalid_session_id', error: '无效的 Session ID。' }
      }

      const existing = getBrowserAgentSession(sessionId)
      if (!existing) {
        return {
          success: false,
          reason: 'session_not_found',
          error: 'Session 已不在内存中，可能已结束或应用已重启。',
        }
      }

      const updated = showBrowserAgentSession(sessionId) || existing
      const rawWindowId = updated && updated.windowId
      const windowId =
        typeof rawWindowId === 'number' && Number.isFinite(rawWindowId) && rawWindowId > 0
          ? rawWindowId
          : null

      if (!windowId) {
        return {
          success: false,
          reason: 'no_window_id',
          error: '该 Session 没有关联窗口，可能从未成功打开浏览器。',
        }
      }

      const win = getBrowserWindowById(windowId)
      if (!win) {
        return {
          success: false,
          reason: 'window_closed',
          error: '浏览器窗口已关闭，无法再次显示。',
        }
      }

      try {
        win.show()
        win.focus()
      } catch {}

      return { success: true }
    } catch (error) {
      const message = error && error.message ? String(error.message) : String(error || '')
      return { success: false, reason: 'error', error: message }
    }
  })

  ipcMain.handle('browserAgent:openSnapshot', async (_event, payload) => {
    try {
      const snapshotId =
        payload && typeof payload.snapshotId === 'string' && payload.snapshotId.trim()
          ? payload.snapshotId.trim()
          : ''
      if (!snapshotId) {
        return { success: false, error: '无效的截图 ID。' }
      }

      const date =
        payload && typeof payload.date === 'string' && payload.date.trim()
          ? payload.date.trim()
          : undefined

      /** @type {any[]} */
      const snapshotRecords = readNdjson('snapshots', date)

      let target = null
      for (const rec of snapshotRecords) {
        if (!rec || typeof rec !== 'object') continue
        const rawId = rec.snapshotId
        const sid = typeof rawId === 'string' && rawId.trim() ? rawId.trim() : ''
        if (!sid) continue
        if (sid === snapshotId) {
          target = rec
          break
        }
      }

      if (!target) {
        return { success: false, error: '未找到对应截图元数据。' }
      }

      const root = getBrowserAgentDataRootDir()
      if (!root) {
        return { success: false, error: 'Browser Agent 数据目录未配置或不可用。' }
      }

      const rawPath = target.path
      const relPath = typeof rawPath === 'string' && rawPath.trim() ? rawPath.trim() : ''
      if (!relPath) {
        return { success: false, error: '截图路径信息不完整。' }
      }

      const absPath = path.isAbsolute(relPath) ? relPath : path.join(root, relPath)

      try {
        const st = fs.statSync(absPath)
        if (!st || !st.isFile()) {
          return { success: false, error: '截图文件不存在或已被删除。' }
        }
      } catch {
        return { success: false, error: '截图文件不存在或已被删除。' }
      }

      try {
        const result = await shell.openPath(absPath)
        if (typeof result === 'string' && result.trim()) {
          return { success: false, error: result.trim() }
        }
      } catch (error) {
        const message = error && error.message ? String(error.message) : String(error || '')
        return { success: false, error: message }
      }

      return { success: true, error: null }
    } catch (error) {
      const message = error && error.message ? String(error.message) : String(error || '')
      return { success: false, error: message }
    }
  })

  ipcMain.handle('browserAgent:getRuntimeMetrics', async () => {
    try {
      if (!app || typeof app.getAppMetrics !== 'function') {
        return {
          cpuUsage: 0,
          memoryUsage: 0,
          runningSessions: 0,
          windowsCount: 0,
        }
      }

      /** @type {any[]} */
      let running = []
      try {
        running = listBrowserAgentSessions({ status: 'running' }) || []
      } catch {
        running = []
      }

      const windowIds = []
      for (const s of running) {
        if (!s || typeof s.windowId !== 'number') continue
        const id = s.windowId
        if (!Number.isFinite(id) || id <= 0) continue
        windowIds.push(id)
      }

      if (windowIds.length === 0) {
        return {
          cpuUsage: 0,
          memoryUsage: 0,
          runningSessions: running.length,
          windowsCount: 0,
        }
      }

      const pids = new Set()
      for (const id of windowIds) {
        try {
          const win = getBrowserWindowById(id)
          if (!win) continue
          const contents = win.webContents
          if (!contents) continue
          let pid = null
          if (typeof contents.getOSProcessId === 'function') {
            pid = contents.getOSProcessId()
          } else if (typeof contents.getProcessId === 'function') {
            pid = contents.getProcessId()
          }
          if (typeof pid === 'number' && Number.isFinite(pid) && pid > 0) {
            pids.add(pid)
          }
        } catch {}
      }

      if (pids.size === 0) {
        return {
          cpuUsage: 0,
          memoryUsage: 0,
          runningSessions: running.length,
          windowsCount: windowIds.length,
        }
      }

      let totalCpu = 0
      let totalMem = 0

      try {
        const metrics = app.getAppMetrics() || []
        for (const m of metrics) {
          if (!m || !pids.has(m.pid)) continue
          try {
            const cpu = m.cpu && typeof m.cpu.percentCPUUsage === 'number' ? m.cpu.percentCPUUsage : 0
            const memKb =
              m.memory && typeof m.memory.workingSetSize === 'number' ? m.memory.workingSetSize : 0
            if (cpu > 0) totalCpu += cpu
            if (memKb > 0) {
              totalMem += memKb * 1024
            }
          } catch {}
        }
      } catch {}

      const clamp = (v) => {
        if (v == null || Number.isNaN(v)) return 0
        return Math.max(0, Math.min(100, v))
      }

      let cpuPercent = clamp(totalCpu)
      let memPercent = 0

      if (totalMem > 0) {
        try {
          const memInfo = await si.mem()
          const total = typeof memInfo.total === 'number' ? memInfo.total : 0
          if (total > 0) {
            memPercent = clamp((totalMem / total) * 100)
          }
        } catch {}
      }

      return {
        cpuUsage: cpuPercent,
        memoryUsage: memPercent,
        runningSessions: running.length,
        windowsCount: windowIds.length,
      }
    } catch {
      return {
        cpuUsage: 0,
        memoryUsage: 0,
        runningSessions: 0,
        windowsCount: 0,
      }
    }
  })

  ipcMain.handle('browserView:openModule', async (_event, payload) => {
    const moduleId = payload && typeof payload.moduleId === 'string' ? payload.moduleId : undefined
    return openModuleBrowserView(moduleId)
  })

  ipcMain.handle('browserView:close', async () => {
    return closeBrowserView()
  })

  ipcMain.handle('browserView:control', async (_event, payload) => {
    const moduleId = payload && typeof payload.moduleId === 'string' ? payload.moduleId : undefined
    const action = payload && typeof payload.action === 'string' ? payload.action : undefined
    return controlModuleBrowserView(moduleId, action)
  })

  // Monitoring
  ipcMain.handle('monitor:getSystem', async () => {
    try {
      const [load, mem, fsInfo] = await Promise.all([
        si.currentLoad(),
        si.mem(),
        si.fsSize(),
      ])

      const cpuUsage = typeof load.currentLoad === 'number' ? load.currentLoad : 0

      const totalMem = typeof mem.total === 'number' ? mem.total : 0
      const usedMem =
        typeof mem.active === 'number'
          ? mem.active
          : typeof mem.used === 'number'
          ? mem.used
          : 0
      const memoryUsage = totalMem > 0 ? (usedMem / totalMem) * 100 : 0

      let diskTotal = 0
      let diskUsed = 0
      if (Array.isArray(fsInfo)) {
        for (const d of fsInfo) {
          const size = typeof d.size === 'number' ? d.size : 0
          const used = typeof d.used === 'number' ? d.used : 0
          diskTotal += size
          diskUsed += used
        }
      }
      const diskUsage = diskTotal > 0 ? (diskUsed / diskTotal) * 100 : 0

      const clamp = (v) => Math.max(0, Math.min(100, v))

      return {
        cpuUsage: clamp(cpuUsage),
        memoryUsage: clamp(memoryUsage),
        memoryTotal: totalMem,
        memoryUsed: usedMem,
        diskUsage: clamp(diskUsage),
        diskTotal,
        diskUsed,
      }
    } catch {
      return {
        cpuUsage: 0,
        memoryUsage: 0,
        memoryTotal: 0,
        memoryUsed: 0,
        diskUsage: 0,
        diskTotal: 0,
        diskUsed: 0,
      }
    }
  })

  ipcMain.handle('monitor:getModules', async () => {
    /** @type {import('../shared/types').ModuleRuntimeMetrics[]} */
    const items = []

    let containers = []
    try {
      const dockerStatus = await detectDockerStatus()
      if (!dockerStatus.installed || !dockerStatus.running) {
        return { items }
      }
      const docker = getDockerClient()
      containers = await docker.listContainers({ all: true })

      const getModuleStatus = (info) => {
        if (!info) return 'stopped'
        const state = String(info.State || '').toLowerCase()
        if (state === 'running') return 'running'
        if (state === 'restarting') return 'starting'
        if (state === 'dead') return 'error'
        return 'stopped'
      }

      for (const m of modules) {
        const config = moduleDockerConfig[m.id]
        if (!config) continue

        const info =
          containers.find((c) => {
            if (!Array.isArray(c.Names)) return false
            return c.Names.some((name) =>
              config.containerNames.some(
                (needle) => typeof name === 'string' && name.includes(needle),
              ),
            )
          }) || null

        let cpuUsage = null
        let memoryUsage = null
        let startedAt = null
        let uptimeSeconds = null
        const status = getModuleStatus(info)

        if (info && status === 'running') {
          try {
            const container = getDockerClient().getContainer(info.Id)
            const stats = await container.stats({ stream: false })

            if (stats && stats.cpu_stats && stats.precpu_stats) {
              const cpuDelta =
                (stats.cpu_stats.cpu_usage.total_usage || 0) -
                (stats.precpu_stats.cpu_usage.total_usage || 0)
              const systemDelta =
                (stats.cpu_stats.system_cpu_usage || 0) -
                (stats.precpu_stats.system_cpu_usage || 0)
              const cpuCount =
                stats.cpu_stats.online_cpus ||
                (stats.cpu_stats.cpu_usage.percpu_usage
                  ? stats.cpu_stats.cpu_usage.percpu_usage.length
                  : 1)
              if (cpuDelta > 0 && systemDelta > 0) {
                cpuUsage = (cpuDelta / systemDelta) * cpuCount * 100
              }
            }

            if (stats && stats.memory_stats) {
              const used = stats.memory_stats.usage || 0
              const limit = stats.memory_stats.limit || 0
              if (limit > 0) {
                memoryUsage = (used / limit) * 100
              }
            }

            const inspectData = await container.inspect()
            const startedRaw =
              inspectData &&
              inspectData.State &&
              typeof inspectData.State.StartedAt === 'string'
                ? inspectData.State.StartedAt
                : null

            if (startedRaw) {
              const startedMs = Date.parse(startedRaw)
              if (!Number.isNaN(startedMs)) {
                const diffSeconds = Math.floor((Date.now() - startedMs) / 1000)
                uptimeSeconds = diffSeconds > 0 ? diffSeconds : 0
                startedAt = new Date(startedMs).toISOString()
              }
            }
          } catch {
            // ignore stats errors
          }
        }

        const clamp = (v) =>
          v == null || Number.isNaN(v) ? null : Math.max(0, Math.min(100, v))

        items.push({
          moduleId: m.id,
          name: m.name,
          status,
          cpuUsage: clamp(cpuUsage),
          memoryUsage: clamp(memoryUsage),
          startedAt,
          uptimeSeconds,
        })
      }

      return { items }
    } catch {
      return { items }
    }
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
    const image = payload && typeof payload.image === 'string' ? payload.image : undefined
    return pullDockerImage(image)
  })

  // Settings
  ipcMain.handle('settings:get', async () => {
    return appSettings
  })

  ipcMain.handle('settings:update', async (_event, patch) => {
    const previous = appSettings
    appSettings = mergeAppSettings(appSettings, patch)
    saveSettingsToDisk(appSettings)
    setAppSettings(appSettings)

    try {
      const prevAgent = previous && previous.browserAgent
      const nextAgent = appSettings && appSettings.browserAgent
      const prevEnabled = !!(prevAgent && typeof prevAgent.enabled === 'boolean' ? prevAgent.enabled : false)
      const nextEnabled = !!(nextAgent && typeof nextAgent.enabled === 'boolean' ? nextAgent.enabled : false)

      if (!prevEnabled && nextEnabled) {
        startBrowserAgentServer()
      } else if (prevEnabled && !nextEnabled) {
        stopBrowserAgentServer()
      }
    } catch {}

    return appSettings
  })
}
