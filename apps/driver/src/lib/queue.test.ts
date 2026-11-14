import { describe, expect, it } from "vitest";
import {
  FIRST_RETRY_MS,
  MAX_RETRY_MS,
  attemptId,
  due,
  enqueue,
  isRetryable,
  markStuck,
  parseQueue,
  pendingFor,
  recordFailure,
  remove,
  unstick,
  type NewAction,
} from "./queue.js";

const NOW = 1_700_000_000_000;

const deliver = (id = "a1"): NewAction => ({
  id,
  kind: "deliver",
  shipmentId: "s1",
  bookingId: "b1",
  path: "/v1/driver/deliver",
  body: { shipmentId: "s1", receivedBy: "Jane", attemptId: id },
  label: "Delivered DC-1 to Jane",
});

describe("enqueue", () => {
  it("adds once, ready to send now", () => {
    const q = enqueue([], deliver(), NOW);
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ attempts: 0, nextAttemptAt: NOW, stuck: false, lastError: null });
  });

  it("ignores the same attempt twice — a double tap is one delivery", () => {
    const q = enqueue(enqueue([], deliver(), NOW), deliver(), NOW + 1);
    expect(q).toHaveLength(1);
  });
});

describe("due", () => {
  it("returns the oldest first, so a collection is sent before its drops", () => {
    let q = enqueue([], { ...deliver("drop"), kind: "deliver" }, NOW + 10);
    q = enqueue(q, { ...deliver("collect"), kind: "collect", shipmentId: null }, NOW);
    expect(due(q, NOW + 10).map((a) => a.id)).toEqual(["collect", "drop"]);
  });

  it("holds back what is backing off and what is stuck", () => {
    let q = enqueue(enqueue([], deliver("a"), NOW), deliver("b"), NOW);
    q = recordFailure(q, "a", "network", NOW);
    q = markStuck(q, "b", "invalid_transition");
    expect(due(q, NOW)).toEqual([]);
    expect(due(q, NOW + FIRST_RETRY_MS).map((a) => a.id)).toEqual(["a"]);
  });
});

describe("recordFailure", () => {
  it("doubles the wait each time and caps it", () => {
    let q = enqueue([], deliver(), NOW);
    q = recordFailure(q, "a1", "no signal", NOW);
    expect(q[0]!.nextAttemptAt - NOW).toBe(FIRST_RETRY_MS);
    q = recordFailure(q, "a1", "no signal", NOW);
    expect(q[0]!.nextAttemptAt - NOW).toBe(FIRST_RETRY_MS * 2);
    for (let i = 0; i < 12; i++) q = recordFailure(q, "a1", "no signal", NOW);
    expect(q[0]!.nextAttemptAt - NOW).toBe(MAX_RETRY_MS);
    expect(q[0]!.attempts).toBe(14);
    expect(q[0]!.lastError).toBe("no signal");
  });
});

describe("stuck", () => {
  it("parks a refused action and lets the driver try again", () => {
    let q = markStuck(enqueue([], deliver(), NOW), "a1", "shipment is delivered");
    expect(q[0]!.stuck).toBe(true);
    expect(due(q, NOW + MAX_RETRY_MS)).toEqual([]);
    q = unstick(q, "a1", NOW + 5);
    expect(q[0]).toMatchObject({ stuck: false, nextAttemptAt: NOW + 5, lastError: null });
  });

  it("can be removed", () => {
    expect(remove(enqueue([], deliver(), NOW), "a1")).toEqual([]);
  });
});

describe("isRetryable", () => {
  it("retries no answer, server trouble, and requests for patience", () => {
    for (const code of [0, 500, 502, 503, 408, 425, 429]) expect(isRetryable(code)).toBe(true);
  });
  it("does not retry a refusal — the bytes will not change", () => {
    for (const code of [400, 401, 403, 404, 409, 422]) expect(isRetryable(code)).toBe(false);
  });
});

describe("pendingFor", () => {
  it("finds the action for a drop by shipment and for a pickup by booking", () => {
    let q = enqueue([], deliver("d"), NOW);
    q = enqueue(q, { ...deliver("c"), kind: "collect", shipmentId: null }, NOW);
    expect(pendingFor(q, { shipmentId: "s1" })?.id).toBe("d");
    expect(pendingFor(q, { bookingId: "b1" })?.id).toBe("c");
    expect(pendingFor(q, { shipmentId: "other" })).toBeNull();
  });
});

describe("parseQueue", () => {
  it("round-trips what it writes", () => {
    const q = recordFailure(enqueue([], deliver(), NOW), "a1", "x", NOW);
    expect(parseQueue(JSON.stringify(q))).toEqual(q);
  });
  it("drops anything that is not a queue", () => {
    expect(parseQueue(null)).toEqual([]);
    expect(parseQueue("not json")).toEqual([]);
    expect(parseQueue(JSON.stringify({ id: "a" }))).toEqual([]);
    expect(parseQueue(JSON.stringify([{ id: "a" }, 42]))).toEqual([]);
  });
});

describe("attemptId", () => {
  it("is different for two taps in the same instant", () => {
    expect(attemptId(NOW, 0.1)).not.toBe(attemptId(NOW, 0.2));
  });
});
