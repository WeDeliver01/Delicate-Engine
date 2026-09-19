import * as React from "react"
import { cn } from "@/lib/utils"

export type DriverKey = "vinny" | "ashley" | "refiloe" | "clifford" | string

const driverColors: Record<string, { bg: string; ring: string; text: string }> = {
  vinny: { bg: "bg-driver-vinny/15", ring: "ring-driver-vinny/40", text: "text-driver-vinny" },
  ashley: { bg: "bg-driver-ashley/15", ring: "ring-driver-ashley/40", text: "text-driver-ashley" },
  refiloe: { bg: "bg-driver-refiloe/15", ring: "ring-driver-refiloe/40", text: "text-driver-refiloe" },
  clifford: { bg: "bg-driver-clifford/15", ring: "ring-driver-clifford/40", text: "text-driver-clifford" },
}

export interface DriverChipProps extends React.HTMLAttributes<HTMLDivElement> {
  driver: DriverKey
  name?: string
  size?: "sm" | "md" | "lg"
  showName?: boolean
}

export const DriverChip = React.forwardRef<HTMLDivElement, DriverChipProps>(
  ({ driver, name, size = "md", showName = true, className, ...props }, ref) => {
    const colors = driverColors[driver.toLowerCase()] ?? {
      bg: "bg-surface-overlay",
      ring: "ring-hairline",
      text: "text-text-secondary",
    }
    const display = name ?? driver.charAt(0).toUpperCase() + driver.slice(1)
    const initials = display
      .split(/\s+/)
      .map((s) => s[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase()
    const sizes = {
      sm: { wrap: "gap-1.5 text-xs", avatar: "size-5 text-[10px]" },
      md: { wrap: "gap-2 text-sm", avatar: "size-6 text-[11px]" },
      lg: { wrap: "gap-2.5 text-base", avatar: "size-8 text-xs" },
    }[size]

    return (
      <div
        ref={ref}
        className={cn(
          "inline-flex items-center rounded-[var(--v7-radius-pill)] border border-hairline bg-surface-raised pl-1 pr-3 py-1",
          sizes.wrap,
          className
        )}
        {...props}
      >
        <span
          className={cn(
            "inline-flex items-center justify-center rounded-full font-semibold ring-1",
            sizes.avatar,
            colors.bg,
            colors.ring,
            colors.text
          )}
        >
          {initials}
        </span>
        {showName && <span className="font-medium text-text-primary">{display}</span>}
      </div>
    )
  }
)
DriverChip.displayName = "DriverChip"
