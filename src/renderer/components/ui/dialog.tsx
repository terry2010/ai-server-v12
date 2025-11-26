import * as React from 'react'
import { cn } from '@/lib/utils'

interface DialogContextValue {
  open: boolean
  setOpen: (open: boolean) => void
}

const DialogContext = React.createContext<DialogContextValue | undefined>(undefined)

function useDialogContext() {
  const ctx = React.useContext(DialogContext)
  if (!ctx) throw new Error('Dialog components must be used within <Dialog>')
  return ctx
}

export interface DialogProps {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  children: React.ReactNode
}

export function Dialog({ open: controlledOpen, defaultOpen, onOpenChange, children }: DialogProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(!!defaultOpen)
  const open = controlledOpen ?? uncontrolledOpen

  const setOpen = (value: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(value)
    onOpenChange?.(value)
  }

  return <DialogContext.Provider value={{ open, setOpen }}>{children}</DialogContext.Provider>
}

export interface DialogTriggerProps extends React.HTMLAttributes<HTMLButtonElement> {
  asChild?: boolean
}

export const DialogTrigger = React.forwardRef<HTMLButtonElement, DialogTriggerProps>(
  ({ asChild, children, ...props }, ref) => {
    const { setOpen } = useDialogContext()

    if (asChild && React.isValidElement(children)) {
      return React.cloneElement(children as any, {
        ref,
        onClick: (event: React.MouseEvent) => {
          children.props.onClick?.(event)
          if (!event.defaultPrevented) setOpen(true)
        },
      })
    }

    return (
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen(true)}
        {...props}
      >
        {children}
      </button>
    )
  },
)
DialogTrigger.displayName = 'DialogTrigger'

export interface DialogContentProps extends React.HTMLAttributes<HTMLDivElement> {}

export const DialogContent = React.forwardRef<HTMLDivElement, DialogContentProps>(
  ({ className, children, ...props }, ref) => {
    const { open, setOpen } = useDialogContext()

    if (!open) return null

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div
          className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        />
        <div
          ref={ref}
          className={cn(
            'relative z-10 w-full max-w-md rounded-2xl bg-white/90 p-6 shadow-2xl shadow-black/40',
            className,
          )}
          {...props}
        >
          {children}
        </div>
      </div>
    )
  },
)
DialogContent.displayName = 'DialogContent'

export interface DialogHeaderProps extends React.HTMLAttributes<HTMLDivElement> {}

export const DialogHeader = ({ className, ...props }: DialogHeaderProps) => (
  <div className={cn('mb-4 space-y-1', className)} {...props} />
)

export interface DialogTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {}

export const DialogTitle = ({ className, ...props }: DialogTitleProps) => (
  <h2 className={cn('text-base font-semibold', className)} {...props} />
)

export interface DialogDescriptionProps extends React.HTMLAttributes<HTMLParagraphElement> {}

export const DialogDescription = ({ className, ...props }: DialogDescriptionProps) => (
  <p className={cn('text-sm text-muted', className)} {...props} />
)

export interface DialogFooterProps extends React.HTMLAttributes<HTMLDivElement> {}

export const DialogFooter = ({ className, ...props }: DialogFooterProps) => (
  <div className={cn('mt-6 flex justify-end gap-2', className)} {...props} />
)
