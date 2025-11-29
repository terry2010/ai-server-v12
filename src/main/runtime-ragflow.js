import http from 'node:http'
import path from 'node:path'

import {
  MANAGED_NETWORK_NAME,
  MYSQL_DB_CONTAINER_NAME,
  MYSQL_DB_VOLUME_NAME,
  MINIO_IMAGE,
  MINIO_CONTAINER_NAME,
  MINIO_DATA_VOLUME_NAME,
  REDIS_CONTAINER_NAME,
  ELASTICSEARCH_IMAGE,
  ELASTICSEARCH_CONTAINER_NAME,
  ELASTICSEARCH_DATA_VOLUME_NAME,
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
import { ensureOneApiMysql, ensureOneApiRedis, ensureRagflowDatabase } from './runtime-oneapi.js'
import { defaultAppSettings, getAppSettings, isVerboseLoggingEnabled } from './app-settings.js'

async function ensureRagflowElasticsearch() {
  const docker = getDockerClient()

  let volumeExists = false
  try {
    const volResult = await docker.listVolumes({
      filters: {
        name: [ELASTICSEARCH_DATA_VOLUME_NAME],
      },
    })
    if (volResult && Array.isArray(volResult.Volumes) && volResult.Volumes.length > 0) {
      volumeExists = true
    }
  } catch (error) {
    if (isVerboseLoggingEnabled()) {
      console.error('[ragflow] 检查 Elasticsearch 数据卷状态失败', error)
    }
  }

  if (isVerboseLoggingEnabled()) {
    console.log('[ragflow] ensureRagflowElasticsearch: checking existing Elasticsearch 容器', {
      containerName: ELASTICSEARCH_CONTAINER_NAME,
      volume: ELASTICSEARCH_DATA_VOLUME_NAME,
      volumeExists,
    })
  }

  let containers
  try {
    containers = await docker.listContainers({
      all: true,
      filters: {
        name: [ELASTICSEARCH_CONTAINER_NAME],
      },
    })
  } catch (error) {
    const message = error && error.message ? error.message : String(error)
    return {
      success: false,
      error: `检查 RagFlow 依赖的 Elasticsearch 容器失败：${message}`,
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
        console.error('[ragflow] 连接 Elasticsearch 容器到网络失败', error)
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
          error: `启动 RagFlow 依赖的 Elasticsearch 容器失败：${message}`,
        }
      }
    }

    if (isVerboseLoggingEnabled()) {
      console.log('[ragflow] Elasticsearch 容器已就绪', {
        host: 'es01',
        port: 9200,
        containerName: ELASTICSEARCH_CONTAINER_NAME,
      })
    }

    return {
      success: true,
      esConfig: {
        host: 'es01',
        port: 9200,
        user: 'elastic',
        password: 'infini_rag_flow',
      },
    }
  }

  if (volumeExists) {
    try {
      if (isVerboseLoggingEnabled()) {
        console.log('[ragflow] 检测到无 Elasticsearch 容器但存在数据卷，将尝试继续复用该数据卷', {
          volume: ELASTICSEARCH_DATA_VOLUME_NAME,
        })
      }
    } catch {}
  }

  await ensureVolumeExists(ELASTICSEARCH_DATA_VOLUME_NAME)

  const imageEnsure = await ensureImagePresent(ELASTICSEARCH_IMAGE)
  if (!imageEnsure.ok) {
    const message =
      imageEnsure.errorResult && imageEnsure.errorResult.error
        ? imageEnsure.errorResult.error
        : '拉取 Elasticsearch 镜像失败，无法启动 RagFlow。'
    return {
      success: false,
      error: message,
    }
  }

  try {
    await ensureNetworkExists()
    const imageRef = await resolveLocalImageReference(ELASTICSEARCH_IMAGE)
    const env = []
    env.push('node.name=es01')
    env.push('bootstrap.memory_lock=false')
    env.push('discovery.type=single-node')
    env.push('xpack.security.enabled=false')
    env.push('cluster.routing.allocation.disk.watermark.low=5gb')
    env.push('cluster.routing.allocation.disk.watermark.high=3gb')
    env.push('cluster.routing.allocation.disk.watermark.flood_stage=2gb')
    applyHostTimeZoneToEnv(env)

    const container = await docker.createContainer({
      name: ELASTICSEARCH_CONTAINER_NAME,
      Image: imageRef,
      Env: env,
      ExposedPorts: {
        '9200/tcp': {},
        '9300/tcp': {},
      },
      HostConfig: {
        RestartPolicy: {
          Name: 'always',
        },
        Binds: [`${ELASTICSEARCH_DATA_VOLUME_NAME}:/usr/share/elasticsearch/data`],
        PortBindings: {
          '9200/tcp': [
            {
              HostPort: '9200',
            },
          ],
          '9300/tcp': [
            {
              HostPort: '9300',
            },
          ],
        },
      },
      NetworkingConfig: {
        EndpointsConfig: {
          [MANAGED_NETWORK_NAME]: {
            Aliases: [ELASTICSEARCH_CONTAINER_NAME, 'es01'],
          },
        },
      },
    })

    await container.start()

    if (isVerboseLoggingEnabled()) {
      console.log('[ragflow] 新的 Elasticsearch 容器创建并启动成功', {
        containerName: ELASTICSEARCH_CONTAINER_NAME,
        imageRef,
      })
    }

    return {
      success: true,
      esConfig: {
        host: 'es01',
        port: 9200,
        user: 'elastic',
        password: 'infini_rag_flow',
      },
    }
  } catch (error) {
    const message = error && error.message ? error.message : String(error)
    return {
      success: false,
      error: `创建 RagFlow 依赖的 Elasticsearch 容器失败：${message}`,
    }
  }
}

