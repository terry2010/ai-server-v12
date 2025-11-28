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
    const programData = process.env.ProgramData || 'C\\ProgramData'
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
    const programData = process.env.ProgramData || 'C\\ProgramData'
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

export { execAsync, getDockerClient, detectDockerStatus, startDockerDesktop }
