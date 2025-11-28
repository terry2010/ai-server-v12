import { isVerboseLoggingEnabled, getMirrorPrefixesFromSettings, getAppSettings } from './app-settings.js'
import { execAsync, getDockerClient, detectDockerStatus } from './docker-client.js'
import {
  MANAGED_NETWORK_NAME,
  N8N_DB_CONTAINER_NAME,
  MYSQL_DB_CONTAINER_NAME,
  REDIS_CONTAINER_NAME,
  moduleDockerConfig,
  moduleImageMap,
} from './config.js'

/** @type {string} */
let HOST_TZ = ''
try {
  if (typeof Intl !== 'undefined' && Intl.DateTimeFormat) {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (tz && typeof tz === 'string') {
      HOST_TZ = tz
    }
  }
  if (!HOST_TZ && process.env.TZ && typeof process.env.TZ === 'string') {
    HOST_TZ = process.env.TZ
  }
} catch {
  HOST_TZ = ''
}

/**
 * @param {string[]} env
 */
function applyHostTimeZoneToEnv(env) {
  try {
    if (!HOST_TZ) return env
    const hasTz = env.some((item) => typeof item === 'string' && item.startsWith('TZ='))
    if (!hasTz) {
      env.push(`TZ=${HOST_TZ}`)
    }
  } catch {
    // ignore
  }
  return env
}

const moduleBaseServiceContainers = {
  n8n: [N8N_DB_CONTAINER_NAME],
  oneapi: [MYSQL_DB_CONTAINER_NAME, REDIS_CONTAINER_NAME],
  dify: [N8N_DB_CONTAINER_NAME, REDIS_CONTAINER_NAME],
}

async function maybeStopBaseServicesForModule(moduleId, docker) {
  const baseContainers = moduleBaseServiceContainers[moduleId]
  if (!baseContainers || baseContainers.length === 0) {
    return
  }

  for (const baseName of baseContainers) {
    let inUseByOthers = false

    for (const [otherModuleId, otherBaseContainers] of Object.entries(
      moduleBaseServiceContainers,
    )) {
      if (otherModuleId === moduleId) continue
      if (!Array.isArray(otherBaseContainers) || !otherBaseContainers.includes(baseName)) continue

      const otherConfig = moduleDockerConfig[otherModuleId]
      if (!otherConfig) continue

      let containers = []
      try {
        containers = await docker.listContainers({
          all: true,
          filters: {
            name: otherConfig.containerNames,
          },
        })
      } catch {
        // ignore
      }

      const hasRunning =
        Array.isArray(containers) &&
        containers.some((info) => {
          const state = String(info.State || '').toLowerCase()
          return state === 'running' || state === 'restarting'
        })

      if (hasRunning) {
        inUseByOthers = true
        break
      }
    }

    if (inUseByOthers) {
      continue
    }

    try {
      const baseContainersList = await docker.listContainers({
        all: true,
        filters: {
          name: [baseName],
        },
      })

      if (!Array.isArray(baseContainersList) || baseContainersList.length === 0) {
        continue
      }

      for (const info of baseContainersList) {
        const state = String(info.State || '').toLowerCase()
        if (state === 'running' || state === 'restarting') {
          const container = docker.getContainer(info.Id)
          try {
            await container.stop()
          } catch (error) {
            if (isVerboseLoggingEnabled()) {
              console.error('[modules] 停止基础服务容器失败', { moduleId, baseName, error })
            }
          }
        }
      }
    } catch (error) {
      if (isVerboseLoggingEnabled()) {
        console.error('[modules] 检查基础服务容器状态失败', { moduleId, baseName, error })
      }
    }
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
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

  const settings = getAppSettings()
  const proxy = settings && settings.docker ? settings.docker.proxy : undefined
  const mode = proxy && proxy.proxyMode ? proxy.proxyMode : 'system'

  if (mode === 'direct') {
    delete env.HTTP_PROXY
    delete env.HTTPS_PROXY
  } else if (mode === 'manual') {
    const host = proxy && proxy.proxyHost
    const port = proxy && proxy.proxyPort
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
    error: `拉取镜像失败 (${image})`,
  }
}

export {
  HOST_TZ,
  applyHostTimeZoneToEnv,
  delay,
  splitImageName,
  buildImageCandidates,
  resolveLocalImageReference,
  ensureNetworkExists,
  ensureVolumeExists,
  ensureImagePresent,
  ensureDockerAvailableForDebug,
  execDockerCommand,
  buildDockerActionError,
  dockerStopAllContainers,
  dockerRemoveAllContainers,
  dockerPruneVolumes,
  dockerFullCleanup,
  pullDockerImage,
  maybeStopBaseServicesForModule,
  ensureImagePresentForModule,
}
