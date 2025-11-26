import * as React from 'react'
import { cn } from '@/lib/utils'

export interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {}

export const Avatar = React.forwardRef<HTMLDivElement, AvatarProps>(
  ({ className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-tr from-primary to-sky-400 text-xs font-semibold text-white shadow-md',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  ),
)

Avatar.displayName = 'Avatar'
