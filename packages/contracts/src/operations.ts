import type { LatLng } from "./dto/geo.js";
import { haversineKm } from "./pricing.js";

/**
 * Operational logic, ported from the route planner Delicate ran before this engine.
 *
 * Everything here is a rule the business learned the hard way, lifted out of 2,000 lines of
 * browser code and 7,000 lines of dispatch screen: how long a stop really takes, when a driver
 * will wait at a pickup and when they will not, how much worse a late delivery is than a long
 * one, and what makes a day badly shared out between drivers.
 *
 * Three deliberate differences from the original:
 *
 *  1. **Pure and deterministic.** The original shuffled with `Math.random()`, so the same day
 *     could produce two different routes, and a driver reloading the app watched their stops
 *     rearrange. Every search here is seeded, like pricing and allocation elsewhere in the
 *     engine: the same input always gives the same answer.
 *  2. **No hard-coded fleet.** The original encoded real rules as constants against specific
 *     vehicle ids and one account code. Those are configuration now.
 *  3. **It advises; it never blocks.** `stopsCanMerge` in the original always returned true —
 *     the dispatcher has authority and the system offers warnings. That is kept exactly.
 */

// ── service time ──────────────────────────────────────────────────────────────

/**
 * How long a driver is actually at a stop.
 *
 * A collection takes longer than a drop — paperwork, checking the load, waiting for someone to
 * come out — and both grow with the number of pieces. Capped at a quarter of an hour either
 * way: a van with forty parcels still does not spend an hour at one door, it does several
 * stops. The single biggest input to whether a planned arrival time is worth anything.
 */
export function serviceMinutes(kind: StopKind, pieces: number): number {
  if (kind === "collection") return Math.min(15, Math.max(5, 5 + Math.ceil(pieces * 1.5)));
  return Math.min(15, Math.max(3, 3 + pieces));
}

export type StopKind = "collection" | "drop";

// ── how soon a delivery can honestly follow its collection ────────────────────

export interface FeasibleGapInput {
  /** Road kilometres from the collection to the door. */
  km: number;
  /** Pieces handled at each end. Both affect how long the driver is standing there. */
  collectionPieces?: number;
  dropPieces?: number;
  /** Average road speed. The same default the planner and the live board use. */
  averageSpeedKph?: number;
  /** Proportional allowance for traffic and the unexpected. 2500 = a quarter again. */
  bufferBps?: number;
  /** Never shorter than this, however short the drive. */
  minimumMinutes?: number;
}

/**
 * The soonest a parcel could reach the door, if the van went straight there.
 *
 * This is a floor, not a promise, and the difference matters. A driver collecting at eight
 * is usually collecting three other jobs on the same run, so the parcel rides along while
 * they work; what this number says is only that nothing faster than this is physically
 * possible. Use it to refuse the impossible -- an eight o'clock collection with an
 * eight-thirty delivery on a forty-minute drive -- and to price and promise a dedicated run,
 * where the van really does go straight there. Never to tell a customer when a batched
 * delivery will arrive: that is what the slot they bought says, and what the live estimate
 * says once a driver is actually moving.
 *
 * Built from the same parts as the rest of the day: `serviceMinutes` at both ends, the
 * planner's road speed, and a proportional buffer, rounded out to the next five minutes
 * because a promise of 41 minutes is a lie about how precisely anyone knows.
 */
export function feasibleGapMinutes(input: FeasibleGapInput): number {
  const speed = input.averageSpeedKph ?? 35;
  const buffer = (input.bufferBps ?? 2_500) / 10_000;
  const minimum = input.minimumMinutes ?? 45;

  const load = serviceMinutes("collection", input.collectionPieces ?? 1);
  const unload = serviceMinutes("drop", input.dropPieces ?? 1);
  const drive = (Math.max(0, input.km) / speed) * 60;

  const total = (load + drive + unload) * (1 + buffer);
  return Math.max(minimum, Math.ceil(total / 5) * 5);
}

// ── grouping collections ──────────────────────────────────────────────────────

export interface GroupableStop {
  id: string;
  kind: StopKind;
  location: LatLng;
  /** Suburb or other coarse area name. Used before coordinates, because it is what people mean. */
  area?: string | null;
  earliestMinute?: number | null;
  latestMinute?: number | null;
}

