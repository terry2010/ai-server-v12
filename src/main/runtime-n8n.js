import http from 'node:http'

import {
  MANAGED_NETWORK_NAME,
  N8N_DB_IMAGE,
  N8N_DB_CONTAINER_NAME,
  N8N_DB_VOLUME_NAME,
  N8N_DATA_VOLUME_NAME,
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
  ensureN8nSecretsInSettings,
  isVerboseLoggingEnabled,
  generateRandomPassword,
  getAppSettings,
} from './app-settings.js'

/**
 * 等待 n8n HTTP 服务就绪
 * 与原来 ipc-handlers.js 中的实现保持逻辑一致
 */
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

async function ensurePostgresDatabaseAndUser(
  adminDbConfig,
  { dbName, dbUser, dbPassword, logPrefix },
) {
  const docker = getDockerClient()
  const container = docker.getContainer(N8N_DB_CONTAINER_NAME)

  // 拆分为多条顶层语句，避免在同一个事务块中执行 CREATE DATABASE
  const roleSql = `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${dbUser}') THEN CREATE ROLE ${dbUser} LOGIN PASSWORD '${dbPassword}'; END IF; END $$;`
  const createDbSql = `CREATE DATABASE ${dbName} OWNER ${dbUser};`
  const alterOwnerSql = `ALTER DATABASE ${dbName} OWNER TO ${dbUser};`
  const grantSql = `GRANT ALL PRIVILEGES ON DATABASE ${dbName} TO ${dbUser};`

  const statements = [roleSql, createDbSql, alterOwnerSql, grantSql]

  try {
    const maxAttempts = 20
    const perAttemptTimeoutMs = 15000
    const retryDelayMs = 5000
    let lastErrorMessage = ''

    for (let i = 0; i < maxAttempts; i++) {
      const attempt = i + 1

      let attemptOk = true

      for (const [index, stmt] of statements.entries()) {
        const exec = await container.exec({
          Cmd: [
            'psql',
            '-U',
            (adminDbConfig && adminDbConfig.user) || 'postgres',
            '-h',
            '127.0.0.1',
            '-p',
            String((adminDbConfig && adminDbConfig.port) || 5432),
            '-d',
            'postgres',
            '-c',
            stmt,
          ],
          Env: [
            `PGPASSWORD=${(adminDbConfig && adminDbConfig.password) || ''}`,
          ],
          AttachStdout: true,
          AttachStderr: true,
        })

        const start = Date.now()
        const stream = await exec.start({ hijack: true, stdin: false })

        /** @type {string} */
        let output = ''
        stream.on('data', (chunk) => {
          try {
            if (!chunk) return
            if (Buffer.isBuffer(chunk)) {
              output += chunk.toString('utf-8')
            } else {
              output += String(chunk)
            }
          } catch {
            // ignore
          }
        })

        let inspect = await exec.inspect()
        while (
          (inspect.Running || typeof inspect.Running === 'undefined') &&
          typeof inspect.ExitCode !== 'number' &&
          Date.now() - start < perAttemptTimeoutMs
        ) {
          await delay(1000)
          inspect = await exec.inspect()
        }

        if (Date.now() - start >= perAttemptTimeoutMs) {
          lastErrorMessage = `${logPrefix || '[postgres]'} 初始化数据库第 ${attempt} 次尝试在 ${perAttemptTimeoutMs}ms 内未完成（可能是 Postgres 尚未完全就绪），将重试。`
          if (isVerboseLoggingEnabled()) {
            console.error(lastErrorMessage)
          }
          attemptOk = false
          break
        }

        if (typeof inspect.ExitCode === 'number' && inspect.ExitCode !== 0) {
          const tail = output ? output.replace(/\s+$/g, '').slice(-500) : ''
          const lowerTail = tail.toLowerCase()

          // 针对 CREATE DATABASE 语句，如果只提示已存在则视为成功
          const isCreateDbStmt = index === 1 || /create\s+database/i.test(stmt)
          if (
            isCreateDbStmt &&
            lowerTail.includes('already exists') &&
            lowerTail.includes(dbName.toLowerCase())
          ) {
            if (isVerboseLoggingEnabled()) {
              console.log(
                `${logPrefix || '[postgres]'} 数据库 ${dbName} 已存在，本次初始化将视为成功（忽略该错误）。`,
              )
            }
            // 继续执行后续 ALTER / GRANT 等语句
            continue
          }

          lastErrorMessage = `${logPrefix || '[postgres]'} 初始化数据库失败（退出码 ${inspect.ExitCode}），第 ${attempt} 次尝试。${tail ? ` 输出: ${tail}` : ''}`
          if (isVerboseLoggingEnabled()) {
            console.error(lastErrorMessage)
          }
          attemptOk = false
          break
        }
      }

      if (attemptOk) {
        lastErrorMessage = ''
        break
      }

      if (attempt < maxAttempts) {
        await delay(retryDelayMs)
      } else if (lastErrorMessage) {
        return {
          success: false,
          error: lastErrorMessage,
        }
      }
    }
  } catch (error) {
    const rawMessage = error && error.message ? error.message : String(error)
    const message = `${logPrefix || '[postgres]'} 初始化数据库失败：${rawMessage}`
    if (isVerboseLoggingEnabled()) {
      console.error(message)
    }
    return {
      success: false,
      error: message,
    }
  }

  return {
    success: true,
    dbConfig: {
      host: (adminDbConfig && adminDbConfig.host) || N8N_DB_CONTAINER_NAME,
      port: (adminDbConfig && adminDbConfig.port) || 5432,
      database: dbName,
      user: dbUser,
      password: dbPassword,
    },
  }
}

