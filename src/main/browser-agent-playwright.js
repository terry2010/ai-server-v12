import { BrowserWindow, app } from 'electron'
import path from 'node:path'
import os from 'node:os'
import { getSession } from './browser-agent-core.js'
import { appendBrowserAgentTextLog } from './browser-agent-storage.js'

/**
 * 获取用于 CDP 连接的调试端口。
 * 优先读取 AI_SERVER_CDP_PORT，其次使用固定默认值 9223。
 */
function getCdpPort() {
  const raw = process.env.AI_SERVER_CDP_PORT
  if (!raw) return 9223
  const num = Number(raw)
  if (!Number.isFinite(num) || num <= 0 || num >= 65536) return 9223
  return num
}

/**
 * 导航动作（阶段 1 版本）：
 * - 打开一个 BrowserWindow，加载指定 URL（为便于在 CDP 中识别，会通过查询参数附加 agent_session 标记）；
 * - 通过 playwright-core 的 connectOverCDP 连接到 Electron；
 * - 找到对应 Page，读取 title/url，并在临时目录截一张图；
 * - 返回调试信息，供 HTTP 层 /sessions/{id}/navigate 使用。
 */
export async function navigateOnce(params) {
  const sessionId = params && typeof params.sessionId === 'string' ? params.sessionId : ''
  const rawUrl = params && typeof params.url === 'string' ? params.url : ''

  if (!sessionId) {
    throw new Error('sessionId is required')
  }

  const baseUrl = rawUrl && rawUrl.trim() ? rawUrl.trim() : 'https://www.baidu.com'
  const targetUrl = buildNavigateTargetUrl(baseUrl, sessionId)
  const cdpPort = getCdpPort()

  if (!app.isReady()) {
    await app.whenReady()
  }

  /** @type {BrowserWindow | null} */
  let win = null

  // 尝试复用已绑定到该 session 的 BrowserWindow，保证一个 session 只维护一个窗口
  try {
    const s = typeof getSession === 'function' ? getSession(sessionId) : null
    if (s && typeof s.windowId === 'number' && Number.isFinite(s.windowId)) {
      const existing = BrowserWindow.fromId(s.windowId)
      if (existing && !existing.isDestroyed()) {
        win = existing
        try {
          win.show()
          win.focus()
        } catch {}
      }
    }
  } catch {}

  if (!win) {
    win = new BrowserWindow({
      width: 1024,
      height: 768,
      show: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    })
  }

  // 为该 BrowserWindow 附加 URL 变化日志（只注册一次监听器），并记录当前归属的 sessionId
  try {
    win.__browserAgentSessionId = sessionId
    if (!win.__browserAgentUrlLoggerAttached) {
      const logNav = (eventType, url) => {
        try {
          const sid = win.__browserAgentSessionId || sessionId
          console.log(
            `[BrowserAgent] [session=${sid}] event=${eventType} url=${url}`,
          )
        } catch {}
      }

      win.webContents.on('did-navigate', (_event, url) => {
        logNav('did-navigate', url)
      })

      win.webContents.on('did-navigate-in-page', (_event, url) => {
        logNav('did-navigate-in-page', url)
      })

      win.__browserAgentUrlLoggerAttached = true
    }
  } catch {}

  await win.loadURL(targetUrl)

  // 简单等待页面加载稳定，后续可根据 timeoutMs / waitUntil 优化
  await delay(3000)

  let chromium
  try {
    ;({ chromium } = await import('playwright-core'))
  } catch (error) {
    const message = error && error.message ? String(error.message) : String(error || '')
    throw new Error(`加载 playwright-core 失败，请先安装依赖：${message}`)
  }

  const endpoint = `http://127.0.0.1:${cdpPort}`
  const browser = await chromium.connectOverCDP(endpoint)

  try {
    const contexts = browser.contexts()
    let targetPage = null
    const candidatePages = []

    for (const context of contexts) {
      const pages = context.pages()
      for (const page of pages) {
        try {
          const url = page.url()
          if (!url) continue
          if (url.includes(sessionId)) {
            targetPage = page
            break
          }
          if (!isMainAppUrl(url)) {
            candidatePages.push(page)
          }
        } catch {
          // ignore
        }
      }
      if (targetPage) break
    }

    if (!targetPage && candidatePages.length === 1) {
      targetPage = candidatePages[0]
    }

    if (!targetPage) {
      throw new Error('Playwright 已连接到 Electron，但未找到包含该 session 标记的 Page。')
    }

    const title = await targetPage.title().catch(() => '')
    const finalUrl = targetPage.url()

    let screenshotPath = ''
    try {
      const fileName = `browser-agent-session-${Date.now().toString(36)}.png`
      const tmpDir = os.tmpdir()
      const fullPath = path.join(tmpDir, fileName)
      await targetPage.screenshot({ path: fullPath, fullPage: true })
      screenshotPath = fullPath
    } catch {
      screenshotPath = ''
    }

    try {
      const line = `[BrowserAgent] [session=${sessionId}] action=navigate targetUrl=${targetUrl} pageUrl=${finalUrl}`
      console.log(line)
      appendBrowserAgentTextLog(line)
    } catch {}

    return {
      sessionId,
      windowId: win.id,
      cdpEndpoint: endpoint,
      targetUrl,
      pageUrl: finalUrl,
      pageTitle: title,
      screenshotPath,
    }
  } finally {
    try {
      await browser.close()
    } catch {
      // ignore
    }
  }
}

