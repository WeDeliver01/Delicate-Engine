import { useState, useEffect } from "react";

export function useLiveClock() {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const time = now.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const date = now.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

  return { now, time, date };
}
