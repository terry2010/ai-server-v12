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
import { useTranslation } from 'react-i18next'

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

function formatDurationMs(
  ms: number | null | undefined,
  t: (key: string, options?: Record<string, any>) => string,
) {
  if (ms == null || Number.isNaN(ms) || ms < 0) return '—'
  if (ms < 1000) return t('browserAgent:timeline.durationMs', { ms })
  const seconds = ms / 1000
  if (seconds < 60) return t('browserAgent:timeline.durationSec', { sec: Number(seconds.toFixed(1)) })
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds - m * 60)
  return t('browserAgent:timeline.durationMinSec', { min: m, sec: s })
}

function formatFileSize(
  size: number | null | undefined,
  t: (key: string, options?: Record<string, any>) => string,
) {
  if (size == null || !Number.isFinite(size) || size < 0) return t('browserAgent:files.unknownSize')
  if (size < 1024) return t('browserAgent:files.sizeB', { value: size })
  const kb = size / 1024
  if (kb < 1024) return t('browserAgent:files.sizeKB', { value: Number(kb.toFixed(1)) })
  const mb = kb / 1024
  if (mb < 1024) return t('browserAgent:files.sizeMB', { value: Number(mb.toFixed(1)) })
  const gb = mb / 1024
  return t('browserAgent:files.sizeGB', { value: Number(gb.toFixed(1)) })
}

function translateStatus(
  status: 'running' | 'closed' | 'error',
  t: (key: string, options?: Record<string, any>) => string,
) {
  if (status === 'running') return t('browserAgent:status.running')
  if (status === 'closed') return t('browserAgent:status.closed')
  return t('browserAgent:status.error')
}

function translateActionType(
  type: string | null | undefined,
  t: (key: string, options?: Record<string, any>) => string,
) {
  const normalized = (type || '').toLowerCase()
  if (normalized === 'navigate') return t('browserAgent:actions.navigate')
  if (normalized === 'navigate.auto') return t('browserAgent:actions.navigateAuto')
  if (normalized === 'click') return t('browserAgent:actions.click')
  if (normalized === 'fill') return t('browserAgent:actions.fill')
  if (normalized === 'screenshot') return t('browserAgent:actions.screenshot')
  return type || t('browserAgent:actions.unknown')
}

