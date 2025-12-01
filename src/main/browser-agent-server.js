import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { BrowserWindow, ipcMain } from 'electron'
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

/** @type {import('electron').BrowserWindow | null} */
let mockHttpWindow = null
let mockHttpWindowReady = false
let mockHttpRequestSeq = 0
/** @type {{ channel: string, payload: any }[]} */
let mockHttpUiQueue = []
/** @type {Map<number, { resolve: (value: any) => void, timer: NodeJS.Timeout | null }>} */
const mockHttpPendingResponses = new Map()
const MOCK_HTTP_TIMEOUT_MS = 5 * 60 * 1000

function nextMockHttpRequestId() {
  mockHttpRequestSeq += 1
  return mockHttpRequestSeq
}

function getMockHttpHtml() {
  const style =
    'body{margin:0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#020617;color:#e5e7eb;}' +
    '.header{padding:10px 12px;border-bottom:1px solid #1f2937;background:#020617;display:flex;justify-content:space-between;align-items:center;}' +
    '.title{font-size:14px;font-weight:600;}' +
    '.subtitle{font-size:11px;color:#9ca3af;}' +
    '.layout{display:flex;height:calc(100vh - 44px);}' +
    '.side{flex:1;overflow:auto;padding:12px;}' +
    '.side.right{max-width:360px;border-left:1px solid #1f2937;}' +
    '.req{border-bottom:1px solid #1f2937;padding:8px 4px;}' +
    '.req-title{font-size:12px;font-weight:600;margin-bottom:4px;}' +
    '.req-meta{font-size:11px;color:#9ca3af;margin-bottom:4px;}' +
    '.code{font-family:ui-monospace,Menlo,Monaco,Consolas,monospace;font-size:11px;background:#020617;border-radius:4px;padding:6px 8px;white-space:pre-wrap;word-break:break-all;border:1px solid #111827;margin-bottom:4px;}' +
    '.templates-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;}' +
    '.btn{border-radius:4px;border:none;padding:4px 8px;font-size:11px;cursor:pointer;background:#1d4ed8;color:#ffffff;}' +
    '.btn.small{font-size:10px;padding:2px 6px;}' +
    '.btn.secondary{background:#374151;}' +
    '.field-label{font-size:11px;color:#9ca3af;margin-top:4px;margin-bottom:2px;display:inline-block;margin-right:6px;}' +
    '.input,.textarea{width:100%;box-sizing:border-box;border-radius:4px;border:1px solid #111827;background:#020617;color:#e5e7eb;font-size:11px;padding:4px 6px;}' +
    '.template .input{display:inline-block;width:calc(100% - 70px);}' +
    '.textarea{min-height:54px;font-family:ui-monospace,Menlo,Monaco,Consolas,monospace;resize:vertical;}' +
    '.badge{display:inline-block;padding:1px 6px;border-radius:999px;font-size:10px;background:#065f46;color:#bbf7d0;margin-left:4px;}' +
    'select.input{padding-right:18px;}' +
    '.row{display:flex;gap:4px;}' +
    '.row>.col-1{flex:1;}' +
    '.row>.col-0{flex:0 0 auto;}' +
    '.template .row>.col-1:first-child .input{max-width:72px;}' +
    '.template .row>.col-1:nth-child(2) .field-label{display:inline-block;margin-right:6px;}' +
    '.template .row>.col-1:nth-child(2) .input{display:inline-block;width:calc(100% - 80px);}' +
    '.template{border:1px solid #111827;border-radius:6px;padding:6px 8px;margin-bottom:6px;background:#020617;}'

  const script =
    'const { ipcRenderer } = require("electron");' +
    'const state = { templates: [], requests: [] };' +
    'let nextTemplateId = 1;let expandedRequestId = null;' +
    'function getRequestsEl(){return document.getElementById("requests");}' +
    'function getTemplatesEl(){return document.getElementById("templates");}' +
    'function escapeHtml(v){if(v===null||v===undefined)return"";return String(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}' +
    'function initDefaultTemplates(){if(state.templates.length){return;}state.templates.push({id:nextTemplateId++,name:"200 OK JSON",statusCode:200,contentType:"application/json; charset=utf-8",body:"{\\n  \\\"ok\\\": true\\n}"});state.templates.push({id:nextTemplateId++,name:"500 Error JSON",statusCode:500,contentType:"application/json; charset=utf-8",body:"{\\n  \\\"ok\\\": false,\\n  \\\"error\\\": \\\"mock error\\\"\\n}"});state.templates.push({id:nextTemplateId++,name:"302 Redirect",statusCode:302,contentType:"text/html; charset=utf-8",body:"<!doctype html>\\n<html><head><meta http-equiv=\\"refresh\\" content=\\"0;url=https://example.com/\\" /></head><body>Redirecting to https://example.com/ ...</body></html>"});}' +
    'function renderTemplates(){const el=getTemplatesEl();if(!el)return;let html="";html+="<div class=\\"templates-header\\"><div class=\\"title\\">返回模板</div><button class=\\"btn small\\" onclick=\\"window.__mockAddTemplate()\\">新增模板</button></div>";html+="<div class=\\"templates-list\\">";if(!state.templates.length){html+="<div class=\\"subtitle\\">暂无模板，请点击“新增模板”。</div>";}for(const t of state.templates){html+="<div class=\\"template\\" data-id=\\""+t.id+"\\">";html+="<div class=\\"field-label\\">名称</div>";html+="<input class=\\"input\\" value=\\""+escapeHtml(t.name||"")+"\\" onchange=\\"window.__mockUpdateTemplateName("+t.id+", this.value)\\" />";html+="<div class=\\"row\\"><div class=\\"col-1\\"><div class=\\"field-label\\">HTTP 状态码</div><input class=\\"input\\" value=\\""+escapeHtml(t.statusCode)+"\\" onchange=\\"window.__mockUpdateTemplateStatus("+t.id+", this.value)\\" /></div><div class=\\"col-1\\"><div class=\\"field-label\\">Content-Type</div><input class=\\"input\\" value=\\""+escapeHtml(t.contentType||"")+"\\" onchange=\\"window.__mockUpdateTemplateType("+t.id+", this.value)\\" /></div><div class=\\"col-0\\" style=\\"align-self:flex-end;\\"><button class=\\"btn small secondary\\" onclick=\\"window.__mockDeleteTemplate("+t.id+")\\">删除</button></div></div>";html+="<div class=\\"field-label\\">Body</div>";html+="<textarea class=\\"textarea\\" rows=\\"3\\" onchange=\\"window.__mockUpdateTemplateBody("+t.id+", this.value)\\">"+escapeHtml(t.body||"")+"</textarea>";html+="</div>";}html+="</div>";el.innerHTML=html;}' +
    'function renderRequests(){const el=getRequestsEl();if(!el)return;let html="";if(!state.requests.length){html+="<div class=\\"subtitle\\">暂无请求，请向 /debug/mock-http 发送 GET/POST 请求。</div>";}else{if(expandedRequestId===null&&state.requests.length){expandedRequestId=state.requests[0].id;}html+="<div class=\\"requests-header\\"><button class=\\"btn small secondary\\" onclick=\\"window.__mockClearRequests()\\">清除历史请求</button></div>";for(const r of state.requests){const headersJson=escapeHtml(JSON.stringify(r.headers||{},null,2));const queryJson=escapeHtml(JSON.stringify(r.query||{},null,2));const bodyText=escapeHtml(r.body||"");const expanded=expandedRequestId===r.id;html+="<div class=\\"req\\">";html+="<div class=\\"req-title\\" onclick=\\"window.__mockToggleRequest("+r.id+")\\" style=\\"cursor:pointer;\\">";html+="#"+r.id+" "+escapeHtml(r.method||"")+" "+escapeHtml(r.url||"");if(r.responded&&r.responseTemplateName){html+="<span class=\\"badge\\">已返回: "+escapeHtml(r.responseTemplateName)+"</span>";}html+="<button class=\\"btn small secondary\\" style=\\"margin-left:8px;float:right;\\" onclick=\\"window.__mockDeleteRequest("+r.id+");event.stopPropagation();\\">删除</button>";html+="</div>";html+="<div class=\\"req-body\\" style=\\""+(expanded?"":"display:none;")+"\\">";html+="<div class=\\"req-meta\\">"+escapeHtml(r.receivedAt||"");if(r.source){html+=" · 来源 "+escapeHtml(r.source);}html+="</div>";html+="<div class=\\"field-label\\">Headers</div><div class=\\"code\\">"+headersJson+"</div>";html+="<div class=\\"field-label\\">Query</div><div class=\\"code\\">"+queryJson+"</div>";if(bodyText){html+="<div class=\\"field-label\\">Body</div><div class=\\"code\\">"+bodyText+"</div>";}html+="<div class=\\"field-label\\">选择返回模板</div>";html+="<div class=\\"row\\"><div class=\\"col-1\\"><select class=\\"input\\" id=\\"mock-select-"+r.id+"\\">";for(const t of state.templates){html+="<option value=\\""+t.id+"\\">["+escapeHtml(t.statusCode)+"] "+escapeHtml(t.name||"")+"</option>";}html+="</select></div><div class=\\"col-0\\"><button class=\\"btn small\\" onclick=\\"window.__mockSendResponse("+r.id+")\\">发送</button></div></div>";html+="</div>";html+="</div>";}}el.innerHTML=html;}' +
    'window.__mockAddTemplate=function(){state.templates.unshift({id:nextTemplateId++,name:"New template",statusCode:200,contentType:"application/json; charset=utf-8",body:""});renderTemplates();};' +
    'window.__mockDeleteTemplate=function(id){state.templates=state.templates.filter(function(t){return t.id!==id;});renderTemplates();renderRequests();};' +
    'window.__mockUpdateTemplateName=function(id,val){for(const t of state.templates){if(t.id===id){t.name=val;break;}}renderTemplates();renderRequests();};' +
    'window.__mockUpdateTemplateStatus=function(id,val){const num=parseInt(String(val),10);for(const t of state.templates){if(t.id===id){if(!isNaN(num))t.statusCode=num;break;}}renderTemplates();renderRequests();};' +
    'window.__mockUpdateTemplateType=function(id,val){for(const t of state.templates){if(t.id===id){t.contentType=val;break;}}renderTemplates();};' +
    'window.__mockUpdateTemplateBody=function(id,val){for(const t of state.templates){if(t.id===id){t.body=val;break;}}};' +
    'window.__mockSendResponse=function(requestId){let req=null;for(const r of state.requests){if(r.id===requestId){req=r;break;}}if(!req)return;const select=document.getElementById("mock-select-"+requestId);if(!select||!select.options.length){alert("请先在右侧添加至少一个返回模板。");return;}const templateId=parseInt(select.value,10);let tpl=null;for(const t of state.templates){if(t.id===templateId){tpl=t;break;}}if(!tpl){alert("未找到选择的模板。");return;}req.responded=true;req.responseTemplateName=tpl.name||"";renderRequests();ipcRenderer.send("browserAgentMock:respond",{requestId:requestId,statusCode:tpl.statusCode,contentType:tpl.contentType,body:tpl.body});};' +
    'window.__mockToggleRequest=function(id){if(expandedRequestId===id){expandedRequestId=null;}else{expandedRequestId=id;}renderRequests();};' +
    'window.__mockClearRequests=function(){expandedRequestId=null;state.requests=[];renderRequests();};' +
    'window.__mockDeleteRequest=function(id){state.requests=state.requests.filter(function(r){return r.id!==id;});if(expandedRequestId===id){expandedRequestId=null;}renderRequests();};' +
    'ipcRenderer.on("browserAgentMock:newRequest",function(_event,payload){const item={id:payload.id,method:payload.method,url:payload.url,source:payload.source,headers:payload.headers||{},query:payload.query||{},body:payload.body||"",receivedAt:payload.receivedAt,responded:false,responseTemplateName:null};state.requests.unshift(item);expandedRequestId=item.id;renderRequests();});' +
    'document.addEventListener("DOMContentLoaded",function(){initDefaultTemplates();renderTemplates();renderRequests();});'

  const html =
    '<!doctype html>' +
    '<html lang="zh-CN"><head><meta charset="utf-8" />' +
    '<title>Browser Agent Mock HTTP</title>' +
    '<style>' +
    style +
    '</style>' +
    '</head><body>' +
    '<div class="header"><div><div class="title">Browser Agent Mock HTTP</div><div class="subtitle">调试 /debug/mock-http 的请求与返回</div></div></div>' +
    '<div class="layout"><div class="side" id="requests"></div><div class="side right" id="templates"></div></div>' +
    '<script>' +
    script +
    '</script>' +
    '</body></html>'

  return html
}

