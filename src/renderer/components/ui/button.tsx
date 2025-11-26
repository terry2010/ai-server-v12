import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'relative inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium',
  {
    variants: {
      variant: {
        default:
          'bg-gradient-to-r from-primary to-primary/80 text-primary-foreground shadow-sm hover:-translate-y-0.5 hover:shadow-glass dark:from-sky-400 dark:to-sky-300 dark:text-slate-900 dark:shadow-md dark:hover:shadow-lg',
        outline:
          'border border-white/40 bg-white/10 text-foreground shadow-sm hover:bg-white/20 hover:-translate-y-0.5 dark:border-slate-600 dark:bg-slate-900/40 dark:text-slate-100 dark:hover:bg-slate-800/80',
        ghost:
          'text-foreground/80 hover:bg-white/20 hover:text-foreground dark:text-slate-200 dark:hover:bg-slate-800/80 dark:hover:text-slate-50',
        subtle:
          'bg-white/60 text-foreground shadow-sm hover:bg-white/80 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700',
        destructive:
          'bg-gradient-to-r from-destructive to-destructive/80 text-destructive-foreground shadow-sm hover:-translate-y-0.5 hover:shadow-glass dark:from-red-500 dark:to-red-400 dark:text-slate-950',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 px-3 text-xs',
        lg: 'h-10 px-6 text-sm',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  shine?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, shine = false, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'font-medium transition-all duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 disabled:pointer-events-none disabled:opacity-60',
          shine &&
            "before:pointer-events-none before:absolute before:inset-y-0 before:left-[-40%] before:w-[40%] before:bg-gradient-to-r before:from-white/0 before:via-white/40 before:to-white/0 before:opacity-0 before:transition before:duration-500 hover:before:translate-x-[260%] hover:before:opacity-100",
          buttonVariants({ variant, size, className }),
        )}
        {...props}
      >
        {children}
      </button>
    )
  },
)

Button.displayName = 'Button'

export { Button, buttonVariants }