/**
 * 确保 RagFlow 依赖的 MinIO 容器存在并运行
 */
async function ensureRagflowMinio() {
  const docker = getDockerClient()

  let volumeExists = false
  try {
    const volResult = await docker.listVolumes({
      filters: {
        name: [MINIO_DATA_VOLUME_NAME],
      },
    })
    if (volResult && Array.isArray(volResult.Volumes) && volResult.Volumes.length > 0) {
      volumeExists = true
    }
  } catch (error) {
    if (isVerboseLoggingEnabled()) {
      console.error('[ragflow] 检查 MinIO 数据卷状态失败', error)
    }
  }

  if (isVerboseLoggingEnabled()) {
    console.log('[ragflow] ensureRagflowMinio: checking existing MinIO 容器', {
      containerName: MINIO_CONTAINER_NAME,
      volume: MINIO_DATA_VOLUME_NAME,
      volumeExists,
    })
  }

  let containers
  try {
    containers = await docker.listContainers({
      all: true,
      filters: {
        name: [MINIO_CONTAINER_NAME],
      },
    })
  } catch (error) {
    const message = error && error.message ? error.message : String(error)
    return {
      success: false,
      error: `检查 RagFlow 依赖的 MinIO 容器失败：${message}`,
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
        console.error('[ragflow] 连接 MinIO 容器到网络失败', error)
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
          error: `启动 RagFlow 依赖的 MinIO 容器失败：${message}`,
        }
      }
    }

    if (isVerboseLoggingEnabled()) {
      console.log('[ragflow] MinIO 容器已就绪', {
        host: MINIO_CONTAINER_NAME,
        port: 9000,
      })
    }

    return {
      success: true,
      minioConfig: {
        host: MINIO_CONTAINER_NAME,
        port: 9000,
        consolePort: 9001,
        accessKey: 'rag_flow',
        secretKey: 'infini_rag_flow',
      },
    }
  }

  if (volumeExists) {
    try {
      if (isVerboseLoggingEnabled()) {
        console.log('[ragflow] 检测到无 MinIO 容器但存在数据卷，将尝试继续复用该数据卷', {
          volume: MINIO_DATA_VOLUME_NAME,
        })
      }
    } catch {
      // ignore
    }
  }

  await ensureVolumeExists(MINIO_DATA_VOLUME_NAME)

  const imageEnsure = await ensureImagePresent(MINIO_IMAGE)
  if (!imageEnsure.ok) {
    const message =
      imageEnsure.errorResult && imageEnsure.errorResult.error
        ? imageEnsure.errorResult.error
        : '拉取 MinIO 镜像失败，无法启动 RagFlow。'
    return {
      success: false,
      error: message,
    }
  }

  try {
    await ensureNetworkExists()
    const imageRef = await resolveLocalImageReference(MINIO_IMAGE)
    /** @type {string[]} */
    const env = []
    env.push('MINIO_ROOT_USER=rag_flow')
    env.push('MINIO_ROOT_PASSWORD=infini_rag_flow')
    applyHostTimeZoneToEnv(env)

    const container = await docker.createContainer({
      name: MINIO_CONTAINER_NAME,
      Image: imageRef,
      Env: env,
      Cmd: ['server', '--console-address', ':9001', '/data'],
      ExposedPorts: {
        '9000/tcp': {},
        '9001/tcp': {},
      },
      HostConfig: {
        RestartPolicy: {
          Name: 'always',
        },
        Binds: [`${MINIO_DATA_VOLUME_NAME}:/data`],
      },
      NetworkingConfig: {
        EndpointsConfig: {
          [MANAGED_NETWORK_NAME]: {
            Aliases: [MINIO_CONTAINER_NAME, 'minio'],
          },
        },
      },
    })

    await container.start()

    if (isVerboseLoggingEnabled()) {
      console.log('[ragflow] 新的 MinIO 容器创建并启动成功', {
        containerName: MINIO_CONTAINER_NAME,
        imageRef,
      })
    }

    return {
      success: true,
      minioConfig: {
        host: MINIO_CONTAINER_NAME,
        port: 9000,
        consolePort: 9001,
        accessKey: 'rag_flow',
        secretKey: 'infini_rag_flow',
      },
    }
  } catch (error) {
    const message = error && error.message ? error.message : String(error)
    return {
      success: false,
      error: `创建 RagFlow 依赖的 MinIO 容器失败：${message}`,
    }
  }
}