export async function domClick(params) {
  const sessionId = params && typeof params.sessionId === 'string' ? params.sessionId : ''
  const selector = params && typeof params.selector === 'string' ? params.selector : ''
  const rawTimeout = params && typeof params.timeoutMs === 'number' ? params.timeoutMs : null

  if (!sessionId) {
    throw new Error('sessionId is required')
  }
  if (!selector) {
    throw new Error('selector is required')
  }

  const timeoutMs = rawTimeout && Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 30000
  const cdpPort = getCdpPort()

  if (!app.isReady()) {
    await app.whenReady()
  }

  let chromium
  try {
    ;({ chromium } = await import('playwright-core'))
  } catch (error) {
    const message = error && error.message ? String(error.message) : String(error || '')
    throw new Error(`加载 playwright-core 失败，请先安装依赖：${message}`)
  }

  const endpoint = `http://127.0.0.1:${cdpPort}`
  const browser = await chromium.connectOverCDP(endpoint)

  try {
    const contexts = browser.contexts()
    let targetPage = null
    const candidatePages = []

    for (const context of contexts) {
      const pages = context.pages()
      for (const page of pages) {
        try {
          const url = page.url()
          if (!url) continue
          if (url.includes(sessionId)) {
            targetPage = page
            break
          }
          if (!isMainAppUrl(url)) {
            candidatePages.push(page)
          }
        } catch {
          // ignore
        }
      }
      if (targetPage) break
    }

    if (!targetPage && candidatePages.length === 1) {
      targetPage = candidatePages[0]
    }

    if (!targetPage) {
      throw new Error('Playwright 已连接到 Electron，但未找到包含该 session 标记的 Page。')
    }

    const locator = targetPage.locator(selector)
    let clickTarget = locator
    let resolvedCount = 0

    try {
      resolvedCount = await locator.count()
    } catch {
      resolvedCount = 0
    }

    if (resolvedCount > 1) {
      for (let i = 0; i < resolvedCount; i += 1) {
        const candidate = locator.nth(i)
        try {
          const visible = await candidate.isVisible()
          if (visible) {
            clickTarget = candidate
            break
          }
        } catch {
          // ignore
        }
      }
    }

    await clickTarget.click({ timeout: timeoutMs })

    const title = await targetPage.title().catch(() => '')
    const finalUrl = targetPage.url()

    try {
      const line = `[BrowserAgent] [session=${sessionId}] action=dom.click selector=${selector} pageUrl=${finalUrl}`
      console.log(line)
      appendBrowserAgentTextLog(line)
    } catch {}

    return {
      sessionId,
      action: 'dom.click',
      selector,
      timeoutMs,
      pageUrl: finalUrl,
      pageTitle: title,
    }
  } finally {
    try {
      await browser.close()
    } catch {
      // ignore
    }
  }
}

