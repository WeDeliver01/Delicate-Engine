const DEFAULT_PUBLIC_APP_URL = "https://route.delicatecourier.co.za";

export function getPublicBaseUrl(): string {
  const raw = (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined)?.trim();
  const base = raw && raw.length > 0 ? raw : DEFAULT_PUBLIC_APP_URL;
  return base.replace(/\/+$/, "");
}

export function publicUrl(path = ""): string {
  const base = getPublicBaseUrl();
  if (!path) return base;
  return `${base}/${String(path).replace(/^\/+/, "")}`;
}
