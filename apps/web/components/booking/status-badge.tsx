import type { BookingStatus, ShipmentStatus } from "@delicate/contracts";

const STYLES: Record<string, string> = {
  confirmed: "bg-[#EFE9FF] text-[#5B43C9]",
  in_progress: "bg-[#FBF1D6] text-[#8A5A06]",
  completed: "bg-[#E6F4EC] text-[#1B7F4B]",
  cancelled: "bg-[#F4F2EF] text-[#86817A]",
  booked: "bg-[#EFE9FF] text-[#5B43C9]",
  assigned: "bg-[#EFE9FF] text-[#5B43C9]",
  collected: "bg-[#FBF1D6] text-[#8A5A06]",
  in_transit: "bg-[#FBF1D6] text-[#8A5A06]",
  delivered: "bg-[#E6F4EC] text-[#1B7F4B]",
  failed: "bg-[#FCEEF4] text-[#C13B73]",
};

export function StatusBadge({ status }: { status: BookingStatus | ShipmentStatus }) {
  const cls = STYLES[status] ?? "bg-[#FCEEF4] text-[#C13B73]";
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}
