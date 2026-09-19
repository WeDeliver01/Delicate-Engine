export const formatZAR = (cents: number | undefined | null) => {
  if (cents == null) return "R0.00";
  return `R${(cents / 100).toFixed(2)}`;
};

export const formatBps = (bps: number | undefined | null) => {
  if (bps == null) return "0.0%";
  return `${(bps / 100).toFixed(1)}%`;
};
