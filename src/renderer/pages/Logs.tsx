import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Download, Filter, RefreshCcw, Trash2 } from 'lucide-react'
import { GlassCard } from '@/components/GlassCard'
import { Button } from '@/components/ui/button'
import { StatusDot } from '@/components/StatusDot'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'

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

const levelColors: Record<LogLevel, string> = {
  error: 'bg-red-500 text-white',
  warn: 'bg-amber-400 text-slate-900',
  info: 'bg-sky-500 text-white',
  debug: 'bg-slate-600 text-slate-50',
}

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
  }, [moduleFilter, levelFilter, pageSize])

  useEffect(() => {
    let cancelled = false

    const fetchLogs = async () => {
      if (!cancelled) {
        setLoading(true)
      }
      try {
        const result = await window.api.getLogs({
          module: moduleFilter,
          level: levelFilter,
          page,
          pageSize,
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

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const handleExport = async () => {
    if (exporting) return
    setExporting(true)
    try {
      const result = await window.api.exportLogs({})
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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">系统日志</h2>
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-700 dark:bg-slate-900/70 dark:text-slate-300">
            <StatusDot status="running" />
            <span>实时</span>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-xl bg-white/90 px-2 py-1 text-slate-700 shadow-sm dark:bg-slate-900/70 dark:text-slate-100">
            <Filter className="mr-1 h-3 w-3 text-slate-500 dark:text-slate-400" />
            <Select
              value={moduleFilter}
              onValueChange={(v) => {
                setModuleFilter(v as any)
              }}
            >
              <SelectTrigger className="h-8 w-28">
                {moduleFilter === 'all'
                  ? '选择模块'
                  : moduleFilter === 'client'
                  ? 'client'
                  : moduleFilter === 'n8n'
                  ? 'n8n'
                  : moduleFilter === 'dify'
                  ? 'Dify'
                  : moduleFilter === 'oneapi'
                  ? 'OneAPI'
                  : 'RagFlow'}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="client">client</SelectItem>
                <SelectItem value="n8n">n8n</SelectItem>
                <SelectItem value="dify">Dify</SelectItem>
                <SelectItem value="oneapi">OneAPI</SelectItem>
                <SelectItem value="ragflow">RagFlow</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={levelFilter}
              onValueChange={(v) => {
                setLevelFilter(v as LogLevel | 'all')
              }}
            >
              <SelectTrigger className="h-8 w-28">
                {levelFilter === 'all' ? '选择日志级别' : levelFilter}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="error">error</SelectItem>
                <SelectItem value="warn">warn</SelectItem>
                <SelectItem value="info">info</SelectItem>
                <SelectItem value="debug">debug</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            size="sm"
            variant="outline"
            shine
            className="text-[11px] disabled:opacity-60 disabled:cursor-not-allowed"
            onClick={() => setReloadKey((key) => key + 1)}
            disabled={loading}
          >
            <RefreshCcw className={`mr-1 h-3 w-3 ${loading ? 'animate-spin' : ''}`} /> 刷新
          </Button>
          <Button
            size="sm"
            variant="outline"
            shine
            className="text-[11px]"
            onClick={handleExport}
            disabled={exporting}
          >
            <Download className="mr-1 h-3 w-3" /> {exporting ? '导出中…' : '导出日志'}
          </Button>
          <Button size="sm" variant="destructive" shine className="text-[11px]">
            <Trash2 className="mr-1 h-3 w-3" /> 清空
          </Button>
        </div>
      </div>

      <GlassCard className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 p-0 text-slate-800 dark:border-white/20 dark:bg-slate-950/80">
        <div className="font-mono text-[11px] text-slate-800 dark:text-slate-100">
          <Table className="min-w-full">
            <TableHeader className="sticky top-0 z-10 border-b border-slate-200 bg-slate-100/95 backdrop-blur-sm dark:border-slate-800/80 dark:bg-slate-900/95">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[110px]">时间</TableHead>
                <TableHead className="w-[70px]">级别</TableHead>
                <TableHead className="w-[160px]">模块 / 服务</TableHead>
                <TableHead>消息</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((log) => {
                const [datePart, timePart] = log.timestamp.split(' ')
                return (
                  <TableRow key={log.id}>
                    <TableCell className="tabular-nums text-slate-500 dark:text-slate-400">
                      <div className="flex flex-col leading-tight">
                        <span>{datePart}</span>
                        <span className="text-[10px] text-slate-400 dark:text-slate-500">{timePart}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex items-center rounded-full px-1 py-px text-[8px] font-semibold ${levelColors[log.level]}`}
                      >
                        {log.level.toUpperCase()}
                      </span>
                    </TableCell>
                    <TableCell className="text-slate-700 dark:text-slate-300">
                      <div className="flex flex-col leading-tight">
                        <span>{log.module}</span>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400">{log.service}</span>
                      </div>
                    </TableCell>
                    <TableCell className="truncate text-slate-800 dark:text-slate-100">{log.message}</TableCell>
                  </TableRow>
                )
              })}
              {total === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-6 text-center text-slate-500">
                    当前筛选条件下暂无日志。
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </GlassCard>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
        <span>
          共 {total} 条 · 每页 {pageSize} 条 · 第 {page} / {totalPages} 页
        </span>
        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-1 text-[10px] text-slate-500 sm:flex dark:text-slate-400 whitespace-nowrap">
            <span className="whitespace-nowrap">每页</span>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => {
                const raw = Number(v) || 20
                const next = Math.min(100, Math.max(3, raw))
                setPageSize(next)
              }}
            >
              <SelectTrigger className="h-8 w-14">
                {pageSize}
              </SelectTrigger>
              <SelectContent side="top">
                <SelectItem value="3">3</SelectItem>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="20">20</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
              </SelectContent>
            </Select>
            <span>条</span>
          </div>
          <Pagination className="w-auto">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  href="#"
                  aria-disabled={page === 1}
                  className={page === 1 ? 'pointer-events-none opacity-50' : ''}
                  onClick={(e) => {
                    e.preventDefault()
                    if (page > 1) setPage(page - 1)
                  }}
                />
              </PaginationItem>
              {Array.from({ length: totalPages }).map((_, index) => {
                const p = index + 1
                return (
                  <PaginationItem key={p}>
                    <PaginationLink
                      href="#"
                      isActive={p === page}
                      onClick={(e) => {
                        e.preventDefault()
                        setPage(p)
                      }}
                    >
                      {p}
                    </PaginationLink>
                  </PaginationItem>
                )
              })}
              <PaginationItem>
                <PaginationNext
                  href="#"
                  aria-disabled={page === totalPages}
                  className={page === totalPages ? 'pointer-events-none opacity-50' : ''}
                  onClick={(e) => {
                    e.preventDefault()
                    if (page < totalPages) setPage(page + 1)
                  }}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      </div>
    </div>
  )
}
