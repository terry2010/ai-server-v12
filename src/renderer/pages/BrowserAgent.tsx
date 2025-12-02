import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, Clock, Eye, ExternalLink, Image as ImageIcon, Maximize2, RefreshCw } from 'lucide-react'
import type {
  BrowserAgentSessionSummary,
  BrowserAgentSessionDetail,
  BrowserAgentActionTimelineItem,
} from '../../shared/types'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { StatusDot } from '@/components/StatusDot'

function formatDateInputValue(date: string) {
  if (!date) return ''
  // 期望格式 YYYY-MM-DD，后端也使用该格式作为 NDJSON 文件名的一部分
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date
  try {
    const d = new Date(date)
    if (Number.isNaN(d.getTime())) return ''
    const pad = (n: number) => String(n).padStart(2, '0')
    const yyyy = d.getFullYear()
    const MM = pad(d.getMonth() + 1)
    const dd = pad(d.getDate())
    return `${yyyy}-${MM}-${dd}`
  } catch {
    return ''
  }
}

function getTodayDateString() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const yyyy = d.getFullYear()
  const MM = pad(d.getMonth() + 1)
  const dd = pad(d.getDate())
  return `${yyyy}-${MM}-${dd}`
}

function formatTime(value: string | null | undefined) {
  if (!value || typeof value !== 'string') return '—'
  // 尝试截取 "YYYY-MM-DD HH:mm:ss" 中的时间部分
  const m = value.match(/\d{2}:\d{2}:\d{2}/)
  if (m) return m[0]
  if (value.length >= 8) return value.slice(-8)
  return value
}

function formatDateTime(value: string | null | undefined) {
  if (!value || typeof value !== 'string') return '—'
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(value)) return value
  try {
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return value
    const pad = (n: number) => String(n).padStart(2, '0')
    const yyyy = d.getFullYear()
    const MM = pad(d.getMonth() + 1)
    const dd = pad(d.getDate())
    const hh = pad(d.getHours())
    const mm = pad(d.getMinutes())
    const ss = pad(d.getSeconds())
    return `${yyyy}-${MM}-${dd} ${hh}:${mm}:${ss}`
  } catch {
    return value
  }
}

function formatDurationMs(ms: number | null | undefined) {
  if (ms == null || Number.isNaN(ms) || ms < 0) return '—'
  if (ms < 1000) return `${ms} ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)} s`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds - m * 60)
  return `${m} 分 ${s} 秒`
}

function formatFileSize(size: number | null | undefined) {
  if (size == null || !Number.isFinite(size) || size < 0) return '未知大小'
  if (size < 1024) return `${size} B`
  const kb = size / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  const gb = mb / 1024
  return `${gb.toFixed(1)} GB`
}

function translateStatus(status: 'running' | 'closed' | 'error') {
  if (status === 'running') return '运行中'
  if (status === 'closed') return '已关闭'
  return '异常'
}

function translateActionType(type: string | null | undefined) {
  const t = (type || '').toLowerCase()
  if (t === 'navigate') return '打开页面'
  if (t === 'navigate.auto') return '页面跳转'
  if (t === 'click') return '点击元素'
  if (t === 'fill') return '输入文本'
  if (t === 'screenshot') return '截图'
  return type || '未知操作'
}

function buildActionSummary(action: BrowserAgentActionTimelineItem) {
  const type = (action.type || '').toLowerCase()
  const params: any = action.params || {}

  if (type === 'navigate') {
    return params && typeof params.url === 'string' && params.url
      ? `打开 URL：${params.url}`
      : '打开页面'
  }

  if (type === 'navigate.auto') {
    const url = params && typeof params.url === 'string' ? params.url : ''
    if (url) return `页面跳转到：${url}`
    return '页面跳转'
  }

  if (type === 'click') {
    if (params && typeof params.selector === 'string' && params.selector) {
      return `点击元素：${params.selector}`
    }
    return '点击元素'
  }

  if (type === 'fill') {
    const selector =
      params && typeof params.selector === 'string' && params.selector
        ? params.selector
        : ''
    const text = params && typeof params.text === 'string' ? params.text : ''
    const textPreview = text.length > 32 ? `${text.slice(0, 32)}…` : text
    if (selector && textPreview) {
      return `在 ${selector} 中输入：${textPreview}`
    }
    if (textPreview) {
      return `输入文本：${textPreview}`
    }
    return '输入文本'
  }

  if (type === 'screenshot') {
    const desc =
      params && typeof params.description === 'string' && params.description
        ? params.description
        : ''
    const mode =
      params && typeof params.mode === 'string' && params.mode ? params.mode : ''
    if (desc) return `截图：${desc}`
    if (mode) return `截图模式：${mode}`
    return '截图'
  }

  try {
    return JSON.stringify(params)
  } catch {
    return '—'
  }
}

