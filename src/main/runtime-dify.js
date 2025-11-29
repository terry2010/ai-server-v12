import http from 'node:http'

import {
  MANAGED_NETWORK_NAME,
  N8N_DB_CONTAINER_NAME,
  REDIS_CONTAINER_NAME,
  DIFY_DATA_VOLUME_NAME,
  moduleImageMap,
} from './config.js'
import {
  applyHostTimeZoneToEnv,
  ensureNetworkExists,
  ensureVolumeExists,
  ensureImagePresent,
  resolveLocalImageReference,
  delay,
} from './docker-utils.js'
import { getDockerClient } from './docker-client.js'
import { ensureN8nPostgres, ensureDifyDatabase } from './runtime-n8n.js'
import { ensureOneApiRedis } from './runtime-oneapi.js'
import { defaultAppSettings, getAppSettings, isVerboseLoggingEnabled } from './app-settings.js'

/**
 * 等待 Dify Web HTTP 服务就绪
 * 与原来 ipc-handlers.js 中的实现保持逻辑一致
 */
async function waitForDifyWebReady(port, timeoutMs = 60000, intervalMs = 2000) {
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
            resolve({
              statusCode: res.statusCode || 0,
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
      if (statusCode >= 200 && statusCode < 400) {
        if (isVerboseLoggingEnabled()) {
          console.log('[dify] HTTP 就绪检查通过', { port, statusCode })
        }
        return
      }

      if (isVerboseLoggingEnabled()) {
        console.log('[dify] HTTP 仍在启动中', {
          port,
          statusCode,
        })
      }
    } catch (error) {
      if (isVerboseLoggingEnabled()) {
        console.log('[dify] HTTP 就绪检查重试中', {
          port,
          error: String(error),
        })
      }
    }

    if (Date.now() - start >= timeoutMs) {
      throw new Error('Dify Web HTTP ready timeout')
    }

    await delay(intervalMs)
  }
}

/**
 * 确保 Dify 运行时（Postgres + Redis + API/Web 容器）就绪
 * 复用 n8n 的 Postgres 和 OneAPI 的 Redis，实现与原 ipc-handlers.js 相同的行为
 */
