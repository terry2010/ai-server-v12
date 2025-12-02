import { BrowserWindow, app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { getSession } from './browser-agent-core.js'
import {
  appendBrowserAgentTextLog,
  getBrowserAgentDataRootDir,
  ensureDirSync,
  appendFileRecord,
  appendActionRecord,
} from './browser-agent-storage.js'

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
  const rawWaitUntil =
    params && typeof params.waitUntil === 'string' ? params.waitUntil : ''
  const rawTimeout =
    params && typeof params.timeoutMs === 'number' ? params.timeoutMs : null
  const timeoutMs =
    rawTimeout && Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 30000

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

  /**
   * 记录当前导航主文档的 HTTP 状态码，供后续错误分类使用。
   *
   * - 优先通过 session.webRequest.onCompleted 捕获 resourceType=mainFrame 的状态码；
   * - 同时保留 did-get-response-details 作为补充（旧接口，部分版本可能不触发）。
   */
  let mainFrameHttpStatus = null
  /** @type {((event: Electron.Event, status: boolean, newURL: string, originalURL: string, httpResponseCode: number, requestMethod: string, referrer: string, responseHeaders: any, resourceType: string) => void) | null} */
  let mainFrameResponseListener = null

  try {
    const wc = win.webContents

    // 使用 webRequest.onCompleted 按 sessionId 记录主文档 HTTP 状态码
    try {
      const electronSession = wc.session
      // @ts-ignore 在 BrowserWindow 上挂一个 Map: sessionId -> httpStatus
      if (!win.__browserAgentMainFrameStatusMap) {
        // @ts-ignore
        win.__browserAgentMainFrameStatusMap = new Map()
      }
      // @ts-ignore 记录每个 session 的主文档重定向链路数组
      if (!win.__browserAgentRedirectChainMap) {
        // @ts-ignore
        win.__browserAgentRedirectChainMap = new Map()
      }
      // @ts-ignore
      const statusMap = win.__browserAgentMainFrameStatusMap
      // @ts-ignore
      const redirectMap = win.__browserAgentRedirectChainMap

      // 确保 webRequest 监听器只注册一次
      // @ts-ignore
      if (!win.__browserAgentWebRequestAttached) {
        const filter = { urls: ['*://*/*'] }
        try {
          // 记录每一次 3xx 主文档重定向
          electronSession.webRequest.onBeforeRedirect(filter, (details) => {
            try {
              if (!details || details.resourceType !== 'mainFrame') return
              const url = typeof details.url === 'string' ? details.url : ''
              if (!url) return

              const m = /[?&]agent_session=([^&]+)/.exec(url)
              if (!m || !m[1]) return

              const sid = decodeURIComponent(m[1])
              const code =
                typeof details.statusCode === 'number' &&
                Number.isFinite(details.statusCode)
                  ? details.statusCode
                  : null
              if (!code || code < 100 || code > 999) return

              try {
                let chain = redirectMap.get(sid)
                if (!Array.isArray(chain)) {
                  chain = []
                  redirectMap.set(sid, chain)
                }
                chain.push({
                  url,
                  statusCode: code,
                  fromCache: !!details.fromCache,
                  isRedirect: true,
                  redirectUrl:
                    typeof details.redirectURL === 'string'
                      ? details.redirectURL
                      : '',
                  timestamp: new Date().toISOString(),
                })
              } catch {}

              try {
                const line = `[BrowserAgent] [session=${sid}] event=webRequestMainFrameRedirect url=${url} httpStatus=${code} redirectUrl=${
                  // @ts-ignore
                  details.redirectURL || ''
                }`
                console.log(line)
                appendBrowserAgentTextLog(line)
              } catch {}
            } catch {}
          })
        } catch {}

        try {
          // 记录最终主文档响应（通常是 2xx/4xx/5xx）
          electronSession.webRequest.onCompleted(filter, (details) => {
            try {
              if (!details || details.resourceType !== 'mainFrame') return
              const url = typeof details.url === 'string' ? details.url : ''
              if (!url) return

              const m = /[?&]agent_session=([^&]+)/.exec(url)
              if (!m || !m[1]) return

              const sid = decodeURIComponent(m[1])
              const code =
                typeof details.statusCode === 'number' &&
                Number.isFinite(details.statusCode)
                  ? details.statusCode
                  : null
              if (!code || code < 100 || code > 999) return

              statusMap.set(sid, code)

              try {
                let chain = redirectMap.get(sid)
                if (!Array.isArray(chain)) {
                  chain = []
                  redirectMap.set(sid, chain)
                }
                chain.push({
                  url,
                  statusCode: code,
                  fromCache: !!details.fromCache,
                  isRedirect: false,
                  redirectUrl: '',
                  timestamp: new Date().toISOString(),
                })
              } catch {}

              try {
                const line = `[BrowserAgent] [session=${sid}] event=webRequestMainFrameCompleted url=${url} httpStatus=${code}`
                console.log(line)
                appendBrowserAgentTextLog(line)
              } catch {}
            } catch {}
          })
        } catch {}

        // @ts-ignore
        win.__browserAgentWebRequestAttached = true
      }

      // 每次导航前清理当前 sessionId 的旧值
      statusMap.delete(sessionId)
      redirectMap.delete(sessionId)
    } catch {}

    // 兼容旧版：继续尝试通过 did-get-response-details 捕获 HTTP 状态
    mainFrameResponseListener = (
      _event,
      _status,
      newURL,
      _originalURL,
      httpResponseCode,
      _requestMethod,
      _referrer,
      _responseHeaders,
      resourceType,
    ) => {
      try {
        if (resourceType === 'mainFrame') {
          const code =
            typeof httpResponseCode === 'number' && Number.isFinite(httpResponseCode)
              ? httpResponseCode
              : null
          if (code && code >= 100 && code <= 999) {
            mainFrameHttpStatus = code
            try {
              const line = `[BrowserAgent] [session=${sessionId}] event=mainFrameResponse url=${newURL} httpStatus=${code}`
              console.log(line)
              appendBrowserAgentTextLog(line)
            } catch {}
          }
        }
      } catch {}
    }

    try {
      wc.on('did-get-response-details', mainFrameResponseListener)
    } catch {}
  } catch {}

  // 为该 BrowserWindow 附加 URL 变化日志与下载拦截（只注册一次监听器），并记录当前归属的 sessionId
  try {
    win.__browserAgentSessionId = sessionId
    if (!win.__browserAgentUrlLoggerAttached) {
      const logNav = (eventType, url) => {
        try {
          const sid = win.__browserAgentSessionId || sessionId
          const line = `[BrowserAgent] [session=${sid}] event=${eventType} url=${url}`
          console.log(line)
          appendBrowserAgentTextLog(line)
          appendNavTimelineAction(sid, url, eventType)
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

    if (!win.__browserAgentDownloadHandlerAttached) {
      const wc = win.webContents
      try {
        wc.session.on('will-download', (_event, item) => {
          try {
            const sid = win.__browserAgentSessionId || sessionId
            if (!sid) return

            const root = getBrowserAgentDataRootDir()
            if (!root) return

            const relDir = path.join('sessions', sid, 'files')
            const absDir = ensureDirSync(path.join(root, relDir))
            if (!absDir) return

            const originalName =
              (typeof item.getFilename === 'function' && item.getFilename()) ||
              'download.dat'
            const safeName = String(originalName || 'download.dat').replace(/[\\/]+/g, '_')

            const fileId = `file_${Date.now().toString(36)}`
            const fileName = safeName || `${fileId}.dat`
            const relPath = path.join(relDir, fileName)
            const absPath = path.join(absDir, fileName)

            try {
              item.setSavePath(absPath)
            } catch {
              return
            }

            const startAt = new Date().toISOString()

            item.once('done', (_e, state) => {
              try {
                const endAt = new Date().toISOString()
                if (state !== 'completed') {
                  const logLine = `[BrowserAgent] [session=${sid}] action=download state=${state} name=${fileName}`
                  console.log(logLine)
                  appendBrowserAgentTextLog(logLine)
                  return
                }

                let size = 0
                try {
                  const st = fs.statSync(absPath)
                  if (st && typeof st.size === 'number') {
                    size = st.size
                  }
                } catch {}

                let mimeType = null
                try {
                  mimeType =
                    typeof item.getMimeType === 'function' && item.getMimeType()
                      ? item.getMimeType()
                      : null
                } catch {
                  mimeType = null
                }

                appendFileRecord({
                  fileId,
                  sessionId: sid,
                  path: relPath,
                  name: fileName,
                  size,
                  mimeType,
                  createdAt: endAt,
                })

                const logLine = `[BrowserAgent] [session=${sid}] action=download state=completed fileId=${fileId} name=${fileName} size=${size}`
                console.log(logLine)
                appendBrowserAgentTextLog(logLine)
              } catch {}
            })
          } catch {}
        })
      } catch {}

      win.__browserAgentDownloadHandlerAttached = true
    }
  } catch {}

  await loadUrlWithTimeout(win, targetUrl, timeoutMs)

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
    } else if (!targetPage && candidatePages.length > 1) {
      // 当存在多个候选 Page（如 302 跳转到外部站点），优先选择最后一个非应用页面，
      // 视为本次导航的最终页面，而不是直接报错。
      targetPage = candidatePages[candidatePages.length - 1]
    }

    if (!targetPage) {
      // 如果连候选页面都没有，再按原逻辑视为 Playwright 连接异常。
      let httpStatusForError = null
      try {
        // @ts-ignore
        const statusMap = win.__browserAgentMainFrameStatusMap
        if (statusMap && typeof statusMap.get === 'function') {
          const code = statusMap.get(sessionId)
          if (typeof code === 'number' && Number.isFinite(code)) {
            httpStatusForError = code
          }
        }
      } catch {}

      const err = new Error(
        'Playwright 已连接到 Electron，但未找到包含该 session 标记的 Page。',
      )

      try {
        const classified = classifyNetworkError(err, {
          action: 'navigate',
          url: targetUrl,
          httpStatus: httpStatusForError,
        })
        if (classified && classified.baCode) {
          // @ts-ignore
          err.baCode = classified.baCode
          // @ts-ignore
          err.baDetails = classified.baDetails
        }
      } catch {}

      throw err
    }

    const lowerWait = rawWaitUntil.toLowerCase()
    let waitUntil = null
    if (
      lowerWait === 'load' ||
      lowerWait === 'domcontentloaded' ||
      lowerWait === 'networkidle'
    ) {
      waitUntil = lowerWait
    }

    if (waitUntil) {
      await targetPage
        .waitForLoadState(waitUntil, { timeout: timeoutMs })
        .catch((error) => {
          try {
            const classified = classifyNetworkError(error, {
              action: 'navigate',
              url: targetUrl,
              httpStatus: mainFrameHttpStatus,
            })
            if (classified && classified.baCode) {
              // @ts-ignore
              error.baCode = classified.baCode
              // @ts-ignore
              error.baDetails = classified.baDetails
            }
          } catch {}
          throw error
        })
    }

    const antiBot = await detectAntiBotPage(targetPage).catch(() => null)
    if (antiBot && antiBot.isAntiBot) {
      const err = new Error(antiBot.message || 'Anti-bot or verification page detected')
      err.name = 'ANTI_BOT_PAGE'
      // @ts-ignore
      err.baCode = 'ANTI_BOT_PAGE'
      // @ts-ignore
      err.baDetails = {
        url: antiBot.url || null,
        title: antiBot.title || null,
        snippet: antiBot.snippet || null,
        ruleType: antiBot.ruleType || null,
        ruleKeyword: antiBot.ruleKeyword || null,
      }
      throw err
    }

    const title = await targetPage.title().catch(() => '')
    const finalUrl = targetPage.url()

    // 如果主文档 HTTP 状态码为 4xx/5xx，则按网络错误进行分类并抛出，供上层映射为 HTTP_4XX / HTTP_5XX。
    let httpStatus = null
    let redirectChain = null

    try {
      // @ts-ignore
      const statusMap = win.__browserAgentMainFrameStatusMap
      // @ts-ignore
      const redirectMap = win.__browserAgentRedirectChainMap
      if (statusMap && typeof statusMap.get === 'function') {
        const code = statusMap.get(sessionId)
        if (typeof code === 'number' && Number.isFinite(code)) {
          httpStatus = code
        }
      }
      if (redirectMap && typeof redirectMap.get === 'function') {
        const chain = redirectMap.get(sessionId)
        if (Array.isArray(chain) && chain.length > 0) {
          redirectChain = chain
        }
      }
    } catch {}

    if (
      !httpStatus &&
      typeof mainFrameHttpStatus === 'number' &&
      Number.isFinite(mainFrameHttpStatus)
    ) {
      httpStatus = mainFrameHttpStatus
    }
    if (httpStatus && httpStatus >= 400) {
      const err = new Error(
        `HTTP status ${httpStatus} while navigating to ${finalUrl || targetUrl}`,
      )
      try {
        const classified = classifyNetworkError(err, {
          action: 'navigate',
          url: finalUrl || targetUrl,
          httpStatus,
        })
        if (classified && classified.baCode) {
          // @ts-ignore
          err.baCode = classified.baCode
          // @ts-ignore
          err.baDetails = classified.baDetails
        }
      } catch {}
      throw err
    }

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
      waitUntil: waitUntil || null,
      timeoutMs,
      httpStatus,
      redirectChain,
    }
  } finally {
    // 清理主文档 HTTP 状态监听器，避免重复注册
    try {
      if (win && !win.isDestroyed() && mainFrameResponseListener) {
        try {
          win.webContents.removeListener(
            'did-get-response-details',
            mainFrameResponseListener,
          )
        } catch {}
      }
    } catch {}

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

export async function mouseClickPoint(params) {
  const sessionId = params && typeof params.sessionId === 'string' ? params.sessionId : ''
  const xRaw = params && typeof params.x === 'number' ? params.x : null
  const yRaw = params && typeof params.y === 'number' ? params.y : null
  const rawButton = params && typeof params.button === 'string' ? params.button : ''
  const rawTimeout = params && typeof params.timeoutMs === 'number' ? params.timeoutMs : null

  if (!sessionId) {
    throw new Error('sessionId is required')
  }

  const x = Number(xRaw)
  const y = Number(yRaw)
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error('x and y are required')
  }

  const lowerButton = rawButton.toLowerCase()
  const button =
    lowerButton === 'right' || lowerButton === 'middle' || lowerButton === 'left'
      ? lowerButton
      : 'left'

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

    const mouse = targetPage.mouse
    await mouse.move(x, y)
    await mouse.down({ button })
    await mouse.up({ button })

    const title = await targetPage.title().catch(() => '')
    const finalUrl = targetPage.url()

    try {
      const line = `[BrowserAgent] [session=${sessionId}] action=mouse.click x=${x} y=${y} button=${button} pageUrl=${finalUrl}`
      console.log(line)
      appendBrowserAgentTextLog(line)
    } catch {}

    return {
      sessionId,
      action: 'mouse.click',
      x,
      y,
      button,
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

export async function mouseDragPath(params) {
  const sessionId = params && typeof params.sessionId === 'string' ? params.sessionId : ''
  const rawPath = params && Array.isArray(params.path) ? params.path : []
  const rawButton = params && typeof params.button === 'string' ? params.button : ''
  const rawTimeout = params && typeof params.timeoutMs === 'number' ? params.timeoutMs : null

  if (!sessionId) {
    throw new Error('sessionId is required')
  }

  const points = []
  for (const item of rawPath) {
    if (!item || typeof item !== 'object') continue
    const x = Number(item.x)
    const y = Number(item.y)
    const tMsRaw = Number(item.tMs)
    const tMs = Number.isFinite(tMsRaw) && tMsRaw >= 0 ? tMsRaw : 0
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    points.push({ x, y, tMs })
  }

  if (!points.length) {
    throw new Error('path with at least one valid point is required')
  }

  points.sort((a, b) => a.tMs - b.tMs)

  const lowerButton = rawButton.toLowerCase()
  const button =
    lowerButton === 'right' || lowerButton === 'middle' || lowerButton === 'left'
      ? lowerButton
      : 'left'

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

    const mouse = targetPage.mouse

    // 起点
    const first = points[0]
    await mouse.move(first.x, first.y)
    await mouse.down({ button })

    for (let i = 1; i < points.length; i += 1) {
      const prev = points[i - 1]
      const curr = points[i]
      const delta = curr.tMs - prev.tMs
      if (delta > 0) {
        // 使用已有的 delay 工具，按相对时间间隔移动
        await delay(delta)
      }
      await mouse.move(curr.x, curr.y)
    }

    await mouse.up({ button })

    const title = await targetPage.title().catch(() => '')
    const finalUrl = targetPage.url()

    try {
      const line = `[BrowserAgent] [session=${sessionId}] action=mouse.drag points=${points.length} button=${button} pageUrl=${finalUrl}`
      console.log(line)
      appendBrowserAgentTextLog(line)
    } catch {}

    return {
      sessionId,
      action: 'mouse.drag',
      button,
      timeoutMs,
      path: points,
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

export async function extractHtml(params) {
  const sessionId = params && typeof params.sessionId === 'string' ? params.sessionId : ''
  const selector = params && typeof params.selector === 'string' ? params.selector : ''
  const outer =
    params && typeof params.outer === 'boolean' ? params.outer : false

  if (!sessionId) {
    throw new Error('sessionId is required')
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

    let html = ''
    if (selector) {
      const locator = targetPage.locator(selector).first()
      try {
        await locator.waitFor({ state: 'attached', timeout: 5000 })
      } catch {}
      html = await locator.evaluate((el, useOuter) => {
        try {
          return useOuter ? el.outerHTML || '' : el.innerHTML || ''
        } catch {
          return ''
        }
      }, outer)
    } else {
      html = await targetPage.content()
    }
    const title = await targetPage.title().catch(() => '')
    const finalUrl = targetPage.url()

    try {
      const line = `[BrowserAgent] [session=${sessionId}] action=content.html selector=${selector || ''} outer=${outer} pageUrl=${finalUrl}`
      console.log(line)
      appendBrowserAgentTextLog(line)
    } catch {}

    return {
      sessionId,
      action: 'content.html',
      selector: selector || null,
      outer,
      pageUrl: finalUrl,
      pageTitle: title,
      html,
    }
  } finally {
    try {
      await browser.close()
    } catch {
      // ignore
    }
  }
}

export async function extractText(params) {
  const sessionId = params && typeof params.sessionId === 'string' ? params.sessionId : ''
  const rawScope = params && typeof params.scope === 'string' ? params.scope : ''
  const selector = params && typeof params.selector === 'string' ? params.selector : ''

  if (!sessionId) {
    throw new Error('sessionId is required')
  }

  const scope = rawScope && rawScope.toLowerCase() === 'selector' ? 'selector' : 'page'
  if (scope === 'selector' && !selector) {
    throw new Error('selector is required when scope=selector')
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

    let text = ''
    if (scope === 'page') {
      text = await targetPage.evaluate(() => {
        try {
          const root = document.body || document.documentElement
          if (!root) return ''
          const value = root.innerText || root.textContent || ''
          return typeof value === 'string' ? value : ''
        } catch {
          return ''
        }
      })
    } else {
      const locator = targetPage.locator(selector)
      try {
        text = await locator.innerText()
      } catch {
        text = ''
      }
    }

    const title = await targetPage.title().catch(() => '')
    const finalUrl = targetPage.url()

    try {
      const line = `[BrowserAgent] [session=${sessionId}] action=content.text scope=${scope} pageUrl=${finalUrl}`
      console.log(line)
      appendBrowserAgentTextLog(line)
    } catch {}

    return {
      sessionId,
      action: 'content.text',
      scope,
      selector: scope === 'selector' ? selector : null,
      pageUrl: finalUrl,
      pageTitle: title,
      text,
    }
  } finally {
    try {
      await browser.close()
    } catch {
      // ignore
    }
  }
}

export async function extractTable(params) {
  const sessionId = params && typeof params.sessionId === 'string' ? params.sessionId : ''
  const selector = params && typeof params.selector === 'string' ? params.selector : ''

  if (!sessionId) {
    throw new Error('sessionId is required')
  }
  if (!selector) {
    throw new Error('selector is required')
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

    const tableData = await targetPage.evaluate((sel) => {
      try {
        const table = document.querySelector(sel)
        if (!table) {
          return { headers: [], rows: [] }
        }

        const headers = []
        const rows = []

        const headerRow = table.querySelector('thead tr') || table.querySelector('tr')
        if (headerRow) {
          const cells = Array.from(headerRow.querySelectorAll('th,td'))
          for (const cell of cells) {
            const text = cell.innerText || cell.textContent || ''
            headers.push(String(text || '').trim())
          }
        }

        const bodyRows = table.querySelectorAll('tbody tr')
        const rowNodes =
          bodyRows && bodyRows.length > 0
            ? Array.from(bodyRows)
            : Array.from(table.querySelectorAll('tr')).slice(1)

        for (const tr of rowNodes) {
          const cells = Array.from(tr.querySelectorAll('th,td'))
          if (!cells.length) continue
          const row = []
          for (const cell of cells) {
            const text = cell.innerText || cell.textContent || ''
            row.push(String(text || '').trim())
          }
          rows.push(row)
        }

        return { headers, rows }
      } catch {
        return { headers: [], rows: [] }
      }
    }, selector)

    const title = await targetPage.title().catch(() => '')
    const finalUrl = targetPage.url()

    try {
      const line = `[BrowserAgent] [session=${sessionId}] action=content.table selector=${selector} pageUrl=${finalUrl}`
      console.log(line)
      appendBrowserAgentTextLog(line)
    } catch {}

    return {
      sessionId,
      action: 'content.table',
      selector,
      pageUrl: finalUrl,
      pageTitle: title,
      headers: Array.isArray(tableData && tableData.headers) ? tableData.headers : [],
      rows: Array.isArray(tableData && tableData.rows) ? tableData.rows : [],
    }
  } finally {
    try {
      await browser.close()
    } catch {
      // ignore
    }
  }
}

async function getPageForSession(sessionId) {
  if (!sessionId) {
    throw new Error('sessionId is required')
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
    try {
      await browser.close()
    } catch {
      // ignore
    }
    throw new Error('Playwright 已连接到 Electron，但未找到包含该 session 标记的 Page。')
  }

  return { browser, page: targetPage, endpoint }
}

export async function waitForSelectorAction(params) {
  const sessionId = params && typeof params.sessionId === 'string' ? params.sessionId : ''
  const selector = params && typeof params.selector === 'string' ? params.selector : ''
  const rawState = params && typeof params.state === 'string' ? params.state : ''
  const rawTimeout = params && typeof params.timeoutMs === 'number' ? params.timeoutMs : null

  if (!sessionId) {
    throw new Error('sessionId is required')
  }
  if (!selector) {
    throw new Error('selector is required')
  }

  const lower = rawState.toLowerCase()
  let state = 'visible'
  if (lower === 'attached' || lower === 'visible' || lower === 'hidden' || lower === 'detached') {
    state = lower
  }

  const timeoutMs =
    rawTimeout && Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 30000

  const { browser, page } = await getPageForSession(sessionId)

  try {
    const locator = page.locator(selector)
    await locator.waitFor({ state, timeout: timeoutMs }).catch((error) => {
      try {
        const currentUrl = (() => {
          try {
            return page.url()
          } catch {
            return ''
          }
        })()
        const classified = classifyNetworkError(error, {
          action: 'wait.selector',
          url: currentUrl,
        })
        if (classified && classified.baCode) {
          // @ts-ignore
          error.baCode = classified.baCode
          // @ts-ignore
          error.baDetails = classified.baDetails
        }
      } catch {}
      throw error
    })

    const title = await page.title().catch(() => '')
    const finalUrl = page.url()

    try {
      const line = `[BrowserAgent] [session=${sessionId}] action=wait.selector selector=${selector} state=${state} pageUrl=${finalUrl}`
      console.log(line)
      appendBrowserAgentTextLog(line)
    } catch {}

    return {
      sessionId,
      action: 'wait.selector',
      selector,
      state,
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

export async function waitForTextAction(params) {
  const sessionId = params && typeof params.sessionId === 'string' ? params.sessionId : ''
  const text = params && typeof params.text === 'string' ? params.text : ''
  const rawScope = params && typeof params.scope === 'string' ? params.scope : ''
  const selector = params && typeof params.selector === 'string' ? params.selector : ''
  const rawTimeout = params && typeof params.timeoutMs === 'number' ? params.timeoutMs : null

  if (!sessionId) {
    throw new Error('sessionId is required')
  }
  if (!text) {
    throw new Error('text is required')
  }

  const scope = rawScope && rawScope.toLowerCase() === 'selector' ? 'selector' : 'page'
  if (scope === 'selector' && !selector) {
    throw new Error('selector is required when scope=selector')
  }

  const timeoutMs =
    rawTimeout && Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 30000

  const { browser, page } = await getPageForSession(sessionId)

  try {
    if (scope === 'page') {
      await page
        .waitForFunction(
          (needle) => {
            try {
              const root = document.body || document.documentElement
              if (!root) return false
              const value = root.innerText || root.textContent || ''
              return typeof value === 'string' && value.includes(needle)
            } catch {
              return false
            }
          },
          text,
          { timeout: timeoutMs },
        )
        .catch((error) => {
          try {
            const currentUrl = (() => {
              try {
                return page.url()
              } catch {
                return ''
              }
            })()
            const classified = classifyNetworkError(error, {
              action: 'wait.text',
              url: currentUrl,
            })
            if (classified && classified.baCode) {
              // @ts-ignore
              error.baCode = classified.baCode
              // @ts-ignore
              error.baDetails = classified.baDetails
            }
          } catch {}
          throw error
        })
    } else {
      await page
        .waitForFunction(
          (arg) => {
            const { selector: sel, needle } = arg
            try {
              const el = document.querySelector(sel)
              if (!el) return false
              const value = el.innerText || el.textContent || ''
              return typeof value === 'string' && value.includes(needle)
            } catch {
              return false
            }
          },
          { selector, needle: text },
          { timeout: timeoutMs },
        )
        .catch((error) => {
          try {
            const currentUrl = (() => {
              try {
                return page.url()
              } catch {
                return ''
              }
            })()
            const classified = classifyNetworkError(error, {
              action: 'wait.text',
              url: currentUrl,
            })
            if (classified && classified.baCode) {
              // @ts-ignore
              error.baCode = classified.baCode
              // @ts-ignore
              error.baDetails = classified.baDetails
            }
          } catch {}
          throw error
        })
    }

    const title = await page.title().catch(() => '')
    const finalUrl = page.url()

    try {
      const line = `[BrowserAgent] [session=${sessionId}] action=wait.text scope=${scope} selector=${scope === 'selector' ? selector : ''} pageUrl=${finalUrl}`
      console.log(line)
      appendBrowserAgentTextLog(line)
    } catch {}

    return {
      sessionId,
      action: 'wait.text',
      text,
      scope,
      selector: scope === 'selector' ? selector : null,
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

export async function waitForUrlAction(params) {
  const sessionId = params && typeof params.sessionId === 'string' ? params.sessionId : ''
  const contains = params && typeof params.contains === 'string' ? params.contains : ''
  const equals = params && typeof params.equals === 'string' ? params.equals : ''
  const rawTimeout = params && typeof params.timeoutMs === 'number' ? params.timeoutMs : null

  if (!sessionId) {
    throw new Error('sessionId is required')
  }
  if (!contains && !equals) {
    throw new Error('contains or equals is required')
  }

  const timeoutMs =
    rawTimeout && Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 30000

  const { browser, page } = await getPageForSession(sessionId)

  try {
    await page
      .waitForFunction(
        (arg) => {
          const { contains: c, equals: e } = arg
          try {
            const url = window.location.href || ''
            if (e && url === e) return true
            if (c && url.includes(c)) return true
            return false
          } catch {
            return false
          }
        },
        { contains, equals },
        { timeout: timeoutMs },
      )
      .catch((error) => {
        try {
          const currentUrl = (() => {
            try {
              return page.url()
            } catch {
              return ''
            }
          })()
          const classified = classifyNetworkError(error, {
            action: 'wait.url',
            url: currentUrl,
          })
          if (classified && classified.baCode) {
            // @ts-ignore
            error.baCode = classified.baCode
            // @ts-ignore
            error.baDetails = classified.baDetails
          }
        } catch {}
        throw error
      })

    const title = await page.title().catch(() => '')
    const finalUrl = page.url()

    try {
      const line = `[BrowserAgent] [session=${sessionId}] action=wait.url contains=${contains} equals=${equals} pageUrl=${finalUrl}`
      console.log(line)
      appendBrowserAgentTextLog(line)
    } catch {}

    return {
      sessionId,
      action: 'wait.url',
      contains: contains || null,
      equals: equals || null,
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

export async function domScrollIntoView(params) {
  const sessionId = params && typeof params.sessionId === 'string' ? params.sessionId : ''
  const selector = params && typeof params.selector === 'string' ? params.selector : ''
  const rawTimeout = params && typeof params.timeoutMs === 'number' ? params.timeoutMs : null

  if (!sessionId) {
    throw new Error('sessionId is required')
  }
  if (!selector) {
    throw new Error('selector is required')
  }

  const timeoutMs =
    rawTimeout && Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 30000

  const { browser, page } = await getPageForSession(sessionId)

  try {
    const locator = page.locator(selector)
    await locator.scrollIntoViewIfNeeded({ timeout: timeoutMs })

    const title = await page.title().catch(() => '')
    const finalUrl = page.url()

    try {
      const line = `[BrowserAgent] [session=${sessionId}] action=dom.scrollIntoView selector=${selector} pageUrl=${finalUrl}`
      console.log(line)
      appendBrowserAgentTextLog(line)
    } catch {}

    return {
      sessionId,
      action: 'dom.scrollIntoView',
      selector,
      timeoutMs,
      pageUrl: finalUrl,
      pageTitle: title,
    }
  } finally {
    try {
      if (win && !win.isDestroyed() && mainFrameResponseListener) {
        try {
          win.webContents.removeListener(
            'did-get-response-details',
            mainFrameResponseListener,
          )
        } catch {}
      }
    } catch {}

    try {
      await browser.close()
    } catch {
    }
  }
}

export async function domSetCheckbox(params) {
  const sessionId = params && typeof params.sessionId === 'string' ? params.sessionId : ''
  const selector = params && typeof params.selector === 'string' ? params.selector : ''
  const checked =
    params && typeof params.checked === 'boolean' ? params.checked : true
  const rawTimeout = params && typeof params.timeoutMs === 'number' ? params.timeoutMs : null

  if (!sessionId) {
    throw new Error('sessionId is required')
  }
  if (!selector) {
    throw new Error('selector is required')
  }

  const timeoutMs =
    rawTimeout && Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 30000

  const { browser, page } = await getPageForSession(sessionId)

  try {
    const locator = page.locator(selector)
    await locator.setChecked(checked, { timeout: timeoutMs })

    const title = await page.title().catch(() => '')
    const finalUrl = page.url()

    try {
      const line = `[BrowserAgent] [session=${sessionId}] action=dom.setCheckbox selector=${selector} checked=${checked} pageUrl=${finalUrl}`
      console.log(line)
      appendBrowserAgentTextLog(line)
    } catch {}

    return {
      sessionId,
      action: 'dom.setCheckbox',
      selector,
      checked,
      timeoutMs,
      pageUrl: finalUrl,
      pageTitle: title,
    }
  } finally {
    try {
      await browser.close()
    } catch {
    }
  }
}

export async function domSetRadio(params) {
  const sessionId = params && typeof params.sessionId === 'string' ? params.sessionId : ''
  const selector = params && typeof params.selector === 'string' ? params.selector : ''
  const rawTimeout = params && typeof params.timeoutMs === 'number' ? params.timeoutMs : null

  if (!sessionId) {
    throw new Error('sessionId is required')
  }
  if (!selector) {
    throw new Error('selector is required')
  }

  const timeoutMs =
    rawTimeout && Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 30000

  const { browser, page } = await getPageForSession(sessionId)

  try {
    const locator = page.locator(selector)
    await locator.check({ timeout: timeoutMs })

    const title = await page.title().catch(() => '')
    const finalUrl = page.url()

    try {
      const line = `[BrowserAgent] [session=${sessionId}] action=dom.setRadio selector=${selector} pageUrl=${finalUrl}`
      console.log(line)
      appendBrowserAgentTextLog(line)
    } catch {}

    return {
      sessionId,
      action: 'dom.setRadio',
      selector,
      timeoutMs,
      pageUrl: finalUrl,
      pageTitle: title,
    }
  } finally {
    try {
      await browser.close()
    } catch {
    }
  }
}

export async function domSelectOptions(params) {
  const sessionId = params && typeof params.sessionId === 'string' ? params.sessionId : ''
  const selector = params && typeof params.selector === 'string' ? params.selector : ''
  const values =
    params && Array.isArray(params.values)
      ? params.values.filter((v) => typeof v === 'string')
      : null
  const labels =
    params && Array.isArray(params.labels)
      ? params.labels.filter((v) => typeof v === 'string')
      : null
  const indexes =
    params && Array.isArray(params.indexes)
      ? params.indexes.filter((v) => Number.isFinite(v))
      : null
  const rawTimeout = params && typeof params.timeoutMs === 'number' ? params.timeoutMs : null

  if (!sessionId) {
    throw new Error('sessionId is required')
  }
  if (!selector) {
    throw new Error('selector is required')
  }

  const timeoutMs =
    rawTimeout && Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 30000

  const { browser, page } = await getPageForSession(sessionId)

  try {
    const locator = page.locator(selector)

    if (values && values.length > 0) {
      await locator.selectOption(values, { timeout: timeoutMs })
    } else if (labels && labels.length > 0) {
      await locator.selectOption(
        labels.map((label) => ({ label })),
        { timeout: timeoutMs },
      )
    } else if (indexes && indexes.length > 0) {
      await locator.selectOption(
        indexes.map((index) => ({ index })),
        { timeout: timeoutMs },
      )
    } else {
      throw new Error('values/labels/indexes are all empty')
    }

    const title = await page.title().catch(() => '')
    const finalUrl = page.url()

    try {
      const line = `[BrowserAgent] [session=${sessionId}] action=dom.selectOptions selector=${selector} pageUrl=${finalUrl}`
      console.log(line)
      appendBrowserAgentTextLog(line)
    } catch {}

    return {
      sessionId,
      action: 'dom.selectOptions',
      selector,
      values: values || null,
      labels: labels || null,
      indexes: indexes || null,
      timeoutMs,
      pageUrl: finalUrl,
      pageTitle: title,
    }
  } finally {
    try {
      await browser.close()
    } catch {
    }
  }
}

export async function domUploadFile(params) {
  const sessionId = params && typeof params.sessionId === 'string' ? params.sessionId : ''
  const selector = params && typeof params.selector === 'string' ? params.selector : ''
  const files =
    params && Array.isArray(params.files)
      ? params.files.filter((v) => typeof v === 'string' && v)
      : []
  const rawTimeout = params && typeof params.timeoutMs === 'number' ? params.timeoutMs : null

  if (!sessionId) {
    throw new Error('sessionId is required')
  }
  if (!selector) {
    throw new Error('selector is required')
  }
  if (!files.length) {
    throw new Error('files is required')
  }

  const timeoutMs =
    rawTimeout && Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 30000

  const { browser, page } = await getPageForSession(sessionId)

  try {
    const locator = page.locator(selector)
    await locator.setInputFiles(files, { timeout: timeoutMs })

    const title = await page.title().catch(() => '')
    const finalUrl = page.url()

    try {
      const line = `[BrowserAgent] [session=${sessionId}] action=dom.uploadFile selector=${selector} files=${files.length} pageUrl=${finalUrl}`
      console.log(line)
      appendBrowserAgentTextLog(line)
    } catch {}

    return {
      sessionId,
      action: 'dom.uploadFile',
      selector,
      files,
      timeoutMs,
      pageUrl: finalUrl,
      pageTitle: title,
    }
  } finally {
    try {
      await browser.close()
    } catch {
    }
  }
}
export async function domIsDisabled(params) {
  const sessionId = params && typeof params.sessionId === 'string' ? params.sessionId : ''
  const selector = params && typeof params.selector === 'string' ? params.selector : ''
  const rawTimeout = params && typeof params.timeoutMs === 'number' ? params.timeoutMs : null

  if (!sessionId) {
    throw new Error('sessionId is required')
  }
  if (!selector) {
    throw new Error('selector is required')
  }

  const timeoutMs =
    rawTimeout && Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 30000

  const { browser, page } = await getPageForSession(sessionId)

  try {
    const locator = page.locator(selector).first()
    await locator.waitFor({ state: 'attached', timeout: timeoutMs })

    const info = await locator.evaluate((el) => {
      try {
        const hasDisabledAttr = el.hasAttribute('disabled')
        const ariaDisabled = el.getAttribute('aria-disabled')
        // @ts-ignore
        const nativeDisabled = !!el.disabled
        const disabled = nativeDisabled || ariaDisabled === 'true'
        return {
          disabled,
          hasDisabledAttr,
          ariaDisabled,
        }
      } catch {
        return {
          disabled: false,
          hasDisabledAttr: false,
          ariaDisabled: null,
        }
      }
    })

    const title = await page.title().catch(() => '')
    const finalUrl = page.url()

    try {
      const line = `[BrowserAgent] [session=${sessionId}] action=dom.isDisabled selector=${selector} disabled=${info && info.disabled} pageUrl=${finalUrl}`
      console.log(line)
      appendBrowserAgentTextLog(line)
    } catch {}

    return {
      sessionId,
      action: 'dom.isDisabled',
      selector,
      disabled: info && typeof info.disabled === 'boolean' ? info.disabled : false,
      hasDisabledAttr:
        info && typeof info.hasDisabledAttr === 'boolean' ? info.hasDisabledAttr : false,
      ariaDisabled:
        info && typeof info.ariaDisabled === 'string' ? info.ariaDisabled : null,
      timeoutMs,
      pageUrl: finalUrl,
      pageTitle: title,
    }
  } finally {
    try {
      await browser.close()
    } catch {
    }
  }
}

export async function domGetFormData(params) {
  const sessionId = params && typeof params.sessionId === 'string' ? params.sessionId : ''
  const formSelector =
    params && typeof params.formSelector === 'string' ? params.formSelector : ''
  const includeDisabled =
    params && typeof params.includeDisabled === 'boolean' ? params.includeDisabled : false

  if (!sessionId) {
    throw new Error('sessionId is required')
  }

  const { browser, page } = await getPageForSession(sessionId)

  try {
    const payload = await page.evaluate((arg) => {
      const sel = arg.formSelector
      const includeDisabled = !!arg.includeDisabled
      const root = sel ? document.querySelector(sel) : document
      if (!root) {
        return { fields: [] }
      }

      const controls = Array.from(
        root.querySelectorAll('input, textarea, select'),
      )
      const fields = []

      for (const el of controls) {
        // @ts-ignore
        const name = el.name || ''
        if (!name) continue

        // @ts-ignore
        const disabled = !!el.disabled
        if (!includeDisabled && disabled) continue

        const tag = (el.tagName || '').toLowerCase()
        // @ts-ignore
        const type = (el.type || '').toLowerCase()

        if (tag === 'input') {
          if (type === 'checkbox') {
            // @ts-ignore
            const checked = !!el.checked
            // @ts-ignore
            const value = el.value || 'on'
            fields.push({
              name,
              kind: 'checkbox',
              type,
              value,
              checked,
              disabled,
            })
          } else if (type === 'radio') {
            // @ts-ignore
            const checked = !!el.checked
            if (!checked) continue
            // @ts-ignore
            const value = el.value || ''
            fields.push({
              name,
              kind: 'radio',
              type,
              value,
              checked: true,
              disabled,
            })
          } else {
            // text/password/email/number 等
            // @ts-ignore
            const value = el.value || ''
            fields.push({
              name,
              kind: 'input',
              type,
              value,
              disabled,
            })
          }
        } else if (tag === 'textarea') {
          // @ts-ignore
          const value = el.value || ''
          fields.push({
            name,
            kind: 'textarea',
            type: 'textarea',
            value,
            disabled,
          })
        } else if (tag === 'select') {
          const options = []
          // @ts-ignore
          const multiple = !!el.multiple
          const optionNodes = Array.from(el.options || [])
          let value = null
          for (const opt of optionNodes) {
            const optValue = opt.value || ''
            const optLabel = opt.label || opt.textContent || ''
            const selected = !!opt.selected
            options.push({ value: optValue, label: optLabel, selected })
            if (selected) {
              if (!multiple && value == null) {
                value = optValue
              }
            }
          }

          fields.push({
            name,
            kind: 'select',
            type: 'select',
            multiple,
            value,
            options,
            disabled,
          })
        }
      }

      return { fields }
    }, {
      formSelector,
      includeDisabled,
    })

    const title = await page.title().catch(() => '')
    const finalUrl = page.url()

    try {
      const line = `[BrowserAgent] [session=${sessionId}] action=dom.getFormData formSelector=${formSelector || ''} fields=${
        payload && Array.isArray(payload.fields) ? payload.fields.length : 0
      } pageUrl=${finalUrl}`
      console.log(line)
      appendBrowserAgentTextLog(line)
    } catch {}

    return {
      sessionId,
      action: 'dom.getFormData',
      formSelector: formSelector || null,
      includeDisabled,
      fields: payload && Array.isArray(payload.fields) ? payload.fields : [],
      pageUrl: finalUrl,
      pageTitle: title,
    }
  } finally {
    try {
      await browser.close()
    } catch {
    }
  }
}

export async function domGetValue(params) {
  const sessionId = params && typeof params.sessionId === 'string' ? params.sessionId : ''
  const selector = params && typeof params.selector === 'string' ? params.selector : ''
  const rawTimeout = params && typeof params.timeoutMs === 'number' ? params.timeoutMs : null

  if (!sessionId) {
    throw new Error('sessionId is required')
  }
  if (!selector) {
    throw new Error('selector is required')
  }

  const timeoutMs =
    rawTimeout && Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 30000

  const { browser, page } = await getPageForSession(sessionId)

  try {
    const locator = page.locator(selector).first()
    await locator.waitFor({ state: 'attached', timeout: timeoutMs })

    const valueInfo = await locator.evaluate((el) => {
      try {
        const tag = (el.tagName || '').toLowerCase()
        // @ts-ignore
        const type = (el.type || '').toLowerCase()
        // @ts-ignore
        const disabled = !!el.disabled

        if (tag === 'input') {
          if (type === 'checkbox') {
            // @ts-ignore
            const checked = !!el.checked
            // @ts-ignore
            const value = el.value || 'on'
            return { kind: 'checkbox', type, value, checked, disabled }
          }
          if (type === 'radio') {
            // @ts-ignore
            const checked = !!el.checked
            // @ts-ignore
            const value = el.value || ''
            return { kind: 'radio', type, value, checked, disabled }
          }
          // 其他 input 视作普通文本
          // @ts-ignore
          const value = el.value || ''
          return { kind: 'input', type, value, disabled }
        }

        if (tag === 'textarea') {
          // @ts-ignore
          const value = el.value || ''
          return { kind: 'textarea', type: 'textarea', value, disabled }
        }

        if (tag === 'select') {
          const options = []
          // @ts-ignore
          const multiple = !!el.multiple
          const optionNodes = Array.from(el.options || [])
          let value = null
          for (const opt of optionNodes) {
            const optValue = opt.value || ''
            const optLabel = opt.label || opt.textContent || ''
            const selected = !!opt.selected
            options.push({ value: optValue, label: optLabel, selected })
            if (selected && value == null) {
              value = optValue
            }
          }
          return { kind: 'select', type: 'select', multiple, value, options, disabled }
        }

        return { kind: 'unknown', type: null, value: null, disabled }
      } catch {
        return { kind: 'unknown', type: null, value: null, disabled: false }
      }
    })

    const title = await page.title().catch(() => '')
    const finalUrl = page.url()

    try {
      const line = `[BrowserAgent] [session=${sessionId}] action=dom.getValue selector=${selector} kind=${
        valueInfo && valueInfo.kind
      } pageUrl=${finalUrl}`
      console.log(line)
      appendBrowserAgentTextLog(line)
    } catch {}

    return {
      sessionId,
      action: 'dom.getValue',
      selector,
      timeoutMs,
      kind: valueInfo && valueInfo.kind ? valueInfo.kind : 'unknown',
      type: valueInfo && valueInfo.type ? valueInfo.type : null,
      value: valueInfo && 'value' in valueInfo ? valueInfo.value : null,
      checked:
        valueInfo && Object.prototype.hasOwnProperty.call(valueInfo, 'checked')
          ? valueInfo.checked
          : undefined,
      multiple:
        valueInfo && Object.prototype.hasOwnProperty.call(valueInfo, 'multiple')
          ? valueInfo.multiple
          : undefined,
      options:
        valueInfo && Array.isArray(valueInfo.options) ? valueInfo.options : undefined,
      disabled:
        valueInfo && Object.prototype.hasOwnProperty.call(valueInfo, 'disabled')
          ? valueInfo.disabled
          : false,
      pageUrl: finalUrl,
      pageTitle: title,
    }
  } finally {
    try {
      await browser.close()
    } catch {
    }
  }
}

export async function domScroll(params) {
  const sessionId = params && typeof params.sessionId === 'string' ? params.sessionId : ''
  const rawMode = params && typeof params.mode === 'string' ? params.mode : ''
  const rawTargetY = params && typeof params.targetY === 'number' ? params.targetY : null
  const rawDeltaY = params && typeof params.deltaY === 'number' ? params.deltaY : null
  const selector = params && typeof params.selector === 'string' ? params.selector : ''
  const rawDuration = params && typeof params.durationMs === 'number' ? params.durationMs : null
  const rawStepMinMs = params && typeof params.stepMinMs === 'number' ? params.stepMinMs : null
  const rawStepMaxMs = params && typeof params.stepMaxMs === 'number' ? params.stepMaxMs : null
  const rawJitterRatio =
    params && typeof params.jitterRatio === 'number' ? params.jitterRatio : null
  const rawTimeout = params && typeof params.timeoutMs === 'number' ? params.timeoutMs : null

  if (!sessionId) {
    throw new Error('sessionId is required')
  }

  const modeLower = rawMode.toLowerCase()
  const modeInternal =
    modeLower === 'toposition' || modeLower === 'bydelta' || modeLower === 'toelement'
      ? modeLower
      : 'bydelta'

  const durationMs =
    rawDuration && Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : 1000
  let stepMinMs =
    rawStepMinMs && Number.isFinite(rawStepMinMs) && rawStepMinMs > 0 ? rawStepMinMs : 16
  let stepMaxMs =
    rawStepMaxMs && Number.isFinite(rawStepMaxMs) && rawStepMaxMs > 0 ? rawStepMaxMs : 50
  if (stepMaxMs < stepMinMs) {
    const tmp = stepMinMs
    stepMinMs = stepMaxMs
    stepMaxMs = tmp
  }

  const jitterRatio =
    rawJitterRatio && Number.isFinite(rawJitterRatio) && rawJitterRatio > 0
      ? Math.min(rawJitterRatio, 1)
      : 0.2

  const timeoutMs =
    rawTimeout && Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 0

  const targetYValue = Number(rawTargetY)
  const deltaYValue = Number(rawDeltaY)

  const { browser, page } = await getPageForSession(sessionId)

  const startTs = Date.now()

  try {
    const info = await page.evaluate((arg) => {
      const mode = arg.mode
      const targetYArg = arg.targetY
      const deltaYArg = arg.deltaY
      const sel = arg.selector

      const doc =
        document.scrollingElement || document.documentElement || document.body || window
      let currentY = 0
      try {
        currentY = typeof doc.scrollTop === 'number' ? doc.scrollTop : window.scrollY || 0
      } catch {
        currentY = 0
      }

      let finalTargetY = currentY

      if (mode === 'toposition') {
        finalTargetY = typeof targetYArg === 'number' ? targetYArg : currentY
      } else if (mode === 'bydelta') {
        const dy = typeof deltaYArg === 'number' ? deltaYArg : 0
        finalTargetY = currentY + dy
      } else if (mode === 'toelement') {
        const el = sel ? document.querySelector(sel) : null
        if (!el) {
          throw new Error('TARGET_ELEMENT_NOT_FOUND')
        }
        const rect = el.getBoundingClientRect()
        finalTargetY = currentY + (rect ? rect.top : 0)
      }

      return { currentY, targetY: finalTargetY }
    }, {
      mode: modeInternal,
      targetY: Number.isFinite(targetYValue) ? targetYValue : null,
      deltaY: Number.isFinite(deltaYValue) ? deltaYValue : null,
      selector,
    })

    let currentY = info && typeof info.currentY === 'number' ? info.currentY : 0
    let targetY = info && typeof info.targetY === 'number' ? info.targetY : currentY

    if (!Number.isFinite(currentY)) currentY = 0
    if (!Number.isFinite(targetY)) targetY = currentY

    let remaining = targetY - currentY
    const avgStepMs = (stepMinMs + stepMaxMs) / 2
    let steps = Math.max(1, Math.round(durationMs / avgStepMs))
    if (!Number.isFinite(steps) || steps <= 0) steps = 1

    for (let i = 0; i < steps; i += 1) {
      const now = Date.now()
      if (timeoutMs && timeoutMs > 0 && now - startTs > timeoutMs) {
        throw new Error('SCROLL_TIMEOUT')
      }

      const stepsLeft = steps - i
      let baseDelta = remaining / stepsLeft
      if (!Number.isFinite(baseDelta)) baseDelta = 0

      let factor = 1
      if (jitterRatio > 0) {
        const r = Math.random() * 2 - 1
        factor = 1 + r * jitterRatio
      }

      let moveDelta = baseDelta * factor
      if (stepsLeft === 1) {
        moveDelta = remaining
      }

      await page.evaluate((dy) => {
        try {
          const docEl =
            document.scrollingElement ||
            document.documentElement ||
            document.body ||
            window
          if (typeof docEl.scrollTop === 'number') {
            docEl.scrollTop += dy
          } else {
            window.scrollBy(0, dy)
          }
        } catch {
          try {
            window.scrollBy(0, dy)
          } catch {
          }
        }
      }, moveDelta)

      remaining -= moveDelta

      if (i < steps - 1) {
        const delayMs = stepMinMs + Math.random() * (stepMaxMs - stepMinMs)
        await page.waitForTimeout(delayMs)
      }
    }

    const title = await page.title().catch(() => '')
    const finalUrl = page.url()

    try {
      const line = `[BrowserAgent] [session=${sessionId}] action=dom.scroll mode=${modeInternal} pageUrl=${finalUrl}`
      console.log(line)
      appendBrowserAgentTextLog(line)
    } catch {}

    return {
      sessionId,
      action: 'dom.scroll',
      mode: modeInternal,
      targetY,
      durationMs,
      stepMinMs,
      stepMaxMs,
      jitterRatio,
      timeoutMs: timeoutMs || null,
      pageUrl: finalUrl,
      pageTitle: title,
    }
  } finally {
    try {
      await browser.close()
    } catch {
    }
  }
}

function classifyNetworkError(error, info) {
  if (!error) return null

  const action = info && typeof info.action === 'string' ? info.action : null
  const url = info && typeof info.url === 'string' ? info.url : null
  const httpStatusRaw = info && typeof info.httpStatus === 'number' ? info.httpStatus : null

  const name =
    error && typeof error.name === 'string' && error.name
      ? error.name
      : ''
  const message =
    error && error.message
      ? String(error.message)
      : String(error || '')
  const lower = message.toLowerCase()

  let baCode = null
  let netError = null
  let httpStatus = httpStatusRaw && Number.isFinite(httpStatusRaw) ? httpStatusRaw : null

  if (name === 'TimeoutError' || lower.includes('timeout')) {
    baCode = 'TIMEOUT'
  }

  const m = /ERR_[A-Z0-9_:-]+/i.exec(message)
  if (m && m[0]) {
    netError = m[0]
    const upper = netError.toUpperCase()
    if (upper === 'ERR_NAME_NOT_RESOLVED') {
      baCode = baCode || 'DNS_ERROR'
    } else if (
      upper.startsWith('ERR_SSL') ||
      upper.startsWith('ERR_CERT')
    ) {
      baCode = baCode || 'TLS_ERROR'
    } else if (
      upper.includes('CONNECTION') ||
      upper.includes('ADDRESS_UNREACHABLE') ||
      upper.includes('NETWORK_CHANGED')
    ) {
      baCode = baCode || 'CONNECTION_ERROR'
    }
  }

  if (httpStatus && httpStatus >= 400 && httpStatus < 500) {
    baCode = baCode || 'HTTP_4XX'
  } else if (httpStatus && httpStatus >= 500 && httpStatus < 600) {
    baCode = baCode || 'HTTP_5XX'
  }

  if (!baCode && (netError || httpStatus)) {
    baCode = 'UNKNOWN_NETWORK_ERROR'
  }

  if (!baCode) return null

  const baDetails = {
    action,
    url,
    httpStatus: httpStatus || null,
    errorName: name || null,
    errorMessage: message || null,
    netError: netError || null,
  }

  return { baCode, baDetails }
}

async function detectAntiBotPage(page) {
  if (!page) {
    return null
  }

  let url = ''
  let title = ''
  let text = ''

  try {
    url = page.url() || ''
  } catch {
    url = ''
  }

  try {
    title = await page.title()
  } catch {
    title = ''
  }

  try {
    text = await page.evaluate(() => {
      try {
        const root = document.body || document.documentElement
        if (!root) return ''
        const value = root.innerText || root.textContent || ''
        return typeof value === 'string' ? value : ''
      } catch {
        return ''
      }
    })
  } catch {
    text = ''
  }

  const lowerUrl = url.toLowerCase()
  const lowerTitle = title.toLowerCase()
  const lowerText = text.toLowerCase()

  const urlKeywords = [
    'captcha',
    'verify',
    'validation',
    'sec.douyin',
    'sec.traffic',
    'anti-bot',
    'antibot',
    'challenge',
  ]
  const textKeywords = [
    '人机验证',
    '安全验证',
    '验证您是否为人类',
    '访问过于频繁',
    'too many requests',
    'access denied',
    'unusual traffic',
    'robot check',
    'verify you are human',
  ]

  let ruleType = null
  let ruleKeyword = null

  for (const kw of urlKeywords) {
    if (kw && lowerUrl.includes(kw)) {
      ruleType = 'url'
      ruleKeyword = kw
      break
    }
  }

  if (!ruleType) {
    for (const kw of textKeywords) {
      if (!kw) continue
      if (lowerTitle.includes(kw) || lowerText.includes(kw)) {
        ruleType = 'text'
        ruleKeyword = kw
        break
      }
    }
  }

  if (!ruleType) {
    return {
      isAntiBot: false,
      url,
      title,
    }
  }

  const snippet = text && text.length > 0 ? text.slice(0, 512) : ''
  return {
    isAntiBot: true,
    url,
    title,
    snippet,
    ruleType,
    ruleKeyword,
    message: 'Anti-bot or verification page detected',
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

async function loadUrlWithTimeout(win, url, timeoutMs) {
  if (!win || !url) {
    throw new Error('loadUrlWithTimeout: invalid arguments')
  }

  const loadPromise = win.loadURL(url)

  if (!timeoutMs || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return loadPromise
  }

  /** @type {NodeJS.Timeout | null} */
  let timer = null

  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(
        `Timed out after ${timeoutMs}ms while loading URL: ${url}`,
      )
      err.name = 'TimeoutError'
      reject(err)
    }, timeoutMs)
  })

  try {
    await Promise.race([loadPromise, timeoutPromise])
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
  }
}

let localNavActionSeq = 0

function nextLocalNavigateActionId() {
  localNavActionSeq += 1
  return `act_local_${Date.now().toString(36)}_${localNavActionSeq.toString(36)}`
}

function appendNavTimelineAction(sessionId, url, eventType) {
  try {
    if (!sessionId || !url) return
    const actionId = nextLocalNavigateActionId()
    const now = new Date().toISOString()
    appendActionRecord({
      id: actionId,
      sessionId,
      type: 'navigate.auto',
      params: {
        url,
        source: eventType,
      },
      startAt: now,
      endAt: now,
      status: 'ok',
      errorCode: null,
      errorMessage: null,
      snapshotId: null,
    })
  } catch {}
}

function buildNavigateTargetUrl(rawUrl, sessionId) {
  const safeId = encodeURIComponent(sessionId)
  try {
    const url = new URL(rawUrl)
    url.searchParams.set('agent_session', safeId)
    return url.toString()
  } catch {
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
