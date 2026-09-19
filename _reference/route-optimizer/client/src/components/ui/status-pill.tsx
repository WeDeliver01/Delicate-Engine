import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const statusPillVariants = cva(
  "inline-flex items-center gap-1.5 rounded-[var(--v7-radius-pill)] border px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] leading-none whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "border-hairline bg-surface-overlay/60 text-text-secondary",
        success: "border-success/30 bg-success/10 text-success",
        warning: "border-warning/30 bg-warning/10 text-warning",
        danger: "border-danger/30 bg-danger/10 text-danger",
        info: "border-info/30 bg-info/10 text-info",
        brand: "border-jacaranda-400/30 bg-jacaranda-500/15 text-jacaranda-200",
      },
      size: {
        sm: "px-2 py-0.5 text-[10px]",
        md: "px-2.5 py-1 text-[11px]",
        lg: "px-3 py-1.5 text-xs",
      },
    },
    defaultVariants: { tone: "neutral", size: "md" },
  }
)

export interface StatusPillProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof statusPillVariants> {
  dot?: boolean
}

export const StatusPill = React.forwardRef<HTMLSpanElement, StatusPillProps>(
  ({ className, tone, size, dot, children, ...props }, ref) => (
    <span ref={ref} className={cn(statusPillVariants({ tone, size }), className)} {...props}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  )
)
StatusPill.displayName = "StatusPill"
