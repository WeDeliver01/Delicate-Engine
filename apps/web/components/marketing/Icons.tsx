export function Check() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" className="shrink-0">
      <path
        d="M5 13l4 4L19 7"
        stroke="#E84A8A"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Cross() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="shrink-0">
      <path d="M6 6l12 12M18 6L6 18" stroke="#A8A39C" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export function Dots() {
  return (
    <span className="flex gap-1">
      <span className="w-[7px] h-[7px] rounded-full bg-[#E84A8A]" />
      <span className="w-[7px] h-[7px] rounded-full bg-[#F4C430]" />
      <span className="w-[7px] h-[7px] rounded-full bg-[#7C5CFF]" />
    </span>
  );
}