function buildActionSummary(
  action: BrowserAgentActionTimelineItem,
  options: {
    redirectExpanded?: boolean
    onToggleRedirect?: () => void
    t: (key: string, options?: Record<string, any>) => string
  },
) {
  const type = (action.type || '').toLowerCase()
  const params: any = action.params || {}
  const t = options.t

  if (type === 'navigate') {
    const base =
      params && typeof params.url === 'string' && params.url
        ? t('browserAgent:redirectTable.baseNavigate', { url: params.url })
        : t('browserAgent:redirectTable.baseNavigateNoUrl')

    const rawChain = Array.isArray(params && params.redirectChain)
      ? params.redirectChain
      : null

    if (!rawChain || rawChain.length === 0) {
      return base
    }

    // 规范化重定向链数据，并根据时间戳估算每一步的耗时
    type ChainRow = {
      url: string
      statusCode: number | null
      timestamp: number | null
      durationMs: number | null
    }

    const rows: ChainRow[] = []
    let prevTs: number | null = null

    for (const item of rawChain as any[]) {
      if (!item || typeof item !== 'object') continue
      const url =
        typeof item.url === 'string' && item.url ? String(item.url) : ''
      const code =
        typeof item.statusCode === 'number' && Number.isFinite(item.statusCode)
          ? item.statusCode
          : null
      const tsRaw =
        typeof item.timestamp === 'string' && item.timestamp
          ? Date.parse(item.timestamp)
          : NaN
      const ts = Number.isNaN(tsRaw) ? null : tsRaw

      let durationMs: number | null = null
      if (ts != null && prevTs != null && ts >= prevTs) {
        durationMs = ts - prevTs
      }
      if (ts != null) {
        prevTs = ts
      }

      if (!url && code == null) continue
      rows.push({ url, statusCode: code, timestamp: ts, durationMs })
    }

    if (rows.length === 0) {
      return base
    }

    const redirectExpanded = options && options.redirectExpanded
    const onToggleRedirect = options && options.onToggleRedirect

    const visibleRows: ChainRow[] = []
    const total = rows.length
    const shouldCollapse = total > 3 && !redirectExpanded

    if (shouldCollapse) {
      // 仅展示第一步和最后一步，中间用一行“展开剩余 N 条重定向”表示
      visibleRows.push(rows[0])
    } else {
      visibleRows.push(...rows)
    }

    return (
      <div className="space-y-1">
        <div>{base}</div>
        <div className="mt-1 overflow-x-auto rounded-md bg-slate-50 px-2 py-1 text-[10px] text-slate-600 dark:bg-slate-900/40 dark:text-slate-300">
          <table className="min-w-full border-separate border-spacing-y-0.5">
            <thead>
              <tr className="text-left text-[10px] text-slate-400 dark:text-slate-500">
                <th className="w-[52px] pr-2 font-normal">{t('browserAgent:redirectTable.http')}</th>
                <th className="w-[80px] pr-2 font-normal">{t('browserAgent:redirectTable.duration')}</th>
                <th className="font-normal">{t('browserAgent:redirectTable.url')}</th>
              </tr>
            </thead>
            <tbody>
              {shouldCollapse && (
                <tr key="__first__">
                  <td className="align-top pr-2 text-slate-700 dark:text-slate-200">
                    {rows[0].statusCode != null ? rows[0].statusCode : '—'}
                  </td>
                  <td className="align-top pr-2 text-slate-500 dark:text-slate-400">
                    {rows[0].durationMs != null
                      ? formatDurationMs(rows[0].durationMs, t)
                      : '—'}
                  </td>
                  <td className="align-top break-all text-slate-700 dark:text-slate-200">
                    {rows[0].url || '—'}
                  </td>
                </tr>
              )}

              {shouldCollapse && total > 2 && (
                <tr key="__collapse__">
                  <td
                    colSpan={3}
                    className="cursor-pointer select-none py-0.5 text-center text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                    onClick={onToggleRedirect}
                  >
                    {t('browserAgent:redirectTable.collapseTip', {
                      total,
                      middle: total - 2,
                    })}
                  </td>
                </tr>
              )}

              {shouldCollapse ? (
                total > 1 && (
                  <tr key="__last__">
                    <td className="align-top pr-2 text-slate-700 dark:text-slate-200">
                      {rows[total - 1].statusCode != null
                        ? rows[total - 1].statusCode
                        : '—'}
                    </td>
                    <td className="align-top pr-2 text-slate-500 dark:text-slate-400">
                      {rows[total - 1].durationMs != null
                        ? formatDurationMs(rows[total - 1].durationMs, t)
                        : '—'}
                    </td>
                    <td className="align-top break-all text-slate-700 dark:text-slate-200">
                      {rows[total - 1].url || '—'}
                    </td>
                  </tr>
                )
              ) : (
                rows.map((row, idx) => (
                  <tr key={idx}>
                    <td className="align-top pr-2 text-slate-700 dark:text-slate-200">
                      {row.statusCode != null ? row.statusCode : '—'}
                    </td>
                    <td className="align-top pr-2 text-slate-500 dark:text-slate-400">
                      {row.durationMs != null
                        ? formatDurationMs(row.durationMs, t)
                        : '—'}
                    </td>
                    <td className="align-top break-all text-slate-700 dark:text-slate-200">
                      {row.url || '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {shouldCollapse && onToggleRedirect && (
          <div className="mt-0.5 text-[10px] text-slate-400 dark:text-slate-500">
            {t('browserAgent:redirectTable.hint')}
          </div>
        )}
      </div>
    )
  }

  if (type === 'navigate.auto') {
    const url = params && typeof params.url === 'string' ? params.url : ''
    if (url) return t('browserAgent:actions.navigateAutoTo', { url })
    return t('browserAgent:actions.navigateAuto')
  }

  if (type === 'click') {
    if (params && typeof params.selector === 'string' && params.selector) {
      return t('browserAgent:actions.clickWithSelector', { selector: params.selector })
    }
    return t('browserAgent:actions.click')
  }

  if (type === 'fill') {
    const selector =
      params && typeof params.selector === 'string' && params.selector
        ? params.selector
        : ''
    const text = params && typeof params.text === 'string' ? params.text : ''
    const textPreview = text.length > 32 ? `${text.slice(0, 32)}…` : text
    if (selector && textPreview) {
      return t('browserAgent:actions.fillWithSelector', {
        selector,
        text: textPreview,
      })
    }
    if (textPreview) {
      return t('browserAgent:actions.fillWithText', { text: textPreview })
    }
    return t('browserAgent:actions.fill')
  }

  if (type === 'screenshot') {
    const desc =
      params && typeof params.description === 'string' && params.description
        ? params.description
        : ''
    const mode =
      params && typeof params.mode === 'string' && params.mode ? params.mode : ''
    if (desc) return t('browserAgent:actions.screenshotWithDesc', { desc })
    if (mode) return t('browserAgent:actions.screenshotWithMode', { mode })
    return t('browserAgent:actions.screenshot')
  }

  try {
    return JSON.stringify(params)
  } catch {
    return '—'
  }
}

export function BrowserAgentPage() {
  const { t } = useTranslation('browserAgent')
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

  // 记录每条 navigate 动作的重定向链是否展开
  const [expandedRedirectActions, setExpandedRedirectActions] = useState<
    Record<string, boolean>
  >({})

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
          throw new Error(t('errors.ipcListNotRegistered'))
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
          setSessionsError(err && err.message ? String(err.message) : t('errors.loadSessionsFail'))
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
          throw new Error(t('errors.detailIpcNotRegistered'))
        }
        const result = await window.api.browserAgentGetSessionDetail({
          sessionId: selectedSessionId,
          date,
        })
        if (cancelled) return
        if (!result) {
          setDetail(null)
          setDetailError(t('errors.detailNotFound'))
        } else {
          setDetail(result)
        }
      } catch (err: any) {
        if (!cancelled) {
          setDetail(null)
          setDetailError(err && err.message ? String(err.message) : t('errors.loadDetailFail'))
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
        let message = result && result.error ? result.error : t('errors.showWindowDefault')
        if (!result || !result.error) {
          if (reason === 'invalid_session_id') {
            message = t('errors.showWindowInvalidSession')
          } else if (reason === 'session_not_found') {
            message = t('errors.showWindowNotFound')
          } else if (reason === 'no_window_id') {
            message = t('errors.showWindowNoWindow')
          } else if (reason === 'window_closed') {
            message = t('errors.showWindowClosed')
          }
        }
        toast.error(message)
      } else {
        toast.success(t('toasts.showWindowSuccess'))
      }
    } catch {
      toast.error(t('errors.showWindowFail'))
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
        toast.error(message || t('errors.openSnapshotFail'))
      }
    } catch {
      toast.error(t('errors.openSnapshotRetry'))
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
            {t('browserAgent:header.title')}
          </h2>
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-700 dark:bg-slate-900/80 dark:text-slate-200">
            <StatusDot
              status={browserAgentEnabled ? 'running' : 'stopped'}
            />
            <span>
              {browserAgentEnabled === null
                ? t('browserAgent:header.statusUnknown')
                : browserAgentEnabled
                ? t('browserAgent:header.statusEnabled')
                : t('browserAgent:header.statusDisabled')}
            </span>
            {browserAgentPort != null && (
              <span className="ml-1 text-slate-400">
                {t('browserAgent:header.portLabel', { port: browserAgentPort })}
              </span>
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
            <option value="all">{t('browserAgent:filters.statusAll')}</option>
            <option value="running">{t('browserAgent:filters.statusRunning')}</option>
            <option value="closed">{t('browserAgent:filters.statusClosed')}</option>
          </select>
          <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 text-[11px] text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
            <SearchIcon />
            <input
              className="h-6 w-40 bg-transparent text-xs outline-none placeholder:text-slate-400"
              placeholder={t('browserAgent:filters.searchPlaceholder')}
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
                <CardTitle className="text-sm">{t('browserAgent:list.title')}</CardTitle>
                <CardDescription>{t('browserAgent:list.description')}</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  {loadingSessions
                    ? t('browserAgent:list.loading')
                    : t('browserAgent:list.count', { count: sessions.length })}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                  onClick={() => setReloadFlag((v) => v + 1)}
                  disabled={loadingSessions}
                  aria-label={t('common:actions.refresh')}
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
                  {t('browserAgent:list.empty')}
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
                        status={
                          s.status === 'running'
                            ? 'running'
                            : s.status === 'closed'
                            ? 'stopped'
                            : 'error'
                        }
                      />
                      <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                        {t('browserAgent:list.steps', { count: s.actionsCount })}
                      </span>
                    </div>
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="truncate font-mono text-[11px] text-slate-900 dark:text-slate-50">
                          {s.sessionId}
                        </div>
                        <span className="whitespace-nowrap text-[10px] text-slate-500 dark:text-slate-400">
                          {translateStatus(s.status, t)}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                        {s.profile && <span>{t('browserAgent:list.profile', { value: s.profile })}</span>}
                        {s.clientId && <span>{t('browserAgent:list.client', { value: s.clientId })}</span>}
                        {s.domain && <span>{t('browserAgent:list.domain', { value: s.domain })}</span>}
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
                <CardTitle className="text-sm">{t('browserAgent:detail.title')}</CardTitle>
                <CardDescription>
                  {t('browserAgent:detail.description')}
                </CardDescription>
              </div>
              {selectedSummary && (
                <div className="flex flex-col items-end gap-2 text-[10px] text-slate-500 dark:text-slate-300">
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
                    <span>{translateStatus(selectedSummary.status, t)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-slate-400">
                    <span>
                      <Clock className="mr-1 inline-block h-3 w-3 align-middle" />
                      {formatDateTime(selectedSummary.createdAt)}
                    </span>
                    {selectedSummary.lastActionAt && (
                      <span>
                        {t('browserAgent:detail.lastAction', {
                          action: formatDateTime(selectedSummary.lastActionAt),
                        })}
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
                {t('browserAgent:detail.selectHint')}
              </div>
            )}

            {selectedSessionId && loadingDetail && (
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500 dark:bg-slate-900/70 dark:text-slate-400">
                {t('browserAgent:detail.loading')}
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
                      {detail.session.profile && (
                        <span>{t('browserAgent:list.profile', { value: detail.session.profile })}</span>
                      )}
                      {detail.session.clientId && (
                        <span>{t('browserAgent:list.client', { value: detail.session.clientId })}</span>
                      )}
                      {detail.session.domain && (
                        <span>{t('browserAgent:list.domain', { value: detail.session.domain })}</span>
                      )}
                      <span>{t('browserAgent:detail.sessionActions', { count: detail.session.actionsCount })}</span>
                      {detail.session.lastActionType && (
                        <span>
                          {t('browserAgent:detail.sessionLastAction', {
                            type: translateActionType(detail.session.lastActionType, t),
                          })}
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
                      {showingWindow ? t('browserAgent:detail.showWindowLoading') : t('browserAgent:detail.showWindow')}
                    </Button>
                    <div className="flex items-center gap-2 text-[10px] text-slate-400">
                      <ExternalLink className="h-3 w-3" />
                      <span>{t('browserAgent:detail.showWindowInfo')}</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-sky-100 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300">
                      <Eye className="h-3 w-3" />
                    </span>
                    <span>{t('browserAgent:timeline.title')}</span>
                  </div>

                  {detail.actions.length === 0 && (
                    <div className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500 dark:bg-slate-900/70 dark:text-slate-400">
                      {t('browserAgent:timeline.empty')}
                    </div>
                  )}

                  <div className="max-h-[360px] space-y-2 overflow-auto pr-1">
                    {detail.actions.map((action) => {
                      const hasScreenshot = !!action.screenshot
                      const isOpening = openingSnapshotId === action.snapshotId
                      const redirectExpanded = !!expandedRedirectActions[action.id]
                      const handleToggleRedirect = () => {
                        setExpandedRedirectActions((prev) => ({
                          ...prev,
                          [action.id]: !prev[action.id],
                        }))
                      }
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
                                  {translateActionType(action.type, t)}
                                </span>
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                                  {formatDurationMs(action.durationMs, t)}
                                </span>
                                {typeof action.httpStatus === 'number' &&
                                  Number.isFinite(action.httpStatus) && (
                                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                                      HTTP {action.httpStatus}
                                    </span>
                                  )}
                              </div>
                              {hasScreenshot && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] text-slate-500 dark:bg-sky-500/10 dark:text-sky-300">
                                  <ImageIcon className="h-3 w-3" />
                                  {t('browserAgent:actions.screenshot')}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-700 dark:text-slate-200">
                              {buildActionSummary(action, {
                                redirectExpanded,
                                onToggleRedirect: handleToggleRedirect,
                                t,
                              })}
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400">
                              {action.errorMessage && (
                                <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] text-red-600 dark:bg-red-500/10 dark:text-red-200">
                                  {t('browserAgent:errors.actionFailedPrefix')}
                                  {action.errorMessage}
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
                                  {isOpening
                                    ? t('browserAgent:files.openingSnapshot')
                                    : t('browserAgent:files.openSnapshot')}
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
