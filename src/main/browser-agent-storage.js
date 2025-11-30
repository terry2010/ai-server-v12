import fs from 'node:fs'
import path from 'node:path'
import { getAppDataRootDir } from './app-paths.js'
import { getAppSettings, defaultAppSettings } from './app-settings.js'

let cachedDataRoot = ''

function getBrowserAgentDataRootDir() {
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

function ensureDirSync(dir) {
  if (!dir) return null
  try {
    fs.mkdirSync(dir, { recursive: true })
    return dir
  } catch {
    return null
  }
}

function getCurrentDateString() {
  return new Date().toISOString().slice(0, 10)
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