export function BrowserAgentPage() {
  const [browserAgentEnabled, setBrowserAgentEnabled] = useState<boolean | null>(null)
  const [browserAgentPort, setBrowserAgentPort] = useState<number | null>(null)

  const [date, setDate] = useState<string>(() => getTodayDateString())
  const [statusFilter, setStatusFilter] = useState<'all' | 'running' | 'closed'>('all')
  const [keyword, setKeyword] = useState('')

  const [sessions, setSessions] = useState<BrowserAgentSessionSummary[]>([])
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [sessionsError, setSessionsError] = useState<string | null>(null)

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [detail, setDetail] = useState<BrowserAgentSessionDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  const [showingWindow, setShowingWindow] = useState(false)
  const [openingSnapshotId, setOpeningSnapshotId] = useState<string | null>(null)

  const [reloadFlag, setReloadFlag] = useState(0)
  const dateInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    let cancelled = false

    const loadSettings = async () => {
      try {
        const settings = await window.api.getSettings()
        if (cancelled || !settings) return
        const raw = settings.browserAgent || null
        const enabled = !!(raw && typeof raw.enabled === 'boolean' ? raw.enabled : false)
        let port = raw && typeof raw.port === 'number' && raw.port > 0 && raw.port < 65536 ? raw.port : 26080
        setBrowserAgentEnabled(enabled)
        setBrowserAgentPort(port)
      } catch {
        if (!cancelled) {
          setBrowserAgentEnabled(null)
          setBrowserAgentPort(null)
        }
      }
    }

    loadSettings()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setLoadingSessions(true)
      setSessionsError(null)
      try {
        if (!window.api || typeof window.api.browserAgentListSessions !== 'function') {
          throw new Error('Browser Agent IPC 尚未注册，请确认是通过桌面客户端运行，并已重新启动应用。')
        }
        const payload: any = {
          date,
          status: statusFilter,
        }
        const result = await window.api.browserAgentListSessions(payload)
        if (cancelled) return
        let items: BrowserAgentSessionSummary[] = (result && result.items) || []

        const kw = keyword.trim().toLowerCase()
        if (kw) {
          items = items.filter((s) => {
            const id = (s.sessionId || '').toLowerCase()
            const profile = (s.profile || '').toLowerCase()
            const clientId = (s.clientId || '').toLowerCase()
            const domain = (s as any).domain ? String((s as any).domain).toLowerCase() : ''
            return (
              id.includes(kw) ||
              (!!profile && profile.includes(kw)) ||
              (!!clientId && clientId.includes(kw)) ||
              (!!domain && domain.includes(kw))
            )
          })
        }

        setSessions(items)

        if (!selectedSessionId && items.length > 0) {
          setSelectedSessionId(items[0].sessionId)
        } else if (
          selectedSessionId &&
          items.length > 0 &&
          !items.some((s) => s.sessionId === selectedSessionId)
        ) {
          setSelectedSessionId(items[0].sessionId)
        } else if (items.length === 0) {
          setSelectedSessionId(null)
        }
      } catch (err: any) {
        if (!cancelled) {
          setSessions([])
          setSessionsError(err && err.message ? String(err.message) : '加载会话列表失败。')
        }
      } finally {
        if (!cancelled) {
          setLoadingSessions(false)
        }
      }
    }

    load()

    return () => {
      cancelled = true
    }
  }, [date, statusFilter, keyword, selectedSessionId, reloadFlag])

  // 简单轮询：每 15 秒自动尝试刷新一次当前日期下的列表
  useEffect(() => {
    const timer = window.setInterval(() => {
      setReloadFlag((v) => v + 1)
    }, 15000)

    return () => {
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      if (!selectedSessionId) {
        setDetail(null)
        setDetailError(null)
        return
      }

      setLoadingDetail(true)
      setDetailError(null)
      try {
        if (!window.api || typeof window.api.browserAgentGetSessionDetail !== 'function') {
          throw new Error('Browser Agent 详情 IPC 尚未注册，请确认是通过桌面客户端运行。')
        }
        const result = await window.api.browserAgentGetSessionDetail({
          sessionId: selectedSessionId,
          date,
        })
        if (cancelled) return
        if (!result) {
          setDetail(null)
          setDetailError('未找到该 Session 的详细信息（可能已被清理或日期不匹配）。')
        } else {
          setDetail(result)
        }
      } catch (err: any) {
        if (!cancelled) {
          setDetail(null)
          setDetailError(err && err.message ? String(err.message) : '加载 Session 详情失败。')
        }
      } finally {
        if (!cancelled) {
          setLoadingDetail(false)
        }
      }
    }

    load()

    return () => {
      cancelled = true
    }
  }, [selectedSessionId, date, reloadFlag])

  const selectedSummary = useMemo(() => {
    if (!selectedSessionId) return null
    return sessions.find((s) => s.sessionId === selectedSessionId) || null
  }, [sessions, selectedSessionId])

  const sessionFiles = detail && Array.isArray((detail as any).files) ? (detail as any).files : []

  const handleShowWindow = async () => {
    if (!selectedSessionId) return
    setShowingWindow(true)
    try {
      const result = await window.api.browserAgentShowSessionWindow(selectedSessionId)
      if (!result || !result.success) {
        const reason = result && result.reason
        let message = result && result.error ? result.error : '无法显示浏览器窗口。'
        if (!result || !result.error) {
          if (reason === 'invalid_session_id') {
            message = '无效的 Session ID，无法显示窗口。'
          } else if (reason === 'session_not_found') {
            message = 'Session 已不在内存中，可能应用已经重启或 Session 已结束。'
          } else if (reason === 'no_window_id') {
            message = '该 Session 没有关联窗口，可能从未成功打开过浏览器。'
          } else if (reason === 'window_closed') {
            message = '浏览器窗口已经关闭，无法再次显示。'
          }
        }
        toast.error(message)
      } else {
        toast.success('已尝试显示浏览器窗口，请切回桌面查看。')
      }
    } catch {
      toast.error('显示浏览器窗口失败，请稍后重试。')
    } finally {
      setShowingWindow(false)
    }
  }

  const handleOpenSnapshot = async (snapshotId: string) => {
    if (!snapshotId) return
    setOpeningSnapshotId(snapshotId)
    try {
      const result = await window.api.browserAgentOpenSnapshot({
        snapshotId,
        date,
      })
      if (!result || !result.success) {
        const message = result && result.error ? result.error : '打开截图失败，请检查文件是否仍然存在。'
        toast.error(message)
      }
    } catch {
      toast.error('打开截图失败，请稍后重试。')
    } finally {
      setOpeningSnapshotId((prev) => (prev === snapshotId ? null : prev))
    }
  }

  const effectiveDateValue = formatDateInputValue(date)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            AI 浏览器 · 会话观察
          </h2>
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-700 dark:bg-slate-900/80 dark:text-slate-200">
            <StatusDot
              status={browserAgentEnabled ? 'running' : 'stopped'}
            />
            <span>
              {browserAgentEnabled === null
                ? '状态未知'
                : browserAgentEnabled
                ? 'Browser Agent 已启用'
                : 'Browser Agent 未启用'}
            </span>
            {browserAgentPort != null && (
              <span className="ml-1 text-slate-400">端口 {browserAgentPort}</span>
            )}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-[11px] text-slate-700 dark:bg-slate-900/80 dark:text-slate-200">
            <CalendarDays className="mr-1 h-3 w-3 text-sky-500" />
            <input
              ref={dateInputRef}
              type="date"
              className="h-6 cursor-pointer rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              value={effectiveDateValue}
              onChange={(e) => {
                const v = e.target.value
                setDate(v || getTodayDateString())
              }}
              onClick={(e) => {
                try {
                  // 显式调起原生日期选择器，避免不同平台行为差异
                  ;(e.currentTarget as any).showPicker?.()
                } catch {}
              }}
            />
          </div>
          <select
            className="h-7 rounded-lg border border-slate-200 bg-white px-2 text-[11px] text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'running' | 'closed')}
          >
            <option value="all">全部状态</option>
            <option value="running">运行中</option>
            <option value="closed">已关闭</option>
          </select>
          <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 text-[11px] text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
            <SearchIcon />
            <input
              className="h-6 w-40 bg-transparent text-xs outline-none placeholder:text-slate-400"
              placeholder="搜索 session / profile / clientId / 域名"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,2.2fr)_minmax(0,3fr)]">
        <Card className="overflow-hidden">
          <CardHeader className="px-4 pt-4">
            <div className="flex items-center justify-between gap-2 text-xs">
              <div>
                <CardTitle className="text-sm">会话列表</CardTitle>
                <CardDescription>按日期从 NDJSON 中聚合出的会话记录，仅供只读观察。</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  {loadingSessions
                    ? '加载中…'
                    : `共 ${sessions.length} 条`}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                  onClick={() => setReloadFlag((v) => v + 1)}
                  disabled={loadingSessions}
                  aria-label="刷新会话列表"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loadingSessions ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-3 pb-3">
            <div className="max-h-[420px] space-y-2 overflow-auto pr-1 text-xs">
              {sessionsError && (
                <div className="rounded-md bg-red-50 px-2 py-1 text-[11px] text-red-600 dark:bg-red-500/10 dark:text-red-200">
                  {sessionsError}
                </div>
              )}
              {!sessionsError && !loadingSessions && sessions.length === 0 && (
                <div className="rounded-md bg-slate-50 px-2 py-2 text-[11px] text-slate-500 dark:bg-slate-900/60 dark:text-slate-400">
                  当前日期下暂无 Browser Agent 会话记录。
                </div>
              )}
              {sessions.map((s) => {
                const active = s.sessionId === selectedSessionId
                return (
                  <button
                    key={s.sessionId}
                    type="button"
                    className={`flex w-full items-start gap-2 rounded-xl border px-3 py-2 text-left text-[11px] transition-colors ${
                      active
                        ? 'border-sky-400 bg-sky-50 text-slate-900 shadow-sm dark:border-sky-400/80 dark:bg-sky-500/10 dark:text-slate-50'
                        : 'border-slate-200 bg-white hover:border-sky-300 hover:bg-sky-50/60 dark:border-slate-700 dark:bg-slate-900/80 dark:hover:border-sky-500/60 dark:hover:bg-slate-900'
                    }`}
                    onClick={() => setSelectedSessionId(s.sessionId)}
                  >
                    <div className="mt-0.5 flex flex-col items-center gap-1">
                      <StatusDot
                        status={s.status === 'running' ? 'running' : s.status === 'closed' ? 'stopped' : 'error'}
                      />
                      <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                        {s.actionsCount} 步
                      </span>
                    </div>
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="truncate font-mono text-[11px] text-slate-900 dark:text-slate-50">
                          {s.sessionId}
                        </div>
                        <span className="whitespace-nowrap text-[10px] text-slate-500 dark:text-slate-400">
                          {translateStatus(s.status)}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                        {s.profile && <span>profile: {s.profile}</span>}
                        {s.clientId && <span>client: {s.clientId}</span>}
                        {s.domain && <span>域名: {s.domain}</span>}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-400 dark:text-slate-500">
                        <span>
                          <Clock className="mr-1 inline-block h-3 w-3 align-middle text-slate-400" />
                          {formatDateTime(s.createdAt)}
                        </span>
                        {s.finishedAt && (
                          <span>
                            <span className="mx-1 text-slate-300">→</span>
                            {formatDateTime(s.finishedAt)}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="px-4 pt-4">
            <div className="flex items-center justify-between gap-2 text-xs">
              <div>
                <CardTitle className="text-sm">会话详情</CardTitle>
                <CardDescription>
                  仅从本地 NDJSON 元数据与截图文件中还原，不会重新执行历史操作。
                </CardDescription>
              </div>
              {selectedSummary && (
                <div className="flex flex-col items-end gap-1 text-[10px] text-slate-500 dark:text-slate-400">
                  <div className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-900/80">
                    <StatusDot
                      status={
                        selectedSummary.status === 'running'
                          ? 'running'
                          : selectedSummary.status === 'closed'
                          ? 'stopped'
                          : 'error'
                      }
                    />
                    <span>{translateStatus(selectedSummary.status)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-slate-400">
                    <span>
                      <Clock className="mr-1 inline-block h-3 w-3 align-middle" />
                      {formatDateTime(selectedSummary.createdAt)}
                    </span>
                    {selectedSummary.lastActionAt && (
                      <span>
                        最后动作：{formatDateTime(selectedSummary.lastActionAt)}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3 px-4 pb-4 pt-2 text-xs">
            {!selectedSessionId && (
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500 dark:bg-slate-900/70 dark:text-slate-400">
                请先在左侧选择一个 Session 进行查看。
              </div>
            )}

            {selectedSessionId && loadingDetail && (
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500 dark:bg-slate-900/70 dark:text-slate-400">
                正在加载 Session 详情…
              </div>
            )}

            {selectedSessionId && detailError && !loadingDetail && (
              <div className="rounded-lg bg-red-50 px-3 py-2 text-[11px] text-red-600 dark:bg-red-500/10 dark:text-red-200">
                {detailError}
              </div>
            )}

            {selectedSessionId && detail && !loadingDetail && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-700 dark:bg-slate-900/70 dark:text-slate-200">
                  <div className="space-y-1">
                    <div className="font-mono text-[11px] text-slate-900 dark:text-slate-50">
                      {detail.session.sessionId}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                      {detail.session.profile && <span>profile: {detail.session.profile}</span>}
                      {detail.session.clientId && <span>client: {detail.session.clientId}</span>}
                      {detail.session.domain && <span>域名: {detail.session.domain}</span>}
                      <span>动作数：{detail.session.actionsCount}</span>
                      {detail.session.lastActionType && (
                        <span>
                          最后动作：{translateActionType(detail.session.lastActionType)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 text-[10px] text-slate-500 dark:text-slate-300">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-[11px]"
                      disabled={showingWindow}
                      onClick={handleShowWindow}
                    >
                      <Maximize2 className="mr-1 h-3 w-3" />
                      {showingWindow ? '正在尝试显示…' : '显示浏览器窗口'}
                    </Button>
                    <div className="flex items-center gap-2 text-[10px] text-slate-400">
                      <ExternalLink className="h-3 w-3" />
                      <span>本页仅做可视化复盘，不会自动重新执行历史操作。</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-sky-100 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300">
                      <Eye className="h-3 w-3" />
                    </span>
                    <span>动作时间线（按时间顺序）</span>
                  </div>

                  {detail.actions.length === 0 && (
                    <div className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500 dark:bg-slate-900/70 dark:text-slate-400">
                      当前 Session 暂无记录到的动作。
                    </div>
                  )}

                  <div className="max-h-[360px] space-y-2 overflow-auto pr-1">
                    {detail.actions.map((action) => {
                      const hasScreenshot = !!action.screenshot
                      const isOpening = openingSnapshotId === action.snapshotId
                      return (
                        <div
                          key={action.id}
                          className="flex gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-100"
                        >
                          <div className="mt-0.5 flex flex-col items-center gap-1 text-[10px] text-slate-400 dark:text-slate-500">
                            <StatusDot
                              status={action.status === 'error' ? 'error' : 'running'}
                            />
                            <span>{formatTime(action.startAt || action.endAt)}</span>
                          </div>
                          <div className="flex-1 space-y-1">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[11px] font-semibold text-slate-900 dark:text-slate-50">
                                  {translateActionType(action.type)}
                                </span>
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                                  用时 {formatDurationMs(action.durationMs)}
                                </span>
                                {typeof action.httpStatus === 'number' &&
                                  Number.isFinite(action.httpStatus) && (
                                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                                      HTTP {action.httpStatus}
                                    </span>
                                  )}
                              </div>
                              {hasScreenshot && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                                  <ImageIcon className="h-3 w-3" />
                                  截图
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-700 dark:text-slate-200">
                              {buildActionSummary(action)}
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400">
                              {action.errorMessage && (
                                <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] text-red-600 dark:bg-red-500/10 dark:text-red-200">
                                  失败：{action.errorMessage}
                                </span>
                              )}
                              {hasScreenshot && action.screenshot && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-6 px-2 text-[10px]"
                                  disabled={isOpening}
                                  onClick={() => handleOpenSnapshot(action.screenshot!.snapshotId)}
                                >
                                  <Eye className="mr-1 h-3 w-3" />
                                  {isOpening ? '正在打开…' : '查看截图'}
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function SearchIcon() {
  return (
    <svg
      className="h-3 w-3 text-slate-400 dark:text-slate-500"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M11 5a6 6 0 104.472 10.03l3.249 3.248a1 1 0 001.415-1.414l-3.248-3.249A6 6 0 0011 5zm-4 6a4 4 0 118 0 4 4 0 01-8 0z"
        fill="currentColor"
      />
    </svg>
  )
}
