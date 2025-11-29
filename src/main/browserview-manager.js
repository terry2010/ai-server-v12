import { BrowserView } from 'electron'
import { defaultAppSettings, getAppSettings, isVerboseLoggingEnabled } from './app-settings.js'
import { detectDockerStatus, getDockerClient } from './docker-client.js'
import { moduleDockerConfig } from './config.js'

let mainWindow = null
const HEADER_HEIGHT = 56
const moduleViews = {}
let currentModuleId = null
let gcTimer = null
let resizeListenerAttached = false

function getValidModuleId(raw) {
  if (raw === 'n8n' || raw === 'dify' || raw === 'oneapi' || raw === 'ragflow') {
    return raw
  }
  return null
}

function getBrowserViewBounds() {
  if (!mainWindow) return null
  try {
    const size = mainWindow.getContentSize()
    if (!Array.isArray(size) || size.length < 2) return null
    const width = size[0]
    const height = size[1]
    const contentHeight = height - HEADER_HEIGHT
    if (width <= 0 || contentHeight <= 0) return null
    return { x: 0, y: HEADER_HEIGHT, width, height: contentHeight }
  } catch {
    return null
  }
}

function updateBrowserViewBounds() {
  if (!mainWindow || !currentModuleId) return
  const entry = moduleViews[currentModuleId]
  if (!entry || !entry.view) return
  const bounds = getBrowserViewBounds()
  if (!bounds) return
  try {
    entry.view.setBounds(bounds)
  } catch {}
}

function getHomeUrl(moduleId) {
  const settings = getAppSettings() || defaultAppSettings
  const modules = (settings && settings.modules) || defaultAppSettings.modules
  const moduleSettings = modules && modules[moduleId] ? modules[moduleId] : defaultAppSettings.modules[moduleId]
  const port = moduleSettings && typeof moduleSettings.port === 'number' ? moduleSettings.port : null
  if (!port || port <= 0) return null
  return `http://localhost:${port}/`
}

function loadErrorPage(view, moduleId, targetUrl, errorMessage) {
  const safeModule = moduleId || ''
  const safeUrl = targetUrl || ''
  const safeError = errorMessage || ''
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" /><title>模块无法访问</title><style>body{margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:radial-gradient(circle at top,#0f172a,#020617);color:#e5e7eb;display:flex;align-items:center;justify-content:center;height:100vh;} .box{max-width:520px;padding:32px;border-radius:24px;background:rgba(15,23,42,0.92);box-shadow:0 18px 45px rgba(0,0,0,0.6);border:1px solid rgba(148,163,184,0.4);} .title{font-size:18px;font-weight:600;margin-bottom:8px;display:flex;align-items:center;gap:8px;} .badge{padding:2px 8px;border-radius:999px;background:rgba(56,189,248,0.16);color:#e0f2fe;font-size:11px;} .desc{font-size:12px;color:#9ca3af;margin-bottom:12px;} .label{font-size:11px;color:#6b7280;margin-top:8px;margin-bottom:2px;} .code{font-size:11px;color:#e5e7eb;background:rgba(15,23,42,0.9);border-radius:8px;padding:8px 10px;word-break:break-all;} a{color:#38bdf8;text-decoration:none;} a:hover{text-decoration:underline;}</style></head><body><div class="box"><div class="title"><span>模块无法访问</span><span class="badge">${safeModule || '模块'}</span></div><div class="desc">无法加载模块页面。请确认模块已启动且端口配置正确，然后重试。</div>${safeUrl ? `<div class="label">目标地址</div><div class="code">${safeUrl}</div>` : ''}${safeError ? `<div class="label">错误信息</div><div class="code">${safeError}</div>` : ''}<div class="desc" style="margin-top:12px;">你可以返回应用首页，在仪表盘中检查模块的运行状态。</div></div></body></html>`
  try {
    view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  } catch {}
}

function ensureGcTimer() {
  if (gcTimer) return
  gcTimer = setInterval(runBrowserViewGcOnce, 30000)
}

async function runBrowserViewGcOnce() {
  const ids = Object.keys(moduleViews)
  if (!ids.length) return
  const settings = getAppSettings() || defaultAppSettings
  const debug = settings && settings.debug ? settings.debug : defaultAppSettings.debug
  let minutes = debug && typeof debug.browserViewIdleDestroyMinutes === 'number' ? debug.browserViewIdleDestroyMinutes : defaultAppSettings.debug.browserViewIdleDestroyMinutes
  if (!minutes || minutes <= 0) minutes = 1
  const maxIdleMs = minutes * 60_000
  const now = Date.now()

  let docker = null
  let containers = []
  try {
    const status = await detectDockerStatus()
    if (status && status.installed && status.running) {
      docker = getDockerClient()
      containers = await docker.listContainers({ all: true })
    }
  } catch {}

  for (const rawId of ids) {
    const moduleId = getValidModuleId(rawId)
    if (!moduleId) continue
    if (moduleId === currentModuleId) continue
    const entry = moduleViews[moduleId]
    if (!entry || !entry.view) continue
    const idleMs = now - entry.lastActiveAt
    if (idleMs < maxIdleMs) continue

    let running = false
    if (docker && moduleDockerConfig && moduleDockerConfig[moduleId]) {
      const config = moduleDockerConfig[moduleId]
      try {
        const info = containers.find((c) => {
          if (!Array.isArray(c.Names)) return false
          return c.Names.some((name) =>
            config.containerNames.some(
              (needle) => typeof name === 'string' && name.includes(needle),
            ),
          )
        })
        if (info) {
          const state = String(info.State || '').toLowerCase()
          if (state === 'running' || state === 'restarting') {
            running = true
          }
        }
      } catch {}
    }

    if (running) continue

    try {
      if (mainWindow) {
        const views = mainWindow.getBrowserViews()
        if (Array.isArray(views) && views.includes(entry.view)) {
          mainWindow.removeBrowserView(entry.view)
        }
      }
    } catch {}

    try {
      entry.view.destroy()
    } catch {}

    delete moduleViews[moduleId]
  }
}