export interface StopGroup {
  key: string;
  stopIds: string[];
  /** The tightest window that satisfies every stop in the group, when one exists. */
  earliestMinute: number | null;
  latestMinute: number | null;
}

export interface GroupOptions {
  /** Two pickups this far apart in readiness time are still one visit. */
  toleranceMinutes?: number;
  /** And no further apart than this on the ground. */
  radiusKm?: number;
}

/**
 * Merge pickups that are really one visit.
 *
 * Two bookings at the same business, ready within a quarter of an hour of each other, are one
 * stop for a driver and two rows in a database. The original planner spent its first act
 * re-deriving this from flat CSV rows; here it only has to reach *across* bookings, because
 * within a booking the engine already knows.
 */
export function groupCollections(stops: GroupableStop[], options: GroupOptions = {}): StopGroup[] {
  const tolerance = options.toleranceMinutes ?? 15;
  const radius = options.radiusKm ?? 0.3;
  const groups: StopGroup[] = [];
  const anchors: GroupableStop[] = [];

  for (const stop of stops.filter((s) => s.kind === "collection")) {
    const at = anchors.findIndex(
      (a) =>
        sameArea(a, stop, radius) &&
        Math.abs((a.earliestMinute ?? 0) - (stop.earliestMinute ?? 0)) <= tolerance,
    );
    if (at === -1) {
      anchors.push(stop);
      groups.push({
        key: groupKey(stop),
        stopIds: [stop.id],
        earliestMinute: stop.earliestMinute ?? null,
        latestMinute: stop.latestMinute ?? null,
      });
      continue;
    }
    const group = groups[at]!;
    group.stopIds.push(stop.id);
    // The group must satisfy everyone in it: start no earlier than the latest "ready", finish
    // no later than the earliest "must be gone by".
    group.earliestMinute = maxOrNull(group.earliestMinute, stop.earliestMinute ?? null);
    group.latestMinute = minOrNull(group.latestMinute, stop.latestMinute ?? null);
  }

  return groups.sort((a, b) => (a.earliestMinute ?? 0) - (b.earliestMinute ?? 0));
}

/**
 * What is worth saying out loud about a grouping a dispatcher has proposed — and nothing more.
 *
 * The original's `stopsCanMerge()` always returned `true`, with a comment that dispatchers
 * retain full authority. That is not a bug to tidy up, it is the operating philosophy: the
 * person with the phone and the local knowledge decides, and the system's job is to mention
 * what they might not have noticed. Never blocks.
 */
export function groupingAdvisories(stops: GroupableStop[]): string[] {
  const out: string[] = [];
  if (stops.length < 2) return out;

  if (new Set(stops.map((s) => s.kind)).size > 1) {
    out.push("This mixes collections and deliveries into one stop.");
  }

  let furthest = 0;
  for (let i = 0; i < stops.length; i++) {
    for (let j = i + 1; j < stops.length; j++) {
      furthest = Math.max(furthest, haversineKm(stops[i]!.location, stops[j]!.location));
    }
  }
  if (furthest > 0.3) {
    out.push(
      `These are up to ${furthest.toFixed(2)} km apart — the driver will still work them as one stop.`,
    );
  }

  // The intersection of every window: if it is empty, one of them cannot be met.
  let from = 0;
  let to = 1440;
  for (const s of stops) {
    from = Math.max(from, s.earliestMinute ?? 0);
    to = Math.min(to, s.latestMinute ?? 1440);
  }
  if (to < from) {
    out.push("Their time windows do not overlap, so one of them will be missed.");
  }

  return out;
}

// ── sequencing a day ──────────────────────────────────────────────────────────

export interface DayStop {
  id: string;
  kind: StopKind;
  location: LatLng;
  /** On a drop: the collection stop that must happen first. */
  afterStopId?: string | null;
  earliestMinute?: number | null;
  latestMinute?: number | null;
  pieces?: number;
  /** Already picked up and on the vehicle, so it needs no collection leg. */
  alreadyOnBoard?: boolean;
  /** A dispatcher pinned this to an exact minute; the sequencer must not move it off. */
  pinnedMinute?: number | null;
}