function ensureMockHttpWindow() {
  if (mockHttpWindow && !mockHttpWindow.isDestroyed()) {
    try {
      mockHttpWindow.show()
      mockHttpWindow.focus()
    } catch {}
    return mockHttpWindow
  }

  mockHttpWindowReady = false
  mockHttpUiQueue = []

  const win = new BrowserWindow({
    width: 1120,
    height: 720,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  })

  mockHttpWindow = win

  try {
    win.setMenuBarVisibility(false)
  } catch {}

  win.on('closed', () => {
    mockHttpWindow = null
    mockHttpWindowReady = false
    mockHttpUiQueue = []
    try {
      for (const [, entry] of mockHttpPendingResponses) {
        try {
          entry.resolve(null)
        } catch {}
        if (entry.timer) {
          try {
            clearTimeout(entry.timer)
          } catch {}
        }
      }
    } catch {}
    mockHttpPendingResponses.clear()
  })

  const html = getMockHttpHtml()
  try {
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(() => {})
  } catch {}

  try {
    win.webContents.on('did-finish-load', () => {
      mockHttpWindowReady = true
      const pending = mockHttpUiQueue
      mockHttpUiQueue = []
      if (!mockHttpWindow || mockHttpWindow.isDestroyed()) return
      for (const item of pending) {
        try {
          mockHttpWindow.webContents.send(item.channel, item.payload)
        } catch {}
      }
    })
  } catch {}

  return win
}