export async function domFill(params) {
  const sessionId = params && typeof params.sessionId === 'string' ? params.sessionId : ''
  const selector = params && typeof params.selector === 'string' ? params.selector : ''
  const text = params && typeof params.text === 'string' ? params.text : ''
  const rawTimeout = params && typeof params.timeoutMs === 'number' ? params.timeoutMs : null
  const clearBefore =
    params && typeof params.clearBefore === 'boolean' ? params.clearBefore : true

  if (!sessionId) {
    throw new Error('sessionId is required')
  }
  if (!selector) {
    throw new Error('selector is required')
  }

  const timeoutMs = rawTimeout && Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 30000
  const cdpPort = getCdpPort()

  if (!app.isReady()) {
    await app.whenReady()
  }

  let chromium
  try {
    ;({ chromium } = await import('playwright-core'))
  } catch (error) {
    const message = error && error.message ? String(error.message) : String(error || '')
    throw new Error(`加载 playwright-core 失败，请先安装依赖：${message}`)
  }

  const endpoint = `http://127.0.0.1:${cdpPort}`
  const browser = await chromium.connectOverCDP(endpoint)

  try {
    const contexts = browser.contexts()
    let targetPage = null
    const candidatePages = []

    for (const context of contexts) {
      const pages = context.pages()
      for (const page of pages) {
        try {
          const url = page.url()
          if (!url) continue
          if (url.includes(sessionId)) {
            targetPage = page
            break
          }
          if (!isMainAppUrl(url)) {
            candidatePages.push(page)
          }
        } catch {
          // ignore
        }
      }
      if (targetPage) break
    }

    if (!targetPage && candidatePages.length === 1) {
      targetPage = candidatePages[0]
    }

    if (!targetPage) {
      throw new Error('Playwright 已连接到 Electron，但未找到包含该 session 标记的 Page。')
    }

    const locator = targetPage.locator(selector)

    if (clearBefore) {
      await locator.fill(text, { timeout: timeoutMs })
    } else {
      await locator.focus({ timeout: timeoutMs })
      if (text) {
        await locator.type(text, { timeout: timeoutMs })
      }
    }

    const title = await targetPage.title().catch(() => '')
    const finalUrl = targetPage.url()

    try {
      const line = `[BrowserAgent] [session=${sessionId}] action=dom.fill selector=${selector} pageUrl=${finalUrl}`
      console.log(line)
      appendBrowserAgentTextLog(line)
    } catch {}

    return {
      sessionId,
      action: 'dom.fill',
      selector,
      text,
      clearBefore,
      timeoutMs,
      pageUrl: finalUrl,
      pageTitle: title,
    }
  } finally {
    try {
      await browser.close()
    } catch {
      // ignore
    }
  }
}

export async function takeScreenshot(params) {
  const sessionId = params && typeof params.sessionId === 'string' ? params.sessionId : ''
  const rawMode = params && typeof params.mode === 'string' ? params.mode : ''
  const selector = params && typeof params.selector === 'string' ? params.selector : ''
  const rawRegion = params && typeof params.region === 'object' && params.region
    ? params.region
    : null
  const rawFormat = params && typeof params.format === 'string' ? params.format : ''
  const description =
    params && typeof params.description === 'string' ? params.description : ''

  if (!sessionId) {
    throw new Error('sessionId is required')
  }

  const mode = rawMode || 'viewport'
  const format = rawFormat === 'jpeg' || rawFormat === 'jpg' ? 'jpeg' : 'png'

  let region = null
  if (rawRegion) {
    const x = Number(rawRegion.x)
    const y = Number(rawRegion.y)
    const width = Number(rawRegion.width)
    const height = Number(rawRegion.height)
    if (
      Number.isFinite(x) &&
      Number.isFinite(y) &&
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width > 0 &&
      height > 0
    ) {
      region = { x, y, width, height }
    }
  }

  const cdpPort = getCdpPort()

  if (!app.isReady()) {
    await app.whenReady()
  }

  let chromium
  try {
    ;({ chromium } = await import('playwright-core'))
  } catch (error) {
    const message = error && error.message ? String(error.message) : String(error || '')
    throw new Error(`加载 playwright-core 失败，请先安装依赖：${message}`)
  }

  const endpoint = `http://127.0.0.1:${cdpPort}`
  const browser = await chromium.connectOverCDP(endpoint)

  try {
    const contexts = browser.contexts()
    let targetPage = null
    const candidatePages = []

    for (const context of contexts) {
      const pages = context.pages()
      for (const page of pages) {
        try {
          const url = page.url()
          if (!url) continue
          if (url.includes(sessionId)) {
            targetPage = page
            break
          }
          if (!isMainAppUrl(url)) {
            candidatePages.push(page)
          }
        } catch {
          // ignore
        }
      }
      if (targetPage) break
    }

    if (!targetPage && candidatePages.length === 1) {
      targetPage = candidatePages[0]
    }

    if (!targetPage) {
      throw new Error('Playwright 已连接到 Electron，但未找到包含该 session 标记的 Page。')
    }

    const id = Date.now().toString(36)
    const ext = format === 'jpeg' ? 'jpg' : 'png'
    const fileName = `browser-agent-snapshot-${id}.${ext}`
    const tmpDir = os.tmpdir()
    const fullPath = path.join(tmpDir, fileName)

    if (mode === 'full') {
      await targetPage.screenshot({ path: fullPath, fullPage: true, type: format })
    } else if (mode === 'element') {
      if (!selector) {
        throw new Error('selector is required when mode=element')
      }
      const locator = targetPage.locator(selector)
      await locator.screenshot({ path: fullPath, type: format })
    } else if (mode === 'region') {
      if (!region) {
        throw new Error('valid region is required when mode=region')
      }
      await targetPage.screenshot({
        path: fullPath,
        type: format,
        clip: region,
      })
    } else {
      // viewport
      await targetPage.screenshot({ path: fullPath, fullPage: false, type: format })
    }

    const title = await targetPage.title().catch(() => '')
    const finalUrl = targetPage.url()

    try {
      const line = `[BrowserAgent] [session=${sessionId}] action=screenshot mode=${mode} selector=${selector || ''} pageUrl=${finalUrl}`
      console.log(line)
      appendBrowserAgentTextLog(line)
    } catch {}

    return {
      sessionId,
      action: 'screenshot',
      mode,
      selector: selector || null,
      region,
      format,
      description,
      screenshotPath: fullPath,
      pageUrl: finalUrl,
      pageTitle: title,
    }
  } finally {
    try {
      await browser.close()
    } catch {
      // ignore
    }
  }
}