function setupViewEvents(entry, homeUrl) {
  const moduleId = entry.moduleId
  const view = entry.view
  try {
    view.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return
      const url = validatedURL || homeUrl || ''
      const message = `${errorDescription || ''} (${errorCode})`
      if (isVerboseLoggingEnabled()) {
        console.error('[browserview] did-fail-load', { moduleId, url, errorCode, errorDescription })
      }
      loadErrorPage(view, moduleId, url, message)
    })
  } catch {}
}

function detachCurrentView() {
  if (!mainWindow || !currentModuleId) return
  const entry = moduleViews[currentModuleId]
  if (!entry || !entry.view) return
  try {
    const views = mainWindow.getBrowserViews()
    if (Array.isArray(views) && views.includes(entry.view)) {
      mainWindow.removeBrowserView(entry.view)
    }
  } catch {}
}

export function setBrowserViewMainWindow(win) {
  mainWindow = win || null
  if (!mainWindow) return
  if (!resizeListenerAttached) {
    resizeListenerAttached = true
    try {
      mainWindow.on('resize', () => {
        updateBrowserViewBounds()
      })
    } catch {}
  }
}

export async function openModuleBrowserView(rawModuleId) {
  const moduleId = getValidModuleId(rawModuleId)
  if (!moduleId) {
    return { success: false, error: '模块不存在或不支持 BrowserView 集成。' }
  }
  if (!mainWindow) {
    return { success: false, error: '主窗口尚未就绪，无法打开模块页面。' }
  }

  let entry = moduleViews[moduleId]
  const homeUrl = getHomeUrl(moduleId)
  if (!homeUrl) {
    return { success: false, error: '未配置模块端口，请在系统设置中检查模块端口号。' }
  }

  if (!entry) {
    const view = new BrowserView({ webPreferences: { nodeIntegration: false, contextIsolation: true } })
    entry = { moduleId, view, lastActiveAt: Date.now() }
    moduleViews[moduleId] = entry
    setupViewEvents(entry, homeUrl)
    try {
      await view.webContents.loadURL(homeUrl)
    } catch (error) {
      const message = error && error.message ? String(error.message) : String(error || '')
      if (isVerboseLoggingEnabled()) {
        console.error('[browserview] 加载模块首页失败', { moduleId, homeUrl, error })
      }
      loadErrorPage(view, moduleId, homeUrl, message)
    }
  } else {
    entry.lastActiveAt = Date.now()
  }

  detachCurrentView()

  try {
    mainWindow.addBrowserView(entry.view)
    const bounds = getBrowserViewBounds()
    if (bounds) {
      entry.view.setBounds(bounds)
    }
  } catch (error) {
    const message = error && error.message ? String(error.message) : String(error || '')
    if (isVerboseLoggingEnabled()) {
      console.error('[browserview] attach 失败', { moduleId, error })
    }
    return { success: false, error: `附加模块视图失败：${message}` }
  }

  currentModuleId = moduleId
  ensureGcTimer()

  return { success: true }
}

export async function closeBrowserView() {
  if (!mainWindow || !currentModuleId) {
    return { success: true }
  }
  detachCurrentView()
  currentModuleId = null
  return { success: true }
}

export async function controlModuleBrowserView(rawModuleId, action) {
  const moduleId = getValidModuleId(rawModuleId)
  if (!moduleId) {
    return { success: false, error: '模块不存在或不支持 BrowserView 集成。' }
  }
  const entry = moduleViews[moduleId]
  if (!entry || !entry.view) {
    return { success: false, error: '模块视图尚未创建，请先打开模块页面。' }
  }
  const view = entry.view
  const contents = view.webContents

  try {
    if (action === 'home') {
      const homeUrl = getHomeUrl(moduleId)
      if (!homeUrl) {
        return { success: false, error: '未配置模块端口，请在系统设置中检查模块端口号。' }
      }
      await contents.loadURL(homeUrl)
      entry.lastActiveAt = Date.now()
      return { success: true }
    }
    if (action === 'reload') {
      contents.reload()
      entry.lastActiveAt = Date.now()
      return { success: true }
    }
    if (action === 'back') {
      if (contents.canGoBack()) {
        contents.goBack()
      }
      entry.lastActiveAt = Date.now()
      return { success: true }
    }
    if (action === 'forward') {
      if (contents.canGoForward()) {
        contents.goForward()
      }
      entry.lastActiveAt = Date.now()
      return { success: true }
    }
  } catch (error) {
    const message = error && error.message ? String(error.message) : String(error || '')
    if (isVerboseLoggingEnabled()) {
      console.error('[browserview] 控制模块视图失败', { moduleId, action, error })
    }
    return { success: false, error: `控制模块视图失败：${message}` }
  }

  return { success: false, error: '不支持的操作类型。' }
}
