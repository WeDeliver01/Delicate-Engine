"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMap, Marker } from "leaflet";

export interface MapPoint {
  lat: number;
  lng: number;
  kind: "driver" | "destination" | "collection";
  label: string;
}

/**
 * A small map with a handful of pins.
 *
 * Leaflet is driven imperatively here rather than through react-leaflet, for one reason: the
 * driver pin moves every time the position is polled, and re-rendering a whole map component
 * to move one marker makes the tiles flicker. Holding the marker in a ref and setting its
 * position is what makes the van glide instead of blink.
 */
export function TrackingMap({
  points,
  className = "h-72",
}: {
  points: MapPoint[];
  className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const markers = useRef<Map<string, Marker>>(new Map());

  useEffect(() => {
    if (!host.current || map.current) return;
    let cancelled = false;

    // Imported lazily because Leaflet reaches for `window` at module scope, which breaks the
    // server render of any page that so much as imports it.
    void import("leaflet").then((L) => {
      if (cancelled || !host.current || map.current) return;
      const m = L.map(host.current, { zoomControl: true, attributionControl: true });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap",
        maxZoom: 19,
      }).addTo(m);
      // Tshwane, so an empty map is not the middle of the Atlantic while points load.
      m.setView([-25.7479, 28.2293], 11);
      map.current = m;
    });

    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      markers.current.clear();
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m || !points.length) return;

    void import("leaflet").then((L) => {
      if (!map.current) return;
      const seen = new Set<string>();

      for (const p of points) {
        seen.add(p.kind);
        const existing = markers.current.get(p.kind);
        if (existing) {
          existing.setLatLng([p.lat, p.lng]);
          existing.setPopupContent(p.label);
          continue;
        }
        const marker = L.marker([p.lat, p.lng], { icon: pin(L, p.kind), title: p.label })
          .addTo(m)
          .bindPopup(p.label);
        markers.current.set(p.kind, marker);
      }

      // A pin for something no longer on the map — the driver going off shift — is removed
      // rather than left behind at its last known spot.
      for (const [kind, marker] of markers.current) {
        if (!seen.has(kind)) {
          marker.remove();
          markers.current.delete(kind);
        }
      }

      const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number]));
      m.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    });
  }, [points]);

  return (
    <div
      ref={host}
      className={`w-full overflow-hidden rounded-xl border border-line ${className}`}
      role="img"
      aria-label="Delivery tracking map"
    />
  );
}

/** Brand-coloured dots rather than Leaflet's default blue teardrop, whose image 404s anyway. */
function pin(L: typeof import("leaflet"), kind: MapPoint["kind"]) {
  const colour = kind === "driver" ? "#E84A8A" : kind === "destination" ? "#0A0A0A" : "#7C5CFF";
  const pulse =
    kind === "driver"
      ? `<span style="position:absolute;inset:-6px;border-radius:9999px;background:${colour};opacity:.25;animation:ping 1.4s cubic-bezier(0,0,.2,1) infinite"></span>`
      : "";
  return L.divIcon({
    className: "",
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    html: `<span style="position:relative;display:block;width:18px;height:18px">
             ${pulse}
             <span style="position:absolute;inset:0;border-radius:9999px;background:${colour};border:3px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.35)"></span>
           </span>
           <style>@keyframes ping{75%,100%{transform:scale(1.9);opacity:0}}</style>`,
  });
}
