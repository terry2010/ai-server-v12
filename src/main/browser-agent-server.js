import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { BrowserWindow } from 'electron'
import { defaultAppSettings, getAppSettings } from './app-settings.js'
import { createSession, listSessions, getSession, closeSession, showSession, hideSession, setSessionWindowId } from './browser-agent-core.js'
import {
  appendSessionRecord,
  appendActionRecord,
  appendBrowserAgentTextLog,
  appendSnapshotRecord,
  appendFileRecord,
  getBrowserAgentDataRootDir,
  ensureDirSync,
} from './browser-agent-storage.js'

/** @typedef {import('../shared/types').BrowserAgentSettings} BrowserAgentSettings */

/** @type {http.Server | null} */
let server = null
let actionSeq = 0

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

function sendError(res, statusCode, errorCode, message) {
  sendJson(res, statusCode, {
    ok: false,
    errorCode,
    errorMessage: message,
    data: null,
  })
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

          const result = await mod.navigateOnce({
            sessionId,
            url: effectiveUrl,
          })

          if (result) {
            try {
              setSessionWindowId(sessionId, result.windowId)
            } catch {}

            try {
              appendActionRecord({
                id: nextActionId(),
                sessionId,
                type: 'navigate',
                params: {
                  url: effectiveUrl,
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
