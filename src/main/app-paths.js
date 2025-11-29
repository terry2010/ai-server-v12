import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

let cachedPortableMode = false
let cachedDataRootDir = ''

function detectPortableMode() {
  try {
    if (process.env.PORTABLE_EXECUTABLE_DIR) {
      return true
    }

    const exePath = app.getPath('exe')
    if (exePath && typeof exePath === 'string') {
      const exeDir = path.dirname(exePath)
      const flagPath = path.join(exeDir, 'portable.flag')
      if (fs.existsSync(flagPath)) {
        return true
      }
    }
  } catch {}
  return false
}

function getPortableBaseDir() {
  try {
    if (process.env.PORTABLE_EXECUTABLE_DIR) {
      return process.env.PORTABLE_EXECUTABLE_DIR
    }
    const exePath = app.getPath('exe')
    if (exePath && typeof exePath === 'string') {
      return path.dirname(exePath)
    }
  } catch {}
  return ''
}

function ensureInit() {
  if (cachedDataRootDir) return

  cachedPortableMode = detectPortableMode()

  if (cachedPortableMode) {
    const baseDir = getPortableBaseDir()
    if (baseDir) {
      cachedDataRootDir = path.join(baseDir, 'data')
      return
    }
  }

  cachedDataRootDir = app.getPath('userData')
}

function isPortableMode() {
  ensureInit()
  return cachedPortableMode
}

function getAppDataRootDir() {
  ensureInit()
  return cachedDataRootDir
}

function getSettingsFilePath() {
  const root = getAppDataRootDir()
  return path.join(root, 'settings.json')
}

function getLogsDir() {
  const root = getAppDataRootDir()
  return path.join(root, 'logs')
}

export { isPortableMode, getAppDataRootDir, getSettingsFilePath, getLogsDir }
