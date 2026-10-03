import { describe, expect, it } from "vitest";
import {
  allocateDay,
  groupCollections,
  groupingAdvisories,
  scoreAllocation,
  sequenceDay,
  serviceMinutes,
  vehicleConstraints,
  type DayJob,
  type DayStop,
  type DayDriver,
} from "./operations.js";

const DEPOT = { lat: -25.7479, lng: 28.2293 };
const MENLYN = { lat: -25.7826, lng: 28.2755 };
const HATFIELD = { lat: -25.7487, lng: 28.2384 };
const CENTURION = { lat: -25.8603, lng: 28.1894 };
const SOSHANGUVE = { lat: -25.5233, lng: 28.1083 };

const collection = (id: string, location = MENLYN, over: Partial<DayStop> = {}): DayStop => ({
  id,
  kind: "collection",
  location,
  pieces: 1,
  ...over,
});
const drop = (
  id: string,
  after: string,
  location = HATFIELD,
  over: Partial<DayStop> = {},
): DayStop => ({
  id,
  kind: "drop",
  location,
  afterStopId: after,
  pieces: 1,
  ...over,
});

describe("service time", () => {
  it("gives a collection longer than a drop, and both grow with pieces", () => {
    expect(serviceMinutes("collection", 1)).toBeGreaterThan(serviceMinutes("drop", 1));
    expect(serviceMinutes("collection", 4)).toBeGreaterThan(serviceMinutes("collection", 1));
    expect(serviceMinutes("drop", 6)).toBeGreaterThan(serviceMinutes("drop", 2));
  });

  it("holds a floor and a ceiling", () => {
    // A driver cannot do anything in under three minutes, and a van with forty parcels does
    // several stops rather than spending an hour at one door.
    expect(serviceMinutes("drop", 0)).toBe(3);
    expect(serviceMinutes("collection", 0)).toBe(5);
    expect(serviceMinutes("drop", 100)).toBe(15);
    expect(serviceMinutes("collection", 100)).toBe(15);
  });
});

