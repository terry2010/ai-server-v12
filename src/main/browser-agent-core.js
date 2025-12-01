const sessions = new Map()
let seq = 0

function nowIso() {
  return new Date().toISOString()
}

function generateSessionId() {
  seq += 1
  return `sess_${Date.now().toString(36)}_${seq.toString(36)}`
}

export function createSession(input) {
  const raw = input && typeof input === 'object' ? input : null
  const id = generateSessionId()

  const profile = raw && typeof raw.profile === 'string' ? raw.profile : null
  const clientId = raw && typeof raw.clientId === 'string' ? raw.clientId : 'local'
  const viewport = raw && raw.viewport && typeof raw.viewport === 'object' ? raw.viewport : null
  const userAgent = raw && typeof raw.userAgent === 'string' ? raw.userAgent : null

  const now = nowIso()

  const session = {
    id,
    profile,
    clientId,
    viewport,
    userAgent,
    status: 'running',
    windowId: null,
    visible: true,
    createdAt: now,
    lastActiveAt: now,
  }

  sessions.set(id, session)
  return session
}

export function listSessions(filter) {
  const f = filter && typeof filter === 'object' ? filter : null
  const profile = f && typeof f.profile === 'string' && f.profile ? f.profile : null
  const clientId = f && typeof f.clientId === 'string' && f.clientId ? f.clientId : null
  const status = f && typeof f.status === 'string' && f.status ? f.status : null

  const result = []
  for (const session of sessions.values()) {
    if (profile && session.profile !== profile) continue
    if (clientId && session.clientId !== clientId) continue
    if (status && session.status !== status) continue
    result.push(session)
  }
  return result
}

export function listAllSessions() {
  const result = []
  for (const session of sessions.values()) {
    result.push(session)
  }
  return result
}

export function getSession(sessionId) {
  if (!sessionId) return null
  const s = sessions.get(sessionId)
  return s || null
}

export function touchSession(sessionId) {
  const s = sessions.get(sessionId)
  if (!s) return null
  const updated = { ...s, lastActiveAt: nowIso() }
  sessions.set(sessionId, updated)
  return updated
}

export function closeSession(sessionId) {
  if (!sessionId) return null
  const s = sessions.get(sessionId)
  if (!s) return null
  const closed = { ...s, status: 'closed', visible: false, closedAt: nowIso() }
  sessions.delete(sessionId)
  return closed
}

export function setSessionWindowId(sessionId, windowId) {
  if (!sessionId) return null
  const s = sessions.get(sessionId)
  if (!s) return null
  let numericId = Number(windowId)
  if (!Number.isFinite(numericId) || numericId <= 0) {
    numericId = null
  }
  const updated = { ...s, windowId: numericId, lastActiveAt: nowIso() }
  sessions.set(sessionId, updated)
  return updated
}

export function showSession(sessionId) {
  if (!sessionId) return null
  const s = sessions.get(sessionId)
  if (!s) return null
  const updated = { ...s, visible: true, lastActiveAt: nowIso() }
  sessions.set(sessionId, updated)
  return updated
}

export function hideSession(sessionId) {
  if (!sessionId) return null
  const s = sessions.get(sessionId)
  if (!s) return null
  const updated = { ...s, visible: false, lastActiveAt: nowIso() }
  sessions.set(sessionId, updated)
  return updated
}