async function ensureDifyRuntime() {
  if (isVerboseLoggingEnabled()) {
    console.log('[dify] ensureDifyRuntime: start')
  }

  const docker = getDockerClient()

  // 复用 n8n 的 Postgres 数据库
  const pgResult = await ensureN8nPostgres()
  if (!pgResult || !pgResult.success || !pgResult.dbConfig) {
    if (isVerboseLoggingEnabled()) {
      console.error('[dify] ensureDifyRuntime: Postgres 准备失败', pgResult && pgResult.error)
    }
    return {
      success: false,
      error: (pgResult && pgResult.error) || '启动 Dify 依赖的数据库失败。',
    }
  }

  const dbResult = await ensureDifyDatabase(pgResult.dbConfig)
  if (!dbResult || !dbResult.success || !dbResult.dbConfig) {
    if (isVerboseLoggingEnabled()) {
      console.error(
        '[dify] ensureDifyRuntime: 初始化 Dify 独立数据库失败',
        dbResult && dbResult.error,
      )
    }
    return {
      success: false,
      error: (dbResult && dbResult.error) || '初始化 Dify 使用的数据库失败。',
    }
  }

  // 复用 OneAPI 的 Redis 服务
  const redisResult = await ensureOneApiRedis()
  if (!redisResult || !redisResult.success || !redisResult.redisConfig) {
    if (isVerboseLoggingEnabled()) {
      console.error('[dify] ensureDifyRuntime: Redis 准备失败', redisResult && redisResult.error)
    }
    return {
      success: false,
      error: (redisResult && redisResult.error) || '启动 Dify 依赖的 Redis 失败。',
    }
  }

  const settings = getAppSettings()
  const moduleSettings =
    settings && settings.modules && settings.modules.dify
      ? settings.modules.dify
      : defaultAppSettings.modules.dify

  const basePort = moduleSettings.port || defaultAppSettings.modules.dify.port

  const envFromSettings = (moduleSettings && moduleSettings.env) || {}

  const dbUrl = moduleSettings.databaseUrl || ''

  const difyDb = dbResult.dbConfig
  const dbHost = envFromSettings.DB_HOST || difyDb.host || N8N_DB_CONTAINER_NAME
  const dbPort = envFromSettings.DB_PORT || String(difyDb.port || 5432)
  const dbUser = envFromSettings.DB_USERNAME || difyDb.user || 'postgres'
  const dbPassword = envFromSettings.DB_PASSWORD || difyDb.password || ''
  const dbName =
    envFromSettings.DB_DATABASE || (difyDb && difyDb.database ? difyDb.database : 'dify')

  const sharedRedis = redisResult.redisConfig
  const redisHost = envFromSettings.REDIS_HOST || sharedRedis.host || REDIS_CONTAINER_NAME
  const redisPort = envFromSettings.REDIS_PORT || String(sharedRedis.port || 6379)
  const redisPassword = envFromSettings.REDIS_PASSWORD || ''

  /** @type {string[]} */
  const sharedEnv = []

  if (dbUrl) {
    sharedEnv.push(`DB_DATABASE_URL=${dbUrl}`)
  } else {
    sharedEnv.push(`DB_USERNAME=${dbUser}`)
    sharedEnv.push(`DB_PASSWORD=${dbPassword}`)
    sharedEnv.push(`DB_HOST=${dbHost}`)
    sharedEnv.push(`DB_PORT=${dbPort}`)
    sharedEnv.push(`DB_DATABASE=${dbName}`)
  }

  sharedEnv.push(`REDIS_HOST=${redisHost}`)
  sharedEnv.push(`REDIS_PORT=${redisPort}`)
  sharedEnv.push('REDIS_DB=1')
  if (redisPassword) {
    sharedEnv.push(`REDIS_PASSWORD=${redisPassword}`)
  }

  // 确保启动时自动执行数据库迁移，创建 dify_setups 等表
  sharedEnv.push('MIGRATION_ENABLED=true')

  sharedEnv.push('STORAGE_TYPE=opendal')
  sharedEnv.push('OPENDAL_SCHEME=fs')
  sharedEnv.push('OPENDAL_FS_ROOT=storage')

  sharedEnv.push('WEB_API_CORS_ALLOW_ORIGINS=*')
  sharedEnv.push('CONSOLE_CORS_ALLOW_ORIGINS=*')

  for (const [key, value] of Object.entries(envFromSettings)) {
    if (typeof value !== 'string') continue
    if (
      key === 'DB_DATABASE_URL' ||
      key === 'DB_USERNAME' ||
      key === 'DB_PASSWORD' ||
      key === 'DB_HOST' ||
      key === 'DB_PORT' ||
      key === 'DB_DATABASE' ||
      key === 'REDIS_HOST' ||
      key === 'REDIS_PORT' ||
      key === 'REDIS_PASSWORD'
    ) {
      continue
    }
    sharedEnv.push(`${key}=${value}`)
  }

  applyHostTimeZoneToEnv(sharedEnv)

  const apiContainerName = 'ai-server-dify-api'
  const webContainerName = 'ai-server-dify-web'

  const ensureService = async (serviceName, imageKey, extraEnv, hostPort, containerPort) => {
    let info = null
    try {
      const list = await docker.listContainers({
        all: true,
        filters: {
          name: [serviceName],
        },
      })
      if (Array.isArray(list) && list.length > 0) {
        info = list[0]
      }
    } catch {
      info = null
    }

    const exposedPortKey = `${containerPort}/tcp`

    if (info) {
      const container = docker.getContainer(info.Id)
      try {
        await ensureNetworkExists()
        const network = docker.getNetwork(MANAGED_NETWORK_NAME)
        await network.connect({ Container: info.Id }).catch(() => undefined)
      } catch {}

      const state = String(info.State || '').toLowerCase()
      if (state !== 'running') {
        try {
          await container.start()
        } catch (error) {
          const message = error && error.message ? error.message : String(error)
          return {
            success: false,
            error: `启动 ${serviceName} 容器失败：${message}`,
          }
        }
      }

      return { success: true }
    }

    const image = moduleImageMap[imageKey]
    const imageEnsure = await ensureImagePresent(image)
    if (!imageEnsure.ok) {
      return imageEnsure.errorResult
    }

    try {
      await ensureNetworkExists()

      /** @type {string[]} */
      const binds = []
      if (serviceName === apiContainerName) {
        await ensureVolumeExists(DIFY_DATA_VOLUME_NAME)
        binds.push(`${DIFY_DATA_VOLUME_NAME}:/app/api/storage`)
      }

      const imageRef = await resolveLocalImageReference(image)
      const env = [...sharedEnv, ...extraEnv]
      applyHostTimeZoneToEnv(env)

      const container = await docker.createContainer({
        name: serviceName,
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
                HostPort: String(hostPort),
              },
            ],
          },
          ...(binds.length
            ? {
                Binds: binds,
              }
            : {}),
        },
        NetworkingConfig: {
          EndpointsConfig: {
            [MANAGED_NETWORK_NAME]: {
              Aliases: [serviceName],
            },
          },
        },
      })

      await container.start()
      return { success: true }
    } catch (error) {
      const message = error && error.message ? error.message : String(error)
      return {
        success: false,
        error: `创建 ${serviceName} 容器失败：${message}`,
      }
    }
  }

  const apiPort = 5001
  const webPort = basePort

  const apiResult = await ensureService(
    apiContainerName,
    'difyApi',
    ['MODE=api'],
    apiPort,
    apiPort,
  )
  if (!apiResult || !apiResult.success) {
    return apiResult
  }

  const webResult = await ensureService(
    webContainerName,
    'difyWeb',
    [`CONSOLE_API_URL=http://localhost:${apiPort}`],
    webPort,
    3000,
  )
  if (!webResult || !webResult.success) {
    return webResult
  }

  try {
    await waitForDifyWebReady(webPort, 60000, 3000)
  } catch (error) {
    if (isVerboseLoggingEnabled()) {
      console.error('[dify] ensureDifyRuntime: Web 就绪检查失败', error)
    }
  }

  if (isVerboseLoggingEnabled()) {
    console.log('[dify] ensureDifyRuntime: Dify API/Web 已就绪', {
      apiPort,
      webPort,
    })
  }

  return { success: true }
}

export { ensureDifyRuntime, waitForDifyWebReady }