describe("grouping collections", () => {
  it("merges pickups in the same area that are ready at about the same time", () => {
    const groups = groupCollections([
      collection("a", MENLYN, { area: "Menlyn", earliestMinute: 540 }),
      collection("b", MENLYN, { area: "Menlyn", earliestMinute: 550 }),
      collection("c", CENTURION, { area: "Centurion", earliestMinute: 545 }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.stopIds.includes("a"))!.stopIds.sort()).toEqual(["a", "b"]);
    expect(groups.find((g) => g.stopIds.includes("c"))!.stopIds).toEqual(["c"]);
  });

  it("keeps pickups apart when their ready times are too far apart to be one visit", () => {
    const groups = groupCollections([
      collection("a", MENLYN, { area: "Menlyn", earliestMinute: 540 }),
      collection("b", MENLYN, { area: "Menlyn", earliestMinute: 700 }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("narrows a merged group to the window that satisfies everyone in it", () => {
    const [group] = groupCollections([
      collection("a", MENLYN, { area: "Menlyn", earliestMinute: 540, latestMinute: 660 }),
      collection("b", MENLYN, { area: "Menlyn", earliestMinute: 550, latestMinute: 600 }),
    ]);
    // Start no earlier than the latest "ready", finish no later than the earliest deadline.
    expect(group!.earliestMinute).toBe(550);
    expect(group!.latestMinute).toBe(600);
  });

  it("groups by distance when there is no area name to go on", () => {
    const groups = groupCollections([
      collection("a", { lat: -25.78, lng: 28.27 }, { earliestMinute: 540 }),
      collection("b", { lat: -25.7801, lng: 28.2701 }, { earliestMinute: 541 }),
    ]);
    expect(groups).toHaveLength(1);
  });

  it("ignores drops entirely", () => {
    expect(groupCollections([drop("d1", "a")])).toHaveLength(0);
  });
});

describe("grouping advisories", () => {
  it("says nothing about a single stop", () => {
    expect(groupingAdvisories([collection("a")])).toEqual([]);
  });

  it("mentions a mix of collections and deliveries", () => {
    const out = groupingAdvisories([collection("a", MENLYN), drop("b", "a", MENLYN)]);
    expect(out.join(" ")).toContain("collections and deliveries");
  });

  it("mentions a spread the dispatcher may not have noticed", () => {
    const out = groupingAdvisories([
      collection("a", MENLYN, { area: "Menlyn" }),
      collection("b", HATFIELD, { area: "Menlyn" }),
    ]);
    expect(out.join(" ")).toContain("km apart");
  });

  it("mentions windows that cannot both be met", () => {
    const out = groupingAdvisories([
      collection("a", MENLYN, { earliestMinute: 540, latestMinute: 560 }),
      collection("b", MENLYN, { earliestMinute: 600, latestMinute: 620 }),
    ]);
    expect(out.join(" ")).toContain("do not overlap");
  });

  it("never refuses, however bad the grouping", () => {
    // The dispatcher has the phone and the local knowledge. This advises; it cannot block.
    const out = groupingAdvisories([
      collection("a", MENLYN, { earliestMinute: 540, latestMinute: 560 }),
      drop("b", "a", SOSHANGUVE, { earliestMinute: 900, latestMinute: 960 }),
    ]);
    expect(Array.isArray(out)).toBe(true);
    expect(out.length).toBeGreaterThan(0);
  });
});

describe("sequencing a day", () => {
  it("never delivers a parcel before it has been collected", () => {
    const result = sequenceDay({
      depot: DEPOT,
      startMinute: 420,
      // The drop is next to the depot and the collection is far away, so distance alone would
      // put the delivery first.
      stops: [collection("c1", SOSHANGUVE), drop("d1", "c1", DEPOT)],
    });
    expect(result.stops.map((s) => s.id)).toEqual(["c1", "d1"]);
  });

  it("waits for a pickup that is not ready when it has nothing else to do", () => {
    const result = sequenceDay({
      depot: DEPOT,
      startMinute: 420,
      stops: [collection("c1", HATFIELD, { earliestMinute: 600 })],
    });
    const stop = result.stops[0]!;
    expect(stop.waitMinutes).toBeGreaterThan(0);
    expect(stop.arrivalMinute).toBe(600);
  });

  it("goes and delivers rather than idling at a pickup that is not ready yet", () => {
    // One parcel already in the van, and a pickup that will not be ready for hours. Waiting
    // buys nothing, so the drop goes first.
    const result = sequenceDay({
      depot: DEPOT,
      startMinute: 420,
      maxWaitMinutes: 20,
      stops: [
        collection("c_late", HATFIELD, { earliestMinute: 900 }),
        drop("d_onboard", "c_done", CENTURION, { alreadyOnBoard: true }),
      ],
    });
    expect(result.stops.map((s) => s.id)).toEqual(["d_onboard", "c_late"]);
  });

  it("charges no collection leg for a parcel already on the vehicle", () => {
    const result = sequenceDay({
      depot: DEPOT,
      startMinute: 420,
      stops: [drop("d1", "gone", HATFIELD, { alreadyOnBoard: true })],
    });
    expect(result.stops.map((s) => s.id)).toEqual(["d1"]);
  });

  it("rescues a delivery about to miss its window ahead of whatever is nearest", () => {
    const result = sequenceDay({
      depot: DEPOT,
      startMinute: 480,
      stops: [
        // Right next door, no deadline at all.
        drop("d_near", "x", HATFIELD, { alreadyOnBoard: true }),
        // Across town, and due in minutes.
        drop("d_urgent", "y", SOSHANGUVE, { alreadyOnBoard: true, latestMinute: 490 }),
      ],
    });
    expect(result.stops[0]!.id).toBe("d_urgent");
  });

  it("reports which stops were missed and by how much, rather than hiding it", () => {
    const result = sequenceDay({
      depot: DEPOT,
      startMinute: 420,
      stops: [collection("c1", SOSHANGUVE), drop("d1", "c1", CENTURION, { latestMinute: 430 })],
    });
    expect(result.lateStops).toContain("d1");
    expect(result.stops.find((s) => s.id === "d1")!.lateMinutes).toBeGreaterThan(0);
  });

  it("counts the run home, and the overtime past the shift", () => {
    const result = sequenceDay({
      depot: DEPOT,
      startMinute: 420,
      endMinute: 450,
      stops: [collection("c1", SOSHANGUVE), drop("d1", "c1", SOSHANGUVE)],
    });
    // Two far stops and the drive back cannot fit in half an hour.
    expect(result.overtimeMinutes).toBeGreaterThan(0);
    expect(result.finishMinute).toBeGreaterThan(450);
    expect(result.totalKm).toBeGreaterThan(0);
  });

  it("honours a pinned minute as an anchor", () => {
    const result = sequenceDay({
      depot: DEPOT,
      startMinute: 420,
      stops: [drop("d1", "x", HATFIELD, { alreadyOnBoard: true, pinnedMinute: 630 })],
    });
    expect(result.stops[0]!.arrivalMinute).toBe(630);
  });

  it("is deterministic: the same day always sequences the same way", () => {
    const input = {
      depot: DEPOT,
      startMinute: 420,
      stops: [
        collection("c1", MENLYN),
        collection("c2", CENTURION),
        drop("d1", "c1", HATFIELD),
        drop("d2", "c2", SOSHANGUVE),
      ],
    };
    const a = sequenceDay(input);
    const b = sequenceDay(input);
    expect(a.stops.map((s) => s.id)).toEqual(b.stops.map((s) => s.id));
    expect(a.totalKm).toBe(b.totalKm);
  });

  it("does not drop a stop when the precedence data contradicts itself", () => {
    // Two drops each claiming to wait for the other. Nothing is ever ready, and the old code
    // would have looped; this must still visit both.
    const result = sequenceDay({
      depot: DEPOT,
      startMinute: 420,
      stops: [drop("a", "b", MENLYN), drop("b", "a", HATFIELD)],
    });
    expect(result.stops.map((s) => s.id).sort()).toEqual(["a", "b"]);
  });

  it("handles an empty day without inventing a journey", () => {
    const result = sequenceDay({ depot: DEPOT, startMinute: 420, stops: [] });
    expect(result.stops).toEqual([]);
    expect(result.totalKm).toBe(0);
    expect(result.overtimeMinutes).toBe(0);
  });
});

describe("vehicle constraints", () => {
  const vitz = {
    class: "hatchback",
    maxParcels: 6,
    excludedPackageTypes: ["cake_3_tier"],
    maxByPackageType: { platter: 3 },
  };

  it("refuses what the vehicle cannot carry", () => {
    const breaches = vehicleConstraints(
      [{ id: "j1", pieces: 1, packageTypeCodes: ["cake_3_tier"] }],
      vitz,
    );
    expect(breaches).toHaveLength(1);
    expect(breaches[0]).toMatchObject({ jobId: "j1", rule: "excluded_package" });
  });

  it("counts a per-type ceiling across the whole load, not per job", () => {
    const jobs = [
      { id: "j1", pieces: 2, packageTypeCodes: ["platter"] },
      { id: "j2", pieces: 2, packageTypeCodes: ["platter"] },
    ];
    const breaches = vehicleConstraints(jobs, vitz);
    expect(breaches.some((b) => b.rule === "package_cap")).toBe(true);
    // Each job alone is fine; together they are not.
    expect(vehicleConstraints([jobs[0]!], vitz)).toHaveLength(0);
  });

  it("counts total parcels", () => {
    const breaches = vehicleConstraints([{ id: "j1", pieces: 9, packageTypeCodes: ["box"] }], vitz);
    expect(breaches.some((b) => b.rule === "parcel_cap")).toBe(true);
  });

  it("holds a job that insists on a vehicle class", () => {
    const breaches = vehicleConstraints(
      [{ id: "j1", pieces: 1, packageTypeCodes: ["box"], requiresVehicleClass: "cargo" }],
      vitz,
    );
    expect(breaches[0]).toMatchObject({ rule: "vehicle_class" });
    expect(breaches[0]!.detail).toContain("cargo");
  });

  it("says so when a driver has no vehicle recorded and the job needs one", () => {
    const breaches = vehicleConstraints(
      [{ id: "j1", pieces: 1, packageTypeCodes: ["box"], requiresVehicleClass: "cargo" }],
      null,
    );
    expect(breaches).toHaveLength(1);
    expect(breaches[0]!.detail).toContain("none recorded");
  });

  it("passes a load that breaks nothing", () => {
    expect(vehicleConstraints([{ id: "j1", pieces: 2, packageTypeCodes: ["box"] }], vitz)).toEqual(
      [],
    );
  });
});

describe("allocating a day", () => {
  const driver = (id: string, over: Partial<DayDriver> = {}): DayDriver => ({
    id,
    depot: DEPOT,
    shiftStartMinute: 420,
    shiftEndMinute: 1020,
    stopCapacity: 20,
    costPerKmCents: 250,
    ...over,
  });
  const job = (
    id: string,
    from: typeof MENLYN,
    to: typeof HATFIELD,
    over: Partial<DayJob> = {},
  ): DayJob => ({
    id,
    pieces: 1,
    packageTypeCodes: ["box"],
    collection: collection(`c_${id}`, from),
    drop: drop(`d_${id}`, `c_${id}`, to),
    ...over,
  });

  it("never leaves a driver idle while there is work to take", () => {
    const result = allocateDay({
      drivers: [driver("d1"), driver("d2")],
      jobs: [
        job("j1", MENLYN, HATFIELD),
        job("j2", CENTURION, SOSHANGUVE),
        job("j3", MENLYN, CENTURION),
        job("j4", HATFIELD, MENLYN),
      ],
    });
    expect(new Set(Object.values(result.assignment)).size).toBe(2);
    expect(result.score.idleDrivers).toBe(0);
  });

  it("does not punish an idle driver when there is genuinely nothing for them", () => {
    const result = allocateDay({
      drivers: [driver("d1"), driver("d2"), driver("d3")],
      jobs: [job("j1", MENLYN, HATFIELD)],
    });
    // Two drivers must be idle; that is arithmetic, not a bad plan.
    expect(result.score.idleDrivers).toBe(2);
    expect(result.score.total).toBeLessThan(50_000);
  });

  it("keeps a job off a vehicle that cannot carry it", () => {
    const result = allocateDay({
      drivers: [
        driver("hatch", { vehicle: { class: "hatchback", excludedPackageTypes: ["cake_3_tier"] } }),
        driver("cargo", { vehicle: { class: "cargo" } }),
      ],
      jobs: [
        job("cake", MENLYN, HATFIELD, { packageTypeCodes: ["cake_3_tier"] }),
        job("box", MENLYN, CENTURION),
      ],
    });
    expect(result.assignment["cake"]).toBe("cargo");
    expect(result.score.constraintBreaches).toEqual([]);
  });

  it("respects a job a dispatcher has already placed", () => {
    const result = allocateDay({
      drivers: [driver("d1"), driver("d2")],
      jobs: [job("j1", MENLYN, HATFIELD), job("j2", CENTURION, SOSHANGUVE)],
      pinned: { j1: "d2" },
    });
    expect(result.assignment["j1"]).toBe("d2");
  });

  it("is deterministic: the same day and seed give the same plan", () => {
    const input = {
      drivers: [driver("d1"), driver("d2")],
      jobs: [
        job("j1", MENLYN, HATFIELD),
        job("j2", CENTURION, SOSHANGUVE),
        job("j3", MENLYN, CENTURION),
      ],
      seed: 42,
    };
    expect(allocateDay(input).assignment).toEqual(allocateDay(input).assignment);
  });

  it("counts a cap on deliveries finished before a time of day", () => {
    const drivers = [driver("d1")];
    const jobs = Array.from({ length: 4 }, (_, i) => job(`j${i}`, MENLYN, HATFIELD));
    const assignment = Object.fromEntries(jobs.map((j) => [j.id, "d1"]));
    const withoutCap = scoreAllocation({ drivers, jobs }, assignment);
    const withCap = scoreAllocation(
      { drivers, jobs, caps: [{ untilMinute: 720, maxDrops: 1 }] },
      assignment,
    );
    expect(withCap.score.capBreaches).toBeGreaterThan(withoutCap.score.capBreaches);
    expect(withCap.score.total).toBeGreaterThan(withoutCap.score.total);
  });

  it("prices a late delivery far above a long drive", () => {
    const drivers = [driver("d1")];
    const near = [job("j1", MENLYN, HATFIELD)];
    const far = [job("j2", MENLYN, SOSHANGUVE)];
    const late = [
      job("j3", MENLYN, HATFIELD, { drop: drop("d_j3", "c_j3", HATFIELD, { latestMinute: 425 }) }),
    ];

    const longDrive = scoreAllocation({ drivers, jobs: far }, { j2: "d1" }).score;
    const missed = scoreAllocation({ drivers, jobs: late }, { j3: "d1" }).score;
    const fine = scoreAllocation({ drivers, jobs: near }, { j1: "d1" }).score;

    expect(missed.lateMinutes).toBeGreaterThan(0);
    expect(missed.total).toBeGreaterThan(longDrive.total);
    expect(fine.lateMinutes).toBe(0);
  });

  it("gives each driver a sequenced day, not just a list", () => {
    const result = allocateDay({
      drivers: [driver("d1")],
      jobs: [job("j1", MENLYN, HATFIELD), job("j2", CENTURION, SOSHANGUVE)],
    });
    const day = result.perDriver["d1"]!;
    expect(day.jobIds.sort()).toEqual(["j1", "j2"]);
    expect(day.sequence.stops).toHaveLength(4);
    // Every collection precedes its own drop.
    const order = day.sequence.stops.map((s) => s.id);
    expect(order.indexOf("c_j1")).toBeLessThan(order.indexOf("d_j1"));
    expect(order.indexOf("c_j2")).toBeLessThan(order.indexOf("d_j2"));
  });

  it("answers an empty day without inventing a plan", () => {
    const result = allocateDay({ drivers: [driver("d1")], jobs: [] });
    expect(result.assignment).toEqual({});
    expect(result.score.total).toBe(0);
  });

  it("answers when there are no drivers at all rather than throwing", () => {
    const result = allocateDay({ drivers: [], jobs: [job("j1", MENLYN, HATFIELD)] });
    expect(result.assignment).toEqual({});
  });
});
