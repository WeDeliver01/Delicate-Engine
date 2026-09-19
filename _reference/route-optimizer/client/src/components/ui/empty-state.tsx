import * as React from "react"
import { cn } from "@/lib/utils"

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
}

export const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  ({ icon, title, description, action, className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex flex-col items-center justify-center text-center gap-3 rounded-[var(--v7-radius-lg)] border border-dashed border-hairline bg-surface-base/40 px-6 py-12",
        className
      )}
      {...props}
    >
      {icon && (
        <div className="flex size-12 items-center justify-center rounded-full bg-surface-overlay text-text-tertiary">
          {icon}
        </div>
      )}
      <div className="space-y-1">
        <h3 className="font-display text-lg font-medium text-text-primary tracking-tight">{title}</h3>
        {description && (
          <p className="text-sm text-text-tertiary max-w-sm mx-auto leading-relaxed">{description}</p>
        )}
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
)
EmptyState.displayName = "EmptyState"