export interface SequenceDayInput {
  depot: LatLng;
  stops: DayStop[];
  startMinute: number;
  /** Shift end, used only to report overtime. */
  endMinute?: number | null;
  averageSpeedKph?: number;
  /** Straight-line km multiplied by this to approximate roads. */
  roadFactor?: number;
  /**
   * How long a driver will sit at a pickup that is not ready yet while they have parcels in the
   * van waiting to be delivered. Past this they go and deliver, and come back.
   */
  maxWaitMinutes?: number;
}

export interface SequencedStop {
  id: string;
  sequence: number;
  arrivalMinute: number;
  departureMinute: number;
  waitMinutes: number;
  serviceMinutes: number;
  legKm: number;
  legMinutes: number;
  /** Minutes past this stop's `latestMinute`. Zero when it was made in time. */
  lateMinutes: number;
}

export interface SequenceDayResult {
  stops: SequencedStop[];
  totalKm: number;
  totalMinutes: number;
  finishMinute: number;
  lateStops: string[];
  overtimeMinutes: number;
  waitMinutes: number;
}

/**
 * Order one driver's day, interleaving pickups and deliveries.
 *
 * This is the genuinely hard part of the old planner and the piece `optimiseRoute` never had:
 * that function minimises distance and merely *reports* which stops end up late. Here lateness
 * drives the choice.
 *
 * The rules it encodes, all learned from running real days:
 *
 *  - A parcel is never delivered before it is collected.
 *  - A driver will not idle at a pickup that is not ready if there are drops waiting; they go
 *    and deliver and come back, because waiting is the one cost that buys nothing.
 *  - How bad lateness is accelerates as the deadline approaches: twenty minutes of slack is
 *    worth little, five minutes is worth a detour, and being already late is worth a long one.
 *  - A delivery about to miss its window beats whatever merely happens to be nearest.
 */
export function sequenceDay(input: SequenceDayInput): SequenceDayResult {
  const speed = input.averageSpeedKph ?? 35;
  const factor = input.roadFactor ?? 1.3;
  const maxWait = input.maxWaitMinutes ?? 20;
  const km = (a: LatLng, b: LatLng) => haversineKm(a, b) * factor;
  const minutes = (distance: number) => (distance / speed) * 60;

  const byId = new Map(input.stops.map((s) => [s.id, s]));
  const pending = new Set(input.stops.map((s) => s.id));
  const done = new Set<string>();
  const out: SequencedStop[] = [];

  let at = input.depot;
  let clock = input.startMinute;
  let totalKm = 0;
  let totalWait = 0;

  /** A drop waits for its collection; everything else is always available. */
  const ready = (s: DayStop) =>
    s.kind !== "drop" ||
    s.alreadyOnBoard ||
    !s.afterStopId ||
    !byId.has(s.afterStopId) ||
    done.has(s.afterStopId);

  while (pending.size > 0) {
    const available = [...pending].map((id) => byId.get(id)!).filter(ready);
    // Nothing is available: the precedence data contradicts itself. Fall back to the given
    // order rather than looping forever or silently dropping a stop.
    const pool = available.length > 0 ? available : [...pending].map((id) => byId.get(id)!);

    const dropsWaiting = pool.some((s) => s.kind === "drop");
    const scored = pool.map((stop) => {
      const legKm = km(at, stop.location);
      const legMinutes = minutes(legKm);
      const arrive = clock + legMinutes;
      const target = stop.pinnedMinute ?? stop.earliestMinute ?? null;
      const wait = target == null ? 0 : Math.max(0, target - arrive);
      const deadline = stop.pinnedMinute ?? stop.latestMinute ?? null;
      const slack = deadline == null ? Number.POSITIVE_INFINITY : deadline - arrive;

      let score: number;
      if (stop.kind === "collection") {
        // Distance matters less at a pickup than the dead time spent waiting for it.
        score = legKm * 0.5 + wait * 0.3 - urgency(slack);
      } else {
        score = legKm * 0.3 - urgency(slack);
      }
      return { stop, legKm, legMinutes, arrive, wait, slack, score };
    });

    // A pickup we would have to sit at while parcels wait in the van is skipped this round.
    const practical = scored.filter(
      (c) => !(c.stop.kind === "collection" && c.wait > maxWait && dropsWaiting),
    );
    const candidates = practical.length > 0 ? practical : scored;
    candidates.sort((a, b) => a.score - b.score || a.stop.id.localeCompare(b.stop.id));

    // One override: a delivery within ten minutes of its deadline goes now, whatever is nearest.
    const rescue = candidates
      .filter((c) => c.stop.kind === "drop" && c.slack < 10)
      .sort((a, b) => a.slack - b.slack || a.stop.id.localeCompare(b.stop.id))[0];
    const chosen = rescue ?? candidates[0]!;

    const service = serviceMinutes(chosen.stop.kind, chosen.stop.pieces ?? 1);
    const arrival = Math.max(
      chosen.arrive,
      chosen.stop.pinnedMinute ?? chosen.stop.earliestMinute ?? chosen.arrive,
    );
    const deadline = chosen.stop.pinnedMinute ?? chosen.stop.latestMinute ?? null;

    out.push({
      id: chosen.stop.id,
      sequence: out.length + 1,
      arrivalMinute: round(arrival),
      departureMinute: round(arrival + service),
      waitMinutes: round(chosen.wait),
      serviceMinutes: service,
      legKm: round2(chosen.legKm),
      legMinutes: round(chosen.legMinutes),
      lateMinutes: deadline == null ? 0 : Math.max(0, round(arrival - deadline)),
    });

    totalKm += chosen.legKm;
    totalWait += chosen.wait;
    clock = arrival + service;
    at = chosen.stop.location;
    pending.delete(chosen.stop.id);
    done.add(chosen.stop.id);
  }

  // The run back to the depot is part of the day: it is fuel and it is hours.
  const home = out.length > 0 ? km(at, input.depot) : 0;
  totalKm += home;
  const finish = clock + minutes(home);

  return {
    stops: out,
    totalKm: round2(totalKm),
    totalMinutes: round(finish - input.startMinute),
    finishMinute: round(finish),
    lateStops: out.filter((s) => s.lateMinutes > 0).map((s) => s.id),
    overtimeMinutes: input.endMinute == null ? 0 : Math.max(0, round(finish - input.endMinute)),
    waitMinutes: round(totalWait),
  };
}

