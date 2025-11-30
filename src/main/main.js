import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setupIpcHandlers } from './ipc-handlers.js'
import { setBrowserViewMainWindow } from './browserview-manager.js'
import { attachBrowserViewContextMenu } from './browserview-context-menu.js'
import { defaultAppSettings, getAppSettings, initAppSettingsFromDisk } from './app-settings.js'
import { startBrowserAgentServer, stopBrowserAgentServer } from './browser-agent-server.js'

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

// 为 Browser Agent / Playwright 集成开启 Chromium CDP 端口（用于 connectOverCDP）。
// 端口默认 9223，可通过 AI_SERVER_CDP_PORT 覆盖。
try {
  const raw = process.env.AI_SERVER_CDP_PORT
  const num = raw ? Number(raw) : 9223
  const port = Number.isFinite(num) && num > 0 && num < 65536 ? num : 9223
  app.commandLine.appendSwitch('remote-debugging-port', String(port))
} catch {}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {BrowserWindow | null} */
let mainWindow = null
/** @type {null | (() => void)} */
let mainWindowContextMenuDispose = null

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
    },
  })

  // 为主窗口页面（React 应用）挂载通用右键菜单
  try {
    if (typeof mainWindowContextMenuDispose === 'function') {
      try {
        mainWindowContextMenuDispose()
      } catch {}
      mainWindowContextMenuDispose = null
    }

    mainWindowContextMenuDispose = attachBrowserViewContextMenu({
      webContents: mainWindow.webContents,
      getBackLabel: () => {
        try {
          const settings = getAppSettings() || defaultAppSettings
          const rawName = settings && typeof settings.systemName === 'string' ? settings.systemName : ''
          const name = rawName && rawName.trim() ? rawName.trim() : 'AI-Server'
          return `返回${name}首页`
        } catch {
          return '返回AI-Server首页'
        }
      },
      onBackToModules: () => {
        try {
          if (mainWindow && mainWindow.webContents) {
            mainWindow.webContents.send('browserView:backToModules')
          }
        } catch {}
      },
    })
  } catch {}

  setBrowserViewMainWindow(mainWindow)

  if (isDev) {
    await mainWindow.loadURL('http://localhost:5174')
    mainWindow.webContents.openDevTools()
  } else {
    const indexPath = path.join(__dirname, '../../dist/index.html')
    await mainWindow.loadFile(indexPath)
  }

  mainWindow.on('closed', () => {
    try {
      if (typeof mainWindowContextMenuDispose === 'function') {
        mainWindowContextMenuDispose()
      }
    } catch {}
    mainWindowContextMenuDispose = null
    mainWindow = null
  })
}

app.whenReady().then(() => {
  try {
    initAppSettingsFromDisk()
  } catch {}

  setupIpcHandlers()

  try {
    startBrowserAgentServer()
  } catch {}

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('before-quit', () => {
  try {
    stopBrowserAgentServer()
  } catch {}
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
