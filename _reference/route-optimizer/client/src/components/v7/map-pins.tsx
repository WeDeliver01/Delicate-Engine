import L from "leaflet";

const JACARANDA_400 = "#9F66D9";
const JACARANDA_600 = "#6936B4";
const IVORY = "#F4EFE5";

export const CARTO_DARK_NOLABELS = "https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png";
export const CARTO_DARK_ONLY_LABELS = "https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png";
export const CARTO_LIGHT_NOLABELS = "https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png";
export const CARTO_LIGHT_ONLY_LABELS = "https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png";

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([a-fA-F0-9]{6})$/.exec(hex.trim());
  if (!m) return { r: 159, g: 102, b: 217 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function mixWithJacaranda(driverColor: string, driverWeight = 0.6): string {
  const a = hexToRgb(driverColor);
  const b = hexToRgb(JACARANDA_600);
  const w = Math.max(0, Math.min(1, driverWeight));
  return rgbToHex(a.r * w + b.r * (1 - w), a.g * w + b.g * (1 - w), a.b * w + b.b * (1 - w));
}

export const POLYLINE_OPTIONS = (driverColor: string) => ({
  color: mixWithJacaranda(driverColor),
  weight: 4,
  opacity: 0.7,
});

export function ensurePinKeyframes() {
  if (typeof document === "undefined") return;
  if (document.getElementById("v7-map-pin-styles")) return;
  const style = document.createElement("style");
  style.id = "v7-map-pin-styles";
  style.textContent = `
@keyframes v7-driver-halo {
  0%   { transform: scale(0.85); opacity: 0.55; }
  50%  { transform: scale(1.6);  opacity: 0; }
  100% { transform: scale(0.85); opacity: 0; }
}
.v7-pin-svg { display:block; }
`;
  document.head.appendChild(style);
}

export function collectionIcon(color: string): L.DivIcon {
  ensurePinKeyframes();
  const fill = color || JACARANDA_400;
  return L.divIcon({
    className: "v7-collection-pin",
    html: `<div style="width:28px;height:32px;display:block;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.55))">
<svg class="v7-pin-svg" width="28" height="32" viewBox="0 0 28 32" xmlns="http://www.w3.org/2000/svg">
  <path d="M14 2 C19.6 2 24 6.4 24 12 C24 19 14 30 14 30 C14 30 4 19 4 12 C4 6.4 8.4 2 14 2 Z M14 8 C12 8 10 9.4 10 12 C10 13.6 11 14.6 12.6 16 C11 17.4 10 18.4 10 20 C10 22.6 12 24 14 24 C16 24 18 22.6 18 20 C18 18.4 17 17.4 15.4 16 C17 14.6 18 13.6 18 12 C18 9.4 16 8 14 8 Z" fill="${fill}" stroke="${IVORY}" stroke-width="1.2" stroke-linejoin="round"/>
</svg>
</div>`,
    iconSize: [28, 32],
    iconAnchor: [14, 30],
  });
}

export function deliveryIcon(color: string, n: number | string): L.DivIcon {
  ensurePinKeyframes();
  const fill = color || JACARANDA_400;
  return L.divIcon({
    className: "v7-delivery-pin",
    html: `<div style="width:28px;height:30px;display:flex;align-items:center;justify-content:center;background:${fill};border:1.5px solid ${IVORY};border-radius:7px;box-shadow:0 2px 6px rgba(0,0,0,0.5);font:700 11px ui-monospace,SFMono-Regular,Menlo,monospace;color:${IVORY};letter-spacing:-0.02em">${String(n)}</div>`,
    iconSize: [28, 30],
    iconAnchor: [14, 15],
  });
}

export function driverLiveIcon(color: string): L.DivIcon {
  ensurePinKeyframes();
  const fill = color || JACARANDA_400;
  return L.divIcon({
    className: "v7-driver-live-pin",
    html: `<div style="position:relative;width:24px;height:24px">
<div style="position:absolute;inset:-10px;border-radius:50%;background:${JACARANDA_400};animation:v7-driver-halo 2.4s ease-in-out infinite;pointer-events:none"></div>
<div style="position:absolute;inset:0;border-radius:50%;background:${fill};border:2px solid ${IVORY};box-shadow:0 1px 3px rgba(0,0,0,0.55)"></div>
</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

export function handoffIcon(): L.DivIcon {
  ensurePinKeyframes();
  return L.divIcon({
    className: "v7-handoff-pin",
    html: `<div style="width:22px;height:22px;display:flex;align-items:center;justify-content:center;background:${JACARANDA_400};border:1.5px solid ${IVORY};border-radius:50%;box-shadow:0 2px 5px rgba(0,0,0,0.5)">
<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="${IVORY}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
<path d="M3 22h12"/><path d="M5 22V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v18"/><path d="M5 8h8"/><path d="M16 12h2a2 2 0 0 1 2 2v3a1.5 1.5 0 0 0 3 0V8l-3-3"/>
</svg>
</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}