/**
 * How much it matters that a stop is approaching its deadline.
 *
 * Steps rather than a curve, because that is how the original was tuned against real days and
 * the thresholds are the knowledge: an hour of slack is almost free, under twenty minutes is
 * worth a detour, and already-late dominates everything.
 */
function urgency(slack: number): number {
  if (!Number.isFinite(slack)) return 0;
  if (slack < 0) return Math.abs(slack) * 100;
  if (slack < 10) return (10 - slack) * 30;
  if (slack < 20) return (20 - slack) * 15;
  if (slack < 40) return (40 - slack) * 5;
  if (slack < 60) return (60 - slack) * 2;
  return 0;
}

// ── vehicle constraints ───────────────────────────────────────────────────────

/**
 * What a vehicle may carry. Configuration, not constants.
 *
 * The original had `VITZ_RULES`, `VEHICLE_VITZ_IDS` and `acc === "SWE001"` compiled in. The
 * rules were right — a three-tier cake does not go in a hatchback — but written where only a
 * developer could change them, against registrations that get sold.
 */
export interface VehicleProfile {
  /** Free-text class, e.g. "cargo". A job may insist on one. */
  class?: string | null;
  maxParcels?: number | null;
  /** Package type codes this vehicle must never carry. */
  excludedPackageTypes?: string[];
  /** Per-package-type ceilings, e.g. `{ platter: 3 }`. */
  maxByPackageType?: Record<string, number>;
}

export interface ConstraintJob {
  id: string;
  pieces: number;
  packageTypeCodes: string[];
  /** The job will not go on a vehicle of another class. */
  requiresVehicleClass?: string | null;
}

export interface ConstraintBreach {
  jobId: string | null;
  rule: "excluded_package" | "package_cap" | "parcel_cap" | "vehicle_class";
  detail: string;
}

/**
 * Which rules a proposed load breaks. An empty list means it is fine.
 *
 * Returned as findings rather than a score so a dispatcher can be told *what* is wrong, and so
 * the allocator can price them itself.
 */
