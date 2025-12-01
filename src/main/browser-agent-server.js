import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { BrowserWindow } from 'electron'
import { defaultAppSettings, getAppSettings } from './app-settings.js'
import {
  createSession,
  listSessions,
  getSession,
  closeSession,
  showSession,
  hideSession,
  setSessionWindowId,
  listAllSessions,
  touchSession,
} from './browser-agent-core.js'
import {
  appendSessionRecord,
  appendActionRecord,
  appendBrowserAgentTextLog,
  appendSnapshotRecord,
  appendFileRecord,
  getBrowserAgentDataRootDir,
  ensureDirSync,
  readNdjson,
} from './browser-agent-storage.js'

/** @typedef {import('../shared/types').BrowserAgentSettings} BrowserAgentSettings */

/** @type {http.Server | null} */
let server = null
let actionSeq = 0
let sessionCleanupTimer = null

function nextActionId() {
  actionSeq += 1
  return `act_${Date.now().toString(36)}_${actionSeq.toString(36)}`
}

function getEffectiveConfig() {
  /** @type {import('../shared/types').AppSettings} */
  const settings = getAppSettings() || defaultAppSettings
  const raw = (settings && settings.browserAgent) || /** @type {BrowserAgentSettings | null} */ (null)

  const enabled = !!(raw && typeof raw.enabled === 'boolean' ? raw.enabled : false)

  let port = raw && typeof raw.port === 'number' && raw.port > 0 && raw.port < 65536 ? raw.port : 26080
  const envPort = process.env.AI_SERVER_BROWSER_AGENT_PORT
  if (envPort && typeof envPort === 'string') {
    const parsed = Number(envPort)
    if (Number.isFinite(parsed) && parsed > 0 && parsed < 65536) {
      port = parsed
    }
  }

  const token = ''

  const dataRoot =
    (raw && typeof raw.dataRoot === 'string' && raw.dataRoot.trim()) || ''

  // 注意：端口仅在服务启动时使用，后续修改端口需要重启应用或显式重启服务。
  // 其他字段（enabled/token/dataRoot）在每次请求时动态读取，可即时生效。
  return { enabled, port, token, dataRoot }
}

function getTimeoutConfig() {
  /** @type {import('../shared/types').AppSettings} */
  const settings = getAppSettings() || defaultAppSettings
  const raw = (settings && settings.browserAgent) || /** @type {BrowserAgentSettings | null} */ (null)

  let maxSessionDurationMinutes =
    raw && typeof raw.maxSessionDurationMinutes === 'number'
      ? raw.maxSessionDurationMinutes
      : 0
  let maxIdleMinutes =
    raw && typeof raw.maxIdleMinutes === 'number' ? raw.maxIdleMinutes : 0

  if (!Number.isFinite(maxSessionDurationMinutes) || maxSessionDurationMinutes <= 0) {
    maxSessionDurationMinutes = 0
  }
  if (!Number.isFinite(maxIdleMinutes) || maxIdleMinutes <= 0) {
    maxIdleMinutes = 0
  }

  const maxSessionDurationMs =
    maxSessionDurationMinutes > 0 ? maxSessionDurationMinutes * 60 * 1000 : 0
  const maxIdleDurationMs = maxIdleMinutes > 0 ? maxIdleMinutes * 60 * 1000 : 0

  return { maxSessionDurationMs, maxIdleDurationMs }
}

function ensureSessionCleanupTimer() {
  if (sessionCleanupTimer) return
  sessionCleanupTimer = setInterval(() => {
    runSessionTimeoutSweep().catch(() => {})
  }, 60 * 1000)
}

function stopSessionCleanupTimer() {
  if (!sessionCleanupTimer) return
  try {
    clearInterval(sessionCleanupTimer)
  } catch {}
  sessionCleanupTimer = null
}

function triggerAutoScreenshot(sessionId, description) {
  return new Promise((resolve) => {
    try {
      const { enabled, port } = getEffectiveConfig()
      if (!enabled || !port) {
        resolve(null)
        return
      }

      const payload = {
        mode: 'viewport',
        description,
      }
      const body = JSON.stringify(payload)

      const options = {
        hostname: '127.0.0.1',
        port,
        path: `/sessions/${encodeURIComponent(sessionId)}/screenshot`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      }

      const req = http.request(options, (res) => {
        res.on('data', () => {})
        res.on('end', () => {
          resolve(null)
        })
      })

      req.on('error', () => {
        resolve(null)
      })

      req.write(body)
      req.end()
    } catch {
      resolve(null)
    }
  })
}

async function handleSessionTimeout(session, reason) {
  try {
    const sessionId = session && session.id ? session.id : null
    if (!sessionId) return

    const byDuration = !!(reason && reason.byDuration)
    const byIdle = !!(reason && reason.byIdle)

    let reasonCode = 'unknown'
    if (byDuration && byIdle) {
      reasonCode = 'duration_and_idle'
    } else if (byDuration) {
      reasonCode = 'duration'
    } else if (byIdle) {
      reasonCode = 'idle'
    }

    const desc = `auto_timeout_${reasonCode}`

    await triggerAutoScreenshot(sessionId, desc)

    const closed = closeSession(sessionId)
    if (!closed) return

    try {
      const win = getBrowserWindowById(closed.windowId)
      if (win) {
        try {
          win.close()
        } catch {}
      }
    } catch {}

    try {
      const finishedAt =
        closed && typeof closed.closedAt === 'string' && closed.closedAt
          ? closed.closedAt
          : new Date().toISOString()

      appendSessionRecord({
        sessionId: (closed && closed.id) || sessionId,
        profile: (closed && closed.profile) || null,
        clientId: (closed && closed.clientId) || 'local',
        status: 'timeout',
        createdAt:
          closed && typeof closed.createdAt === 'string' && closed.createdAt
            ? closed.createdAt
            : finishedAt,
        finishedAt,
        lastErrorCode: 'TIMEOUT',
        lastErrorMessage: `Session auto timeout by ${reasonCode}`,
      })

      const logLine = `[BrowserAgent] [session=${(closed && closed.id) || sessionId}] event=session.timeout reason=${reasonCode}`
      appendBrowserAgentTextLog(logLine)
      console.log(logLine)
    } catch {}
  } catch {}
}

async function runSessionTimeoutSweep() {
  try {
    const { maxSessionDurationMs, maxIdleDurationMs } = getTimeoutConfig()
    if (!maxSessionDurationMs && !maxIdleDurationMs) return

    const now = Date.now()
    const sessions = listAllSessions()

    for (const s of sessions) {
      if (!s || typeof s !== 'object') continue

      const rawCreatedAt = s.createdAt
      const rawLastActiveAt = s.lastActiveAt || s.createdAt

      const createdAtMs =
        typeof rawCreatedAt === 'string' && rawCreatedAt
          ? Date.parse(rawCreatedAt)
          : NaN
      const lastActiveAtMs =
        typeof rawLastActiveAt === 'string' && rawLastActiveAt
          ? Date.parse(rawLastActiveAt)
          : NaN

      const byDuration =
        maxSessionDurationMs && Number.isFinite(createdAtMs)
          ? now - createdAtMs > maxSessionDurationMs
          : false
      const byIdle =
        maxIdleDurationMs && Number.isFinite(lastActiveAtMs)
          ? now - lastActiveAtMs > maxIdleDurationMs
          : false

      if (!byDuration && !byIdle) continue

      if (s.status && s.status !== 'running') continue

      // 异步处理，避免阻塞主循环
      // eslint-disable-next-line no-void
      void handleSessionTimeout(s, { byDuration, byIdle })
    }
  } catch {}
}

function getBrowserWindowById(id) {
  try {
    if (typeof id !== 'number' || !Number.isFinite(id)) return null
    const win = BrowserWindow.fromId(id)
    if (!win || win.isDestroyed()) return null
    return win
  } catch {
    return null
  }
}

function sendJson(res, statusCode, payload) {
  try {
    const body = JSON.stringify(payload)
    res.statusCode = statusCode
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Content-Length', Buffer.byteLength(body))
    res.end(body)
  } catch {
    try {
      res.statusCode = 500
      res.end()
    } catch {}
  }
}

function sendError(res, statusCode, errorCode, message, errorDetails) {
  sendJson(res, statusCode, {
    ok: false,
    errorCode,
    errorMessage: message,
    errorDetails: errorDetails || null,
    data: null,
  })
}

function isTimeoutError(error) {
  if (!error) return false
  if (error && typeof error === 'object') {
    const name =
      typeof error.name === 'string' && error.name
        ? error.name
        : ''
    if (name === 'TimeoutError') return true
  }
  const message =
    error && error.message
      ? String(error.message)
      : String(error || '')
  if (!message) return false
  const lower = message.toLowerCase()
  return lower.includes('timeout')
}

function handleSessionNotFound(res, sessionId) {
  sendError(res, 404, 'SESSION_NOT_FOUND', `Session not found: ${sessionId}`)
}

function readRequestBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    try {
      let total = 0
      /** @type {Buffer[]} */
      const chunks = []

      req.on('data', (chunk) => {
        try {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          total += buf.length
          if (total > maxBytes) {
            reject(new Error('REQUEST_BODY_TOO_LARGE'))
            req.destroy()
            return
          }
          chunks.push(buf)
        } catch (error) {
          reject(error)
          try {
            req.destroy()
          } catch {}
        }
      })

      req.on('end', () => {
        try {
          if (!chunks.length) {
            resolve('')
            return
          }
          const buf = Buffer.concat(chunks, total)
          resolve(buf.toString('utf8'))
        } catch (error) {
          reject(error)
        }
      })

      req.on('error', (error) => {
        reject(error)
      })
    } catch (error) {
      reject(error)
    }
  })
}

