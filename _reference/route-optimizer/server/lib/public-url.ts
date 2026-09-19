const DEFAULT_PUBLIC_APP_URL = "https://route.delicatecourier.co.za";

export function getPublicBaseUrl(): string {
  const raw = process.env.PUBLIC_APP_URL?.trim();
  const base = raw && raw.length > 0 ? raw : DEFAULT_PUBLIC_APP_URL;
  return base.replace(/\/+$/, "");
}

export function publicUrl(path = ""): string {
  const base = getPublicBaseUrl();
  if (!path) return base;
  return `${base}/${String(path).replace(/^\/+/, "")}`;
}

const LEGACY_HOST_PATTERN = /\.replit\.(app|dev)$/i;

export function isLegacyReplitUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return LEGACY_HOST_PATTERN.test(u.hostname);
  } catch {
    return false;
  }
}

export function rewriteIfLegacyReplitUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (!LEGACY_HOST_PATTERN.test(u.hostname)) return null;
    return publicUrl(`${u.pathname}${u.search}${u.hash}`);
  } catch {
    return null;
  }
}
