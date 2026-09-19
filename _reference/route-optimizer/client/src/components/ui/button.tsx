import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--v7-radius-md)] text-sm font-medium tracking-tight transition-colors [transition-duration:var(--v7-duration-fast)] [transition-timing-function:var(--v7-ease-standard)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jacaranda-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0" +
  " hover-elevate active-elevate-2",
  {
    variants: {
      variant: {
        // primary — jacaranda gradient with ivory text
        default:
          "bg-jacaranda-gradient text-ivory border border-jacaranda-700/40 shadow-v7-sm hover:shadow-v7-md",
        primary:
          "bg-jacaranda-gradient text-ivory border border-jacaranda-700/40 shadow-v7-sm hover:shadow-v7-md",
        destructive:
          "bg-danger text-ivory border border-danger/60 shadow-v7-sm",
        outline:
          " border border-hairline bg-transparent shadow-xs active:shadow-none ",
        // secondary — quiet raised surface w/ hairline border
        secondary:
          "border border-hairline bg-surface-raised text-text-primary",
        // ghost — text-only with transparent border for stable sizing
        ghost: "border border-transparent text-text-secondary hover:text-text-primary",
        link: "border border-transparent text-jacaranda-300 underline-offset-4 hover:underline",
      },
      // Heights are set as "min" heights, because sometimes Ai will place large amount of content
      // inside buttons. With a min-height they will look appropriate with small amounts of content,
      // but will expand to fit large amounts of content.
      size: {
        default: "min-h-9 px-4 py-2",
        sm: "min-h-8 rounded-md px-3 text-xs",
        lg: "min-h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  },
)
Button.displayName = "Button"

export { Button, buttonVariants }
