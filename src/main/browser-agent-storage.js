import fs from 'node:fs'
import path from 'node:path'
import { getAppDataRootDir } from './app-paths.js'
import { getAppSettings, defaultAppSettings } from './app-settings.js'

let cachedDataRoot = ''

export function getBrowserAgentDataRootDir() {
  if (cachedDataRoot) return cachedDataRoot

  let root = ''
  try {
    const settings = (typeof getAppSettings === 'function' && getAppSettings()) || defaultAppSettings
    const rawSettings = settings && settings.browserAgent ? settings.browserAgent : null
    const configured = rawSettings && typeof rawSettings.dataRoot === 'string'
      ? rawSettings.dataRoot.trim()
      : ''

    if (configured) {
      if (path.isAbsolute(configured)) {
        root = configured
      } else {
        const appRoot = getAppDataRootDir()
        root = appRoot ? path.join(appRoot, configured) : configured
      }
    } else {
      const appRoot = getAppDataRootDir()
      root = appRoot ? path.join(appRoot, 'browser-agent') : ''
    }
  } catch {
    try {
      const appRoot = getAppDataRootDir()
      root = appRoot ? path.join(appRoot, 'browser-agent') : ''
    } catch {
      root = ''
    }
  }

  cachedDataRoot = root
  return root
}

export function ensureDirSync(dir) {
  if (!dir) return null
  try {
    fs.mkdirSync(dir, { recursive: true })
    return dir
  } catch {
    return null
  }
}

function getCurrentDateString() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const yyyy = d.getFullYear()
  const MM = pad(d.getMonth() + 1)
  const dd = pad(d.getDate())
  return `${yyyy}-${MM}-${dd}`
}

function appendFileLine(filePath, line) {
  if (!filePath) return
  try {
    fs.appendFile(filePath, `${line}\n`, () => {})
  } catch {}
}

export function appendBrowserAgentTextLog(message) {
  try {
    const root = getBrowserAgentDataRootDir()
    if (!root) return
    const logsDir = ensureDirSync(path.join(root, 'logs'))
    if (!logsDir) return
    const dateStr = getCurrentDateString()
    const filePath = path.join(logsDir, `browser-agent-${dateStr}.log`)
    const ts = new Date().toISOString()
    const line = `${ts} ${message}`
    appendFileLine(filePath, line)
  } catch {}
}

function appendNdjson(kind, record) {
  if (!record) return
  try {
    const root = getBrowserAgentDataRootDir()
    if (!root) return
    const metaDir = ensureDirSync(path.join(root, 'meta'))
    if (!metaDir) return
    const dateStr = getCurrentDateString()
    const filePath = path.join(metaDir, `${kind}-${dateStr}.ndjson`)
    const line = JSON.stringify(record)
    appendFileLine(filePath, line)
  } catch {}
}

export function appendSessionRecord(record) {
  appendNdjson('sessions', record)
}

export function appendActionRecord(record) {
  appendNdjson('actions', record)
}

export function appendSnapshotRecord(record) {
  appendNdjson('snapshots', record)
}

export function appendFileRecord(record) {
  appendNdjson('files', record)
}

export function readNdjson(kind, date) {
  try {
    const root = getBrowserAgentDataRootDir()
    if (!root) return []
    const metaDir = path.join(root, 'meta')
    const dateStr = date && typeof date === 'string' && date.trim() ? date.trim() : getCurrentDateString()
    const filePath = path.join(metaDir, `${kind}-${dateStr}.ndjson`)
    if (!fs.existsSync(filePath)) return []
    const content = fs.readFileSync(filePath, 'utf8')
    if (!content) return []
    const lines = content.split(/\r?\n/)
    const items = []
    for (const raw of lines) {
      const line = raw && raw.trim()
      if (!line) continue
      try {
        const obj = JSON.parse(line)
        if (obj && typeof obj === 'object') {
          items.push(obj)
        }
      } catch {
      }
    }
    return items
  } catch {
    return []
  }
}
