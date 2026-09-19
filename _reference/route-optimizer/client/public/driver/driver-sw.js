const DB_NAME = "dc_driver_sw";
const DB_VERSION = 2;
const QUEUE_STORE = "queue";
const TOKEN_STORE = "tokens";
const TOKEN_KEY = "driver-jwt";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        db.createObjectStore(QUEUE_STORE, { keyPath: "id", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(TOKEN_STORE)) {
        db.createObjectStore(TOKEN_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function putToken(token) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TOKEN_STORE, "readwrite");
    if (token) {
      tx.objectStore(TOKEN_STORE).put(token, TOKEN_KEY);
    } else {
      tx.objectStore(TOKEN_STORE).delete(TOKEN_KEY);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function readToken() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TOKEN_STORE, "readonly");
    const req = tx.objectStore(TOKEN_STORE).get(TOKEN_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function enqueue(item) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readwrite");
    tx.objectStore(QUEUE_STORE).add(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function readAll() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readonly");
    const req = tx.objectStore(QUEUE_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function removeId(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readwrite");
    tx.objectStore(QUEUE_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function flush() {
  const items = await readAll();
  if (!items.length) return { sent: 0, failed: 0 };
  const token = await readToken();
  if (!token) {
    // No JWT in IDB yet. Keep items queued; they'll be retried after the page
    // calls setDriverSwToken or when Background Sync fires post-login.
    return { sent: 0, failed: items.length };
  }
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
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify(item.body),
        keepalive: true,
      });
      if (res.ok || res.status === 429) {
        await removeId(item.id);
        sent++;
      } else if (res.status === 401) {
        // Token rejected — drop it from IDB so we don't keep retrying with a
        // stale credential. Page will reauthenticate and call setDriverSwToken.
        await putToken(null);
        failed++;
        break;
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

  const replyPort = (event.ports && event.ports[0]) || null;
  const reply = (payload) => {
    if (replyPort) {
      try { replyPort.postMessage(payload); } catch {}
    } else if (event.source && event.source.postMessage) {
      try { event.source.postMessage(payload); } catch {}
    }
  };

  if (data.type === "set-token") {
    event.waitUntil(
      (async () => {
        try {
          await putToken(typeof data.token === "string" ? data.token : null);
          reply({ type: "token-set", ok: true });
          // Opportunistically flush anything queued before the token arrived.
          if (data.token) await flush();
        } catch {
          reply({ type: "token-set", ok: false });
        }
      })()
    );
  } else if (data.type === "queue-location" && data.body) {
    event.waitUntil(
      (async () => {
        let enqueued = false;
        let result = { sent: 0, failed: 0 };
        try {
          await enqueue({ body: data.body, ts: Date.now() });
          enqueued = true;
          result = await flush();
          if (result.failed > 0) {
            await tryRegisterSync();
          }
        } catch {
          enqueued = false;
        }
        reply({ type: "queue-result", enqueued, ...result });
      })()
    );
  } else if (data.type === "flush") {
    event.waitUntil(flush().catch(() => {}));
  }
});

self.addEventListener("sync", (event) => {
  if (event.tag === "driver-location-flush") {
    event.waitUntil(flush().catch(() => {}));
  }
});