function sendMockHttpUiEvent(channel, payload) {
  if (!mockHttpWindow || mockHttpWindow.isDestroyed()) return
  if (!mockHttpWindowReady) {
    mockHttpUiQueue.push({ channel, payload })
    return
  }
  try {
    mockHttpWindow.webContents.send(channel, payload)
  } catch {}
}

function waitForMockHttpResponse(requestId) {
  return new Promise((resolve) => {
    let finished = false
    let timer = null

    const done = (value) => {
      if (finished) return
      finished = true
      try {
        mockHttpPendingResponses.delete(requestId)
      } catch {}
      if (timer) {
        try {
          clearTimeout(timer)
        } catch {}
      }
      resolve(value)
    }

    try {
      timer = setTimeout(() => {
        try {
          appendBrowserAgentTextLog(
            `[MockHttp] waitForMockHttpResponse timeout requestId=${requestId}`
          )
        } catch {}
        done(null)
      }, MOCK_HTTP_TIMEOUT_MS)
    } catch {
      timer = null
    }

    mockHttpPendingResponses.set(requestId, { resolve: done, timer })
  })
}

function setupMockHttpIpc() {
  try {
    if (ipcMain.listenerCount('browserAgentMock:respond') > 0) {
      return
    }
  } catch {}

  ipcMain.on('browserAgentMock:respond', (_event, payload) => {
    try {
      if (!payload || typeof payload !== 'object') return
      const rawId = payload.requestId
      let requestId =
        typeof rawId === 'number'
          ? rawId
          : typeof rawId === 'string' && rawId.trim()
              ? Number(rawId)
              : NaN
      if (!Number.isFinite(requestId)) return
      const entry = mockHttpPendingResponses.get(requestId)
      if (!entry) return
      try {
        appendBrowserAgentTextLog(
          `[MockHttp] received UI response requestId=${requestId} statusCode=${payload.statusCode}`
        )
      } catch {}
      const value = {
        statusCode: payload.statusCode,
        contentType: payload.contentType,
        body: payload.body,
      }
      entry.resolve(value)
    } catch {}
  })
}

