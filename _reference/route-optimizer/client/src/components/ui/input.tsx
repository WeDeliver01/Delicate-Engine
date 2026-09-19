import * as React from "react"

import { cn } from "@/lib/utils"

export interface InputProps extends React.ComponentProps<"input"> {
  /** Optional floating tracked label rendered above the underline. */
  label?: string
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, label, id, placeholder, ...props }, ref) => {
    const reactId = React.useId()
    const inputId = id || reactId
    const inputClass = cn(
      "peer flex h-10 w-full bg-transparent border-0 border-b border-hairline px-0 pt-3 pb-2 text-base text-text-primary",
      "placeholder:text-text-quiet",
      "focus:outline-none focus:border-jacaranda-400",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "[transition:border-color_var(--v7-duration-fast)_var(--v7-ease-standard)]",
      "md:text-sm",
      className
    )

    if (!label) {
      return (
        <input
          id={inputId}
          type={type}
          ref={ref}
          placeholder={placeholder}
          className={inputClass}
          {...props}
        />
      )
    }

    return (
      <div className="relative pt-4">
        <input
          id={inputId}
          type={type}
          ref={ref}
          placeholder={placeholder ?? " "}
          className={inputClass}
          {...props}
        />
        <label
          htmlFor={inputId}
          className={cn(
            "pointer-events-none absolute left-0 top-0 text-[10px] uppercase tracking-[0.18em] text-text-quiet",
            "[transition:all_var(--v7-duration-base)_var(--v7-ease-standard)]",
            "peer-placeholder-shown:top-7 peer-placeholder-shown:text-sm peer-placeholder-shown:tracking-normal peer-placeholder-shown:normal-case peer-placeholder-shown:text-text-tertiary",
            "peer-focus:top-0 peer-focus:text-[10px] peer-focus:uppercase peer-focus:tracking-[0.18em] peer-focus:text-jacaranda-300"
          )}
        >
          {label}
        </label>
      </div>
    )
  }
)
Input.displayName = "Input"

/** @deprecated Use `<Input label="…" />` instead. */
const FloatingInput = React.forwardRef<HTMLInputElement, InputProps & { label: string }>(
  (props, ref) => <Input ref={ref} {...props} />
)
FloatingInput.displayName = "FloatingInput"

export { Input, FloatingInput }
