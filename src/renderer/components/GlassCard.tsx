import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export function GlassCard({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-2xl border backdrop-blur-lg shadow-lg shadow-black/10',
        'bg-white/80 border-white/30 text-slate-900',
        'dark:bg-slate-900/75 dark:border-slate-700/80 dark:text-slate-50',
        'transition-all duration-200',
        className,
      )}
      {...props}
    />
  )
}