async function parseJsonBody(req) {
  const raw = await readRequestBody(req)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('INVALID_JSON')
    }
    return parsed
  } catch (error) {
    const err = /** @type {Error} */ (error)
    err.name = 'INVALID_JSON'
    throw err
  }
}

function handleServiceDisabled(res) {
  sendError(res, 503, 'SERVICE_DISABLED', 'Browser Agent is disabled in settings')
}

function handleNotFound(res) {
  sendError(res, 404, 'NOT_FOUND', 'Not found')
}

function handleMethodNotAllowed(res) {
  sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed')
}

function handleNotImplemented(res) {
  sendError(res, 501, 'NOT_IMPLEMENTED', 'Browser Agent core is not implemented yet')
}

/**
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
function handleRequest(req, res) {
  const { enabled } = getEffectiveConfig()

  // CORS 仅为将来需要从浏览器中调试时预留，本机 n8n 通过 HTTP 请求不受影响
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')

  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }

  if (!enabled) {
    handleServiceDisabled(res)
    return
  }

  const rawUrl = typeof req.url === 'string' && req.url ? req.url : '/'

  let url
  try {
    url = new URL(rawUrl, 'http://127.0.0.1')
  } catch {
    sendError(res, 400, 'BAD_REQUEST', 'Invalid URL')
    return
  }

  const pathname = url.pathname || '/'

  if (pathname === '/debug/playwright-spike') {
    if (req.method !== 'GET' && req.method !== 'POST') {
      handleMethodNotAllowed(res)
      return
    }

    ;(async () => {
      try {
        const mod = await import('./browser-agent-playwright.js')
        if (!mod || typeof mod.runPlaywrightSpike !== 'function') {
          sendError(res, 500, 'PLAYWRIGHT_NOT_AVAILABLE', 'Playwright spike 功能未就绪。')
          return
        }

        const result = await mod.runPlaywrightSpike()
        sendJson(res, 200, {
          ok: true,
          errorCode: null,
          errorMessage: null,
          data: result,
        })
      } catch (error) {
        const message = error && error.message ? String(error.message) : String(error || '')
        sendError(res, 500, 'PLAYWRIGHT_ERROR', message)
      }
    })()

    return
  }

  if (pathname === '/health') {
    sendJson(res, 200, {
      ok: true,
      errorCode: null,
      errorMessage: null,
      data: {
        status: 'ok',
      },
    })
    return
  }

  if (pathname.startsWith('/files/')) {
    const segments = pathname.split('/').filter(Boolean)
    if (segments[0] !== 'files' || segments.length < 2) {
      handleNotFound(res)
      return
    }

    const fileId = segments[1]
    if (!fileId) {
      handleNotFound(res)
      return
    }

    if (req.method !== 'GET') {
      handleMethodNotAllowed(res)
      return
    }

    try {
      const search = url.searchParams
      const date = search.get('date') || undefined

      /** @type {any[]} */
      const records = readNdjson('files', date)
      let target = null
      for (const rec of records) {
        if (!rec || typeof rec !== 'object') continue
        const rawId = rec.fileId
        const fid = typeof rawId === 'string' && rawId.trim() ? rawId.trim() : ''
        if (!fid || fid !== fileId) continue
        target = rec
        break
      }

      if (!target) {
        sendError(res, 404, 'FILE_NOT_FOUND', `File not found: ${fileId}`)
        return
      }

      const root = getBrowserAgentDataRootDir()
      if (!root) {
        sendError(res, 500, 'DATA_ROOT_UNAVAILABLE', 'Browser Agent dataRoot is not configured')
        return
      }

      const rawPath = target.path
      const relPath = typeof rawPath === 'string' && rawPath.trim() ? rawPath.trim() : ''
      if (!relPath) {
        sendError(res, 500, 'FILE_PATH_INVALID', 'File path is missing in metadata')
        return
      }

      const absPath = path.isAbsolute(relPath) ? relPath : path.join(root, relPath)

      let stat
      try {
        stat = fs.statSync(absPath)
      } catch (error) {
        const message = error && error.message ? String(error.message) : String(error || '')
        sendError(res, 404, 'FILE_NOT_FOUND_ON_DISK', message)
        return
      }

      if (!stat || !stat.isFile()) {
        sendError(res, 404, 'FILE_NOT_FOUND_ON_DISK', 'File not found on disk')
        return
      }

      const sessionId =
        typeof target.sessionId === 'string' && target.sessionId.trim()
          ? target.sessionId.trim()
          : null
      const nameRaw = target.name
      const fileName =
        typeof nameRaw === 'string' && nameRaw.trim() ? nameRaw.trim() : path.basename(absPath)
      const size =
        typeof target.size === 'number' && Number.isFinite(target.size) && target.size >= 0
          ? target.size
          : stat.size
      const mimeRaw = target.mimeType
      const mimeType =
        typeof mimeRaw === 'string' && mimeRaw.trim() ? mimeRaw.trim() : 'application/octet-stream'

      try {
        const logLine = `[BrowserAgent] [session=${sessionId || ''}] event=file.download fileId=${fileId} name=${fileName} size=${size}`
        appendBrowserAgentTextLog(logLine)
        console.log(logLine)
      } catch {}

      try {
        res.statusCode = 200
        res.setHeader('Content-Type', mimeType)
        if (Number.isFinite(size) && size >= 0) {
          res.setHeader('Content-Length', size)
        }
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${encodeURIComponent(fileName)}"`,
        )

        const stream = fs.createReadStream(absPath)
        stream.on('error', () => {
          try {
            if (!res.headersSent) {
              res.statusCode = 500
              res.end()
            } else {
              res.destroy()
            }
          } catch {}
        })
        stream.pipe(res)
      } catch (error) {
        const message = error && error.message ? String(error.message) : String(error || '')
        sendError(res, 500, 'FILE_STREAM_ERROR', message)
      }
    } catch (error) {
      const message = error && error.message ? String(error.message) : String(error || '')
      sendError(res, 500, 'FILE_READ_ERROR', message)
    }

    return
  }

  if (pathname === '/sessions') {
    if (req.method === 'POST') {
      ;(async () => {
        try {
          let body
          try {
            body = await parseJsonBody(req)
          } catch (error) {
            const err = /** @type {Error} */ (error)
            if (err && err.name === 'INVALID_JSON') {
              sendError(res, 400, 'BAD_JSON', 'Invalid JSON body')
            } else if (err && err.message === 'REQUEST_BODY_TOO_LARGE') {
              sendError(res, 413, 'REQUEST_ENTITY_TOO_LARGE', 'Request body too large')
            } else {
              sendError(res, 400, 'BAD_JSON', 'Invalid JSON body')
            }
            return
          }

          const session = createSession(body)

          try {
            appendSessionRecord({
              sessionId: session.id,
              profile: session.profile || null,
              clientId: session.clientId || 'local',
              status: session.status || 'running',
              createdAt: session.createdAt,
              finishedAt: null,
              lastErrorCode: null,
              lastErrorMessage: null,
            })
            const logLine = `[BrowserAgent] [session=${session.id}] event=session.create profile=${session.profile || ''} clientId=${session.clientId || ''}`
            appendBrowserAgentTextLog(logLine)
            console.log(logLine)
          } catch {}

          sendJson(res, 201, {
            ok: true,
            errorCode: null,
            errorMessage: null,
            data: {
              sessionId: session.id,
              profile: session.profile,
              clientId: session.clientId,
              status: session.status,
              createdAt: session.createdAt,
              lastActiveAt: session.lastActiveAt,
              viewport: session.viewport || null,
              userAgent: session.userAgent || null,
            },
          })
        } catch (error) {
          const message = error && error.message ? String(error.message) : String(error || '')
          sendError(res, 500, 'INTERNAL_ERROR', message)
        }
      })()
      return
    }

    if (req.method === 'GET') {
      const search = url.searchParams
      const filter = {
        profile: search.get('profile') || undefined,
        clientId: search.get('clientId') || undefined,
        status: search.get('status') || undefined,
      }
      const items = listSessions(filter)
      sendJson(res, 200, {
        ok: true,
        errorCode: null,
        errorMessage: null,
        data: {
          items,
        },
      })
      return
    }

    handleMethodNotAllowed(res)
    return
  }

  if (pathname.startsWith('/sessions/')) {
    const segments = pathname.split('/').filter(Boolean)
    if (segments[0] !== 'sessions' || segments.length < 2) {
      handleNotFound(res)
      return
    }

    const sessionId = segments[1]
    const subPath = segments.length >= 3 ? segments[2] : null
    const subAction = segments.length >= 4 ? segments[3] : null

    if (!sessionId) {
      handleNotFound(res)
      return
    }

    if (!subPath) {
      if (req.method === 'GET') {
        const session = getSession(sessionId)
        if (!session) {
          handleSessionNotFound(res, sessionId)
          return
        }
        sendJson(res, 200, {
          ok: true,
          errorCode: null,
          errorMessage: null,
          data: session,
        })
        return
      }

      if (req.method === 'DELETE') {
        const closed = closeSession(sessionId)
        if (!closed) {
          handleSessionNotFound(res, sessionId)
          return
        }

        // 尝试关闭与该 session 关联的 BrowserWindow（如果有记录 windowId 且窗口仍存在）
        try {
          const win = getBrowserWindowById(closed.windowId)
          if (win) {
            try {
              win.close()
            } catch {}
          }
        } catch {}

        try {
          const finishedAt =
            closed && typeof closed.closedAt === 'string' && closed.closedAt
              ? closed.closedAt
              : new Date().toISOString()
          appendSessionRecord({
            sessionId: (closed && closed.id) || sessionId,
            profile: (closed && closed.profile) || null,
            clientId: (closed && closed.clientId) || 'local',
            status: (closed && closed.status) || 'closed',
            createdAt:
              closed && typeof closed.createdAt === 'string' && closed.createdAt
                ? closed.createdAt
                : finishedAt,
            finishedAt,
            lastErrorCode: (closed && closed.lastErrorCode) || null,
            lastErrorMessage: (closed && closed.lastErrorMessage) || null,
          })
          const logLine = `[BrowserAgent] [session=${(closed && closed.id) || sessionId}] event=session.close status=${(closed && closed.status) || 'closed'}`
          appendBrowserAgentTextLog(logLine)
          console.log(logLine)
        } catch {}

        sendJson(res, 200, {
          ok: true,
          errorCode: null,
          errorMessage: null,
          data: closed,
        })
        return
      }

      handleMethodNotAllowed(res)
      return
    }

    if (subPath === 'navigate') {
      if (req.method !== 'POST') {
        handleMethodNotAllowed(res)
        return
      }

      ;(async () => {
        try {
          const existing = getSession(sessionId)
          if (!existing) {
            handleSessionNotFound(res, sessionId)
            return
          }

          let body
          try {
            body = await parseJsonBody(req)
          } catch (error) {
            const err = /** @type {Error} */ (error)
            if (err && err.name === 'INVALID_JSON') {
              sendError(res, 400, 'BAD_JSON', 'Invalid JSON body')
            } else if (err && err.message === 'REQUEST_BODY_TOO_LARGE') {
              sendError(res, 413, 'REQUEST_ENTITY_TOO_LARGE', 'Request body too large')
            } else {
              sendError(res, 400, 'BAD_JSON', 'Invalid JSON body')
            }
            return
          }

          const rawUrl = body && typeof body.url === 'string' ? body.url : ''
          const effectiveUrl = rawUrl && rawUrl.trim() ? rawUrl.trim() : 'https://www.baidu.com'

          const rawWaitUntil =
            body && typeof body.waitUntil === 'string' ? body.waitUntil : undefined
          const waitUntil = rawWaitUntil || undefined

          const timeoutMs =
            body && typeof body.timeoutMs === 'number' ? body.timeoutMs : undefined

          const rawOnTimeout =
            body && typeof body.onTimeout === 'string' ? body.onTimeout : 'none'
          const onTimeout =
            rawOnTimeout === 'screenshot_only' ? 'screenshot_only' : 'none'

          let mod
          try {
            mod = await import('./browser-agent-playwright.js')
          } catch (error) {
            const message = error && error.message ? String(error.message) : String(error || '')
            sendError(res, 500, 'PLAYWRIGHT_NOT_AVAILABLE', message)
            return
          }

          if (!mod || typeof mod.navigateOnce !== 'function') {
            sendError(res, 500, 'PLAYWRIGHT_NOT_AVAILABLE', 'navigateOnce is not available')
            return
          }

          const actionStartAt = new Date().toISOString()
          const actionId = nextActionId()

          try {
            const result = await mod.navigateOnce({
              sessionId,
              url: effectiveUrl,
              waitUntil,
              timeoutMs,
            })

            if (result) {
              try {
                setSessionWindowId(sessionId, result.windowId)
              } catch {}

              try {
                appendActionRecord({
                  id: actionId,
                  sessionId,
                  type: 'navigate',
                  params: {
                    url: effectiveUrl,
                    waitUntil,
                    timeoutMs,
                    onTimeout,
                  },
                  startAt: actionStartAt,
                  endAt: new Date().toISOString(),
                  status: 'ok',
                  errorCode: null,
                  errorMessage: null,
                  snapshotId: null,
                })
              } catch {}
            }

            sendJson(res, 200, {
              ok: true,
              errorCode: null,
              errorMessage: null,
              data: result,
            })
            try {
              touchSession(sessionId)
            } catch {}
          } catch (error) {
            const message = error && error.message ? String(error.message) : String(error || '')
            const errorDetails = {
              sessionId,
              action: 'navigate',
              url: effectiveUrl,
              waitUntil,
              timeoutMs,
              onTimeout,
            }

            try {
              appendActionRecord({
                id: actionId,
                sessionId,
                type: 'navigate',
                params: {
                  url: effectiveUrl,
                  waitUntil,
                  timeoutMs,
                  onTimeout,
                },
                startAt: actionStartAt,
                endAt: new Date().toISOString(),
                status: isTimeoutError(error) ? 'timeout' : 'failed',
                errorCode: isTimeoutError(error) ? 'TIMEOUT' : 'PLAYWRIGHT_ERROR',
                errorMessage: message,
                snapshotId: null,
              })
            } catch {}

            if (isTimeoutError(error)) {
              if (onTimeout === 'screenshot_only') {
                try {
                  await triggerAutoScreenshot(sessionId, 'navigate_timeout')
                } catch {}
              }
              sendError(res, 504, 'TIMEOUT', message, errorDetails)
            } else {
              sendError(res, 500, 'PLAYWRIGHT_ERROR', message, errorDetails)
            }
          }
        } catch (error) {
          const message = error && error.message ? String(error.message) : String(error || '')
          sendError(res, 500, 'PLAYWRIGHT_ERROR', message)
        }
      })()

      return
    }

    if (subPath === 'wait') {
      if (!subAction) {
        handleNotFound(res)
        return
      }

      if (req.method !== 'POST') {
        handleMethodNotAllowed(res)
        return
      }

      ;(async () => {
        try {
          const existing = getSession(sessionId)
          if (!existing) {
            handleSessionNotFound(res, sessionId)
            return
          }

          let body
          try {
            body = await parseJsonBody(req)
          } catch (error) {
            const err = /** @type {Error} */ (error)
            if (err && err.name === 'INVALID_JSON') {
              sendError(res, 400, 'BAD_JSON', 'Invalid JSON body')
            } else if (err && err.message === 'REQUEST_BODY_TOO_LARGE') {
              sendError(res, 413, 'REQUEST_ENTITY_TOO_LARGE', 'Request body too large')
            } else {
              sendError(res, 400, 'BAD_JSON', 'Invalid JSON body')
            }
            return
          }

          let mod
          try {
            mod = await import('./browser-agent-playwright.js')
          } catch (error) {
            const message = error && error.message ? String(error.message) : String(error || '')
            sendError(res, 500, 'PLAYWRIGHT_NOT_AVAILABLE', message)
            return
          }

          if (!mod) {
            sendError(res, 500, 'PLAYWRIGHT_NOT_AVAILABLE', 'Playwright module not available')
            return
          }

          const rawOnTimeout =
            body && typeof body.onTimeout === 'string' ? body.onTimeout : 'none'
          const onTimeout =
            rawOnTimeout === 'screenshot_only' ? 'screenshot_only' : 'none'

          if (subAction === 'selector') {
            if (typeof mod.waitForSelectorAction !== 'function') {
              sendError(res, 500, 'PLAYWRIGHT_NOT_AVAILABLE', 'waitForSelectorAction is not available')
              return
            }

            const selector =
              body && typeof body.selector === 'string' ? body.selector : ''
            const state = body && typeof body.state === 'string' ? body.state : undefined
            const timeoutMs =
              body && typeof body.timeoutMs === 'number'
                ? body.timeoutMs
                : undefined

            const actionStartAt = new Date().toISOString()
            const actionId = nextActionId()

            try {
              const result = await mod.waitForSelectorAction({
                sessionId,
                selector,
                state,
                timeoutMs,
              })

              try {
                appendActionRecord({
                  id: actionId,
                  sessionId,
                  type: 'wait.selector',
                  params: {
                    selector,
                    state,
                    timeoutMs,
                    onTimeout,
                  },
                  startAt: actionStartAt,
                  endAt: new Date().toISOString(),
                  status: 'ok',
                  errorCode: null,
                  errorMessage: null,
                  snapshotId: null,
                })
              } catch {}

              sendJson(res, 200, {
                ok: true,
                errorCode: null,
                errorMessage: null,
                data: result,
              })
              try {
                touchSession(sessionId)
              } catch {}
              return
            } catch (error) {
              const message =
                error && error.message ? String(error.message) : String(error || '')
              const errorDetails = {
                sessionId,
                action: 'wait.selector',
                selector,
                state,
                timeoutMs,
                onTimeout,
              }

              try {
                appendActionRecord({
                  id: actionId,
                  sessionId,
                  type: 'wait.selector',
                  params: {
                    selector,
                    state,
                    timeoutMs,
                    onTimeout,
                  },
                  startAt: actionStartAt,
                  endAt: new Date().toISOString(),
                  status: isTimeoutError(error) ? 'timeout' : 'failed',
                  errorCode: isTimeoutError(error) ? 'TIMEOUT' : 'PLAYWRIGHT_ERROR',
                  errorMessage: message,
                  snapshotId: null,
                })
              } catch {}

              if (isTimeoutError(error)) {
                if (onTimeout === 'screenshot_only') {
                  try {
                    await triggerAutoScreenshot(sessionId, 'wait.selector_timeout')
                  } catch {}
                }
                sendError(res, 504, 'TIMEOUT', message, errorDetails)
              } else {
                sendError(res, 500, 'PLAYWRIGHT_ERROR', message, errorDetails)
              }
              return
            }
          }

          if (subAction === 'text') {
            if (typeof mod.waitForTextAction !== 'function') {
              sendError(res, 500, 'PLAYWRIGHT_NOT_AVAILABLE', 'waitForTextAction is not available')
              return
            }

            const text = body && typeof body.text === 'string' ? body.text : ''
            const scope = body && typeof body.scope === 'string' ? body.scope : undefined
            const selector =
              body && typeof body.selector === 'string' ? body.selector : undefined
            const timeoutMs =
              body && typeof body.timeoutMs === 'number'
                ? body.timeoutMs
                : undefined

            const actionStartAt = new Date().toISOString()
            const actionId = nextActionId()

            try {
              const result = await mod.waitForTextAction({
                sessionId,
                text,
                scope,
                selector,
                timeoutMs,
              })

              try {
                appendActionRecord({
                  id: actionId,
                  sessionId,
                  type: 'wait.text',
                  params: {
                    text,
                    scope,
                    selector,
                    timeoutMs,
                    onTimeout,
                  },
                  startAt: actionStartAt,
                  endAt: new Date().toISOString(),
                  status: 'ok',
                  errorCode: null,
                  errorMessage: null,
                  snapshotId: null,
                })
              } catch {}

              sendJson(res, 200, {
                ok: true,
                errorCode: null,
                errorMessage: null,
                data: result,
              })
              try {
                touchSession(sessionId)
              } catch {}
              return
            } catch (error) {
              const message =
                error && error.message ? String(error.message) : String(error || '')
              const errorDetails = {
                sessionId,
                action: 'wait.text',
                text,
                scope,
                selector,
                timeoutMs,
                onTimeout,
              }

              try {
                appendActionRecord({
                  id: actionId,
                  sessionId,
                  type: 'wait.text',
                  params: {
                    text,
                    scope,
                    selector,
                    timeoutMs,
                    onTimeout,
                  },
                  startAt: actionStartAt,
                  endAt: new Date().toISOString(),
                  status: isTimeoutError(error) ? 'timeout' : 'failed',
                  errorCode: isTimeoutError(error) ? 'TIMEOUT' : 'PLAYWRIGHT_ERROR',
                  errorMessage: message,
                  snapshotId: null,
                })
              } catch {}

              if (isTimeoutError(error)) {
                if (onTimeout === 'screenshot_only') {
                  try {
                    await triggerAutoScreenshot(sessionId, 'wait.text_timeout')
                  } catch {}
                }
                sendError(res, 504, 'TIMEOUT', message, errorDetails)
              } else {
                sendError(res, 500, 'PLAYWRIGHT_ERROR', message, errorDetails)
              }
              return
            }
          }

          if (subAction === 'url') {
            if (typeof mod.waitForUrlAction !== 'function') {
              sendError(res, 500, 'PLAYWRIGHT_NOT_AVAILABLE', 'waitForUrlAction is not available')
              return
            }

            const contains =
              body && typeof body.contains === 'string' ? body.contains : undefined
            const equals =
              body && typeof body.equals === 'string' ? body.equals : undefined
            const timeoutMs =
              body && typeof body.timeoutMs === 'number'
                ? body.timeoutMs
                : undefined

            const actionStartAt = new Date().toISOString()
            const actionId = nextActionId()

            try {
              const result = await mod.waitForUrlAction({
                sessionId,
                contains,
                equals,
                timeoutMs,
              })

              try {
                appendActionRecord({
                  id: actionId,
                  sessionId,
                  type: 'wait.url',
                  params: {
                    contains,
                    equals,
                    timeoutMs,
                    onTimeout,
                  },
                  startAt: actionStartAt,
                  endAt: new Date().toISOString(),
                  status: 'ok',
                  errorCode: null,
                  errorMessage: null,
                  snapshotId: null,
                })
              } catch {}

              sendJson(res, 200, {
                ok: true,
                errorCode: null,
                errorMessage: null,
                data: result,
              })
              try {
                touchSession(sessionId)
              } catch {}
              return
            } catch (error) {
              const message =
                error && error.message ? String(error.message) : String(error || '')
              const errorDetails = {
                sessionId,
                action: 'wait.url',
                contains,
                equals,
                timeoutMs,
                onTimeout,
              }

              try {
                appendActionRecord({
                  id: actionId,
                  sessionId,
                  type: 'wait.url',
                  params: {
                    contains,
                    equals,
                    timeoutMs,
                    onTimeout,
                  },
                  startAt: actionStartAt,
                  endAt: new Date().toISOString(),
                  status: isTimeoutError(error) ? 'timeout' : 'failed',
                  errorCode: isTimeoutError(error) ? 'TIMEOUT' : 'PLAYWRIGHT_ERROR',
                  errorMessage: message,
                  snapshotId: null,
                })
              } catch {}

              if (isTimeoutError(error)) {
                if (onTimeout === 'screenshot_only') {
                  try {
                    await triggerAutoScreenshot(sessionId, 'wait.url_timeout')
                  } catch {}
                }
                sendError(res, 504, 'TIMEOUT', message, errorDetails)
              } else {
                sendError(res, 500, 'PLAYWRIGHT_ERROR', message, errorDetails)
              }
              return
            }
          }

          handleNotFound(res)
        } catch (error) {
          const message = error && error.message ? String(error.message) : String(error || '')
          sendError(res, 500, 'PLAYWRIGHT_ERROR', message)
        }
      })()

      return
    }

    if (subPath === 'show') {
      if (req.method !== 'POST') {
        handleMethodNotAllowed(res)
        return
      }
      const updated = showSession(sessionId)
      if (!updated) {
        handleSessionNotFound(res, sessionId)
        return
      }

      try {
        const win = getBrowserWindowById(updated.windowId)
        if (win) {
          try {
            win.show()
            win.focus()
          } catch {}
        }
      } catch {}

      sendJson(res, 200, {
        ok: true,
        errorCode: null,
        errorMessage: null,
        data: updated,
      })
      return
    }

    if (subPath === 'screenshot') {
      if (req.method !== 'POST') {
        handleMethodNotAllowed(res)
        return
      }

      ;(async () => {
        try {
          const existing = getSession(sessionId)
          if (!existing) {
            handleSessionNotFound(res, sessionId)
            return
          }

          let body
          try {
            body = await parseJsonBody(req)
          } catch (error) {
            const err = /** @type {Error} */ (error)
            if (err && err.name === 'INVALID_JSON') {
              sendError(res, 400, 'BAD_JSON', 'Invalid JSON body')
            } else if (err && err.message === 'REQUEST_BODY_TOO_LARGE') {
              sendError(res, 413, 'REQUEST_ENTITY_TOO_LARGE', 'Request body too large')
            } else {
              sendError(res, 400, 'BAD_JSON', 'Invalid JSON body')
            }
            return
          }

          let mod
          try {
            mod = await import('./browser-agent-playwright.js')
          } catch (error) {
            const message = error && error.message ? String(error.message) : String(error || '')
            sendError(res, 500, 'PLAYWRIGHT_NOT_AVAILABLE', message)
            return
          }

          if (!mod || typeof mod.takeScreenshot !== 'function') {
            sendError(res, 500, 'PLAYWRIGHT_NOT_AVAILABLE', 'takeScreenshot is not available')
            return
          }

          const actionStartAt = new Date().toISOString()
          const actionId = nextActionId()
          const snapshotId = `snap_${actionId}`
          const fileId = `file_${actionId}`

          const result = await mod.takeScreenshot({
            sessionId,
            mode: body && typeof body.mode === 'string' ? body.mode : undefined,
            selector:
              body && typeof body.selector === 'string' ? body.selector : undefined,
            region:
              body && body.region && typeof body.region === 'object' ? body.region : undefined,
            format:
              body && typeof body.format === 'string' ? body.format : undefined,
            description:
              body && typeof body.description === 'string' ? body.description : undefined,
          })

          try {
            let finalSnapshotId = null
            try {
              const root = getBrowserAgentDataRootDir()
              const tmpPath =
                result && typeof result.screenshotPath === 'string'
                  ? result.screenshotPath
                  : ''
              if (root && tmpPath) {
                const extRaw = path.extname(tmpPath) || '.png'
                const safeExt = extRaw.startsWith('.') ? extRaw : `.${extRaw}`
                const relDir = path.join('sessions', sessionId, 'screenshots')
                const absDir = path.join(root, relDir)
                const ensured = ensureDirSync(absDir)
                if (ensured) {
                  const fileName = `${snapshotId}${safeExt}`
                  const relPath = path.join(relDir, fileName)
                  const absPath = path.join(root, relDir, fileName)
                  fs.copyFileSync(tmpPath, absPath)

                  let size = 0
                  try {
                    const stat = fs.statSync(absPath)
                    if (stat && typeof stat.size === 'number') {
                      size = stat.size
                    }
                  } catch {}

                  const lowerExt = safeExt.toLowerCase()
                  const mimeType =
                    lowerExt === '.jpg' || lowerExt === '.jpeg'
                      ? 'image/jpeg'
                      : 'image/png'

                  const createdAt = new Date().toISOString()

                  appendSnapshotRecord({
                    snapshotId,
                    sessionId,
                    actionId,
                    path: relPath,
                    description:
                      body && typeof body.description === 'string'
                        ? body.description
                        : null,
                    createdAt,
                  })

                  appendFileRecord({
                    fileId,
                    sessionId,
                    path: relPath,
                    name: fileName,
                    size,
                    mimeType,
                    createdAt,
                  })

                  finalSnapshotId = snapshotId

                  try {
                    if (result && typeof result === 'object') {
                      result.screenshotPath = absPath
                    }
                  } catch {}
                }
              }
            } catch {}

            appendActionRecord({
              id: actionId,
              sessionId,
              type: 'screenshot',
              params: {
                mode: body && typeof body.mode === 'string' ? body.mode : undefined,
                selector:
                  body && typeof body.selector === 'string' ? body.selector : undefined,
                region:
                  body && body.region && typeof body.region === 'object' ? body.region : undefined,
                format:
                  body && typeof body.format === 'string' ? body.format : undefined,
                description:
                  body && typeof body.description === 'string' ? body.description : undefined,
              },
              startAt: actionStartAt,
              endAt: new Date().toISOString(),
              status: 'ok',
              errorCode: null,
              errorMessage: null,
              snapshotId: finalSnapshotId,
            })
          } catch {}

          sendJson(res, 200, {
            ok: true,
            errorCode: null,
            errorMessage: null,
            data: result,
          })
          try {
            touchSession(sessionId)
          } catch {}
        } catch (error) {
          const message = error && error.message ? String(error.message) : String(error || '')
          sendError(res, 500, 'PLAYWRIGHT_ERROR', message)
        }
      })()

      return
    }

    if (subPath === 'dom') {
      if (!subAction) {
        handleNotFound(res)
        return
      }

      if (req.method !== 'POST') {
        handleMethodNotAllowed(res)
        return
      }

      ;(async () => {
        try {
          const existing = getSession(sessionId)
          if (!existing) {
            handleSessionNotFound(res, sessionId)
            return
          }

          let body
          try {
            body = await parseJsonBody(req)
          } catch (error) {
            const err = /** @type {Error} */ (error)
            if (err && err.name === 'INVALID_JSON') {
              sendError(res, 400, 'BAD_JSON', 'Invalid JSON body')
            } else if (err && err.message === 'REQUEST_BODY_TOO_LARGE') {
              sendError(res, 413, 'REQUEST_ENTITY_TOO_LARGE', 'Request body too large')
            } else {
              sendError(res, 400, 'BAD_JSON', 'Invalid JSON body')
            }
            return
          }

          let mod
          try {
            mod = await import('./browser-agent-playwright.js')
          } catch (error) {
            const message = error && error.message ? String(error.message) : String(error || '')
            sendError(res, 500, 'PLAYWRIGHT_NOT_AVAILABLE', message)
            return
          }

          if (!mod) {
            sendError(res, 500, 'PLAYWRIGHT_NOT_AVAILABLE', 'Playwright module not available')
            return
          }

          if (subAction === 'click') {
            if (typeof mod.domClick !== 'function') {
              sendError(res, 500, 'PLAYWRIGHT_NOT_AVAILABLE', 'domClick is not available')
              return
            }

            const actionStartAt = new Date().toISOString()

            const result = await mod.domClick({
              sessionId,
              selector:
                body && typeof body.selector === 'string' ? body.selector : '',
              timeoutMs:
                body && typeof body.timeoutMs === 'number'
                  ? body.timeoutMs
                  : undefined,
            })

            try {
              appendActionRecord({
                id: nextActionId(),
                sessionId,
                type: 'click',
                params: {
                  selector:
                    body && typeof body.selector === 'string' ? body.selector : '',
                  timeoutMs:
                    body && typeof body.timeoutMs === 'number'
                      ? body.timeoutMs
                      : undefined,
                },
                startAt: actionStartAt,
                endAt: new Date().toISOString(),
                status: 'ok',
                errorCode: null,
                errorMessage: null,
                snapshotId: null,
              })
            } catch {}

            sendJson(res, 200, {
              ok: true,
              errorCode: null,
              errorMessage: null,
              data: result,
            })
            try {
              touchSession(sessionId)
            } catch {}
            return
          }

          if (subAction === 'fill') {
            if (typeof mod.domFill !== 'function') {
              sendError(res, 500, 'PLAYWRIGHT_NOT_AVAILABLE', 'domFill is not available')
              return
            }

            const actionStartAt = new Date().toISOString()

            const result = await mod.domFill({
              sessionId,
              selector:
                body && typeof body.selector === 'string' ? body.selector : '',
              text: body && typeof body.text === 'string' ? body.text : '',
              clearBefore:
                body && typeof body.clearBefore === 'boolean'
                  ? body.clearBefore
                  : undefined,
              timeoutMs:
                body && typeof body.timeoutMs === 'number'
                  ? body.timeoutMs
                  : undefined,
            })

            try {
              appendActionRecord({
                id: nextActionId(),
                sessionId,
                type: 'fill',
                params: {
                  selector:
                    body && typeof body.selector === 'string' ? body.selector : '',
                  text: body && typeof body.text === 'string' ? body.text : '',
                  clearBefore:
                    body && typeof body.clearBefore === 'boolean'
                      ? body.clearBefore
                      : undefined,
                  timeoutMs:
                    body && typeof body.timeoutMs === 'number'
                      ? body.timeoutMs
                      : undefined,
                },
                startAt: actionStartAt,
                endAt: new Date().toISOString(),
                status: 'ok',
                errorCode: null,
                errorMessage: null,
                snapshotId: null,
              })
            } catch {}

            sendJson(res, 200, {
              ok: true,
              errorCode: null,
              errorMessage: null,
              data: result,
            })
            try {
              touchSession(sessionId)
            } catch {}
            return
          }

          if (subAction === 'scroll-into-view') {
            if (typeof mod.domScrollIntoView !== 'function') {
              sendError(res, 500, 'PLAYWRIGHT_NOT_AVAILABLE', 'domScrollIntoView is not available')
              return
            }

            const selector =
              body && typeof body.selector === 'string' ? body.selector : ''
            const timeoutMs =
              body && typeof body.timeoutMs === 'number' ? body.timeoutMs : undefined

            const actionStartAt = new Date().toISOString()
            const actionId = nextActionId()

            try {
              const result = await mod.domScrollIntoView({
                sessionId,
                selector,
                timeoutMs,
              })

              try {
                appendActionRecord({
                  id: actionId,
                  sessionId,
                  type: 'dom.scrollIntoView',
                  params: {
                    selector,
                    timeoutMs,
                  },
                  startAt: actionStartAt,
                  endAt: new Date().toISOString(),
                  status: 'ok',
                  errorCode: null,
                  errorMessage: null,
                  snapshotId: null,
                })
              } catch {}

              sendJson(res, 200, {
                ok: true,
                errorCode: null,
                errorMessage: null,
                data: result,
              })
              try {
                touchSession(sessionId)
              } catch {}
              return
            } catch (error) {
              const message =
                error && error.message ? String(error.message) : String(error || '')
              const errorDetails = {
                sessionId,
                action: 'dom.scrollIntoView',
                selector,
                timeoutMs,
              }

              try {
                appendActionRecord({
                  id: actionId,
                  sessionId,
                  type: 'dom.scrollIntoView',
                  params: {
                    selector,
                    timeoutMs,
                  },
                  startAt: actionStartAt,
                  endAt: new Date().toISOString(),
                  status: isTimeoutError(error) ? 'timeout' : 'failed',
                  errorCode: isTimeoutError(error) ? 'TIMEOUT' : 'PLAYWRIGHT_ERROR',
                  errorMessage: message,
                  snapshotId: null,
                })
              } catch {}

              if (isTimeoutError(error)) {
                sendError(res, 504, 'TIMEOUT', message, errorDetails)
              } else {
                sendError(res, 500, 'PLAYWRIGHT_ERROR', message, errorDetails)
              }
              return
            }
          }

          if (subAction === 'scroll') {
            if (typeof mod.domScroll !== 'function') {
              sendError(res, 500, 'PLAYWRIGHT_NOT_AVAILABLE', 'domScroll is not available')
              return
            }

            const mode = body && typeof body.mode === 'string' ? body.mode : undefined
            const targetY =
              body && typeof body.targetY === 'number' ? body.targetY : undefined
            const deltaY =
              body && typeof body.deltaY === 'number' ? body.deltaY : undefined
            const selector =
              body && typeof body.selector === 'string' ? body.selector : undefined
            const durationMs =
              body && typeof body.durationMs === 'number' ? body.durationMs : undefined
            const stepMinMs =
              body && typeof body.stepMinMs === 'number' ? body.stepMinMs : undefined
            const stepMaxMs =
              body && typeof body.stepMaxMs === 'number' ? body.stepMaxMs : undefined
            const jitterRatio =
              body && typeof body.jitterRatio === 'number' ? body.jitterRatio : undefined
            const timeoutMs =
              body && typeof body.timeoutMs === 'number' ? body.timeoutMs : undefined

            const actionStartAt = new Date().toISOString()
            const actionId = nextActionId()

            try {
              const result = await mod.domScroll({
                sessionId,
                mode,
                targetY,
                deltaY,
                selector,
                durationMs,
                stepMinMs,
                stepMaxMs,
                jitterRatio,
                timeoutMs,
              })

              try {
                appendActionRecord({
                  id: actionId,
                  sessionId,
                  type: 'dom.scroll',
                  params: {
                    mode,
                    targetY,
                    deltaY,
                    selector,
                    durationMs,
                    stepMinMs,
                    stepMaxMs,
                    jitterRatio,
                    timeoutMs,
                  },
                  startAt: actionStartAt,
                  endAt: new Date().toISOString(),
                  status: 'ok',
                  errorCode: null,
                  errorMessage: null,
                  snapshotId: null,
                })
              } catch {}

              sendJson(res, 200, {
                ok: true,
                errorCode: null,
                errorMessage: null,
                data: result,
              })
              try {
                touchSession(sessionId)
              } catch {}
              return
            } catch (error) {
              const message =
                error && error.message ? String(error.message) : String(error || '')
              const errorDetails = {
                sessionId,
                action: 'dom.scroll',
                mode,
                targetY,
                deltaY,
                selector,
                durationMs,
                stepMinMs,
                stepMaxMs,
                jitterRatio,
                timeoutMs,
              }

              try {
                appendActionRecord({
                  id: actionId,
                  sessionId,
                  type: 'dom.scroll',
                  params: {
                    mode,
                    targetY,
                    deltaY,
                    selector,
                    durationMs,
                    stepMinMs,
                    stepMaxMs,
                    jitterRatio,
                    timeoutMs,
                  },
                  startAt: actionStartAt,
                  endAt: new Date().toISOString(),
                  status: isTimeoutError(error) ? 'timeout' : 'failed',
                  errorCode: isTimeoutError(error) ? 'TIMEOUT' : 'PLAYWRIGHT_ERROR',
                  errorMessage: message,
                  snapshotId: null,
                })
              } catch {}

              if (isTimeoutError(error)) {
                sendError(res, 504, 'TIMEOUT', message, errorDetails)
              } else {
                sendError(res, 500, 'PLAYWRIGHT_ERROR', message, errorDetails)
              }
              return
            }
          }

          if (subAction === 'set-checkbox') {
            if (typeof mod.domSetCheckbox !== 'function') {
              sendError(res, 500, 'PLAYWRIGHT_NOT_AVAILABLE', 'domSetCheckbox is not available')
              return
            }

            const selector =
              body && typeof body.selector === 'string' ? body.selector : ''
            const checked =
              body && typeof body.checked === 'boolean' ? body.checked : true
            const timeoutMs =
              body && typeof body.timeoutMs === 'number' ? body.timeoutMs : undefined

            const actionStartAt = new Date().toISOString()
            const actionId = nextActionId()

            try {
              const result = await mod.domSetCheckbox({
                sessionId,
                selector,
                checked,
                timeoutMs,
              })

              try {
                appendActionRecord({
                  id: actionId,
                  sessionId,
                  type: 'dom.setCheckbox',
                  params: {
                    selector,
                    checked,
                    timeoutMs,
                  },
                  startAt: actionStartAt,
                  endAt: new Date().toISOString(),
                  status: 'ok',
                  errorCode: null,
                  errorMessage: null,
                  snapshotId: null,
                })
              } catch {}

              sendJson(res, 200, {
                ok: true,
                errorCode: null,
                errorMessage: null,
                data: result,
              })
              try {
                touchSession(sessionId)
              } catch {}
              return
            } catch (error) {
              const message =
                error && error.message ? String(error.message) : String(error || '')
              const errorDetails = {
                sessionId,
                action: 'dom.setCheckbox',
                selector,
                checked,
                timeoutMs,
              }

              try {
                appendActionRecord({
                  id: actionId,
                  sessionId,
                  type: 'dom.setCheckbox',
                  params: {
                    selector,
                    checked,
                    timeoutMs,
                  },
                  startAt: actionStartAt,
                  endAt: new Date().toISOString(),
                  status: isTimeoutError(error) ? 'timeout' : 'failed',
                  errorCode: isTimeoutError(error) ? 'TIMEOUT' : 'PLAYWRIGHT_ERROR',
                  errorMessage: message,
                  snapshotId: null,
                })
              } catch {}

              if (isTimeoutError(error)) {
                sendError(res, 504, 'TIMEOUT', message, errorDetails)
              } else {
                sendError(res, 500, 'PLAYWRIGHT_ERROR', message, errorDetails)
              }
              return
            }
          }

          if (subAction === 'set-radio') {
            if (typeof mod.domSetRadio !== 'function') {
              sendError(res, 500, 'PLAYWRIGHT_NOT_AVAILABLE', 'domSetRadio is not available')
              return
            }

            const selector =
              body && typeof body.selector === 'string' ? body.selector : ''
            const timeoutMs =
              body && typeof body.timeoutMs === 'number' ? body.timeoutMs : undefined

            const actionStartAt = new Date().toISOString()
            const actionId = nextActionId()

            try {
              const result = await mod.domSetRadio({
                sessionId,
                selector,
                timeoutMs,
              })

              try {
                appendActionRecord({
                  id: actionId,
                  sessionId,
                  type: 'dom.setRadio',
                  params: {
                    selector,
                    timeoutMs,
                  },
                  startAt: actionStartAt,
                  endAt: new Date().toISOString(),
                  status: 'ok',
                  errorCode: null,
                  errorMessage: null,
                  snapshotId: null,
                })
              } catch {}

              sendJson(res, 200, {
                ok: true,
                errorCode: null,
                errorMessage: null,
                data: result,
              })
              try {
                touchSession(sessionId)
              } catch {}
              return
            } catch (error) {
              const message =
                error && error.message ? String(error.message) : String(error || '')
              const errorDetails = {
                sessionId,
                action: 'dom.setRadio',
                selector,
                timeoutMs,
              }

              try {
                appendActionRecord({
                  id: actionId,
                  sessionId,
                  type: 'dom.setRadio',
                  params: {
                    selector,
                    timeoutMs,
                  },
                  startAt: actionStartAt,
                  endAt: new Date().toISOString(),
                  status: isTimeoutError(error) ? 'timeout' : 'failed',
                  errorCode: isTimeoutError(error) ? 'TIMEOUT' : 'PLAYWRIGHT_ERROR',
                  errorMessage: message,
                  snapshotId: null,
                })
              } catch {}

              if (isTimeoutError(error)) {
                sendError(res, 504, 'TIMEOUT', message, errorDetails)
              } else {
                sendError(res, 500, 'PLAYWRIGHT_ERROR', message, errorDetails)
              }
              return
            }
          }

          if (subAction === 'select-options') {
            if (typeof mod.domSelectOptions !== 'function') {
              sendError(res, 500, 'PLAYWRIGHT_NOT_AVAILABLE', 'domSelectOptions is not available')
              return
            }

            const selector =
              body && typeof body.selector === 'string' ? body.selector : ''
            const values =
              body && Array.isArray(body.values) ? body.values : undefined
            const labels =
              body && Array.isArray(body.labels) ? body.labels : undefined
            const indexes =
              body && Array.isArray(body.indexes) ? body.indexes : undefined
            const timeoutMs =
              body && typeof body.timeoutMs === 'number' ? body.timeoutMs : undefined

            const actionStartAt = new Date().toISOString()
            const actionId = nextActionId()

            try {
              const result = await mod.domSelectOptions({
                sessionId,
                selector,
                values,
                labels,
                indexes,
                timeoutMs,
              })

              try {
                appendActionRecord({
                  id: actionId,
                  sessionId,
                  type: 'dom.selectOptions',
                  params: {
                    selector,
                    values,
                    labels,
                    indexes,
                    timeoutMs,
                  },
                  startAt: actionStartAt,
                  endAt: new Date().toISOString(),
                  status: 'ok',
                  errorCode: null,
                  errorMessage: null,
                  snapshotId: null,
                })
              } catch {}

              sendJson(res, 200, {
                ok: true,
                errorCode: null,
                errorMessage: null,
                data: result,
              })
              try {
                touchSession(sessionId)
              } catch {}
              return
            } catch (error) {
              const message =
                error && error.message ? String(error.message) : String(error || '')
              const errorDetails = {
                sessionId,
                action: 'dom.selectOptions',
                selector,
                timeoutMs,
              }

              try {
                appendActionRecord({
                  id: actionId,
                  sessionId,
                  type: 'dom.selectOptions',
                  params: {
                    selector,
                    values,
                    labels,
                    indexes,
                    timeoutMs,
                  },
                  startAt: actionStartAt,
                  endAt: new Date().toISOString(),
                  status: isTimeoutError(error) ? 'timeout' : 'failed',
                  errorCode: isTimeoutError(error) ? 'TIMEOUT' : 'PLAYWRIGHT_ERROR',
                  errorMessage: message,
                  snapshotId: null,
                })
              } catch {}

              if (isTimeoutError(error)) {
                sendError(res, 504, 'TIMEOUT', message, errorDetails)
              } else {
                sendError(res, 500, 'PLAYWRIGHT_ERROR', message, errorDetails)
              }
              return
            }
          }

          if (subAction === 'upload-file') {
            if (typeof mod.domUploadFile !== 'function') {
              sendError(res, 500, 'PLAYWRIGHT_NOT_AVAILABLE', 'domUploadFile is not available')
              return
            }

            const selector =
              body && typeof body.selector === 'string' ? body.selector : ''
            const files =
              body && Array.isArray(body.files) ? body.files : undefined
            const timeoutMs =
              body && typeof body.timeoutMs === 'number' ? body.timeoutMs : undefined

            const actionStartAt = new Date().toISOString()
            const actionId = nextActionId()

            try {
              const result = await mod.domUploadFile({
                sessionId,
                selector,
                files,
                timeoutMs,
              })

              try {
                appendActionRecord({
                  id: actionId,
                  sessionId,
                  type: 'dom.uploadFile',
                  params: {
                    selector,
                    files,
                    timeoutMs,
                  },
                  startAt: actionStartAt,
                  endAt: new Date().toISOString(),
                  status: 'ok',
                  errorCode: null,
                  errorMessage: null,
                  snapshotId: null,
                })
              } catch {}

              sendJson(res, 200, {
                ok: true,
                errorCode: null,
                errorMessage: null,
                data: result,
              })
              try {
                touchSession(sessionId)
              } catch {}
              return
            } catch (error) {
              const message =
                error && error.message ? String(error.message) : String(error || '')
              const errorDetails = {
                sessionId,
                action: 'dom.uploadFile',
                selector,
                timeoutMs,
              }

              try {
                appendActionRecord({
                  id: actionId,
                  sessionId,
                  type: 'dom.uploadFile',
                  params: {
                    selector,
                    files,
                    timeoutMs,
                  },
                  startAt: actionStartAt,
                  endAt: new Date().toISOString(),
                  status: isTimeoutError(error) ? 'timeout' : 'failed',
                  errorCode: isTimeoutError(error) ? 'TIMEOUT' : 'PLAYWRIGHT_ERROR',
                  errorMessage: message,
                  snapshotId: null,
                })
              } catch {}

              if (isTimeoutError(error)) {
                sendError(res, 504, 'TIMEOUT', message, errorDetails)
              } else {
                sendError(res, 500, 'PLAYWRIGHT_ERROR', message, errorDetails)
              }
              return
            }
          }

          if (subAction === 'is-disabled') {
            if (typeof mod.domIsDisabled !== 'function') {
              sendError(res, 500, 'PLAYWRIGHT_NOT_AVAILABLE', 'domIsDisabled is not available')
              return
            }

            const selector =
              body && typeof body.selector === 'string' ? body.selector : ''
            const timeoutMs =
              body && typeof body.timeoutMs === 'number' ? body.timeoutMs : undefined

            const actionStartAt = new Date().toISOString()
            const actionId = nextActionId()

            try {
              const result = await mod.domIsDisabled({
                sessionId,
                selector,
                timeoutMs,
              })

              try {
                appendActionRecord({
                  id: actionId,
                  sessionId,
                  type: 'dom.isDisabled',
                  params: {
                    selector,
                    timeoutMs,
                  },
                  startAt: actionStartAt,
                  endAt: new Date().toISOString(),
                  status: 'ok',
                  errorCode: null,
                  errorMessage: null,
                  snapshotId: null,
                })
              } catch {}

              sendJson(res, 200, {
                ok: true,
                errorCode: null,
                errorMessage: null,
                data: result,
              })
              try {
                touchSession(sessionId)
              } catch {}
              return
            } catch (error) {
              const message =
                error && error.message ? String(error.message) : String(error || '')
              const errorDetails = {
                sessionId,
                action: 'dom.isDisabled',
                selector,
                timeoutMs,
              }

              try {
                appendActionRecord({
                  id: actionId,
                  sessionId,
                  type: 'dom.isDisabled',
                  params: {
                    selector,
                    timeoutMs,
                  },
                  startAt: actionStartAt,
                  endAt: new Date().toISOString(),
                  status: isTimeoutError(error) ? 'timeout' : 'failed',
                  errorCode: isTimeoutError(error) ? 'TIMEOUT' : 'PLAYWRIGHT_ERROR',
                  errorMessage: message,
                  snapshotId: null,
                })
              } catch {}

              if (isTimeoutError(error)) {
                sendError(res, 504, 'TIMEOUT', message, errorDetails)
              } else {
                sendError(res, 500, 'PLAYWRIGHT_ERROR', message, errorDetails)
              }
              return
            }
          }

          if (subAction === 'get-form-data') {
            if (typeof mod.domGetFormData !== 'function') {
              sendError(res, 500, 'PLAYWRIGHT_NOT_AVAILABLE', 'domGetFormData is not available')
              return
            }

            const formSelector =
              body && typeof body.formSelector === 'string' ? body.formSelector : ''
            const includeDisabled =
              body && typeof body.includeDisabled === 'boolean'
                ? body.includeDisabled
                : false

            const actionStartAt = new Date().toISOString()
            const actionId = nextActionId()

            try {
              const result = await mod.domGetFormData({
                sessionId,
                formSelector,
                includeDisabled,
              })

              try {
                appendActionRecord({
                  id: actionId,
                  sessionId,
                  type: 'dom.getFormData',
                  params: {
                    formSelector,
                    includeDisabled,
                  },
                  startAt: actionStartAt,
                  endAt: new Date().toISOString(),
                  status: 'ok',
                  errorCode: null,
                  errorMessage: null,
                  snapshotId: null,
                })
              } catch {}

              sendJson(res, 200, {
                ok: true,
                errorCode: null,
                errorMessage: null,
                data: result,
              })
              try {
                touchSession(sessionId)
              } catch {}
              return
            } catch (error) {
              const message =
                error && error.message ? String(error.message) : String(error || '')
              const errorDetails = {
                sessionId,
                action: 'dom.getFormData',
                formSelector,
                includeDisabled,
              }

              try {
                appendActionRecord({
                  id: actionId,
                  sessionId,
                  type: 'dom.getFormData',
                  params: {
                    formSelector,
                    includeDisabled,
                  },
                  startAt: actionStartAt,
                  endAt: new Date().toISOString(),
                  status: 'failed',
                  errorCode: 'PLAYWRIGHT_ERROR',
                  errorMessage: message,
                  snapshotId: null,
                })
              } catch {}

              sendError(res, 500, 'PLAYWRIGHT_ERROR', message, errorDetails)
              return
            }
          }

          if (subAction === 'get-value') {
            if (typeof mod.domGetValue !== 'function') {
              sendError(res, 500, 'PLAYWRIGHT_NOT_AVAILABLE', 'domGetValue is not available')
              return
            }

            const selector =
              body && typeof body.selector === 'string' ? body.selector : ''
            const timeoutMs =
              body && typeof body.timeoutMs === 'number' ? body.timeoutMs : undefined

            const actionStartAt = new Date().toISOString()
            const actionId = nextActionId()

            try {
              const result = await mod.domGetValue({
                sessionId,
                selector,
                timeoutMs,
              })

              try {
                appendActionRecord({
                  id: actionId,
                  sessionId,
                  type: 'dom.getValue',
                  params: {
                    selector,
                    timeoutMs,
                  },
                  startAt: actionStartAt,
                  endAt: new Date().toISOString(),
                  status: 'ok',
                  errorCode: null,
                  errorMessage: null,
                  snapshotId: null,
                })
              } catch {}

              sendJson(res, 200, {
                ok: true,
                errorCode: null,
                errorMessage: null,
                data: result,
              })
              try {
                touchSession(sessionId)
              } catch {}
              return
            } catch (error) {
              const message =
                error && error.message ? String(error.message) : String(error || '')
              const errorDetails = {
                sessionId,
                action: 'dom.getValue',
                selector,
                timeoutMs,
              }

              try {
                appendActionRecord({
                  id: actionId,
                  sessionId,
                  type: 'dom.getValue',
                  params: {
                    selector,
                    timeoutMs,
                  },
                  startAt: actionStartAt,
                  endAt: new Date().toISOString(),
                  status: isTimeoutError(error) ? 'timeout' : 'failed',
                  errorCode: isTimeoutError(error) ? 'TIMEOUT' : 'PLAYWRIGHT_ERROR',
                  errorMessage: message,
                  snapshotId: null,
                })
              } catch {}

              if (isTimeoutError(error)) {
                sendError(res, 504, 'TIMEOUT', message, errorDetails)
              } else {
                sendError(res, 500, 'PLAYWRIGHT_ERROR', message, errorDetails)
              }
              return
            }
          }

          handleNotFound(res)
        } catch (error) {
          const message = error && error.message ? String(error.message) : String(error || '')
          sendError(res, 500, 'PLAYWRIGHT_ERROR', message)
        }
      })()

      return
    }

    if (subPath === 'mouse') {
      if (!subAction) {
        handleNotFound(res)
        return
      }

      if (req.method !== 'POST') {
        handleMethodNotAllowed(res)
        return
      }

      ;(async () => {
        try {
          const existing = getSession(sessionId)
          if (!existing) {
            handleSessionNotFound(res, sessionId)
            return
          }

          let body
          try {
            body = await parseJsonBody(req)
          } catch (error) {
            const err = /** @type {Error} */ (error)
            if (err && err.name === 'INVALID_JSON') {
              sendError(res, 400, 'BAD_JSON', 'Invalid JSON body')
            } else if (err && err.message === 'REQUEST_BODY_TOO_LARGE') {
              sendError(res, 413, 'REQUEST_ENTITY_TOO_LARGE', 'Request body too large')
            } else {
              sendError(res, 400, 'BAD_JSON', 'Invalid JSON body')
            }
            return
          }

          let mod
          try {
            mod = await import('./browser-agent-playwright.js')
          } catch (error) {
            const message = error && error.message ? String(error.message) : String(error || '')
            sendError(res, 500, 'PLAYWRIGHT_NOT_AVAILABLE', message)
            return
          }

          if (!mod) {
            sendError(res, 500, 'PLAYWRIGHT_NOT_AVAILABLE', 'Playwright module not available')
            return
          }

          const actionStartAt = new Date().toISOString()

          if (subAction === 'click') {
            if (typeof mod.mouseClickPoint !== 'function') {
              sendError(res, 500, 'PLAYWRIGHT_NOT_AVAILABLE', 'mouseClickPoint is not available')
              return
            }

            const x = body && typeof body.x === 'number' ? body.x : null
            const y = body && typeof body.y === 'number' ? body.y : null
            const button =
              body && typeof body.button === 'string'
                ? body.button
                : undefined
            const timeoutMs =
              body && typeof body.timeoutMs === 'number'
                ? body.timeoutMs
                : undefined

            const result = await mod.mouseClickPoint({
              sessionId,
              x,
              y,
              button,
              timeoutMs,
            })

            try {
              appendActionRecord({
                id: nextActionId(),
                sessionId,
                type: 'mouse.click',
                params: {
                  x,
                  y,
                  button,
                  timeoutMs,
                },
                startAt: actionStartAt,
                endAt: new Date().toISOString(),
                status: 'ok',
                errorCode: null,
                errorMessage: null,
                snapshotId: null,
              })
            } catch {}

            sendJson(res, 200, {
              ok: true,
              errorCode: null,
              errorMessage: null,
              data: result,
            })
            return
          }

          if (subAction === 'drag') {
            if (typeof mod.mouseDragPath !== 'function') {
              sendError(res, 500, 'PLAYWRIGHT_NOT_AVAILABLE', 'mouseDragPath is not available')
              return
            }

            const pathValue =
              body && Array.isArray(body.path)
                ? body.path
                : []
            const button =
              body && typeof body.button === 'string'
                ? body.button
                : undefined
            const timeoutMs =
              body && typeof body.timeoutMs === 'number'
                ? body.timeoutMs
                : undefined

            const result = await mod.mouseDragPath({
              sessionId,
              path: pathValue,
              button,
              timeoutMs,
            })

            try {
              appendActionRecord({
                id: nextActionId(),
                sessionId,
                type: 'mouse.drag',
                params: {
                  path: pathValue,
                  button,
                  timeoutMs,
                },
                startAt: actionStartAt,
                endAt: new Date().toISOString(),
                status: 'ok',
                errorCode: null,
                errorMessage: null,
                snapshotId: null,
              })
            } catch {}

            sendJson(res, 200, {
              ok: true,
              errorCode: null,
              errorMessage: null,
              data: result,
            })
            return
          }

          handleNotFound(res)
        } catch (error) {
          const message = error && error.message ? String(error.message) : String(error || '')
          sendError(res, 500, 'PLAYWRIGHT_ERROR', message)
        }
      })()

      return
    }

    if (subPath === 'content') {
      if (!subAction) {
        handleNotFound(res)
        return
      }

      if (req.method !== 'POST') {
        handleMethodNotAllowed(res)
        return
      }

      ;(async () => {
        try {
          const existing = getSession(sessionId)
          if (!existing) {
            handleSessionNotFound(res, sessionId)
            return
          }

          let body = null

          if (subAction === 'html' || subAction === 'text' || subAction === 'table') {
            try {
              body = await parseJsonBody(req)
            } catch (error) {
              const err = /** @type {Error} */ (error)
              if (err && err.name === 'INVALID_JSON') {
                sendError(res, 400, 'BAD_JSON', 'Invalid JSON body')
              } else if (err && err.message === 'REQUEST_BODY_TOO_LARGE') {
                sendError(res, 413, 'REQUEST_ENTITY_TOO_LARGE', 'Request body too large')
              } else {
                sendError(res, 400, 'BAD_JSON', 'Invalid JSON body')
              }
              return
            }
          } else {
            // 其他子接口不需要请求体，但仍尝试读取并丢弃，避免残留数据影响连接复用
            try {
              await readRequestBody(req)
            } catch {}
          }

          let mod
          try {
            mod = await import('./browser-agent-playwright.js')
          } catch (error) {
            const message = error && error.message ? String(error.message) : String(error || '')
            sendError(res, 500, 'PLAYWRIGHT_NOT_AVAILABLE', message)
            return
          }

          if (!mod) {
            sendError(res, 500, 'PLAYWRIGHT_NOT_AVAILABLE', 'Playwright module not available')
            return
          }

          const actionStartAt = new Date().toISOString()

          if (subAction === 'html') {
            if (typeof mod.extractHtml !== 'function') {
              sendError(res, 500, 'PLAYWRIGHT_NOT_AVAILABLE', 'extractHtml is not available')
              return
            }

            const selector =
              body && typeof body.selector === 'string' ? body.selector : undefined
            const outer =
              body && typeof body.outer === 'boolean' ? body.outer : false

            const result = await mod.extractHtml({
              sessionId,
              selector,
              outer,
            })

            try {
              appendActionRecord({
                id: nextActionId(),
                sessionId,
                type: 'content.html',
                params: {
                  selector,
                  outer,
                },
                startAt: actionStartAt,
                endAt: new Date().toISOString(),
                status: 'ok',
                errorCode: null,
                errorMessage: null,
                snapshotId: null,
              })
            } catch {}

            sendJson(res, 200, {
              ok: true,
              errorCode: null,
              errorMessage: null,
              data: result,
            })
            return
          }

          if (subAction === 'text') {
            if (typeof mod.extractText !== 'function') {
              sendError(res, 500, 'PLAYWRIGHT_NOT_AVAILABLE', 'extractText is not available')
              return
            }

            const scope = body && typeof body.scope === 'string' ? body.scope : undefined
            const selector =
              body && typeof body.selector === 'string' ? body.selector : undefined

            const result = await mod.extractText({
              sessionId,
              scope,
              selector,
            })

            try {
              appendActionRecord({
                id: nextActionId(),
                sessionId,
                type: 'content.text',
                params: {
                  scope,
                  selector,
                },
                startAt: actionStartAt,
                endAt: new Date().toISOString(),
                status: 'ok',
                errorCode: null,
                errorMessage: null,
                snapshotId: null,
              })
            } catch {}

            sendJson(res, 200, {
              ok: true,
              errorCode: null,
              errorMessage: null,
              data: result,
            })
            return
          }

          if (subAction === 'table') {
            if (typeof mod.extractTable !== 'function') {
              sendError(res, 500, 'PLAYWRIGHT_NOT_AVAILABLE', 'extractTable is not available')
              return
            }

            const selector =
              body && typeof body.selector === 'string' ? body.selector : undefined

            const result = await mod.extractTable({
              sessionId,
              selector,
            })

            try {
              appendActionRecord({
                id: nextActionId(),
                sessionId,
                type: 'content.table',
                params: {
                  selector,
                },
                startAt: actionStartAt,
                endAt: new Date().toISOString(),
                status: 'ok',
                errorCode: null,
                errorMessage: null,
                snapshotId: null,
              })
            } catch {}

            sendJson(res, 200, {
              ok: true,
              errorCode: null,
              errorMessage: null,
              data: result,
            })
            return
          }

          handleNotFound(res)
        } catch (error) {
          const message = error && error.message ? String(error.message) : String(error || '')
          sendError(res, 500, 'PLAYWRIGHT_ERROR', message)
        }
      })()

      return
    }

    if (subPath === 'files') {
      if (req.method !== 'GET') {
        handleMethodNotAllowed(res)
        return
      }

      ;(async () => {
        try {
          const existing = getSession(sessionId)
          if (!existing) {
            handleSessionNotFound(res, sessionId)
            return
          }

          const search = url.searchParams
          const date = search.get('date') || undefined

          /** @type {any[]} */
          const fileRecords = readNdjson('files', date)
          const items = []

          for (const rec of fileRecords) {
            if (!rec || typeof rec !== 'object') continue
            const rawSessionId = rec.sessionId
            const sid = typeof rawSessionId === 'string' && rawSessionId.trim() ? rawSessionId.trim() : ''
            if (!sid || sid !== sessionId) continue

            const rawFileId = rec.fileId
            const fileId = typeof rawFileId === 'string' && rawFileId.trim() ? rawFileId.trim() : null
            if (!fileId) continue

            const name =
              typeof rec.name === 'string' && rec.name.trim() ? rec.name.trim() : null
            const size =
              typeof rec.size === 'number' && Number.isFinite(rec.size) && rec.size >= 0
                ? rec.size
                : null
            const mimeType =
              typeof rec.mimeType === 'string' && rec.mimeType.trim()
                ? rec.mimeType.trim()
                : null
            const pathValue =
              typeof rec.path === 'string' && rec.path.trim() ? rec.path.trim() : null
            const createdAt =
              typeof rec.createdAt === 'string' && rec.createdAt.trim()
                ? rec.createdAt.trim()
                : null

            items.push({
              fileId,
              sessionId,
              name,
              size,
              mimeType,
              path: pathValue,
              createdAt,
            })
          }

          sendJson(res, 200, {
            ok: true,
            errorCode: null,
            errorMessage: null,
            data: {
              items,
            },
          })
        } catch (error) {
          const message = error && error.message ? String(error.message) : String(error || '')
          sendError(res, 500, 'INTERNAL_ERROR', message)
        }
      })()

      return
    }

    if (subPath === 'hide') {
      if (req.method !== 'POST') {
        handleMethodNotAllowed(res)
        return
      }
      const updated = hideSession(sessionId)
      if (!updated) {
        handleSessionNotFound(res, sessionId)
        return
      }

      try {
        const win = getBrowserWindowById(updated.windowId)
        if (win) {
          try {
            win.hide()
          } catch {}
        }
      } catch {}

      sendJson(res, 200, {
        ok: true,
        errorCode: null,
        errorMessage: null,
        data: updated,
      })
      return
    }

    // 预留给后续 /sessions/{id}/navigate 等子路由使用
    handleMethodNotAllowed(res)
    return
  }

  if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'DELETE') {
    handleMethodNotAllowed(res)
    return
  }

  handleNotFound(res)
}

export async function startBrowserAgentServer() {
  if (server) return

  const { enabled, port } = getEffectiveConfig()
  if (!enabled) {
    return
  }

  server = http.createServer(handleRequest)
  ensureSessionCleanupTimer()

  await new Promise((resolve, reject) => {
    try {
      server.listen(port, '127.0.0.1', (err) => {
        if (err) {
          reject(err)
          return
        }
        resolve(null)
      })
    } catch (error) {
      reject(error)
    }
  }).catch((error) => {
    console.error('[BrowserAgent] 无法启动 HTTP 服务', error)
  })
}

export async function stopBrowserAgentServer() {
  if (!server) return
  const srv = server
  server = null

  stopSessionCleanupTimer()

  await new Promise((resolve) => {
    try {
      srv.close(() => {
        resolve(null)
      })
    } catch {
      resolve(null)
    }
  })
}
