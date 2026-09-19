import { useEffect, useMemo, useRef, useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { decodePolyline } from "@/lib/traffic-corridors";

export type LegPolylines = Map<string, ReadonlyArray<[number, number]>>;

export function legKey(oLat: number, oLng: number, dLat: number, dLng: number): string {
  return `${oLat.toFixed(4)},${oLng.toFixed(4)}|${dLat.toFixed(4)},${dLng.toFixed(4)}`;
}

export interface PolylineRequestLeg {
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
}

/**
 * Fetches OSRM road polylines for a set of legs, caching them by leg key.
 * Returns a Map<legKey, [lat,lng][]> that grows as fetches complete.
 *
 * To share one cache between several consumers (e.g. the dispatcher map
 * and the traffic page), call this hook once at a common ancestor and
 * pass the resulting Map down via context. That is what `dispatch.tsx`
 * does: it computes the cache and exposes it on `TrafficContextValue`.
 */
export function useLegPolylines(legs: PolylineRequestLeg[]): LegPolylines {
  const [cache, setCache] = useState<LegPolylines>(() => new Map());
  const cacheRef = useRef(cache);
  cacheRef.current = cache;

  // Stable list of unique requested keys (rounded to 4dp like legKey).
  const requested = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ key: string } & PolylineRequestLeg> = [];
    for (const l of legs) {
      if (![l.originLat, l.originLng, l.destLat, l.destLng].every(Number.isFinite)) continue;
      if (l.originLat === 0 || l.destLat === 0) continue;
      const k = legKey(l.originLat, l.originLng, l.destLat, l.destLng);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ key: k, ...l });
    }
    return out;
  }, [legs]);

  // Stable signature so the effect only re-runs when the set of keys changes.
  const signature = useMemo(() => requested.map((r) => r.key).sort().join("|"), [requested]);

  useEffect(() => {
    const missing = requested.filter((r) => !cacheRef.current.has(r.key));
    if (missing.length === 0) return;

    let cancelled = false;
    (async () => {
      try {
        const chunkSize = 60; // server cap
        for (let i = 0; i < missing.length; i += chunkSize) {
          const chunk = missing.slice(i, i + chunkSize);
          const res = await apiRequest("POST", "/api/routes/polylines/batch", {
            legs: chunk.map(({ originLat, originLng, destLat, destLng }) => ({
              originLat, originLng, destLat, destLng,
            })),
          });
          const data = await res.json();
          if (cancelled) return;
          const polylines: (string | null)[] = data.polylines || [];
          setCache((prev) => {
            const next = new Map(prev);
            chunk.forEach((leg, j) => {
              const enc = polylines[j];
              if (enc && !next.has(leg.key)) {
                try { next.set(leg.key, decodePolyline(enc)); } catch { /* ignore */ }
              }
            });
            return next;
          });
        }
      } catch (e) {
        console.warn("[useLegPolylines] fetch failed", e);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return cache;
}