export function vehicleConstraints(
  jobs: ConstraintJob[],
  vehicle: VehicleProfile | null | undefined,
): ConstraintBreach[] {
  const out: ConstraintBreach[] = [];
  if (!vehicle) {
    for (const job of jobs) {
      if (job.requiresVehicleClass) {
        out.push({
          jobId: job.id,
          rule: "vehicle_class",
          detail: `needs a ${job.requiresVehicleClass} vehicle; this driver has none recorded`,
        });
      }
    }
    return out;
  }

  const excluded = new Set(vehicle.excludedPackageTypes ?? []);
  for (const job of jobs) {
    for (const code of job.packageTypeCodes) {
      if (excluded.has(code)) {
        out.push({
          jobId: job.id,
          rule: "excluded_package",
          detail: `this vehicle does not carry ${code}`,
        });
      }
    }
    if (job.requiresVehicleClass && job.requiresVehicleClass !== vehicle.class) {
      out.push({
        jobId: job.id,
        rule: "vehicle_class",
        detail: `needs a ${job.requiresVehicleClass} vehicle, this one is ${vehicle.class ?? "unclassified"}`,
      });
    }
  }

  for (const [code, cap] of Object.entries(vehicle.maxByPackageType ?? {})) {
    const carried = jobs
      .filter((j) => j.packageTypeCodes.includes(code))
      .reduce((n, j) => n + j.pieces, 0);
    if (carried > cap) {
      out.push({
        jobId: null,
        rule: "package_cap",
        detail: `${carried} ${code} exceeds the ${cap} this vehicle takes`,
      });
    }
  }

  const parcels = jobs.reduce((n, j) => n + j.pieces, 0);
  if (vehicle.maxParcels != null && parcels > vehicle.maxParcels) {
    out.push({
      jobId: null,
      rule: "parcel_cap",
      detail: `${parcels} parcels exceeds the ${vehicle.maxParcels} this vehicle takes`,
    });
  }

  return out;
}

// ── allocating a day across drivers ───────────────────────────────────────────
//
// Named `DayAllocation*` rather than `Allocation*`: treasury already owns that word for
// splitting margin between wallets, and two different "allocations" in one namespace is how
// someone eventually imports the wrong one.

export interface DayDriver {
  id: string;
  depot: LatLng;
  shiftStartMinute: number;
  shiftEndMinute: number;
  stopCapacity: number;
  costPerKmCents: number;
  vehicle?: VehicleProfile | null;
}

export interface DayJob extends ConstraintJob {
  collection: DayStop;
  drop: DayStop;
}

/**
 * A ceiling on deliveries finished before a time of day.
 *
 * The original hard-coded Saturday: twelve drops before noon, eight after. The rule is real —
 * half the recipients are not home, the roads are different — but it belongs in capacity
 * configuration, not in a constant named after a weekday.
 */
export interface DayCap {
  untilMinute: number;
  maxDrops: number;
}

export interface DayAllocationInput {
  drivers: DayDriver[];
  jobs: DayJob[];
  /** Jobs a dispatcher has already placed. Respected, never moved. */
  pinned?: Record<string, string>;
  caps?: DayCap[];
  maxWaitMinutes?: number;
  /** Restarts of the search. More is better and slower; the default is tuned for a day's work. */
  attempts?: number;
  /** Anything stable. The same seed and input always give the same plan. */
  seed?: number;
}

export interface DayAllocationScore {
  total: number;
  fuelCents: number;
  lateMinutes: number;
  overtimeMinutes: number;
  waitMinutes: number;
  capBreaches: number;
  constraintBreaches: ConstraintBreach[];
  idleDrivers: number;
  spread: number;
}

export interface DayAllocationResult {
  /** Job id → driver id. */
  assignment: Record<string, string>;
  score: DayAllocationScore;
  perDriver: Record<string, { jobIds: string[]; sequence: SequenceDayResult }>;
  attempts: number;
}

/**
 * What a proposed division of the day costs.
 *
 * The weights are the business's opinion, carried over from the planner that ran real days:
 *
 *  - Lateness dwarfs distance. A late parcel costs a customer; a long route costs some diesel.
 *  - An idle driver while work is unallocated is close to unforgivable — it means someone is
 *    being paid to sit while a customer waits.
 *  - Breaking a vehicle rule is effectively prohibitive rather than merely expensive.
 *  - Overtime is real money and is counted, but it beats missing a window.
 */
