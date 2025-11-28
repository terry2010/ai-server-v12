import http from 'node:http'

import {
  MANAGED_NETWORK_NAME,
  MYSQL_DB_IMAGE,
  MYSQL_DB_CONTAINER_NAME,
  MYSQL_DB_VOLUME_NAME,
  ONEAPI_DATA_VOLUME_NAME,
  REDIS_IMAGE,
  REDIS_CONTAINER_NAME,
  REDIS_DATA_VOLUME_NAME,
  moduleDockerConfig,
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
import {
  defaultAppSettings,
  ensureOneApiSecretsInSettings,
  isVerboseLoggingEnabled,
  generateRandomPassword,
  getAppSettings,
} from './app-settings.js'

/**
 * 确保 OneAPI 依赖的 MySQL 容器存在并运行
 */
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

    // 默认与新建容器分支保持一致，使用 root 账号和 rag_flow 数据库，
    // 密码为 infini_rag_flow，方便与 RagFlow 共用同一个 MySQL 实例。
    let dbUser = 'root'
    let dbName = 'rag_flow'
    let dbPassword = 'infini_rag_flow'

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

      // 如果使用的是官方 MySQL 镜像且只设置了 MYSQL_ROOT_PASSWORD，
      // 则按 root 账号推断密码，确保与容器实际配置一致。
      if (!envMap.MYSQL_USER && !envMap.MYSQL_PASSWORD && envMap.MYSQL_ROOT_PASSWORD) {
        dbUser = 'root'
        dbPassword = envMap.MYSQL_ROOT_PASSWORD
      }
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

  // 与 RagFlow 默认的 service_conf.yaml 保持一致：
  // mysql:
  //   name: 'rag_flow'
  //   user: 'root'
  //   password: 'infini_rag_flow'
  const dbUser = 'root'
  const dbName = 'rag_flow'
  const dbPassword = 'infini_rag_flow'

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
    const env = [
      // 只使用 root 账号，并将密码固定为 RagFlow 预期的 infini_rag_flow，
      // 这样 RagFlow 和 OneAPI 可以共用同一个数据库实例。
      `MYSQL_ROOT_PASSWORD=${dbPassword}`,
      `MYSQL_DATABASE=${dbName}`,
    ]
    applyHostTimeZoneToEnv(env)

    const container = await docker.createContainer({
      name: MYSQL_DB_CONTAINER_NAME,
      Image: imageRef,
      Env: env,
      HostConfig: {
        RestartPolicy: {
          Name: 'always',
        },
        Binds: [`${MYSQL_DB_VOLUME_NAME}:/var/lib/mysql`],
      },
      NetworkingConfig: {
        EndpointsConfig: {
          [MANAGED_NETWORK_NAME]: {
            Aliases: [MYSQL_DB_CONTAINER_NAME, 'mysql'],
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

/**
 * 确保 OneAPI 依赖的 Redis 容器存在并运行
 */
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
    const redisEnv = []
    applyHostTimeZoneToEnv(redisEnv)

    const container = await docker.createContainer({
      name: REDIS_CONTAINER_NAME,
      Image: imageRef,
      Env: redisEnv,
      HostConfig: {
        RestartPolicy: {
          Name: 'always',
        },
        Binds: [`${REDIS_DATA_VOLUME_NAME}:/data`],
      },
      NetworkingConfig: {
        EndpointsConfig: {
          [MANAGED_NETWORK_NAME]: {
            Aliases: [REDIS_CONTAINER_NAME, 'redis'],
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

/**
 * 确保 OneAPI 应用容器存在并运行
 */
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

  const settings = getAppSettings()

  const exposedPortKey = '3000/tcp'
  const basePort =
    (settings &&
      settings.modules &&
      settings.modules.oneapi &&
      settings.modules.oneapi.port) ||
    defaultAppSettings.modules.oneapi.port

  const dsn = `${dbConfig.user}:${dbConfig.password}@tcp(${dbConfig.host}:${
    dbConfig.port || 3306
  })/${dbConfig.database}`

  const redisHost =
    redisConfig && redisConfig.host ? redisConfig.host : REDIS_CONTAINER_NAME
  const redisPort = redisConfig && redisConfig.port ? redisConfig.port : 6379

  const env = [
    `SQL_DSN=${dsn}`,
    `SESSION_SECRET=${generateRandomPassword(32)}`,
    `REDIS_CONN_STRING=redis://${redisHost}:${redisPort}`,
    'SYNC_FREQUENCY=60',
  ]

  const extraEnv =
    (settings &&
      settings.modules &&
      settings.modules.oneapi &&
      settings.modules.oneapi.env) ||
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

/**
 * HTTP 就绪检查：等待 OneAPI 对 /api/status 返回 success:true
 */
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

/**
 * 确保 OneAPI 运行时（MySQL + Redis + 应用容器）就绪
 */
async function ensureOneApiRuntime() {
  if (isVerboseLoggingEnabled()) {
    console.log('[oneapi] ensureOneApiRuntime: start')
  }

  ensureOneApiSecretsInSettings()

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

  const settings = getAppSettings()

  const hostPort =
    (settings &&
      settings.modules &&
      settings.modules.oneapi &&
      settings.modules.oneapi.port) ||
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

export { ensureOneApiMysql, ensureOneApiRedis, ensureOneApiContainer, waitForOneApiReady, ensureOneApiRuntime }