/**
 * 确保 RagFlow 应用容器存在并运行
 */
async function ensureRagflowContainer(dbConfig, redisConfig, minioConfig) {
  const docker = getDockerClient()
  const containerName =
    (moduleDockerConfig.ragflow && moduleDockerConfig.ragflow.containerNames[0]) ||
    'ai-server-ragflow'

  if (isVerboseLoggingEnabled()) {
    console.log('[ragflow] ensureRagflowContainer: checking existing RagFlow 容器', {
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
      error: `检查 RagFlow 容器失败：${message}`,
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
        console.error('[ragflow] 连接 RagFlow 容器到网络失败', error)
      }
    }

    const state = String(info.State || '').toLowerCase()
    if (state === 'running') {
      if (isVerboseLoggingEnabled()) {
        console.log('[ragflow] RagFlow 容器已在运行中，无需重新启动', {
          containerName,
        })
      }
      return { success: true }
    }

    try {
      await container.start()
      if (isVerboseLoggingEnabled()) {
        console.log('[ragflow] 已启动已有 RagFlow 容器', {
          containerName,
        })
      }
      return { success: true }
    } catch (error) {
      const message = error && error.message ? error.message : String(error)
      return {
        success: false,
        error: `启动 RagFlow 容器失败：${message}`,
      }
    }
  }

  await ensureNetworkExists()

  const settings = getAppSettings()
  const moduleSettings =
    settings && settings.modules && settings.modules.ragflow
      ? settings.modules.ragflow
      : defaultAppSettings.modules.ragflow

  // RagFlow Docker 镜像内部通过 nginx 监听 80 端口，对外提供 Web 和 API 服务，
  // service_conf.yaml 中的 http_port=9380 仅用于容器内部 ragflow_server 与 nginx 之间的转发。
  // 因此这里需要将宿主机端口映射到容器的 80/tcp，而不是 9380/tcp。
  const exposedPortKey = '80/tcp'
  const basePort = moduleSettings.port || defaultAppSettings.modules.ragflow.port

  const dbHost = dbConfig && dbConfig.host ? dbConfig.host : MYSQL_DB_CONTAINER_NAME
  const dbPort = dbConfig && dbConfig.port ? dbConfig.port : 3306
  const dbName = dbConfig && dbConfig.database ? dbConfig.database : 'rag_flow'
  const dbUser = dbConfig && dbConfig.user ? dbConfig.user : 'ragflow'
  const dbPassword = dbConfig && dbConfig.password ? dbConfig.password : 'infini_rag_flow'

  const redisHost = redisConfig && redisConfig.host ? redisConfig.host : REDIS_CONTAINER_NAME
  const redisPort = redisConfig && redisConfig.port ? redisConfig.port : 6379
  const redisDb = 2

  const minioHost = minioConfig && minioConfig.host ? minioConfig.host : MINIO_CONTAINER_NAME
  const minioUser = minioConfig && minioConfig.accessKey ? minioConfig.accessKey : 'rag_flow'
  const minioPassword =
    minioConfig && minioConfig.secretKey ? minioConfig.secretKey : 'infini_rag_flow'

  /** @type {string[]} */
  const env = []

  env.push(`MYSQL_DBNAME=${dbName}`)
  env.push(`MYSQL_USER=${dbUser}`)
  env.push(`MYSQL_PASSWORD=${dbPassword}`)
  env.push(`MYSQL_HOST=${dbHost}`)
  env.push(`MYSQL_PORT=${dbPort}`)

  env.push(`MINIO_USER=${minioUser}`)
  env.push(`MINIO_PASSWORD=${minioPassword}`)
  env.push(`MINIO_HOST=${minioHost}`)

  env.push(`REDIS_HOST=${redisHost}`)
  env.push(`REDIS_PORT=${redisPort}`)
  env.push(`REDIS_DB=${redisDb}`)

  const envFromSettings = (moduleSettings && moduleSettings.env) || {}
  const reservedEnvKeys = [
    'MYSQL_DBNAME',
    'MYSQL_USER',
    'MYSQL_PASSWORD',
    'MYSQL_HOST',
    'MYSQL_PORT',
    'MINIO_USER',
    'MINIO_PASSWORD',
    'MINIO_HOST',
    'REDIS_HOST',
    'REDIS_PORT',
  ]

  for (const [key, value] of Object.entries(envFromSettings)) {
    if (typeof value !== 'string') continue
    if (reservedEnvKeys.includes(key)) continue
    env.push(`${key}=${value}`)
  }

  applyHostTimeZoneToEnv(env)

  try {
    const image = moduleImageMap.ragflow
    const imageEnsure = await ensureImagePresent(image)
    if (!imageEnsure.ok) {
      return imageEnsure.errorResult
    }

    const imageRef = await resolveLocalImageReference(image)

    /** @type {string[]} */
    const binds = []

    const modelCacheDir =
      moduleSettings && typeof moduleSettings.modelCacheDir === 'string'
        ? moduleSettings.modelCacheDir.trim()
        : ''
    if (modelCacheDir) {
      binds.push(`${modelCacheDir}:/root/.ragflow`)
    }

    const projectRoot = process.cwd()
    binds.push(
      `${path.join(
        projectRoot,
        'doc/systemcode/ragflow/docker/nginx/nginx.conf',
      )}:/etc/nginx/nginx.conf:ro`,
    )
    binds.push(
      `${path.join(
        projectRoot,
        'doc/systemcode/ragflow/docker/nginx/ragflow.conf',
      )}:/etc/nginx/conf.d/ragflow.conf:ro`,
    )
    binds.push(
      `${path.join(
        projectRoot,
        'doc/systemcode/ragflow/docker/nginx/proxy.conf',
      )}:/etc/nginx/proxy.conf:ro`,
    )
    binds.push(
      `${path.join(
        projectRoot,
        'doc/systemcode/ragflow/docker/service_conf.yaml.template',
      )}:/ragflow/conf/service_conf.yaml.template:ro`,
    )
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
        Binds: binds,
      },
      NetworkingConfig: {
        EndpointsConfig: {
          [MANAGED_NETWORK_NAME]: {
            Aliases: [containerName, 'ragflow'],
          },
        },
      },
    })

    await container.start()

    if (isVerboseLoggingEnabled()) {
      console.log('[ragflow] 新的 RagFlow 容器创建并启动成功', {
        containerName,
        imageRef,
        hostPort: basePort,
      })
    }

    return { success: true }
  } catch (error) {
    const message = error && error.message ? error.message : String(error)
    if (isVerboseLoggingEnabled()) {
      console.error('[ragflow] 创建 RagFlow 容器失败', error)
    }
    return {
      success: false,
      error: `创建 RagFlow 容器失败：${message}`,
    }
  }
}

