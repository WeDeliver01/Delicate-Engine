"use client";

import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import type { PublicLiveTracking, ShipmentStatus } from "@delicate/contracts";
import { api, ApiRequestError } from "@/lib/api";
import { dateTime } from "@/lib/money";

// Leaflet reaches for `window` at module scope, and this page is worth reading before a map
// has drawn — the ETA is the headline, the map is the reassurance.
const TrackingMap = dynamic(
  () => import("@/components/shipments/tracking-map").then((m) => m.TrackingMap),
  { ssr: false, loading: () => <div className="h-72 animate-pulse rounded-xl bg-[#F3F1ED]" /> },
);

interface PublicTimeline {
  items: { status: ShipmentStatus; label: string; occurredAt: string }[];
}

export default function LiveView({ token }: { token: string }) {
  const live = useQuery({
    queryKey: ["live", token],
    queryFn: () => api<PublicLiveTracking>(`/v1/public/live/${token}`, { account: null }),
    // Only while there is a van moving. Polling a delivered parcel every twenty seconds is a
    // lot of requests to be told the same thing, and this page sits open on people's phones.
    refetchInterval: (q) => (q.state.data?.state === "live" ? 20_000 : false),
  });

  const timeline = useQuery({
    queryKey: ["live", token, "timeline"],
    queryFn: () => api<PublicTimeline>(`/v1/public/live/${token}/timeline`, { account: null }),
    enabled: live.isSuccess,
  });

  if (live.isError) {
    const gone = live.error instanceof ApiRequestError && live.error.status === 404;
    return (
      <Shell>
        <h1 className="text-2xl font-bold">
          {gone ? "This tracking link is not active" : "We could not load your delivery"}
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[#6B6661]">
          {gone
            ? "Links expire when a delivery is closed off. If you are expecting a parcel, the sender can tell you where it is."
            : "Something went wrong at our end. Try again in a moment."}
        </p>
      </Shell>
    );
  }

  const t = live.data;
  if (!t) {
    return (
      <Shell>
        <div className="h-8 w-48 animate-pulse rounded bg-[#F3F1ED]" />
        <div className="mt-4 h-72 animate-pulse rounded-xl bg-[#F3F1ED]" />
      </Shell>
    );
  }

  const points = [
    t.position && {
      lat: t.position.lat,
      lng: t.position.lng,
      kind: "driver" as const,
      label: t.driverFirstName ? `${t.driverFirstName} is here` : "Your driver",
    },
    t.destination && { ...t.destination, kind: "destination" as const, label: "Your address" },
  ].filter((p): p is NonNullable<typeof p> => Boolean(p));

  return (
    <Shell>
      <p className="font-mono text-[13px] text-[#86817A]">{t.waybill}</p>
      <h1 className="mt-1 text-3xl font-extrabold tracking-tight">{headline(t)}</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-[#6B6661]">{t.message}</p>

      {t.state === "live" && (
        <>
          <div className="mt-6 grid grid-cols-3 gap-3">
            <Stat
              label="Arriving in"
              value={t.etaMinutes != null ? `${t.etaMinutes} min` : "—"}
              hint={t.position?.stale ? "last known" : "estimate"}
            />
            <Stat
              label="Distance"
              value={t.distanceKm != null ? `${t.distanceKm} km` : "—"}
              hint="by road"
            />
            <Stat
              label="Stops away"
              value={t.stopsAway != null ? String(t.stopsAway) : "—"}
              hint={t.stopsAway === 0 ? "you are next" : "before you"}
            />
          </div>
          {points.length > 0 && (
            <div className="mt-5">
              <TrackingMap points={points} />
            </div>
          )}
          {t.driverFirstName && (
            <p className="mt-4 text-[15px] text-[#6B6661]">
              Your driver is <span className="font-medium text-[#0A0A0A]">{t.driverFirstName}</span>
              .
            </p>
          )}
        </>
      )}

      {t.state === "delivered" && (
        <div className="mt-6 rounded-xl border border-[#ECEAE6] bg-[#FAF9F7] p-5">
          <p className="text-[15px]">
            Delivered{t.deliveredAt && ` at ${dateTime(t.deliveredAt)}`}
            {t.proofOfDelivery && (
              <>
                , signed for by <span className="font-medium">{t.proofOfDelivery.receivedBy}</span>
              </>
            )}
            .
          </p>
        </div>
      )}

      {timeline.data && timeline.data.items.length > 0 && (
        <ol className="mt-8 space-y-3 border-l-2 border-[#F0EDE9] pl-4">
          {timeline.data.items.map((item, i) => (
            <li key={i} className="relative text-sm">
              <span
                className={`absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ${i === 0 ? "bg-[#E84A8A]" : "bg-[#DAD6CF]"}`}
              />
              <span className="font-medium">{item.label}</span>
              <span className="ml-2 text-[#86817A]">{dateTime(item.occurredAt)}</span>
            </li>
          ))}
        </ol>
      )}

      <p className="mt-10 text-[13px] text-[#9A948C]">
        {(t.destinationPlace.suburb ?? t.destinationPlace.city)
          ? `Delivering to ${[t.destinationPlace.suburb, t.destinationPlace.city].filter(Boolean).join(", ")}. `
          : ""}
        This link is personal to your delivery — please do not share it.
      </p>
    </Shell>
  );
}

/** The one line someone reads over a gate. The engine's `message` explains underneath. */
function headline(t: PublicLiveTracking): string {
  if (t.state === "delivered") return "Delivered";
  if (t.state === "closed") return t.statusLabel;
  if (t.state !== "live") return "On its way to you";
  if (t.etaMinutes != null) return `About ${t.etaMinutes} minutes away`;
  return "Out for delivery";
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-[#ECEAE6] bg-white p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-[#9A948C]">{label}</p>
      <p className="mt-1 text-xl font-bold leading-none">{value}</p>
      {hint && <p className="mt-1 text-[11px] text-[#9A948C]">{hint}</p>}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-white px-5 py-10">
      <div className="mx-auto max-w-lg">
        <p className="text-[13px] font-semibold uppercase tracking-wider text-[#E84A8A]">
          Delicate Courier
        </p>
        <div className="mt-6">{children}</div>
      </div>
    </main>
  );
}
