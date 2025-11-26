import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SelectContextValue {
  open: boolean
  setOpen: (open: boolean) => void
  onValueChange?: (value: string) => void
}

const SelectContext = React.createContext<SelectContextValue | undefined>(undefined)

function useSelectContext() {
  const ctx = React.useContext(SelectContext)
  if (!ctx) throw new Error('Select components must be used within <Select>')
  return ctx
}

export interface SelectProps {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  children: React.ReactNode
}

export function Select({ value, defaultValue, onValueChange, children }: SelectProps) {
  const [open, setOpen] = React.useState(false)
  const [internalValue, setInternalValue] = React.useState(defaultValue)
  const containerRef = React.useRef<HTMLDivElement | null>(null)

  const handleChange = (next: string) => {
    if (value === undefined) {
      setInternalValue(next)
    }
    onValueChange?.(next)
    setOpen(false)
  }

  React.useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null
      if (!containerRef.current || !target) return
      if (!containerRef.current.contains(target)) {
        setOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <SelectContext.Provider value={{ open, setOpen, onValueChange: handleChange }}>
      <div ref={containerRef} className="relative inline-flex">
        {children}
      </div>
    </SelectContext.Provider>
  )
}

export interface SelectTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {}

export const SelectTrigger = React.forwardRef<HTMLButtonElement, SelectTriggerProps>(
  ({ className, children, ...props }, ref) => {
    const { open, setOpen } = useSelectContext()
    return (
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          'inline-flex h-8 w-full items-center justify-between gap-1 rounded-lg border border-slate-200 bg-white px-2 text-[11px] text-slate-800 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100',
          className,
        )}
        {...props}
      >
        <span className="truncate text-left">{children}</span>
        <ChevronDown className="h-3 w-3 opacity-60" />
      </button>
    )
  },
)
SelectTrigger.displayName = 'SelectTrigger'

export interface SelectContentProps extends React.HTMLAttributes<HTMLDivElement> {
  side?: 'top' | 'bottom'
}

export const SelectContent = React.forwardRef<HTMLDivElement, SelectContentProps>(
  ({ className, children, side = 'bottom', ...props }, ref) => {
    const { open, setOpen } = useSelectContext()
    if (!open) return null

    const positionClasses =
      side === 'top' ? 'bottom-full mb-1' : 'top-full'

    return (
      <div
        ref={ref}
        className={cn(
          'absolute left-0 z-20 max-h-60 min-w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 text-[11px] shadow-lg dark:border-slate-700 dark:bg-slate-900',
          positionClasses,
          className,
        )}
        onMouseLeave={() => setOpen(false)}
        {...props}
      >
        {children}
      </div>
    )
  },
)
SelectContent.displayName = 'SelectContent'

export interface SelectItemProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string
}

export const SelectItem = React.forwardRef<HTMLDivElement, SelectItemProps>(
  ({ value, className, children, ...props }, ref) => {
    const { onValueChange } = useSelectContext()

    return (
      <div
        ref={ref}
        role="option"
        data-value={value}
        onClick={(event) => {
          onValueChange?.(value)
          props.onClick?.(event)
        }}
        className={cn(
          'flex cursor-pointer select-none items-center px-3 py-1.5 text-[11px] text-slate-700 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    )
  },
)
SelectItem.displayName = 'SelectItem'
