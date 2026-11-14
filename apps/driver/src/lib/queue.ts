/**
 * What the app owes the engine, and when to try again.
 *
 * A driver's actions happen where signal is worst: a basement loading bay, a lift lobby, the
 * back of an estate. A delivery marked at the door has to count whether or not the POST lands
 * right then, so each one is written down here first and sent when it can be. The engine makes
 * every one of these safe to repeat — a second "delivered" answers with the proof on file, a
 * second "collected" returns the same parcels — which is what lets this retry without thinking.
 *
 * Pure, in its own file, so the one decision that matters (retry, give up, or ask the driver)
 * is tested rather than discovered on a Tuesday with twelve parcels in the van.
 */

export type ActionKind = "collect" | "deliver" | "fail" | "status" | "arrive";

export interface QueuedAction {
  /** The app's own id for the attempt; the engine sees it as `attemptId` where it matters. */
  id: string;
  kind: ActionKind;
  /** The shipment (drop) or booking (collection) it is about, for showing "Sending…" on a card. */
  shipmentId: string | null;
  bookingId: string | null;
  path: string;
  body: Record<string, unknown>;
  /** What to tell the driver it is: "Delivered DC-… to Jane". */
  label: string;
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
  lastError: string | null;
  /**
   * The engine refused it in a way no retry fixes (a 4xx that is not a timeout or rate limit).
   * Kept, not dropped: the driver decides whether to try again or let it go, because the thing
   * it describes — a parcel handed over — happened whatever the engine said.
   */
  stuck: boolean;
}

export type Queue = QueuedAction[];

export type NewAction = Pick<
  QueuedAction,
  "id" | "kind" | "shipmentId" | "bookingId" | "path" | "body" | "label"
>;

/** First retry after five seconds, doubling, never longer than five minutes between tries. */
export const FIRST_RETRY_MS = 5_000;
export const MAX_RETRY_MS = 5 * 60_000;

export function enqueue(queue: Queue, action: NewAction, now: number): Queue {
  if (queue.some((a) => a.id === action.id)) return queue;
  return [
    ...queue,
    { ...action, createdAt: now, attempts: 0, nextAttemptAt: now, lastError: null, stuck: false },
  ];
}

/** What can be tried right now, oldest first, so a collection goes before its drops. */
export function due(queue: Queue, now: number): QueuedAction[] {
  return queue
    .filter((a) => !a.stuck && a.nextAttemptAt <= now)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function remove(queue: Queue, id: string): Queue {
  return queue.filter((a) => a.id !== id);
}

/** Back off. The delay doubles per failure and is capped, so a dead zone is polled gently. */
export function recordFailure(queue: Queue, id: string, error: string, now: number): Queue {
  return queue.map((a) => {
    if (a.id !== id) return a;
    const attempts = a.attempts + 1;
    const delay = Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** (attempts - 1));
    return { ...a, attempts, nextAttemptAt: now + delay, lastError: error };
  });
}

/** The engine said no in a way that will not change. Park it and ask the driver. */
export function markStuck(queue: Queue, id: string, error: string): Queue {
  return queue.map((a) => (a.id === id ? { ...a, stuck: true, lastError: error } : a));
}

/** The driver asked for another go at a stuck one. */
export function unstick(queue: Queue, id: string, now: number): Queue {
  return queue.map((a) =>
    a.id === id ? { ...a, stuck: false, nextAttemptAt: now, lastError: null } : a,
  );
}

/**
 * Whether an HTTP status means "try again later" or "this will never work".
 *
 * No answer at all (0) and server errors are the engine or the network having a bad moment.
 * 408, 425 and 429 are the server asking for patience. Everything else in 4xx — a refused
 * transition, a missing shipment, a rejected body — is a fact about the request, and sending
 * the same bytes again changes nothing.
 */
export function isRetryable(status: number): boolean {
  if (status === 0 || status >= 500) return true;
  return status === 408 || status === 425 || status === 429;
}

/** Pending work about one stop, for a "Sending…" badge. */
export function pendingFor(
  queue: Queue,
  ref: { shipmentId?: string | null; bookingId?: string | null },
): QueuedAction | null {
  return (
    queue.find(
      (a) =>
        (ref.shipmentId && a.shipmentId === ref.shipmentId) ||
        (ref.bookingId && a.kind === "collect" && a.bookingId === ref.bookingId),
    ) ?? null
  );
}

/** Read a stored queue back, keeping only entries that are still the shape we write. */
export function parseQueue(raw: string | null): Queue {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter(isAction);
  } catch {
    return [];
  }
}

function isAction(x: unknown): x is QueuedAction {
  if (!x || typeof x !== "object") return false;
  const a = x as Partial<QueuedAction>;
  return (
    typeof a.id === "string" &&
    typeof a.kind === "string" &&
    typeof a.path === "string" &&
    !!a.body &&
    typeof a.body === "object" &&
    typeof a.createdAt === "number" &&
    typeof a.attempts === "number" &&
    typeof a.nextAttemptAt === "number"
  );
}

/** A small random id, good enough to tell two taps apart. No crypto needed for that. */
export function attemptId(now: number, random = Math.random()): string {
  return `${now.toString(36)}-${Math.floor(random * 0xffffff).toString(36)}`;
}