setupMockHttpIpc()

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

function buildPlaywrightErrorMeta(error, baseDetails) {
  const message =
    error && error.message
      ? String(error.message)
      : String(error || '')

  const baCodeRaw =
    error && typeof error === 'object' && typeof error.baCode === 'string'
      ? error.baCode
      : ''
  const baDetails =
    error &&
    typeof error === 'object' &&
    error.baDetails &&
    typeof error.baDetails === 'object'
      ? error.baDetails
      : null

  const errorCode = baCodeRaw || (isTimeoutError(error) ? 'TIMEOUT' : 'PLAYWRIGHT_ERROR')

  const errorDetails = {
    ...(baseDetails || {}),
    network: baDetails || null,
  }

  let httpStatus = 500
  if (errorCode === 'TIMEOUT') {
    httpStatus = 504
  } else if (errorCode === 'ANTI_BOT_PAGE') {
    httpStatus = 429
  } else if (
    errorCode === 'DNS_ERROR' ||
    errorCode === 'TLS_ERROR' ||
    errorCode === 'CONNECTION_ERROR' ||
    errorCode === 'HTTP_4XX' ||
    errorCode === 'HTTP_5XX' ||
    errorCode === 'UNKNOWN_NETWORK_ERROR'
  ) {
    httpStatus = 502
  }

  const status = errorCode === 'TIMEOUT' ? 'timeout' : 'failed'

  return { message, errorCode, errorDetails, httpStatus, status, network: baDetails }
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

  if (pathname === '/debug/mock-http') {
    if (req.method !== 'GET' && req.method !== 'POST') {
      handleMethodNotAllowed(res)
      return
    }

    const method = req.method || 'GET'
    const fullUrl = url.toString()

    try {
      appendBrowserAgentTextLog(
        `[MockHttp] incoming request method=${method} url=${fullUrl}`
      )
    } catch {}

    // 每次进入调试接口时都尝试打开或激活 Mock 窗口，便于观察请求与编辑返回模板
    try {
      ensureMockHttpWindow()
    } catch {}

    let source = ''
    try {
      const socket = req.socket
      const remoteAddress = socket && typeof socket.remoteAddress === 'string' ? socket.remoteAddress : ''
      const remotePort = socket && typeof socket.remotePort === 'number' ? String(socket.remotePort) : ''
      if (remoteAddress && remotePort) {
        source = `${remoteAddress}:${remotePort}`
      } else if (remoteAddress) {
        source = remoteAddress
      }
    } catch {}

    const headers = {}
    try {
      const rawHeaders = req.headers || {}
      for (const key of Object.keys(rawHeaders)) {
        const value = rawHeaders[key]
        headers[key] = value
      }
    } catch {}

    const query = {}
    try {
      for (const [k, v] of url.searchParams.entries()) {
        if (Object.prototype.hasOwnProperty.call(query, k)) {
          const existing = query[k]
          if (Array.isArray(existing)) {
            existing.push(v)
          } else {
            query[k] = [existing, v]
          }
        } else {
          query[k] = v
        }
      }
    } catch {}

    ;(async () => {
      try {
        let bodyText = ''
        if (method === 'POST') {
          try {
            // 调试接口允许更大的 body 大小（10MB），避免普通 JSON/表单因为 1MB 限制被拒绝
            bodyText = await readRequestBody(req, 10 * 1024 * 1024)
          } catch (error) {
            // 对于调试接口，即便读取 body 失败也不提前返回，而是将错误信息写入 bodyText 方便在 UI 中观察
            const message = error && error.message ? String(error.message) : String(error || '')
            bodyText = `[BODY_READ_ERROR] ${message}`
          }
        } else {
          try {
            req.resume()
          } catch {}
        }

        const requestId = nextMockHttpRequestId()

        const payload = {
          id: requestId,
          method,
          url: fullUrl,
          source,
          headers,
          query,
          body: bodyText,
          receivedAt: new Date().toISOString(),
        }

        try {
          appendBrowserAgentTextLog(
            `[MockHttp] send UI newRequest id=${requestId} method=${method} url=${fullUrl} bodyLength=${
              bodyText ? bodyText.length : 0
            }`
          )
          sendMockHttpUiEvent('browserAgentMock:newRequest', payload)
        } catch {}

        try {
          appendBrowserAgentTextLog(
            `[MockHttp] wait for UI response id=${requestId}`
          )
        } catch {}
        const resp = await waitForMockHttpResponse(requestId)

        if (!resp) {
          try {
            appendBrowserAgentTextLog(
              `[MockHttp] timeout or window closed id=${requestId}`
            )
          } catch {}
          if (res.writableEnded || res.destroyed) {
            return
          }
          sendError(res, 504, 'MOCK_TIMEOUT', 'Mock HTTP response timeout')
          return
        }

        const rawStatus = resp.statusCode
        const statusCode =
          typeof rawStatus === 'number' && Number.isFinite(rawStatus) && rawStatus >= 100 && rawStatus <= 999
            ? rawStatus
            : 200
        const rawBody = resp.body
        const body = typeof rawBody === 'string' ? rawBody : ''
        const rawType = resp.contentType
        const contentType =
          typeof rawType === 'string' && rawType
            ? rawType
            : 'application/json; charset=utf-8'

        const buf = Buffer.from(body, 'utf8')
        try {
          appendBrowserAgentTextLog(
            `[MockHttp] send HTTP response id=${requestId} status=${statusCode} contentLength=${buf.length}`
          )
        } catch {}
        res.statusCode = statusCode
        res.setHeader('Content-Type', contentType)
        res.setHeader('Content-Length', buf.length)
        res.end(buf)
      } catch (error) {
        const message = error && error.message ? String(error.message) : String(error || '')
        if (!res.writableEnded && !res.destroyed) {
          try {
            sendError(res, 500, 'MOCK_INTERNAL_ERROR', message)
          } catch {}
        }
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
            const baseErrorDetails = {
              sessionId,
              action: 'navigate',
              url: effectiveUrl,
              waitUntil,
              timeoutMs,
              onTimeout,
            }
            const { message, errorCode, errorDetails, httpStatus, status, network } =
              buildPlaywrightErrorMeta(error, baseErrorDetails)

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
                status,
                errorCode,
                errorMessage: message,
                snapshotId: null,
                httpStatus,
                network,
              })
            } catch {}

            if (errorCode === 'TIMEOUT' && onTimeout === 'screenshot_only') {
              try {
                await triggerAutoScreenshot(sessionId, 'navigate_timeout')
              } catch {}
            }

            if (errorCode === 'ANTI_BOT_PAGE') {
              try {
                await triggerAutoScreenshot(sessionId, 'navigate_antibot')
              } catch {}
            }

            sendError(res, httpStatus, errorCode, message, errorDetails)
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
              const baseErrorDetails = {
                sessionId,
                action: 'wait.selector',
                selector,
                state,
                timeoutMs,
                onTimeout,
              }
              const { message, errorCode, errorDetails, httpStatus, status, network } =
                buildPlaywrightErrorMeta(error, baseErrorDetails)

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
                  status,
                  errorCode,
                  errorMessage: message,
                  snapshotId: null,
                  httpStatus,
                  network,
                })
              } catch {}

              if (errorCode === 'TIMEOUT' && onTimeout === 'screenshot_only') {
                try {
                  await triggerAutoScreenshot(sessionId, 'wait.selector_timeout')
                } catch {}
              }

              sendError(res, httpStatus, errorCode, message, errorDetails)
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
              const baseErrorDetails = {
                sessionId,
                action: 'wait.text',
                text,
                scope,
                selector,
                timeoutMs,
                onTimeout,
              }
              const { message, errorCode, errorDetails, httpStatus, status, network } =
                buildPlaywrightErrorMeta(error, baseErrorDetails)

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
                  status,
                  errorCode,
                  errorMessage: message,
                  snapshotId: null,
                  httpStatus,
                  network,
                })
              } catch {}

              if (errorCode === 'TIMEOUT' && onTimeout === 'screenshot_only') {
                try {
                  await triggerAutoScreenshot(sessionId, 'wait.text_timeout')
                } catch {}
              }

              sendError(res, httpStatus, errorCode, message, errorDetails)
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
              const baseErrorDetails = {
                sessionId,
                action: 'wait.url',
                contains,
                equals,
                timeoutMs,
                onTimeout,
              }
              const { message, errorCode, errorDetails, httpStatus, status, network } =
                buildPlaywrightErrorMeta(error, baseErrorDetails)

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
                  status,
                  errorCode,
                  errorMessage: message,
                  snapshotId: null,
                  httpStatus,
                  network,
                })
              } catch {}

              if (errorCode === 'TIMEOUT' && onTimeout === 'screenshot_only') {
                try {
                  await triggerAutoScreenshot(sessionId, 'wait.url_timeout')
                } catch {}
              }

              sendError(res, httpStatus, errorCode, message, errorDetails)
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
