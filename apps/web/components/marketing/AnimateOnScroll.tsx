"use client";

import React, { useEffect, useLayoutEffect, useRef } from "react";

// useLayoutEffect runs synchronously before the browser paints on the client,
// which means we can classify elements (in-viewport vs off-screen) before
// anything is shown — no opacity flash. On the server it falls back to
// useEffect (which is a no-op during SSR anyway).
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

interface Props {
  children: React.ReactNode;
  animation?: "fade-up" | "fade-left" | "fade-right" | "scale";
  delay?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  className?: string;
  as?: keyof React.JSX.IntrinsicElements;
}

export default function AnimateOnScroll({
  children,
  animation = "fade-up",
  delay = 0,
  className = "",
  as: Tag = "div",
}: Props) {
  const ref = useRef<HTMLElement>(null);

  useIsomorphicLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Check position before the browser paints — no flash possible.
    const rect = el.getBoundingClientRect();
    const inViewport = rect.top < window.innerHeight && rect.bottom > 0;

    if (inViewport) {
      // Already on screen: mark visible immediately, skip animation.
      el.classList.add("is-visible");
      return;
    }

    // Off-screen: hide it (before paint) and watch for it to scroll in.
    el.classList.add("will-animate");

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          el.classList.remove("will-animate");
          el.classList.add("is-visible");
          observer.unobserve(el);
        }
      },
      { threshold: 0.12 },
    );
    observer.observe(el);

    return () => observer.disconnect();
  }, []);

  // Handle bfcache restores (back/forward navigation).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const handlePageShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      el.classList.remove("will-animate", "is-visible");
      const rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight && rect.bottom > 0) {
        el.classList.add("is-visible");
      }
    };

    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, []);

  const delayClass = delay > 0 ? `anim-delay-${delay}` : "";

  return React.createElement(
    Tag as string,
    {
      ref,
      className: `animate-on-scroll anim-${animation} ${delayClass} ${className}`.trim(),
    },
    children,
  );
}
