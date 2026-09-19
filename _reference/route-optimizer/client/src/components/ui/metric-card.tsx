import * as React from "react"
import { cn } from "@/lib/utils"
import { AnimatedNumber } from "./animated-number"
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react"

export interface MetricCardProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string
  value: number | string
  unit?: string
  delta?: number
  deltaLabel?: string
  format?: (n: number) => string
  icon?: React.ReactNode
  tone?: "neutral" | "brand" | "success" | "warning" | "danger"
}

const toneRing: Record<NonNullable<MetricCardProps["tone"]>, string> = {
  neutral: "ring-hairline",
  brand: "ring-jacaranda-500/40",
  success: "ring-success/30",
  warning: "ring-warning/30",
  danger: "ring-danger/30",
}

export const MetricCard = React.forwardRef<HTMLDivElement, MetricCardProps>(
  ({ label, value, unit, delta, deltaLabel, format, icon, tone = "neutral", className, ...props }, ref) => {
    const numeric = typeof value === "number"
    const trend = delta == null ? null : delta > 0 ? "up" : delta < 0 ? "down" : "flat"
    return (
      <div
        ref={ref}
        className={cn(
          "rounded-[var(--v7-radius-lg)] border border-hairline bg-surface-raised p-4 shadow-v7-sm ring-1",
          toneRing[tone],
          className
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="text-[10px] uppercase tracking-[0.18em] text-text-quiet">{label}</div>
          {icon && <div className="text-text-tertiary">{icon}</div>}
        </div>
        <div className="mt-3 flex items-baseline gap-1.5">
          <div className="font-display text-3xl font-medium tracking-tight text-text-primary tabular-nums">
            {numeric ? <AnimatedNumber value={value as number} format={format} /> : value}
          </div>
          {unit && <div className="text-sm text-text-tertiary">{unit}</div>}
        </div>
        {trend && (
          <div
            className={cn(
              "mt-2 inline-flex items-center gap-1 text-xs font-medium",
              trend === "up" && "text-success",
              trend === "down" && "text-danger",
              trend === "flat" && "text-text-tertiary"
            )}
          >
            {trend === "up" && <ArrowUpRight className="size-3.5" />}
            {trend === "down" && <ArrowDownRight className="size-3.5" />}
            {trend === "flat" && <Minus className="size-3.5" />}
            <span>
              {delta! > 0 ? "+" : ""}
              {delta}%{deltaLabel ? ` ${deltaLabel}` : ""}
            </span>
          </div>
        )}
      </div>
    )
  }
)
MetricCard.displayName = "MetricCard"
