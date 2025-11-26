import * as React from 'react'
import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'

export interface PaginationProps extends React.ComponentProps<'nav'> {}

export function Pagination({ className, ...props }: PaginationProps) {
  return (
    <nav
      role="navigation"
      aria-label="pagination"
      className={cn('flex w-full items-center justify-center', className)}
      {...props}
    />
  )
}

export interface PaginationContentProps extends React.ComponentProps<'ul'> {}

export function PaginationContent({ className, ...props }: PaginationContentProps) {
  return <ul className={cn('flex flex-row items-center gap-1', className)} {...props} />
}

export interface PaginationItemProps extends React.ComponentProps<'li'> {}

export function PaginationItem({ className, ...props }: PaginationItemProps) {
  return <li className={cn('list-none', className)} {...props} />
}

export interface PaginationLinkProps extends React.ComponentProps<'a'> {
  isActive?: boolean
}

export const PaginationLink = React.forwardRef<HTMLAnchorElement, PaginationLinkProps>(
  ({ className, isActive, ...props }, ref) => {
    return (
      <a
        ref={ref}
        aria-current={isActive ? 'page' : undefined}
        className={cn(
          buttonVariants({ variant: 'outline', size: 'icon' }),
          'h-9 w-9 rounded-full border-slate-200 text-xs font-medium text-slate-600 bg-transparent dark:border-slate-700 dark:text-slate-300 dark:bg-transparent',
          isActive &&
            'bg-white text-sky-600 text-sm font-bold ring-2 ring-sky-300 border-sky-400 hover:bg-white hover:text-sky-700 dark:bg-slate-100 dark:text-sky-700 dark:ring-sky-500/80',
          className,
        )}
        {...props}
      />
    )
  },
)
PaginationLink.displayName = 'PaginationLink'

export const PaginationPrevious = React.forwardRef<HTMLAnchorElement, React.ComponentProps<'a'>>(
  ({ className, children, ...props }, ref) => (
    <PaginationLink
      ref={ref}
      aria-label="上一页"
      className={cn('w-auto px-3 text-xs', className)}
      {...props}
    >
      <ChevronLeft className="mr-1 h-4 w-4" />
      <span>{children ?? '上一页'}</span>
    </PaginationLink>
  ),
)
PaginationPrevious.displayName = 'PaginationPrevious'

export const PaginationNext = React.forwardRef<HTMLAnchorElement, React.ComponentProps<'a'>>(
  ({ className, children, ...props }, ref) => (
    <PaginationLink
      ref={ref}
      aria-label="下一页"
      className={cn('w-auto px-3 text-xs', className)}
      {...props}
    >
      <span>{children ?? '下一页'}</span>
      <ChevronRight className="ml-1 h-4 w-4" />
    </PaginationLink>
  ),
)
PaginationNext.displayName = 'PaginationNext'

export const PaginationEllipsis = React.forwardRef<HTMLSpanElement, React.ComponentProps<'span'>>(
  ({ className, ...props }, ref) => (
    <span
      ref={ref}
      aria-hidden
      className={cn('flex h-9 w-9 items-center justify-center', className)}
      {...props}
    >
      <MoreHorizontal className="h-4 w-4" />
      <span className="sr-only">更多页</span>
    </span>
  ),
)
PaginationEllipsis.displayName = 'PaginationEllipsis'
