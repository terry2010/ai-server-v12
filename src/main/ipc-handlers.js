import { app, ipcMain, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import si from 'systeminformation'
import {
  setAppSettings,
  defaultAppSettings,
  loadSettingsFromDisk,
  mergeAppSettings,
  saveSettingsToDisk,
} from './app-settings.js'
import { modules, moduleDockerConfig } from './config.js'
import { getDockerClient, detectDockerStatus, startDockerDesktop } from './docker-client.js'
import {
  ensureImagePresentForModule,
  maybeStopBaseServicesForModule,
  dockerStopAllContainers,
  dockerRemoveAllContainers,
  dockerPruneVolumes,
  dockerFullCleanup,
  pullDockerImage,
} from './docker-utils.js'
import { ensureN8nRuntime } from './runtime-n8n.js'
import { ensureOneApiRuntime as ensureOneApiRuntimeExt } from './runtime-oneapi.js'
import { ensureDifyRuntime } from './runtime-dify.js'
import { ensureRagflowRuntime } from './runtime-ragflow.js'

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
      const userDataDir = app.getPath('userData')
      const logsDir = path.join(userDataDir, 'logs')
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
    appSettings = mergeAppSettings(appSettings, patch)
    saveSettingsToDisk(appSettings)
    setAppSettings(appSettings)
    return appSettings
  })
}