function isMainAppUrl(url) {
  if (!url || typeof url !== 'string') return false
  if (url.startsWith('http://localhost:5174')) return true
  if (url.startsWith('file://')) return true
  if (url.startsWith('devtools://')) return true
  if (url.startsWith('chrome-extension://')) return true
  return false
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildNavigateTargetUrl(rawUrl, sessionId) {
  const safeId = encodeURIComponent(sessionId)
  try {
    const url = new URL(rawUrl)
    url.searchParams.set('agent_session', safeId)
    return url.toString()
  } catch {
    // 若不是合法绝对 URL，则直接附加查询参数
    const hasQuery = rawUrl.includes('?')
    const sep = hasQuery ? '&' : '?'
    return `${rawUrl}${sep}agent_session=${safeId}`
  }
}

/**
 * Playwright Spike：
 * - 创建一个专用 BrowserWindow，导航到 https://www.baidu.com 带唯一标记；
 * - 通过 remote-debugging-port 使用 playwright-core 的 connectOverCDP 连接到 Electron；
 * - 找到对应 Page，读取 title/url，并在临时目录截一张图；
 * - 返回调试信息（不做持久化存储）。
 *
 * 注意：
 * - 需要在应用启动前通过 app.commandLine.appendSwitch('remote-debugging-port', port) 开启 CDP 端口；
 * - 需要安装 dev 依赖 playwright-core。
 */
export async function runPlaywrightSpike() {
  const cdpPort = getCdpPort()

  if (!app.isReady()) {
    await app.whenReady()
  }

  // 创建一个简单的 BrowserWindow，用于 Spike
  const spikeWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    show: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  const sessionId = `spike_${Date.now().toString(36)}`
  const targetUrl = `https://www.baidu.com/?agent_spike=${encodeURIComponent(sessionId)}`

  await spikeWindow.loadURL(targetUrl)

  // 等待页面初步加载稳定（百度首页相对较重，适当多等一会）
  await delay(3000)

  let chromium
  try {
    ;({ chromium } = await import('playwright-core'))
  } catch (error) {
    const message = error && error.message ? String(error.message) : String(error || '')
    throw new Error(`加载 playwright-core 失败，请先安装依赖：${message}`)
  }

  const endpoint = `http://127.0.0.1:${cdpPort}`
  const browser = await chromium.connectOverCDP(endpoint)

  try {
    const contexts = browser.contexts()
    let targetPage = null

    for (const context of contexts) {
      const pages = context.pages()
      for (const page of pages) {
        try {
          const url = page.url()
          if (url && url.includes(sessionId)) {
            targetPage = page
            break
          }
        } catch {
          // ignore
        }
      }
      if (targetPage) break
    }

    if (!targetPage) {
      throw new Error('Playwright 已连接到 Electron，但未找到包含 spike 会话标记的 Page。')
    }

    const title = await targetPage.title().catch(() => '')
    const finalUrl = targetPage.url()

    // 在临时目录保存一张截图，便于人工验证
    let screenshotPath = ''
    try {
      const fileName = `browser-agent-spike-${Date.now().toString(36)}.png`
      const tmpDir = os.tmpdir()
      const fullPath = path.join(tmpDir, fileName)
      await targetPage.screenshot({ path: fullPath, fullPage: true })
      screenshotPath = fullPath
    } catch {
      // 截图失败不视为整个 Spike 失败，只在结果中留空截图路径
      screenshotPath = ''
    }

    return {
      cdpEndpoint: endpoint,
      sessionId,
      targetUrl,
      pageUrl: finalUrl,
      pageTitle: title,
      screenshotPath,
    }
  } finally {
    try {
      await browser.close()
    } catch {
      // ignore
    }
  }
}
