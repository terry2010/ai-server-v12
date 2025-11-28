import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { LogsFilterBar } from './logs/LogsFilterBar'
import { LogsTable } from './logs/LogsTable'
import { LogsPaginationBar } from './logs/LogsPaginationBar'

export type LogLevel = 'error' | 'warn' | 'info' | 'debug'

export interface LogItem {
  id: number
  timestamp: string
  level: LogLevel
  module: 'client' | 'n8n' | 'dify' | 'oneapi' | 'ragflow' | 'system'
  service: string
  message: string
}

const mockLogs: LogItem[] = [
  {
    id: 1,
    timestamp: '2025-09-16 19:22:10',
    level: 'info',
    module: 'client',
    service: 'ui-shell',
    message: '应用启动完成，用时 1324ms。',
  },
  {
    id: 2,
    timestamp: '2025-09-16 19:22:12',
    level: 'info',
    module: 'n8n',
    service: 'container-n8n',
    message: '容器启动，监听端口 5678。',
  },
  {
    id: 3,
    timestamp: '2025-09-16 19:22:20',
    level: 'warn',
    module: 'dify',
    service: 'container-dify',
    message: '检测到本地端口 8081 已被占用，尝试使用 8082。',
  },
  {
    id: 4,
    timestamp: '2025-09-16 19:22:35',
    level: 'error',
    module: 'ragflow',
    service: 'container-ragflow',
    message: '数据库连接失败，请检查 RAG_FLOW_DB_URL 配置。',
  },
  {
    id: 5,
    timestamp: '2025-09-16 19:23:01',
    level: 'debug',
    module: 'oneapi',
    service: 'container-oneapi',
    message: '下游模型服务健康检查通过，延迟 132ms。',
  },
  {
    id: 6,
    timestamp: '2025-09-16 19:24:10',
    level: 'info',
    module: 'client',
    service: 'ui-shell',
    message: '用户登录成功，账号 terry。',
  },
  {
    id: 7,
    timestamp: '2025-09-16 19:24:25',
    level: 'debug',
    module: 'n8n',
    service: 'container-n8n',
    message: '定时工作流心跳检测通过。',
  },
  {
    id: 8,
    timestamp: '2025-09-16 19:24:40',
    level: 'info',
    module: 'dify',
    service: 'container-dify',
    message: '加载应用模板列表成功，数量 12。',
  },
  {
    id: 9,
    timestamp: '2025-09-16 19:25:02',
    level: 'warn',
    module: 'oneapi',
    service: 'container-oneapi',
    message: '检测到上游模型 QPS 接近上限。',
  },
  {
    id: 10,
    timestamp: '2025-09-16 19:25:18',
    level: 'info',
    module: 'ragflow',
    service: 'container-ragflow',
    message: '知识库索引重建完成，用时 4.2s。',
  },
  {
    id: 11,
    timestamp: '2025-09-16 19:26:01',
    level: 'error',
    module: 'oneapi',
    service: 'container-oneapi',
    message: '请求 OpenAI 失败，请检查 API Key。',
  },
  {
    id: 12,
    timestamp: '2025-09-16 19:26:35',
    level: 'debug',
    module: 'client',
    service: 'ui-shell',
    message: '渲染 Dashboard 完成。',
  },
  {
    id: 13,
    timestamp: '2025-09-16 19:27:02',
    level: 'info',
    module: 'n8n',
    service: 'container-n8n',
    message: '同步工作流配置到磁盘。',
  },
  {
    id: 14,
    timestamp: '2025-09-16 19:27:30',
    level: 'warn',
    module: 'dify',
    service: 'container-dify',
    message: '缓存命中率低于 60%，建议检查向量索引。',
  },
  {
    id: 15,
    timestamp: '2025-09-16 19:28:05',
    level: 'info',
    module: 'ragflow',
    service: 'container-ragflow',
    message: '新文档导入任务开始，队列长度 8。',
  },
  {
    id: 16,
    timestamp: '2025-09-16 19:28:46',
    level: 'debug',
    module: 'oneapi',
    service: 'container-oneapi',
    message: '路由到模型 openai:gpt-4o，温度 0.2。',
  },
  {
    id: 17,
    timestamp: '2025-09-16 19:29:10',
    level: 'info',
    module: 'client',
    service: 'ui-shell',
    message: '用户打开系统设置页面。',
  },
  {
    id: 18,
    timestamp: '2025-09-16 19:29:32',
    level: 'warn',
    module: 'n8n',
    service: 'container-n8n',
    message: '某个工作流执行时间超过 5 秒。',
  },
  {
    id: 19,
    timestamp: '2025-09-16 19:30:01',
    level: 'info',
    module: 'dify',
    service: 'container-dify',
    message: '应用「客服对话助手」收到新会话请求。',
  },
  {
    id: 20,
    timestamp: '2025-09-16 19:30:40',
    level: 'debug',
    module: 'ragflow',
    service: 'container-ragflow',
    message: '向量检索延迟 78ms。',
  },
  {
    id: 21,
    timestamp: '2025-09-16 19:31:05',
    level: 'info',
    module: 'oneapi',
    service: 'container-oneapi',
    message: '刷新模型配置信息成功。',
  },
  {
    id: 22,
    timestamp: '2025-09-16 19:31:40',
    level: 'error',
    module: 'client',
    service: 'ui-shell',
    message: '渲染模块卡片时发生未知错误。',
  },
  {
    id: 23,
    timestamp: '2025-09-16 19:32:12',
    level: 'info',
    module: 'n8n',
    service: 'container-n8n',
    message: '工作流队列为空。',
  },
  {
    id: 24,
    timestamp: '2025-09-16 19:32:45',
    level: 'warn',
    module: 'dify',
    service: 'container-dify',
    message: '发现未配置的模型密钥，跳过相关应用。',
  },
  {
    id: 25,
    timestamp: '2025-09-16 19:33:08',
    level: 'info',
    module: 'ragflow',
    service: 'container-ragflow',
    message: '定时清理过期索引任务完成。',
  },
  {
    id: 26,
    timestamp: '2025-09-16 19:33:40',
    level: 'debug',
    module: 'oneapi',
    service: 'container-oneapi',
    message: '上游模型 openai:gpt-4o 响应头解析完成。',
  },
]

