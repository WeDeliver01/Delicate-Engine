import { useEffect, useRef, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { DriverStop, OnlineDriver } from "@/lib/driver-api";
import { gMap } from "@/lib/geo";
import {
  driverLiveIcon, collectionIcon, deliveryIcon,
  CARTO_DARK_NOLABELS, CARTO_DARK_ONLY_LABELS,
  CARTO_LIGHT_NOLABELS, CARTO_LIGHT_ONLY_LABELS,
  POLYLINE_OPTIONS,
} from "@/components/v7/map-pins";
import { useTheme } from "@/components/theme-provider";

const PRETORIA_CENTER: [number, number] = [-25.7479, 28.2293];
const SELF_FALLBACK = "#9F66D9";

function sanitizeColor(c: string): string {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c) ? c : SELF_FALLBACK;
}

function MapUpdater({ lat, lng }: { lat: number | null; lng: number | null }) {
  const map = useMap();
  const initialRef = useRef(false);
  const lastPanRef = useRef<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    if (lat == null || lng == null) return;
    if (!initialRef.current) {
      map.setView([lat, lng], 14);
      initialRef.current = true;
      lastPanRef.current = { lat, lng };
      return;
    }
    const prev = lastPanRef.current;
    if (prev) {
      const dlat = Math.abs(lat - prev.lat);
      const dlng = Math.abs(lng - prev.lng);
      if (dlat < 0.0003 && dlng < 0.0003) return;
    }
    map.panTo([lat, lng], { animate: true, duration: 0.8 });
    lastPanRef.current = { lat, lng };
  }, [lat, lng, map]);
  return null;
}

interface Props {
  driverLat: number | null;
  driverLng: number | null;
  stops: DriverStop[];
  activeStopKey: string | null;
  routePolyline?: [number, number][];
  otherDrivers?: OnlineDriver[];
  selfColor?: string;
}

export default function DriverMap({ driverLat, driverLng, stops, activeStopKey, routePolyline, otherDrivers = [], selfColor }: Props) {
  const { theme } = useTheme();
  const center = useMemo<[number, number]>(() => {
    if (driverLat != null && driverLng != null) return [driverLat, driverLng];
    const first = stops.find((s) => s.lat && s.lng);
    if (first) return [first.lat, first.lng];
    return PRETORIA_CENTER;
  }, [driverLat, driverLng, stops]);

  const myColor = sanitizeColor(selfColor || SELF_FALLBACK);

  return (
    <div className="w-full h-full" data-testid="driver-map-container">
      <style>{`
        .leaflet-container { background: hsl(var(--v7-surface-base)); }
      `}</style>
      <MapContainer
        center={center}
        zoom={13}
        style={{ width: "100%", height: "100%" }}
        zoomControl={false}
        attributionControl={false}
      >
        <TileLayer
          url={theme === "light" ? CARTO_LIGHT_NOLABELS : CARTO_DARK_NOLABELS}
          maxZoom={19}
        />
        <TileLayer
          url={theme === "light" ? CARTO_LIGHT_ONLY_LABELS : CARTO_DARK_ONLY_LABELS}
          maxZoom={19}
          pane="overlayPane"
        />
        <MapUpdater lat={driverLat} lng={driverLng} />

        {routePolyline && routePolyline.length > 1 && (
          <Polyline
            positions={routePolyline}
            pathOptions={POLYLINE_OPTIONS(myColor)}
          />
        )}

        {driverLat != null && driverLng != null && (
          <Marker position={[driverLat, driverLng]} icon={driverLiveIcon(myColor)}>
            <Popup>Your location</Popup>
          </Marker>
        )}

        {stops.map((s) => {
          if (!s.lat || !s.lng) return null;
          const isCompleted = s.status === "completed" || s.status === "skipped" || s.status === "failed";
          const tone = isCompleted ? "#5b637a" : (s.key === activeStopKey ? myColor : myColor);
          const icon = s.type === "C"
            ? collectionIcon(tone)
            : deliveryIcon(tone, s.seq);
          return (
            <Marker
              key={s.key}
              position={[s.lat, s.lng]}
              icon={icon}
            >
              <Popup>
                <div style={{ fontSize: 13 }}>
                  <strong>{s.addr || `${s.sub}, ${s.city}`}</strong><br />
                  <span>{s.wbs.join(", ")}</span><br />
                  <span style={{ color: "#666" }}>{s.pcs} pcs &middot; {s.kg}kg</span>
                </div>
              </Popup>
            </Marker>
          );
        })}

        {otherDrivers.map((od) => {
          if (od.lat == null || od.lng == null) return null;
          return (
            <Marker
              key={`od-${od.id}`}
              position={[od.lat, od.lng]}
              icon={driverLiveIcon(sanitizeColor(od.fleetColor))}
            >
              <Popup>
                <div style={{ fontSize: 13, minWidth: 140 }} data-testid={`popup-driver-${od.id}`}>
                  <strong>{od.driverName}</strong><br />
                  {od.vehiclePlate && <span style={{ color: "#666", fontSize: 11 }}>{od.vehiclePlate}</span>}
                  {od.vehiclePlate && <br />}
                  <a
                    href={gMap(od.lat!, od.lng!)}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "inline-block",
                      marginTop: 6,
                      padding: "4px 10px",
                      background: "hsl(var(--v7-jacaranda-500))",
                      color: "hsl(var(--v7-text-primary))",
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 600,
                      textDecoration: "none",
                    }}
                    data-testid={`button-navigate-driver-${od.id}`}
                  >
                    Navigate to Driver
                  </a>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}
