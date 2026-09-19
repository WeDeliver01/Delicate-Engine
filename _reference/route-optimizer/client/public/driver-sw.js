const DB_NAME = "dc_driver_sw";
const STORE = "queue";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function enqueue(item) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).add(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function readAll() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function removeId(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function flush() {
  const items = await readAll();
  if (!items.length) return { sent: 0, failed: 0 };
  let sent = 0, failed = 0;
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const item of items) {
    if (item.ts && item.ts < cutoff) {
      await removeId(item.id);
      continue;
    }
    try {
      const res = await fetch("/api/driver/location", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${item.token}`,
        },
        body: JSON.stringify(item.body),
        keepalive: true,
      });
      if (res.ok || res.status === 429) {
        await removeId(item.id);
        sent++;
      } else if (res.status === 401) {
        await removeId(item.id);
        failed++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }
  return { sent, failed };
}

async function tryRegisterSync() {
  try {
    if ("sync" in self.registration) {
      await self.registration.sync.register("driver-location-flush");
    }
  } catch {}
}

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;

  if (data.type === "queue-location" && data.token && data.body) {
    event.waitUntil(
      (async () => {
        await enqueue({ token: data.token, body: data.body, ts: Date.now() });
        const result = await flush();
        if (result.failed > 0) {
          await tryRegisterSync();
        }
        if (event.source && event.source.postMessage) {
          event.source.postMessage({ type: "queue-result", ...result });
        }
      })().catch(() => {})
    );
  } else if (data.type === "flush") {
    event.waitUntil(flush().catch(() => {}));
  } else if (data.type === "queue-depth") {
    event.waitUntil((async () => {
      let depth = -1;
      try {
        const items = await readAll();
        depth = items.length;
      } catch {}
      const port = (event.ports && event.ports[0]) || event.source;
      try { port && port.postMessage({ type: "queue-depth", depth }); } catch {}
    })());
  }
});

self.addEventListener("sync", (event) => {
  if (event.tag === "driver-location-flush") {
    event.waitUntil(flush().catch(() => {}));
  }
});
