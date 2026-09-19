let registration: ServiceWorkerRegistration | null = null;
let registering: Promise<ServiceWorkerRegistration | null> | null = null;

export async function ensureDriverSwRegistered(): Promise<ServiceWorkerRegistration | null> {
  if (registration) return registration;
  if (!("serviceWorker" in navigator)) return null;
  if (registering) return registering;
  registering = navigator.serviceWorker
    .register("/driver/driver-sw.js", { scope: "/driver/" })
    .then((reg) => {
      registration = reg;
      return reg;
    })
    .catch(() => null);
  return registering;
}

export async function getActiveDriverSw(): Promise<ServiceWorker | null> {
  const reg = await ensureDriverSwRegistered();
  if (!reg) return null;
  if (reg.active) return reg.active;
  await navigator.serviceWorker.ready;
  return reg.active || null;
}

/**
 * Stores the driver's JWT inside the service worker's IndexedDB so the SW can
 * authenticate replayed/queued location uploads without the page passing the
 * token on every message. Should be called whenever the token becomes
 * available (e.g. on login / hook init) and again after rotation. Quietly
 * no-ops if the SW isn't installed yet.
 */
export async function setDriverSwToken(token: string | null): Promise<boolean> {
  const sw = await getActiveDriverSw();
  if (!sw) return false;
  try {
    const channel = new MessageChannel();
    const ack = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 5000);
      channel.port1.onmessage = (ev) => {
        clearTimeout(timer);
        resolve(ev.data && ev.data.type === "token-set");
      };
    });
    sw.postMessage({ type: "set-token", token }, [channel.port2]);
    return await ack;
  } catch {
    return false;
  }
}

export async function queueLocationViaSw(
  body: Record<string, number | null | undefined>,
): Promise<boolean> {
  const sw = await getActiveDriverSw();
  if (!sw) return false;
  try {
    const channel = new MessageChannel();
    const ack = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 8000);
      channel.port1.onmessage = (ev) => {
        clearTimeout(timer);
        const d = ev.data;
        if (d && d.type === "queue-result") {
          // SW only marks a location "delivered" if it successfully enqueued
          // AND either flushed at least one item or had nothing left in the
          // queue afterward. A hard failure (e.g. no token, network down)
          // returns false here so the hook falls back to a direct fetch
          // instead of silently dropping the sample.
          resolve((d.enqueued === true) && ((d.sent || 0) > 0 || (d.failed || 0) === 0));
        } else {
          resolve(false);
        }
      };
    });
    sw.postMessage({ type: "queue-location", body }, [channel.port2]);
    return await ack;
  } catch {
    return false;
  }
}

export function flushQueueViaSw() {
  navigator.serviceWorker?.controller?.postMessage({ type: "flush" });
}
