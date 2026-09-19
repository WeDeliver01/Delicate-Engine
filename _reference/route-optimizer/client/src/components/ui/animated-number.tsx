import * as React from "react"

interface AnimatedNumberProps {
  value: number
  duration?: number
  format?: (n: number) => string
  className?: string
}

export function AnimatedNumber({
  value,
  duration = 600,
  format,
  className,
}: AnimatedNumberProps) {
  const [display, setDisplay] = React.useState(value)
  const fromRef = React.useRef(value)
  const startRef = React.useRef<number | null>(null)
  const rafRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    fromRef.current = display
    startRef.current = null
    const tick = (ts: number) => {
      if (startRef.current === null) startRef.current = ts
      const t = Math.min(1, (ts - startRef.current) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      const next = fromRef.current + (value - fromRef.current) * eased
      setDisplay(next)
      if (t < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration])

  const text = format ? format(display) : Math.round(display).toLocaleString()
  return <span className={className}>{text}</span>
}