async function ensureDifyDatabase(adminDbConfig) {
  return ensurePostgresDatabaseAndUser(adminDbConfig, {
    dbName: 'dify',
    dbUser: 'dify',
    dbPassword: 'infini_dify',
    logPrefix: '[dify]',
  })
}

/**
 * 确保 n8n 依赖的 Postgres 容器存在并运行
 */
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
    const env = [
      `POSTGRES_USER=${dbUser}`,
      `POSTGRES_PASSWORD=${dbPassword}`,
      `POSTGRES_DB=${dbName}`,
    ]
    applyHostTimeZoneToEnv(env)

    const container = await docker.createContainer({
      name: N8N_DB_CONTAINER_NAME,
      Image: imageRef,
      Env: env,
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

/**
 * 确保 n8n 应用容器存在并运行
 */
async function ensureN8nContainer(dbConfig) {
  const docker = getDockerClient()
  const containerName = 'ai-server-n8n'

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

  const settings = getAppSettings()

  const exposedPortKey = '5678/tcp'
  const basePort =
    (settings &&
      settings.modules &&
      settings.modules.n8n &&
      settings.modules.n8n.port) ||
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
    (settings &&
      settings.modules &&
      settings.modules.n8n &&
      settings.modules.n8n.env) ||
    {}
  for (const key of Object.keys(extraEnv)) {
    const value = extraEnv[key]
    if (typeof value === 'string') {
      env.push(`${key}=${value}`)
    }
  }

  applyHostTimeZoneToEnv(env)

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

/**
 * 确保 n8n 运行时（数据库 + 容器）就绪
 */
async function ensureN8nRuntime() {
  if (isVerboseLoggingEnabled()) {
    console.log('[n8n] ensureN8nRuntime: start')
  }

  ensureN8nSecretsInSettings()

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

  const settings = getAppSettings()

  const hostPort =
    (settings &&
      settings.modules &&
      settings.modules.n8n &&
      settings.modules.n8n.port) ||
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
    console.log('[n8n] ensureN8nRuntime: n8n 容器已就绪', {
      hostPort,
    })
  }

  return { success: true }
}

export {
  ensureN8nPostgres,
  ensureN8nContainer,
  ensureN8nRuntime,
  waitForN8nReady,
  ensureDifyDatabase,
}