export function scoreAllocation(
  input: DayAllocationInput,
  assignment: Record<string, string>,
): { score: DayAllocationScore; perDriver: DayAllocationResult["perDriver"] } {
  const caps = input.caps ?? [];
  const perDriver: DayAllocationResult["perDriver"] = {};
  let fuelCents = 0;
  let lateMinutes = 0;
  let overtimeMinutes = 0;
  let waitMinutes = 0;
  let capBreaches = 0;
  const constraintBreaches: ConstraintBreach[] = [];
  const loads: number[] = [];

  for (const driver of input.drivers) {
    const mine = input.jobs.filter((j) => assignment[j.id] === driver.id);
    loads.push(mine.length);
    if (mine.length === 0) {
      perDriver[driver.id] = {
        jobIds: [],
        sequence: {
          stops: [],
          totalKm: 0,
          totalMinutes: 0,
          finishMinute: driver.shiftStartMinute,
          lateStops: [],
          overtimeMinutes: 0,
          waitMinutes: 0,
        },
      };
      continue;
    }

    // An already-collected parcel is on the vehicle: it must not be charged a collection leg,
    // and its delivery must not be handed to someone who never picked it up.
    const stops: DayStop[] = [];
    for (const job of mine) {
      if (!job.drop.alreadyOnBoard) stops.push(job.collection);
      stops.push(job.drop);
    }
    const sequence = sequenceDay({
      depot: driver.depot,
      stops,
      startMinute: driver.shiftStartMinute,
      endMinute: driver.shiftEndMinute,
      maxWaitMinutes: input.maxWaitMinutes,
    });

    fuelCents += sequence.totalKm * driver.costPerKmCents;
    overtimeMinutes += sequence.overtimeMinutes;
    waitMinutes += sequence.waitMinutes;
    for (const stop of sequence.stops) lateMinutes += stop.lateMinutes;
    constraintBreaches.push(...vehicleConstraints(mine, driver.vehicle));
    if (mine.length > driver.stopCapacity) capBreaches += mine.length - driver.stopCapacity;

    // Caps are about deliveries finished by a time of day, not about the whole day's total.
    const dropIds = new Set(mine.map((j) => j.drop.id));
    for (const cap of caps) {
      const within = sequence.stops.filter(
        (s) => dropIds.has(s.id) && s.departureMinute <= cap.untilMinute,
      ).length;
      if (within > cap.maxDrops) capBreaches += within - cap.maxDrops;
    }

    perDriver[driver.id] = { jobIds: mine.map((j) => j.id), sequence };
  }

  const placed = input.jobs.filter((j) => {
    const to = assignment[j.id];
    return to && input.drivers.some((d) => d.id === to);
  }).length;
  const unplaced = input.jobs.length - placed;

  // An idle driver is only a fault when there was work for them to take.
  const idleDrivers = loads.filter((n) => n === 0).length;
  const spare = Math.max(0, input.drivers.length - input.jobs.length);
  const wastedDrivers = Math.max(0, idleDrivers - spare);

  const spread = loads.length === 0 ? 0 : Math.max(...loads) - Math.min(...loads);
  const evenness = input.jobs.length >= input.drivers.length && spread > 1 ? spread * 200 : 0;

  const total =
    fuelCents / 100 +
    lateMinutes * 200 +
    overtimeMinutes * 5 +
    waitMinutes * 0.2 +
    capBreaches * 500 +
    constraintBreaches.length * 100_000 +
    wastedDrivers * 50_000 +
    unplaced * 99_999 +
    evenness;

  return {
    score: {
      total: round2(total),
      fuelCents: Math.round(fuelCents),
      lateMinutes: round(lateMinutes),
      overtimeMinutes: round(overtimeMinutes),
      waitMinutes: round(waitMinutes),
      capBreaches,
      constraintBreaches,
      idleDrivers,
      spread,
    },
    perDriver,
  };
}

/**
 * Share a day out between drivers.
 *
 * A seeded multi-start hill climb over `scoreAllocation`: start from a sensible greedy plan,
 * then from shuffled ones, and keep nudging single jobs between drivers while that helps. The
 * same input and seed always produce the same plan, which is what lets a dispatcher trust it —
 * a suggestion that changes every time you look at it is noise.
 *
 * It proposes. Nothing here assigns anything; a person does that.
 */
