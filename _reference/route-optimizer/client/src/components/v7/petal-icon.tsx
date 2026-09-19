import * as React from "react";

export function PetalIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M22 10c-1 7 1 12 5 16 4 4 11 6 18 5-1 7-5 13-12 17-7 4-15 4-21 0" />
      <path d="M27 26c2 4 6 7 11 8" opacity="0.6" />
      <path d="M14 50c1.5-1 3-1.5 5-1.5" opacity="0.5" />
      <path d="M9 56c1-.6 2-.9 3-1" opacity="0.4" />
    </svg>
  );
}