/**
 * 等待 Elasticsearch HTTP 服务就绪（仅当检测到 host 端口映射时）
 */
async function waitForElasticsearchReady(timeoutMs = 600000, intervalMs = 5000) {
  const docker = getDockerClient()
  let hostPort

  try {
    const containers = await docker.listContainers({
      all: true,
      filters: {
        name: [ELASTICSEARCH_CONTAINER_NAME],
      },
    })

    if (Array.isArray(containers) && containers.length > 0) {
      const info = containers[0]
      const ports = Array.isArray(info.Ports) ? info.Ports : []
      const mapped = ports.find(
        (p) => p && p.PrivatePort === 9200 && typeof p.PublicPort === 'number',
      )
      if (mapped && mapped.PublicPort) {
        hostPort = mapped.PublicPort
      }
    }
  } catch (error) {
    if (isVerboseLoggingEnabled()) {
      console.log('[ragflow] Elasticsearch 就绪检查：获取容器端口映射失败', String(error))
    }
  }

  if (!hostPort) {
    if (isVerboseLoggingEnabled()) {
      console.log(
        '[ragflow] Elasticsearch 就绪检查：未检测到 host 端口映射，跳过 HTTP 检查',
      )
    }
    return
  }

  const start = Date.now()

  while (true) {
    try {
      const result = await new Promise((resolve, reject) => {
        const req = http.request(
          {
            host: '127.0.0.1',
            port: hostPort,
            path: '/',
            method: 'GET',
            timeout: 10000,
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
          console.log('[ragflow] Elasticsearch HTTP 就绪检查通过', {
            hostPort,
            statusCode,
          })
        }
        return
      }

      if (isVerboseLoggingEnabled()) {
        console.log('[ragflow] Elasticsearch HTTP 仍在启动中', {
          hostPort,
          statusCode,
        })
      }
    } catch (error) {
      if (isVerboseLoggingEnabled()) {
        console.log('[ragflow] Elasticsearch HTTP 就绪检查重试中', {
          hostPort,
          error: String(error),
        })
      }
    }

    if (Date.now() - start >= timeoutMs) {
      throw new Error('Elasticsearch HTTP ready timeout')
    }

    await delay(intervalMs)
  }
}

/**
 * 等待 RagFlow HTTP 服务就绪
 */
async function waitForRagflowReady(port, timeoutMs = 600000, intervalMs = 5000) {
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
            timeout: 10000,
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
          console.log('[ragflow] HTTP 就绪检查通过', { port, statusCode })
        }
        return
      }

      if (isVerboseLoggingEnabled()) {
        console.log('[ragflow] HTTP 仍在启动中', {
          port,
          statusCode,
        })
      }
    } catch (error) {
      if (isVerboseLoggingEnabled()) {
        console.log('[ragflow] HTTP 就绪检查重试中', {
          port,
          error: String(error),
        })
      }
    }

    if (Date.now() - start >= timeoutMs) {
      throw new Error('RagFlow HTTP ready timeout')
    }

    await delay(intervalMs)
  }
}

