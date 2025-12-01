import fs from 'node:fs'
import path from 'node:path'
import { getSettingsFilePath } from './app-paths.js'
import crypto from 'node:crypto'

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
      port: 80,
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
      port: 9380,
      databaseUrl: '',
      env: {},
    },
  },
  debug: {
    showDebugTools: false,
    verboseLogging: false,
    showSystemNameSetting: true,
    browserViewIdleDestroyMinutes: 1,
  },
  browserAgent: {
    enabled: false,
    port: 26080,
    token: '',
    dataRoot: '',
    maxSessionDurationMinutes: 30,
    maxIdleMinutes: 10,
  },
}

let appSettings = defaultAppSettings

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
  const safePatch = patch || {}
  return {
    ...base,
    ...safePatch,
    docker: {
      ...base.docker,
      ...(safePatch.docker || {}),
    },
    debug: {
      ...base.debug,
      ...(safePatch.debug || {}),
    },
    modules: {
      ...base.modules,
      ...(safePatch.modules || {}),
    },
    browserAgent: {
      ...(base.browserAgent || {}),
      ...(safePatch.browserAgent || {}),
    },
  }
}

function generateRandomPassword(length) {
  const size = Math.max(16, length)
  return crypto.randomBytes(size).toString('hex').slice(0, length)
}

function isVerboseLoggingEnabled() {
  return !!(appSettings && appSettings.debug && appSettings.debug.verboseLogging)
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
        const pathName = url.pathname.replace(/\/+$/, '')
        const hostAndPath = pathName ? `${url.host}${pathName}` : url.host
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

function ensureN8nSecretsInSettings() {
  try {
    if (!appSettings || !appSettings.modules || !appSettings.modules.n8n) return

    const moduleSettings = appSettings.modules.n8n
    const currentEnv = moduleSettings.env || {}
    const nextEnv = { ...currentEnv }
    let changed = false

    const ensureSecret = (key, length) => {
      const value = nextEnv[key]
      if (!value || typeof value !== 'string' || !value.trim()) {
        nextEnv[key] = generateRandomPassword(length)
        changed = true
      }
    }

    ensureSecret('N8N_ENCRYPTION_KEY', 48)
    ensureSecret('N8N_JWT_SECRET', 48)
    ensureSecret('N8N_USER_MANAGEMENT_JWT_SECRET', 48)

    if (!changed) return

    appSettings = {
      ...appSettings,
      modules: {
        ...appSettings.modules,
        n8n: {
          ...moduleSettings,
          env: nextEnv,
        },
      },
    }

    saveSettingsToDisk(appSettings)
  } catch {}
}

function ensureOneApiSecretsInSettings() {
  try {
    if (!appSettings || !appSettings.modules || !appSettings.modules.oneapi) return

    const moduleSettings = appSettings.modules.oneapi
    const currentEnv = moduleSettings.env || {}
    const nextEnv = { ...currentEnv }
    let changed = false

    const ensureSecret = (key, length) => {
      const value = nextEnv[key]
      if (!value || typeof value !== 'string' || !value.trim()) {
        nextEnv[key] = generateRandomPassword(length)
        changed = true
      }
    }

    ensureSecret('SESSION_SECRET', 48)

    if (!changed) return

    appSettings = {
      ...appSettings,
      modules: {
        ...appSettings.modules,
        oneapi: {
          ...moduleSettings,
          env: nextEnv,
        },
      },
    }

    saveSettingsToDisk(appSettings)
  } catch {}
}

function initAppSettingsFromDisk() {
  const diskSettings = loadSettingsFromDisk()
  if (diskSettings) {
    appSettings = mergeAppSettings(defaultAppSettings, diskSettings)
  } else {
    appSettings = defaultAppSettings
  }
  return appSettings
}

function getAppSettings() {
  return appSettings
}

function setAppSettings(next) {
  appSettings = next || defaultAppSettings
  return appSettings
}

function updateAppSettings(patch) {
  appSettings = mergeAppSettings(appSettings, patch)
  saveSettingsToDisk(appSettings)
  return appSettings
}

export {
  defaultAppSettings,
  getSettingsFilePath,
  loadSettingsFromDisk,
  saveSettingsToDisk,
  mergeAppSettings,
  generateRandomPassword,
  isVerboseLoggingEnabled,
  getMirrorPrefixesFromSettings,
  ensureN8nSecretsInSettings,
  ensureOneApiSecretsInSettings,
  initAppSettingsFromDisk,
  getAppSettings,
  setAppSettings,
  updateAppSettings,
}
