import type { ReactNode } from 'react'

interface FieldProps {
  label: string
  description?: string
  children: ReactNode
}

export function Field({ label, description, children }: FieldProps) {
  return (
    <div className="space-y-1 text-xs">
      <div className="text-[11px] font-medium text-slate-700 dark:text-slate-200">{label}</div>
      {description && (
        <div className="text-[11px] text-slate-500 dark:text-slate-400">{description}</div>
      )}
      <div className="pt-1">{children}</div>
    </div>
  )
}