/**
 * 确保 RagFlow 运行时（MySQL + Redis + MinIO + 应用容器）就绪
 */
async function ensureRagflowRuntime() {
  if (isVerboseLoggingEnabled()) {
    console.log('[ragflow] ensureRagflowRuntime: start')
  }

  const dbInstanceResult = await ensureOneApiMysql()
  if (!dbInstanceResult || !dbInstanceResult.success || !dbInstanceResult.dbConfig) {
    if (isVerboseLoggingEnabled()) {
      console.error(
        '[ragflow] ensureRagflowRuntime: MySQL 准备失败',
        dbInstanceResult && dbInstanceResult.error,
      )
    }
    return {
      success: false,
      error: (dbInstanceResult && dbInstanceResult.error) || '启动 RagFlow 依赖的数据库失败。',
    }
  }

  const dbResult = await ensureRagflowDatabase(dbInstanceResult.dbConfig)
  if (!dbResult || !dbResult.success || !dbResult.dbConfig) {
    if (isVerboseLoggingEnabled()) {
      console.error(
        '[ragflow] ensureRagflowRuntime: 初始化 RagFlow 独立数据库失败',
        dbResult && dbResult.error,
      )
    }
    return {
      success: false,
      error: (dbResult && dbResult.error) || '初始化 RagFlow 使用的数据库失败。',
    }
  }

  const redisResult = await ensureOneApiRedis()
  if (!redisResult || !redisResult.success || !redisResult.redisConfig) {
    if (isVerboseLoggingEnabled()) {
      console.error('[ragflow] ensureRagflowRuntime: Redis 准备失败', redisResult && redisResult.error)
    }
    return {
      success: false,
      error: (redisResult && redisResult.error) || '启动 RagFlow 依赖的 Redis 失败。',
    }
  }

  const minioResult = await ensureRagflowMinio()
  if (!minioResult || !minioResult.success || !minioResult.minioConfig) {
    if (isVerboseLoggingEnabled()) {
      console.error('[ragflow] ensureRagflowRuntime: MinIO 准备失败', minioResult && minioResult.error)
    }
    return {
      success: false,
      error: (minioResult && minioResult.error) || '启动 RagFlow 依赖的 MinIO 失败。',
    }
  }

  const esResult = await ensureRagflowElasticsearch()
  if (!esResult || !esResult.success) {
    if (isVerboseLoggingEnabled()) {
      console.error('[ragflow] ensureRagflowRuntime: Elasticsearch 准备失败', esResult && esResult.error)
    }
    return {
      success: false,
      error: (esResult && esResult.error) || '启动 RagFlow 依赖的 Elasticsearch 失败。',
    }
  }

  try {
    if (isVerboseLoggingEnabled()) {
      console.log('[ragflow] ensureRagflowRuntime: Elasticsearch 容器已启动，开始 HTTP 就绪检查')
    }
    await waitForElasticsearchReady()
  } catch (error) {
    if (isVerboseLoggingEnabled()) {
      console.error('[ragflow] ensureRagflowRuntime: Elasticsearch HTTP 就绪检查失败', error)
    }
    return {
      success: false,
      error: 'Elasticsearch 容器已启动，但在预期时间内未完成初始化，请检查 ai-server-es 容器日志。',
    }
  }

  if (isVerboseLoggingEnabled()) {
    console.log(
      '[ragflow] ensureRagflowRuntime: MySQL / Redis / MinIO / Elasticsearch 就绪，准备确保 RagFlow 容器',
    )
  }

  const appResult = await ensureRagflowContainer(
    dbResult.dbConfig,
    redisResult.redisConfig,
    minioResult.minioConfig,
  )
  if (!appResult || !appResult.success) {
    if (isVerboseLoggingEnabled()) {
      console.error('[ragflow] ensureRagflowRuntime: RagFlow 容器启动失败', appResult && appResult.error)
    }
    return {
      success: false,
      error: (appResult && appResult.error) || '启动 RagFlow 容器失败。',
    }
  }

  const settings = getAppSettings()
  const hostPort =
    (settings &&
      settings.modules &&
      settings.modules.ragflow &&
      settings.modules.ragflow.port) || defaultAppSettings.modules.ragflow.port

  try {
    if (isVerboseLoggingEnabled()) {
      console.log('[ragflow] ensureRagflowRuntime: RagFlow 容器已启动，开始 HTTP 就绪检查', {
        hostPort,
      })
    }

    await waitForRagflowReady(hostPort)
  } catch (error) {
    if (isVerboseLoggingEnabled()) {
      console.error('[ragflow] ensureRagflowRuntime: RagFlow HTTP 就绪检查失败', error)
    }
    return {
      success: false,
      error: 'RagFlow 容器已启动，但在预期时间内未完成初始化，请检查 9380 端口页面或日志。',
    }
  }

  if (isVerboseLoggingEnabled()) {
    console.log('[ragflow] ensureRagflowRuntime: RagFlow 容器已就绪')
  }

  return { success: true }
}

export {
  ensureRagflowMinio,
  ensureRagflowElasticsearch,
  ensureRagflowContainer,
  waitForRagflowReady,
  ensureRagflowRuntime,
}
