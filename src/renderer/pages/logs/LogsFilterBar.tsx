import { Download, Filter, RefreshCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusDot } from '@/components/StatusDot'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import type { LogItem, LogLevel } from '../Logs'

interface LogsFilterBarProps {
  moduleFilter: 'all' | LogItem['module']
  levelFilter: 'all' | LogLevel
  timeRange: 'all' | '5m' | '30m' | '1h' | '24h'
  isAutoRefresh: boolean
  loading: boolean
  exporting: boolean
  onModuleFilterChange: (value: 'all' | LogItem['module']) => void
  onLevelFilterChange: (value: 'all' | LogLevel) => void
  onTimeRangeChange: (value: 'all' | '5m' | '30m' | '1h' | '24h') => void
  onToggleAutoRefresh: () => void
  onExport: () => void
  onClear: () => void
}

export function LogsFilterBar({
  moduleFilter,
  levelFilter,
  timeRange,
  isAutoRefresh,
  loading,
  exporting,
  onModuleFilterChange,
  onLevelFilterChange,
  onTimeRangeChange,
  onToggleAutoRefresh,
  onExport,
  onClear,
}: LogsFilterBarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">系统日志</h2>
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-700 dark:bg-slate-900/70 dark:text-slate-300">
          <StatusDot status={isAutoRefresh ? 'running' : 'stopped'} />
          <span>{isAutoRefresh ? '实时' : '已暂停'}</span>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-xl bg-white/90 px-2 py-1 text-slate-700 shadow-sm dark:bg-slate-900/70 dark:text-slate-100">
          <Filter className="mr-1 h-3 w-3 text-slate-500 dark:text-slate-400" />
          <Select
            value={moduleFilter}
            onValueChange={(v) => {
              onModuleFilterChange(v as 'all' | LogItem['module'])
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
              onLevelFilterChange(v as LogLevel | 'all')
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
        <div className="flex items-center gap-1 rounded-xl bg-white/90 px-2 py-1 text-slate-700 shadow-sm dark:bg-slate-900/70 dark:text-slate-100">
          <span className="text-[10px] text-slate-500 dark:text-slate-400">时间范围</span>
          <Select
            value={timeRange}
            onValueChange={(v) => {
              onTimeRangeChange(v as 'all' | '5m' | '30m' | '1h' | '24h')
            }}
          >
            <SelectTrigger className="h-8 w-40 text-[10px]">
              {timeRange === 'all'
                ? '全部'
                : timeRange === '5m'
                ? '最近 5 分钟'
                : timeRange === '30m'
                ? '最近 30 分钟'
                : timeRange === '1h'
                ? '最近 1 小时'
                : '最近 24 小时'}
            </SelectTrigger>
            <SelectContent className="min-w-[160px]">
              <SelectItem value="all">全部</SelectItem>
              <SelectItem value="5m">最近 5 分钟</SelectItem>
              <SelectItem value="30m">最近 30 分钟</SelectItem>
              <SelectItem value="1h">最近 1 小时</SelectItem>
              <SelectItem value="24h">最近 24 小时</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          size="sm"
          variant="outline"
          shine
          className="text-[11px] disabled:opacity-60 disabled:cursor-not-allowed"
          onClick={onToggleAutoRefresh}
          disabled={loading}
        >
          <RefreshCcw className={`mr-1 h-3 w-3 ${isAutoRefresh && !loading ? 'animate-spin' : ''}`} />
          {isAutoRefresh ? '停止刷新' : '开始刷新'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          shine
          className="text-[11px]"
          onClick={onExport}
          disabled={exporting}
        >
          <Download className="mr-1 h-3 w-3" /> {exporting ? '导出中…' : '导出日志'}
        </Button>
        <Button size="sm" variant="destructive" shine className="text-[11px]" onClick={onClear}>
          <Trash2 className="mr-1 h-3 w-3" /> 清空
        </Button>
      </div>
    </div>
  )
}