export function LogsPage() {
  const [searchParams] = useSearchParams()
  const [moduleFilter, setModuleFilter] = useState<'all' | LogItem['module']>('all')
  const [levelFilter, setLevelFilter] = useState<'all' | LogLevel>('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [items, setItems] = useState<LogItem[]>([])
  const [total, setTotal] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [loading, setLoading] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [isAutoRefresh, setIsAutoRefresh] = useState(true)
  const refreshTimerRef = useRef<number | null>(null)
  const [timeRange, setTimeRange] = useState<'all' | '5m' | '30m' | '1h' | '24h'>('all')

  useEffect(() => {
    const qp = searchParams.get('module') as LogItem['module'] | null
    const allowed: LogItem['module'][] = ['client', 'n8n', 'dify', 'oneapi', 'ragflow', 'system']
    if (qp && allowed.includes(qp)) {
      setModuleFilter(qp)
    } else {
      setModuleFilter('all')
    }
  }, [searchParams])

  useEffect(() => {
    setPage(1)
  }, [moduleFilter, levelFilter, pageSize, timeRange])

  useEffect(() => {
    let cancelled = false

    const fetchLogs = async () => {
      if (!cancelled) {
        setLoading(true)
      }
      try {
        let start: string | undefined
        let end: string | undefined

        if (timeRange !== 'all') {
          const now = new Date()
          const from = new Date(now.getTime())

          if (timeRange === '5m') {
            from.setMinutes(from.getMinutes() - 5)
          } else if (timeRange === '30m') {
            from.setMinutes(from.getMinutes() - 30)
          } else if (timeRange === '1h') {
            from.setHours(from.getHours() - 1)
          } else if (timeRange === '24h') {
            from.setDate(from.getDate() - 1)
          }

          const format = (d: Date) => {
            const pad = (n: number) => String(n).padStart(2, '0')
            const yyyy = d.getFullYear()
            const MM = pad(d.getMonth() + 1)
            const dd = pad(d.getDate())
            const hh = pad(d.getHours())
            const mm = pad(d.getMinutes())
            const ss = pad(d.getSeconds())
            return `${yyyy}-${MM}-${dd} ${hh}:${mm}:${ss}`
          }

          start = format(from)
          end = format(now)
        }

        const result = await window.api.getLogs({
          module: moduleFilter,
          level: levelFilter,
          page,
          pageSize,
          startTime: start,
          endTime: end,
        })
        if (!cancelled) {
          setItems(result.items)
          setTotal(result.total)
        }
      } catch (_err) {
        if (!cancelled) {
          setItems([])
          setTotal(0)
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    fetchLogs()

    return () => {
      cancelled = true
    }
  }, [moduleFilter, levelFilter, page, pageSize, reloadKey])

  useEffect(() => {
    const start = () => {
      if (refreshTimerRef.current != null) {
        window.clearInterval(refreshTimerRef.current)
      }
      refreshTimerRef.current = window.setInterval(() => {
        setReloadKey((key) => key + 1)
      }, 1000)
    }

    const stop = () => {
      if (refreshTimerRef.current != null) {
        window.clearInterval(refreshTimerRef.current)
        refreshTimerRef.current = null
      }
    }

    if (isAutoRefresh) {
      start()
    } else {
      stop()
    }

    return () => {
      stop()
    }
  }, [isAutoRefresh])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const handleExport = async () => {
    if (exporting) return
    setExporting(true)
    try {
      let start: string | undefined
      let end: string | undefined

      if (timeRange !== 'all') {
        const now = new Date()
        const from = new Date(now.getTime())

        if (timeRange === '5m') {
          from.setMinutes(from.getMinutes() - 5)
        } else if (timeRange === '30m') {
          from.setMinutes(from.getMinutes() - 30)
        } else if (timeRange === '1h') {
          from.setHours(from.getHours() - 1)
        } else if (timeRange === '24h') {
          from.setDate(from.getDate() - 1)
        }

        const format = (d: Date) => {
          const pad = (n: number) => String(n).padStart(2, '0')
          const yyyy = d.getFullYear()
          const MM = pad(d.getMonth() + 1)
          const dd = pad(d.getDate())
          const hh = pad(d.getHours())
          const mm = pad(d.getMinutes())
          const ss = pad(d.getSeconds())
          return `${yyyy}-${MM}-${dd} ${hh}:${mm}:${ss}`
        }

        start = format(from)
        end = format(now)
      }

      const result = await window.api.exportLogs({
        startTime: start,
        endTime: end,
        module: moduleFilter === 'all' ? undefined : moduleFilter,
        level: levelFilter === 'all' ? undefined : levelFilter,
      })
      if (result && result.success) {
        window.alert(`日志已导出到：${result.path}`)
      } else {
        window.alert('日志导出失败，请稍后重试。')
      }
    } catch (_err) {
      window.alert('日志导出失败，请稍后重试。')
    } finally {
      setExporting(false)
    }
  }

  const handleClear = async () => {
    try {
      await window.api.clearLogs()
      setPage(1)
      setReloadKey((key) => key + 1)
    } catch {
      // ignore
    }
  }

  return (
    <div className="space-y-3">
      <LogsFilterBar
        moduleFilter={moduleFilter}
        levelFilter={levelFilter}
        timeRange={timeRange}
        isAutoRefresh={isAutoRefresh}
        loading={loading}
        exporting={exporting}
        onModuleFilterChange={(v) => setModuleFilter(v)}
        onLevelFilterChange={(v) => setLevelFilter(v)}
        onTimeRangeChange={(v) => setTimeRange(v)}
        onToggleAutoRefresh={() => {
          setIsAutoRefresh((prev) => {
            const next = !prev
            if (!prev && next) {
              setPage(1)
              setReloadKey((key) => key + 1)
            }
            return next
          })
        }}
        onExport={handleExport}
        onClear={handleClear}
      />

      <LogsTable items={items} total={total} />

      <LogsPaginationBar
        page={page}
        pageSize={pageSize}
        total={total}
        totalPages={totalPages}
        onPageChange={(p) => setPage(p)}
        onPageSizeChange={(size) => setPageSize(size)}
      />
    </div>
  )
}
