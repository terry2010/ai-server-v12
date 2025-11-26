import { cn } from '@/lib/utils'

export type ServiceStatus = 'running' | 'stopped' | 'starting' | 'stopping' | 'error'

export interface StatusDotProps {
  status: ServiceStatus
  className?: string
}

export function StatusDot({ status, className }: StatusDotProps) {
  const base =
    'inline-flex h-2.5 w-2.5 rounded-full shadow-sm ring-2 ring-white/60 ring-offset-[1px] ring-offset-slate-900/40'

  const colorByStatus: Record<ServiceStatus, string> = {
    running: 'bg-gradient-to-r from-emerald-400 to-sky-400 animate-pulse',
    stopped: 'bg-slate-400',
    starting: 'bg-gradient-to-r from-amber-300 to-amber-400 animate-pulse',
    stopping: 'bg-slate-400 animate-pulse',
    error: 'bg-destructive animate-status-error',
  }

  return <span className={cn(base, colorByStatus[status], className)} />
}