export function allocateDay(input: DayAllocationInput): DayAllocationResult {
  const { drivers, jobs } = input;
  if (jobs.length === 0 || drivers.length === 0) {
    return {
      assignment: {},
      score: {
        total: 0,
        fuelCents: 0,
        lateMinutes: 0,
        overtimeMinutes: 0,
        waitMinutes: 0,
        capBreaches: 0,
        constraintBreaches: [],
        idleDrivers: drivers.length,
        spread: 0,
      },
      perDriver: {},
      attempts: 0,
    };
  }

  const pinned = input.pinned ?? {};
  const free = jobs.filter((j) => !pinned[j.id]);
  const rng = mulberry32(input.seed ?? 0x5eed);
  const attempts = input.attempts ?? 6;

  let best = evaluate(greedy());
  let ran = 1;
  for (let i = 1; i < attempts; i++) {
    const candidate = evaluate(random());
    ran++;
    if (candidate.score.total < best.score.total) best = candidate;
  }

  // Hill climb: move one job at a time while it helps. Cheap, and it fixes the obvious
  // mistakes a greedy start makes without pretending to solve the problem exactly.
  let improved = true;
  let guard = 0;
  while (improved && guard < 40) {
    improved = false;
    guard++;
    for (const job of free) {
      for (const driver of drivers) {
        if (best.assignment[job.id] === driver.id) continue;
        const next = { ...best.assignment, [job.id]: driver.id };
        const candidate = evaluate(next);
        ran++;
        if (candidate.score.total < best.score.total - 0.001) {
          best = candidate;
          improved = true;
        }
      }
    }
  }

  return { ...best, attempts: ran };

  function evaluate(assignment: Record<string, string>) {
    const { score, perDriver } = scoreAllocation(input, assignment);
    return { assignment, score, perDriver };
  }

  /** Nearest depot, with a nudge towards drivers who have nothing yet. */
  function greedy(): Record<string, string> {
    const out: Record<string, string> = { ...pinned };
    const loads = new Map(drivers.map((d) => [d.id, 0]));
    for (const id of Object.values(pinned)) loads.set(id, (loads.get(id) ?? 0) + 1);
    const target = Math.max(1, Math.ceil(jobs.length / drivers.length));

    for (const job of free) {
      let bestDriver = drivers[0]!;
      let bestScore = Number.POSITIVE_INFINITY;
      for (const driver of drivers) {
        const load = loads.get(driver.id) ?? 0;
        const distance =
          haversineKm(driver.depot, job.collection.location) +
          haversineKm(job.collection.location, job.drop.location);
        const score = distance + (load >= target ? 30 : 0) + (load === 0 ? -20 : 0);
        if (score < bestScore) {
          bestScore = score;
          bestDriver = driver;
        }
      }
      out[job.id] = bestDriver.id;
      loads.set(bestDriver.id, (loads.get(bestDriver.id) ?? 0) + 1);
    }
    return out;
  }

  /** A shuffled start, so the climb is not stuck with the greedy plan's blind spots. */
  function random(): Record<string, string> {
    const out: Record<string, string> = { ...pinned };
    const order = shuffle(free, rng);
    // Give everyone one job before anyone gets two: an idle driver is the costliest mistake.
    order.forEach((job, i) => {
      out[job.id] = drivers[i % drivers.length]!.id;
    });
    return out;
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

function sameArea(a: GroupableStop, b: GroupableStop, radiusKm: number): boolean {
  const areaA = a.area?.trim().toLowerCase();
  const areaB = b.area?.trim().toLowerCase();
  if (areaA && areaB && areaA === areaB) return true;
  return haversineKm(a.location, b.location) <= radiusKm;
}

function groupKey(stop: GroupableStop): string {
  const area = stop.area?.trim().toLowerCase();
  if (area) return `area:${area}`;
  return `at:${stop.location.lat.toFixed(3)},${stop.location.lng.toFixed(3)}`;
}

function maxOrNull(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
}

function minOrNull(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return Math.min(a, b);
}

/** A tiny seeded generator, so "shuffle" is repeatable and a plan never changes under you. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function round(n: number): number {
  return Math.round(n);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
