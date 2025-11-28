import { GlassCard } from '@/components/GlassCard'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { LogItem, LogLevel } from '../Logs'

const levelColors: Record<LogLevel, string> = {
  error: 'bg-red-500 text-white',
  warn: 'bg-amber-400 text-slate-900',
  info: 'bg-sky-500 text-white',
  debug: 'bg-slate-600 text-slate-50',
}

interface LogsTableProps {
  items: LogItem[]
  total: number
}

export function LogsTable({ items, total }: LogsTableProps) {
  return (
    <GlassCard className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 p-0 text-slate-800 dark:border-white/20 dark:bg-slate-950/80">
      <div className="font-mono text-[11px] text-slate-800 dark:text-slate-100">
        <Table className="min-w-full">
          <TableHeader className="sticky top-0 z-10 border-b border-slate-200 bg-slate-100/95 backdrop-blur-sm dark:border-slate-800/80 dark:bg-slate-900/95">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[110px]">时间</TableHead>
              <TableHead className="w-[70px]">级别</TableHead>
              <TableHead className="w-[170px] whitespace-nowrap">模块 / 服务</TableHead>
              <TableHead>消息</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((log) => {
              const [datePart, timePart] = log.timestamp.split(' ')
              return (
                <TableRow key={log.id}>
                  <TableCell className="tabular-nums text-slate-800 dark:text-slate-100">
                    <div className="flex flex-col leading-tight">
                      <span className="text-[10px] text-slate-400 dark:text-slate-500">{datePart}</span>
                      <span className="text-xs font-medium text-slate-800 dark:text-slate-100">{timePart}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full px-1 py-px text-[8px] font-semibold ${levelColors[log.level]}`}
                    >
                      {log.level.toUpperCase()}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-slate-700 dark:text-slate-300">
                    <div className="flex flex-col leading-tight">
                      <span>{log.module}</span>
                      <span className="text-[10px] text-slate-500 dark:text-slate-400">{log.service}</span>
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-pre-wrap break-words text-slate-800 dark:text-slate-100">
                    {log.message}
                  </TableCell>
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
  )
}
