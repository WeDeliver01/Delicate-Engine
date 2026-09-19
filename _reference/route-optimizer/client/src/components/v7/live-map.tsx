import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, useMap } from "react-leaflet";
import { useQuery } from "@tanstack/react-query";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface DriverLocation {
  id: number;
  driverName: string;
  lat: number | null;
  lng: number | null;
  isOnline: boolean;
  color: string;
  updatedAt: string | null;
}

const PRETORIA: [number, number] = [-25.7479, 28.2293];

function markerIcon(name: string, color: string, online: boolean) {
  const bg = online ? color : "#6b7280";
  return L.divIcon({
    className: "v7-driver-marker",
    html: `<div style="display:flex;flex-direction:column;align-items:center">
      <div style="width:14px;height:14px;border-radius:50%;background:${bg};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5)${online ? ";animation:v7pulse 2s infinite" : ""}"></div>
      <div style="margin-top:2px;background:rgba(15,15,25,.8);color:#fff;font-size:9px;font-weight:600;padding:1px 4px;border-radius:3px;white-space:nowrap">${name}</div>
    </div>`,
    iconSize: [80, 40],
    iconAnchor: [40, 7],
  });
}

function FitBounds({ drivers }: { drivers: DriverLocation[] }) {
  const map = useMap();
  const key = drivers.map((d) => `${d.id}:${d.lat?.toFixed(3)},${d.lng?.toFixed(3)}`).join("|");
  useEffect(() => {
    const positioned = drivers.filter((d) => d.lat != null && d.lng != null);
    if (positioned.length === 0) {
      map.setView(PRETORIA, 11);
      return;
    }
    if (positioned.length === 1) {
      map.setView([positioned[0].lat!, positioned[0].lng!], 13);
      return;
    }
    const b = L.latLngBounds(positioned.map((d) => [d.lat!, d.lng!] as [number, number]));
    map.fitBounds(b, { padding: [30, 30], maxZoom: 14 });
  }, [key, map]);
  return null;
}

export function LiveMap() {
  const { data: drivers = [] } = useQuery<DriverLocation[]>({
    queryKey: ["/api/dispatch/driver-locations"],
    refetchInterval: 15000,
  });
  const positioned = useMemo(
    () => drivers.filter((d) => d.lat != null && d.lng != null),
    [drivers]
  );

  return (
    <div className="relative h-full w-full overflow-hidden rounded-[var(--v7-radius-lg)] border border-hairline" data-testid="v7-live-map">
      <style>{`
        @keyframes v7pulse {
          0% { box-shadow: 0 0 0 0 rgba(124,58,237,0.6); }
          70% { box-shadow: 0 0 0 8px rgba(124,58,237,0); }
          100% { box-shadow: 0 0 0 0 rgba(124,58,237,0); }
        }
      `}</style>
      <MapContainer
        center={PRETORIA}
        zoom={11}
        style={{ width: "100%", height: "100%", background: "#0f0f19" }}
        zoomControl={false}
        attributionControl={false}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          maxZoom={19}
        />
        <FitBounds drivers={positioned} />
        {positioned.map((d) => (
          <Marker
            key={d.id}
            position={[d.lat!, d.lng!]}
            icon={markerIcon(d.driverName, d.color, d.isOnline)}
          />
        ))}
      </MapContainer>
    </div>
  );
}
