import { useEffect, useState } from "react";
import { File, Paths } from "expo-file-system";
import { api, ApiRequestError } from "./api";
import {
  due,
  enqueue,
  isRetryable,
  markStuck,
  parseQueue,
  recordFailure,
  remove,
  unstick,
  type NewAction,
  type Queue,
} from "./queue";

/**
 * The app's side of the engine's outbox: actions the driver took that have not yet landed.
 *
 * Every write to the engine that records work — collected, delivered, failed, a status, an
 * arrival — goes through `submit`. It is tried at once; if the network is the problem it is
 * written to disk and tried again, on a timer, when the app comes to the front, and when the
 * driver asks. The file lives in the app's document directory, which survives the app being
 * killed, so a delivery marked in a basement at ten is sent from the street at five past
 * whether or not the app was still open.
 *
 * What it does not do is lie about the result. A queued action is shown on the stop as
 * "Sending…", not as done, until the engine agrees — and a refusal the engine will never
 * change is parked for the driver to see rather than retried for ever or silently dropped.
 */

const FILE = () => new File(Paths.document, "delicate-outbox.json");

let queue: Queue = [];
let loaded = false;
let flushing = false;
const listeners = new Set<(q: Queue) => void>();

function publish(): void {
  for (const l of listeners) l(queue);
}

async function load(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const f = FILE();
    queue = f.exists ? parseQueue(await f.text()) : [];
  } catch {
    queue = [];
  }
  publish();
}

function persist(): void {
  try {
    const f = FILE();
    if (queue.length === 0) {
      if (f.exists) f.delete();
      return;
    }
    if (!f.exists) f.create();
    f.write(JSON.stringify(queue));
  } catch {
    // Disk trouble is not worth failing the action over: the in-memory copy keeps retrying
    // for as long as the app lives, which is the common case anyway.
  }
}

function set(next: Queue): void {
  queue = next;
  persist();
  publish();
}

export type SubmitResult<T> = { landed: true; result: T } | { landed: false; queued: true };

/**
 * Send now if possible, otherwise keep it and send later.
 *
 * A refusal the engine means (a 4xx that is not a request for patience) is thrown straight
 * back to the screen: the driver is standing there and can act on "this shipment is not
 * yours". Only the network's failures are swallowed into the queue.
 */
export async function submit<T>(action: NewAction): Promise<SubmitResult<T>> {
  await load();
  try {
    const result = await api<T>(action.path, { method: "POST", json: action.body });
    return { landed: true, result };
  } catch (err) {
    const status = err instanceof ApiRequestError ? err.status : 0;
    if (!isRetryable(status)) throw err;
    set(enqueue(queue, action, Date.now()));
    return { landed: false, queued: true };
  }
}

/** Try everything that is due. Returns how many landed, so a caller can refresh the day. */
export async function flush(): Promise<number> {
  await load();
  if (flushing) return 0;
  flushing = true;
  let landed = 0;
  try {
    for (const action of due(queue, Date.now())) {
      try {
        await api(action.path, { method: "POST", json: action.body });
        set(remove(queue, action.id));
        landed++;
      } catch (err) {
        const status = err instanceof ApiRequestError ? err.status : 0;
        const message = err instanceof Error ? err.message : String(err);
        set(
          isRetryable(status)
            ? recordFailure(queue, action.id, message, Date.now())
            : markStuck(queue, action.id, message),
        );
        // One network failure means the rest will fail too; stop and let the timer come back.
        if (status === 0) break;
      }
    }
  } finally {
    flushing = false;
  }
  return landed;
}

export function retry(id: string): void {
  set(unstick(queue, id, Date.now()));
  void flush();
}

export function discard(id: string): void {
  set(remove(queue, id));
}

/** The queue as React state, so a card can show "Sending…" and the day can show a banner. */
export function useOutbox(): Queue {
  const [state, setState] = useState<Queue>(queue);
  useEffect(() => {
    listeners.add(setState);
    void load();
    return () => {
      listeners.delete(setState);
    };
  }, []);
  return state;
}

/** Keep trying in the background while the app is alive. */
export function startFlushing(intervalMs = 30_000): () => void {
  void flush();
  const timer = setInterval(() => void flush(), intervalMs);
  return () => clearInterval(timer);
}
