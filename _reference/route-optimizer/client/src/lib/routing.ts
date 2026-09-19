import type { Shipment, Driver, Stop, HandoffPoint, HandoffEvent, DeliveryOverrides, CollectionOverrides, StopGrouping, StopGroupings } from "@shared/schema";
import { calcDrive, haversine, toM, fmM, svcTime } from "./geo";
import { getFleet, getFleetSettings, VEHICLE_VITZ_IDS, VEHICLE_I10_IDS, VITZ_RULES, I10_RULES } from "./fleet";
import { DEFAULT_HANDOFF_POINTS } from "./handoff-points";
import { getRoadById } from "./roads";
import { toDispatchStopStatus, isShipmentTerminal, isShipmentCollected } from "@shared/status";

interface Batch {
  ck: string;
  cLat: number;
  cLng: number;
  cSub: string;
  cCity: string;
  cAddr: string;
  acc: string;
  cAfter: string;
  cBefore: string;
  cContact: string;
  cPhone: string;
  iCol: string;
  ships: Shipment[];
}

/**
 * Apply dispatcher delivery-window overrides to a shipment list.
 *
 * Only the delivery window (dAfter/dBefore) can be overridden — collection
 * windows are kept intact (drivers can't collect earlier than the sender
 * permits). The original CSV/webhook window is preserved on `origDAfter`
 * / `origDBefore` so the UI can show "was 14:00-17:00" badges without
 * losing data on re-import.
 *
 * Returns the same array reference (no clone) when there are no overrides
 * to apply, so React memoisation stays cheap.
 */
export function applyDeliveryOverrides(
  ships: Shipment[],
  overrides: DeliveryOverrides | undefined,
): Shipment[] {
  if (!overrides || Object.keys(overrides).length === 0) return ships;
  return ships.map((s) => {
    const ov = overrides[s.id];
    if (!ov) return s;
    // When `pinnedTime` is set, narrow the effective delivery window to the
    // exact pinned minute so the optimizer (which uses dAfter as min-wait
    // and dBefore as lateness deadline) honours the pin as a hard anchor.
    let newAfter: string, newBefore: string, pinned: string | undefined;
    if (ov.pinnedTime) {
      newAfter = ov.pinnedTime;
      newBefore = ov.pinnedTime;
      pinned = ov.pinnedTime;
    } else {
      newAfter = ov.dAfter ?? s.dAfter;
      newBefore = ov.dBefore ?? s.dBefore;
    }
    if (newAfter === s.dAfter && newBefore === s.dBefore && !pinned) return s;
    return {
      ...s,
      dAfter: newAfter,
      dBefore: newBefore,
      origDAfter: s.origDAfter ?? s.dAfter,
      origDBefore: s.origDBefore ?? s.dBefore,
      pinnedDelTime: pinned,
    };
  });
}

/**
 * Apply dispatcher collection-window overrides to a shipment list. Mirrors
 * `applyDeliveryOverrides` on the collection (pickup) side. When `pinnedTime`
 * is set, the cAfter/cBefore window is narrowed to that minute so the
 * scheduler treats it as a hard anchor (collection batch builder uses
 * `cAfter`/`cBefore` to group nearby pickups and schedule arrival).
 */
export function applyCollectionOverrides(
  ships: Shipment[],
  overrides: CollectionOverrides | undefined,
): Shipment[] {
  if (!overrides || Object.keys(overrides).length === 0) return ships;
  return ships.map((s) => {
    const ov = overrides[s.id];
    if (!ov) return s;
    let newAfter: string, newBefore: string, pinned: string | undefined;
    if (ov.pinnedTime) {
      newAfter = ov.pinnedTime;
      newBefore = ov.pinnedTime;
      pinned = ov.pinnedTime;
    } else {
      newAfter = ov.cAfter ?? s.cAfter;
      newBefore = ov.cBefore ?? s.cBefore;
    }
    if (newAfter === s.cAfter && newBefore === s.cBefore && !pinned) return s;
    return {
      ...s,
      cAfter: newAfter,
      cBefore: newBefore,
      origCAfter: s.origCAfter ?? s.cAfter,
      origCBefore: s.origCBefore ?? s.cBefore,
      pinnedColTime: pinned,
    };
  });
}

export function buildBatches(myShips: Shipment[]): Batch[] {
  const batches: Batch[] = [];
  myShips.forEach((s) => {
    const ck = s.cSub.trim().toLowerCase() || (Math.round(s.cLat * 1000) + "," + Math.round(s.cLng * 1000));
    let merged = false;
    batches.forEach((b) => {
      if (!merged && b.ck === ck && Math.abs((toM(b.cAfter) || 0) - (toM(s.cAfter) || 0)) <= 15) {
        b.ships.push(s);
        merged = true;
        const sa = toM(s.cAfter), ba = toM(b.cAfter);
        if (sa && ba) {
          b.cAfter = fmM(Math.min(sa, ba));
          b.cBefore = fmM(Math.max(toM(s.cBefore) || sa, toM(b.cBefore) || ba));
        }
      }
    });
    if (!merged) {
      batches.push({
        ck, cLat: s.cLat, cLng: s.cLng, cSub: s.cSub, cCity: s.cCity || "", cAddr: s.cAddr,
        acc: s.acc, cAfter: s.cAfter, cBefore: s.cBefore,
        cContact: s.cContact, cPhone: s.cPhone, iCol: s.iCol, ships: [s]
      });
    }
  });
  batches.sort((a, b) => (toM(a.cAfter) || 0) - (toM(b.cAfter) || 0));
  return batches;
}

// Dispatchers retain full authority over grouping decisions, so the question
// "can these be merged?" is always YES. Callers that want to know about
// possible issues with a proposed group should call `mergeWarnings()` and
// surface the strings to the user as soft (non-blocking) advisories.
export function stopsCanMerge(_a: Stop, _b: Stop): boolean {
  return true;
}

// Soft advisories about a proposed grouping. Returns an empty array when
// nothing is worth flagging. Never blocks the operation.
export function mergeWarnings(stops: Stop[]): string[] {
  const out: string[] = [];
  if (stops.length < 2) return out;
  const types = new Set(stops.map((s) => s.type));
  if (types.size > 1) out.push("Mixing pickup and delivery stops in one group");
  // Distance check between every pair (cheap for small N).
  let maxKm = 0;
  for (let i = 0; i < stops.length; i++) {
    for (let j = i + 1; j < stops.length; j++) {
      const km = haversine({ lat: stops[i].lat, lng: stops[i].lng }, { lat: stops[j].lat, lng: stops[j].lng });
      if (km > maxKm) maxKm = km;
    }
  }
  if (maxKm > 0.3) out.push(`Stops are up to ${maxKm.toFixed(2)}km apart — driver will still service them as one stop`);
  // Window intersection: warn if the tightest intersection is empty.
  let lo = 0, hi = 1440;
  for (const s of stops) {
    const ws = toM(s.win?.split("-")[0] || "") || 0;
    const we = toM(s.win?.split("-")[1] || "") || 1440;
    lo = Math.max(lo, ws);
    hi = Math.min(hi, we);
  }
  if (hi <= lo) out.push("Time windows do not overlap — combined stop will inherit the earliest start and latest end");
  return out;
}

// Two stops are considered same-location for time-collapsing purposes when
// they're within 50m of each other.
export function sameLocation(a: Stop, b: Stop): boolean {
  if (!a.lat || !b.lat) return false;
  return haversine({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng }) <= 0.05;
}

// Combine N stops into one grouped stop. Captures `unmergedIds` so Ungroup
// can rebuild atomically without consulting the live shipment list.
// Window intersection: lowest-end-of-window AND highest-start-of-window is
// the strictest combined window. When the intersection is empty we fall
// back to the union (earliest start, latest end) so the driver still has
// a usable window to work with.
export function combineStops(stops: Stop[]): Stop {
  if (stops.length === 0) throw new Error("combineStops: empty input");
  if (stops.length === 1) return { ...stops[0] };
  const first = stops[0];
  let lo = 0, hi = 1440;
  let unionLo = 1440, unionHi = 0;
  for (const s of stops) {
    const ws = toM(s.win?.split("-")[0] || "") || 0;
    const we = toM(s.win?.split("-")[1] || "") || 1440;
    lo = Math.max(lo, ws);
    hi = Math.min(hi, we);
    unionLo = Math.min(unionLo, ws);
    unionHi = Math.max(unionHi, we);
  }
  const mergedWin = hi > lo ? `${fmM(lo)}-${fmM(hi)}` : `${fmM(unionLo)}-${fmM(unionHi)}`;
  // Flatten any prior `unmergedIds` so we always carry the original atomic
  // shipment IDs, not nested grouping records.
  const unmergedIds: string[][] = [];
  for (const s of stops) {
    if (s.unmergedIds && s.unmergedIds.length) {
      unmergedIds.push(...s.unmergedIds.map((arr) => arr.slice()));
    } else {
      unmergedIds.push(s.ids.slice());
    }
  }
  // Service time: when all stops are co-located, a single service window
  // covers them all — pick the largest svcMin and add a small handling
  // multiplier per extra shipment. When they're not co-located, sum the
  // per-stop service times (conservative).
  const coLocated = stops.every((s) => sameLocation(first, s));
  const maxSvc = stops.reduce((m, s) => Math.max(m, s.svcMin), 0);
  const extraShips = stops.reduce((n, s) => n + Math.max(0, s.ids.length - 1), 0) + Math.max(0, stops.length - 1);
  const svcMin = coLocated ? maxSvc + Math.round(extraShips * 0.5) : stops.reduce((sum, s) => sum + s.svcMin, 0);
  const merged: Stop = {
    ...first,
    ids: stops.flatMap((s) => s.ids),
    wbs: stops.flatMap((s) => s.wbs),
    pcs: stops.reduce((n, s) => n + (s.pcs || 0), 0),
    kg: Math.round(stops.reduce((n, s) => n + (s.kg || 0), 0) * 10) / 10,
    win: mergedWin,
    svcMin,
    key: stops.map((s) => s.key).join("+"),
    unmergedIds,
    grouped: true,
  };
  return merged;
}

// Apply pinned dispatcher groupings to a driver's stop list. Walks each
// pinned group and finds stops whose ids fall inside the group + same type,
// then replaces them with a single combined stop at the position of the
// earliest matching stop. Groups whose shipments are no longer present
// (e.g. reassigned to another driver) are silently skipped.
export function applyStopGroupings(stops: Stop[], groupings: StopGrouping[] | undefined): Stop[] {
  if (!groupings || groupings.length === 0) return stops;
  let work = stops.slice();
  for (const g of groupings) {
    if (!g.ids || g.ids.length < 2) continue;
    const wanted = new Set(g.ids);
    const matchedIdxs: number[] = [];
    work.forEach((s, i) => {
      if (s.type !== g.type) return;
      // A stop matches the group when every id in the stop is also in the
      // pinned group AND at least one id overlaps.
      const sids = s.ids || [];
      if (sids.length === 0) return;
      if (!sids.some((id) => wanted.has(id))) return;
      if (!sids.every((id) => wanted.has(id))) return;
      matchedIdxs.push(i);
    });
    if (matchedIdxs.length < 2) continue;
    const matchedStops = matchedIdxs.map((i) => work[i]);
    const combined = combineStops(matchedStops);
    // Place combined at the first matched index, remove the rest.
    const firstIdx = matchedIdxs[0];
    const removeSet = new Set(matchedIdxs.slice(1));
    work = work.map((s, i) => (i === firstIdx ? combined : s)).filter((_, i) => !removeSet.has(i));
  }
  return work;
}

export function applyStopGroupingsToTrips<T extends { stops: Stop[] }>(
  trips: Record<string, T>,
  groupings: StopGroupings | undefined,
): Record<string, T> {
  if (!groupings || Object.keys(groupings).length === 0) return trips;
  const out: Record<string, T> = {};
  for (const [driverId, trip] of Object.entries(trips)) {
    const pinned = groupings[driverId];
    out[driverId] = pinned && pinned.length > 0
      ? { ...trip, stops: applyStopGroupings(trip.stops, pinned) }
      : trip;
  }
  return out;
}

interface SeqAction {
  type: string;
  batch?: Batch;
  ship?: Shipment;
  legKm: number;
  legMin: number;
  waitMin?: number;
  svcMin: number;
}

export function interleaveSequence(batches: Batch[], curTime: number, curLat: number, curLng: number, preCollected: Shipment[] = []): SeqAction[] {
  const seq: SeqAction[] = [];
  const pendingCol = batches.map((b, i) => ({ idx: i, batch: b, done: false }));
  // Shipments already on the vehicle (collected / in-transit / out-for-delivery)
  // enter the route with no collection leg — seed them straight into the
  // delivery queue so they are scheduled as delivery-only stops.
  const pendingDel: Shipment[] = [...preCollected];
  let time = curTime, lat = curLat, lng = curLng;

  function bestNext(): any {
    const candidates: any[] = [];
    pendingCol.forEach((pc) => {
      if (pc.done) return;
      const readyM = toM(pc.batch.cAfter) || 0;
      const drv = calcDrive({ lat, lng }, { lat: pc.batch.cLat, lng: pc.batch.cLng }, time);
      const arriveAt = time + drv.min;
      const waitNeeded = Math.max(0, readyM - arriveAt);
      if (waitNeeded > 20 && pendingDel.length > 0) return;
      let bPcs = 0; pc.batch.ships.forEach((s) => { bPcs += s.pcs; });
      const colSvc = svcTime("C", bPcs);
      let score = drv.km * 0.5 + waitNeeded * 0.3;
      let earliestDL = 1080;
      pc.batch.ships.forEach((s) => { const dl = toM(s.dBefore) || 1080; if (dl < earliestDL) earliestDL = dl; });
      const dlUrgency = Math.max(0, (earliestDL - (arriveAt + colSvc)));
      if (dlUrgency < 60) score -= 30;
      if (dlUrgency < 30) score -= 50;
      candidates.push({ type: "C", pc, drv, score, wait: waitNeeded, svcMin: colSvc });
    });
    pendingDel.forEach((sh) => {
      const drv = calcDrive({ lat, lng }, { lat: sh.dLat, lng: sh.dLng }, time);
      const eta = time + drv.min;
      const deadline = toM(sh.dBefore) || 1080;
      const timeLeft = deadline - eta;
      let urgency = 0;
      if (timeLeft < 0) urgency = Math.abs(timeLeft) * 100;
      else if (timeLeft < 10) urgency = (10 - timeLeft) * 30;
      else if (timeLeft < 20) urgency = (20 - timeLeft) * 15;
      else if (timeLeft < 40) urgency = (40 - timeLeft) * 5;
      else if (timeLeft < 60) urgency = (60 - timeLeft) * 2;
      const score = drv.km * 0.3 - urgency;
      candidates.push({ type: "D", ship: sh, drv, score, eta, deadline, timeLeft, svcMin: svcTime("D", sh.pcs) });
    });
    if (!candidates.length) return null;
    candidates.sort((a: any, b: any) => a.score - b.score);
    let urgentDel: any = null;
    candidates.forEach((c: any) => {
      if (c.type === "D" && c.timeLeft < 20 && (!urgentDel || c.timeLeft < urgentDel.timeLeft)) urgentDel = c;
    });
    if (urgentDel && candidates[0] !== urgentDel && urgentDel.timeLeft < 10) return urgentDel;
    return candidates[0];
  }

  let safety = 0;
  while (safety < 200) {
    safety++;
    const hasPendingCol = pendingCol.some((pc) => !pc.done);
    if (!hasPendingCol && !pendingDel.length) break;
    const next = bestNext();
    if (!next) {
      let fc: any = null;
      pendingCol.forEach((pc) => {
        if (!pc.done && (!fc || (toM(pc.batch.cAfter) || 0) < (toM(fc.batch.cAfter) || 0))) fc = pc;
      });
      if (fc) {
        fc.done = true;
        let bPcs = 0; fc.batch.ships.forEach((s: Shipment) => { bPcs += s.pcs; });
        const drv = calcDrive({ lat, lng }, { lat: fc.batch.cLat, lng: fc.batch.cLng }, time);
        const colSvc = svcTime("C", bPcs);
        time = Math.max(time + drv.min, toM(fc.batch.cAfter) || 0) + colSvc;
        lat = fc.batch.cLat; lng = fc.batch.cLng;
        seq.push({ type: "C", batch: fc.batch, legKm: drv.km, legMin: drv.min, svcMin: colSvc });
        fc.batch.ships.forEach((s: Shipment) => { pendingDel.push(s); });
      } else break;
      continue;
    }
    if (next.type === "C") {
      next.pc.done = true;
      const readyM = toM(next.pc.batch.cAfter) || 0;
      const arriveAt = time + next.drv.min;
      time = Math.max(arriveAt, readyM) + next.svcMin;
      lat = next.pc.batch.cLat; lng = next.pc.batch.cLng;
      seq.push({ type: "C", batch: next.pc.batch, legKm: next.drv.km, legMin: next.drv.min, waitMin: Math.max(0, readyM - arriveAt), svcMin: next.svcMin });
      next.pc.batch.ships.forEach((s: Shipment) => { pendingDel.push(s); });
    } else {
      const idx = pendingDel.findIndex((s) => s.id === next.ship.id);
      if (idx >= 0) pendingDel.splice(idx, 1);
      time += next.drv.min + next.svcMin;
      lat = next.ship.dLat; lng = next.ship.dLng;
      seq.push({ type: "D", ship: next.ship, legKm: next.drv.km, legMin: next.drv.min, svcMin: next.svcMin });
    }
  }
  return seq;
}

const SAT_MORNING_CAP = 12;
const SAT_AFTERNOON_CAP = 8;
const SAT_MORNING_END = 720;

function evalVehicleConstraints(ships: Shipment[], fleet: Driver[], asgn: Record<string, string>): number {
  let penalty = 0;
  const vitzSet = new Set(VEHICLE_VITZ_IDS);
  const i10Set = new Set(VEHICLE_I10_IDS);

  fleet.forEach((d) => {
    const my = ships.filter((s) => asgn[s.id] === d.id);
    if (!my.length) return;

    const isVitz = vitzSet.has(d.id);
    const isI10 = i10Set.has(d.id);

    if (isVitz) {
      const cakeShips = my.filter((s) =>
        (s.parcelType || "").toLowerCase().includes("3-tier") ||
        (s.parcelType || "").toLowerCase().includes("3 tier") ||
        (s.parcelCategory || "").toLowerCase().includes("3-tier") ||
        (s.parcelCategory || "").toLowerCase().includes("3 tier")
      );
      penalty += cakeShips.length * 100000;

      const platterShips = my.filter((s) =>
        (s.parcelType || "").toLowerCase().includes("platter") ||
        (s.parcelCategory || "").toLowerCase().includes("platter")
      );
      const totalPlatterPcs = platterShips.reduce((sum, s) => sum + s.pcs, 0);
      if (totalPlatterPcs > VITZ_RULES.maxPlatterConsignments) {
        penalty += (totalPlatterPcs - VITZ_RULES.maxPlatterConsignments) * 50000;
      }

      const totalParcels = my.reduce((sum, s) => sum + s.pcs, 0);
      if (totalParcels > VITZ_RULES.maxParcels) {
        penalty += (totalParcels - VITZ_RULES.maxParcels) * 10000;
      }
    }

    if (!isI10) {
      const sweShips = my.filter((s) => s.acc === "SWE001");
      penalty += sweShips.length * 100000;
    }
  });

  return penalty;
}

function evalAssignment(ships: Shipment[], fleet: Driver[], asgn: Record<string, string>, isSaturday: boolean = false, handoffPts?: HandoffPoint[]): number {
  let totalCost = 0, totalLate = 0, totalWait = 0, overtimePen = 0, satCapPen = 0;
  let warnCount = 0;
  const driverCounts: number[] = [];
  fleet.forEach((d) => {
    const my = ships.filter((s) => asgn[s.id] === d.id);
    driverCounts.push(my.length);
    if (!my.length) return;
    // Mirror buildSched: already-collected shipments are delivery-only, so the
    // cost estimate must not charge them a collection leg either.
    const myCol = my.filter((s) => !isShipmentCollected((s as any).status));
    const myDelOnly = my.filter((s) => isShipmentCollected((s as any).status));
    const batches = buildBatches(myCol);
    const seq = interleaveSequence(batches, toM(d.shift[0])!, d.depotLat, d.depotLng, myDelOnly);
    let time = toM(d.shift[0])!, km = 0, lastLat = d.depotLat, lastLng = d.depotLng;
    let morningDel = 0, afternoonDel = 0;
    seq.forEach((act) => {
      km += act.legKm;
      if (act.type === "C" && act.batch) {
        const ready = toM(act.batch.cAfter) || 0;
        const arrive = time + act.legMin;
        const colEnd = toM(act.batch.cBefore) || ready;
        if (arrive > colEnd + 10) warnCount++;
        const colSlack = colEnd - arrive;
        if (colSlack < 15 && colSlack >= 0) warnCount++;
        totalWait += Math.max(0, ready - arrive);
        let bPcs = 0; act.batch.ships.forEach((s) => { bPcs += s.pcs; });
        time = Math.max(arrive, ready) + svcTime("C", bPcs);
        lastLat = act.batch.cLat; lastLng = act.batch.cLng;
      } else if (act.ship) {
        time += act.legMin;
        if (isSaturday) {
          if (time < SAT_MORNING_END) morningDel++;
          else afternoonDel++;
        }
        const dl = toM(act.ship.dBefore) || 1080;
        const delSlack = dl - time;
        if (delSlack < -5) { warnCount++; }
        else if (delSlack >= 0 && delSlack < 15) { warnCount++; }
        if (time > dl) {
          const lateBy = time - dl;
          totalLate += lateBy * (2 + lateBy * 1.5);
        }
        time += svcTime("D", act.ship.pcs);
        lastLat = act.ship.dLat; lastLng = act.ship.dLng;
      }
    });
    if (isSaturday) {
      if (morningDel > SAT_MORNING_CAP) satCapPen += (morningDel - SAT_MORNING_CAP) * 500;
      if (afternoonDel > SAT_AFTERNOON_CAP) satCapPen += (afternoonDel - SAT_AFTERNOON_CAP) * 500;
    }
    if (lastLat && lastLng && d.depotLat && d.depotLng) {
      const ret = calcDrive({ lat: lastLat, lng: lastLng }, { lat: d.depotLat, lng: d.depotLng }, time);
      km += ret.km; time += ret.min;
    }
    const shiftEnd = toM(d.shift[1]) || 1080;
    if (time > shiftEnd) overtimePen += (time - shiftEnd) * 5;
    totalCost += km * d.costPerKm;
  });

  let handoffSavings = 0;
  if (handoffPts && handoffPts.length > 0) {
    const activePts = handoffPts.filter((p) => p.active);
    if (activePts.length > 0 && fleet.length >= 2) {
      const depotDists = new Map<string, { lat: number; lng: number }>();
      fleet.forEach((dd) => depotDists.set(dd.id, { lat: dd.depotLat, lng: dd.depotLng }));
      ships.forEach((sh) => {
        const assignedId = asgn[sh.id];
        if (!assignedId) return;
        const colDelDist = haversine({ lat: sh.cLat, lng: sh.cLng }, { lat: sh.dLat, lng: sh.dLng });
        if (colDelDist <= 20) return;
        const assignedDepot = depotDists.get(assignedId);
        if (!assignedDepot) return;
        const assignedToDelDist = haversine(assignedDepot, { lat: sh.dLat, lng: sh.dLng });
        let bestShipSaving = 0;
        const midLat = (sh.cLat + sh.dLat) / 2;
        const midLng = (sh.cLng + sh.dLng) / 2;
        const sortedPts = activePts
          .map((hp) => ({ hp, dist: haversine({ lat: midLat, lng: midLng }, { lat: hp.lat, lng: hp.lng }) }))
          .sort((a, b) => a.dist - b.dist)
          .slice(0, 5);
        fleet.forEach((otherD) => {
          if (otherD.id === assignedId) return;
          const otherDepot = depotDists.get(otherD.id)!;
          const otherToDelDist = haversine(otherDepot, { lat: sh.dLat, lng: sh.dLng });
          if (otherToDelDist >= assignedToDelDist * 0.7) return;
          sortedPts.forEach(({ hp }) => {
            const colToHp = haversine({ lat: sh.cLat, lng: sh.cLng }, { lat: hp.lat, lng: hp.lng });
            const hpToDel = haversine({ lat: hp.lat, lng: hp.lng }, { lat: sh.dLat, lng: sh.dLng });
            const saving = colDelDist - (colToHp + hpToDel + 5);
            if (saving > bestShipSaving) bestShipSaving = saving;
          });
        });
        if (bestShipSaving > 0) handoffSavings += bestShipSaving * 0.3;
      });
    }
  }

  let balancePen = 0;
  const totalShips = ships.length;
  const driverCount = fleet.length;
  const idle = driverCounts.filter((c) => c === 0).length;

  if (totalShips >= driverCount && idle > 0) {
    balancePen += idle * 50000;
  }

  if (totalShips >= 2 && totalShips < driverCount && idle > (driverCount - totalShips)) {
    balancePen += (idle - (driverCount - totalShips)) * 50000;
  }

  if (totalShips >= driverCount) {
    const avg = totalShips / driverCount;
    const maxCount = Math.max(...driverCounts);
    const minCount = Math.min(...driverCounts);
    const spread = maxCount - minCount;
    if (spread > 1) balancePen += spread * 200;
    driverCounts.forEach((c) => {
      const dev = Math.abs(c - avg);
      if (dev > 1) balancePen += dev * 100;
    });
  }

  const fleetIds = new Set(fleet.map((d) => d.id));
  const unroutedCount = ships.filter((s) => !asgn[s.id] || !fleetIds.has(asgn[s.id])).length;
  const orphanPenalty = unroutedCount * 99999;

  const warnPenalty = warnCount * 5000;
  const vehiclePen = evalVehicleConstraints(ships, fleet, asgn);
  return totalCost + totalLate * 200 + totalWait * 0.2 + overtimePen + balancePen + satCapPen + warnPenalty + orphanPenalty + vehiclePen - handoffSavings;
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

export function optimizeRoutes(
  ships: Shipment[], fleet: Driver[], usePreAssign: boolean,
  currentAsgn?: Record<string, string> | null,
  selectedDay?: string,
  handoffPoints?: HandoffPoint[]
): { asgn: Record<string, string>; cost: number; passes: number } {
  const isSaturday = selectedDay ? new Date(selectedDay + "T00:00:00").getDay() === 6 : false;
  if (!ships.length) return { asgn: {}, cost: 0, passes: 0 };
  const fids = fleet.map((d) => d.id);
  const fidSet = new Set(fids);

  const preAsgn: Record<string, string> = {};
  if (usePreAssign) {
    ships.forEach((s) => {
      const col = s.preColDriver;
      const del = s.preDelDriver;
      // An already-collected shipment is physically on the delivery driver's
      // vehicle, so prefer the delivery driver — the optimizer must not hand
      // its delivery to someone who never picked it up. Uncollected shipments
      // keep the collection-driver-first preference.
      if (isShipmentCollected((s as any).status)) {
        if (del && fidSet.has(del)) preAsgn[s.id] = del;
        else if (col && fidSet.has(col)) preAsgn[s.id] = col;
      } else {
        if (col && fidSet.has(col)) preAsgn[s.id] = col;
        else if (del && fidSet.has(del)) preAsgn[s.id] = del;
      }
    });
  }
  const freeShips = ships.filter((s) => !usePreAssign || !preAsgn[s.id]);

  if (currentAsgn) {
    const loads: Record<string, number> = {};
    fids.forEach((id) => { loads[id] = 0; });
    ships.forEach((s) => { if (currentAsgn![s.id] && fidSet.has(currentAsgn![s.id])) loads[currentAsgn![s.id]]++; });
    const sanitized: Record<string, string> = { ...currentAsgn };
    ships.forEach((s) => {
      if (!sanitized[s.id] || !fidSet.has(sanitized[s.id])) {
        const minD = fids.reduce((best, id) => loads[id] < loads[best] ? id : best, fids[0]);
        sanitized[s.id] = minD;
        loads[minD]++;
      }
    });
    currentAsgn = sanitized;
  }

  function randAsgn(): Record<string, string> {
    const a: Record<string, string> = {};
    if (usePreAssign) ships.forEach((s) => { if (preAsgn[s.id]) a[s.id] = preAsgn[s.id]; });
    const loads: Record<string, number> = {};
    fleet.forEach((d) => { loads[d.id] = 0; });
    ships.forEach((s) => { if (a[s.id]) loads[a[s.id]]++; });

    if (freeShips.length >= fleet.length) {
      const shuffled = shuffle(freeShips);
      fleet.forEach((d, i) => {
        if (i < shuffled.length && loads[d.id] === 0) {
          a[shuffled[i].id] = d.id;
          loads[d.id]++;
        }
      });
      shuffled.forEach((s) => {
        if (!a[s.id]) {
          const minD = fleet.reduce((best, d) => loads[d.id] < loads[best.id] ? d : best, fleet[0]);
          a[s.id] = minD.id;
          loads[minD.id]++;
        }
      });
    } else {
      const shuffledDrivers = shuffle(fids);
      shuffle(freeShips).forEach((s, i) => {
        a[s.id] = shuffledDrivers[i % shuffledDrivers.length];
      });
    }
    return a;
  }

  function perturb(base: Record<string, string>, n: number): Record<string, string> {
    const a = { ...base };
    shuffle(freeShips).slice(0, Math.min(n, freeShips.length)).forEach((s) => {
      const others = fids.filter((did) => did !== a[s.id]);
      if (others.length) a[s.id] = others[Math.floor(Math.random() * others.length)];
    });
    return a;
  }

  function greedyProx(): Record<string, string> {
    const a: Record<string, string> = {};
    const loads: Record<string, number> = {};
    fleet.forEach((d) => { loads[d.id] = 0; });
    const targetPer = Math.max(1, Math.ceil(ships.length / fleet.length));
    ships.forEach((s) => {
      if (usePreAssign && preAsgn[s.id]) { a[s.id] = preAsgn[s.id]; loads[preAsgn[s.id]]++; return; }
      let bestD: string | null = null, bestScore = Infinity;
      fleet.forEach((d) => {
        const km = calcDrive({ lat: d.depotLat, lng: d.depotLng }, { lat: s.cLat, lng: s.cLng }).km +
          calcDrive({ lat: s.cLat, lng: s.cLng }, { lat: s.dLat, lng: s.dLng }).km;
        const overPen = loads[d.id] >= targetPer ? 30 : 0;
        const emptyBonus = loads[d.id] === 0 ? -20 : 0;
        const score = km + overPen + emptyBonus;
        if (score < bestScore) { bestScore = score; bestD = d.id; }
      });
      if (!bestD) bestD = fleet[0].id;
      a[s.id] = bestD; loads[bestD]++;
    });
    return a;
  }

  function greedyDeadline(): Record<string, string> {
    const a: Record<string, string> = {};
    const loads: Record<string, number> = {};
    fleet.forEach((d) => { loads[d.id] = 0; });
    const sorted = ships.slice().sort((x, y) => (toM(x.dBefore) || 1080) - (toM(y.dBefore) || 1080));
    sorted.forEach((s) => {
      if (usePreAssign && preAsgn[s.id]) { a[s.id] = preAsgn[s.id]; loads[preAsgn[s.id]]++; return; }
      let bestD: string | null = null, bestScore = Infinity;
      fleet.forEach((d) => {
        const km = calcDrive({ lat: d.depotLat, lng: d.depotLng }, { lat: s.cLat, lng: s.cLng }).km;
        const bal = loads[d.id] * 5;
        if (km + bal < bestScore) { bestScore = km + bal; bestD = d.id; }
      });
      if (!bestD) bestD = fleet[0].id;
      a[s.id] = bestD; loads[bestD]++;
    });
    return a;
  }

  function greedyZone(): Record<string, string> {
    const a: Record<string, string> = {};
    const loads: Record<string, number> = {};
    fleet.forEach((d) => { loads[d.id] = 0; });
    const sorted = ships.slice().sort((x, y) => x.dLat - y.dLat);
    const perD = Math.ceil(sorted.length / fleet.length);
    sorted.forEach((s, i) => {
      if (usePreAssign && preAsgn[s.id]) { a[s.id] = preAsgn[s.id]; loads[preAsgn[s.id]]++; return; }
      const di = Math.min(Math.floor(i / perD), fleet.length - 1);
      const d = fleet[di];
      a[s.id] = d.id; loads[d.id]++;
    });
    return a;
  }

  function greedyBalanced(): Record<string, string> {
    const a: Record<string, string> = {};
    const loads: Record<string, number> = {};
    fleet.forEach((d) => { loads[d.id] = 0; });
    const sorted = ships.slice().sort((x, y) => {
      const dxMin = Math.min(...fleet.map((d) => calcDrive({ lat: d.depotLat, lng: d.depotLng }, { lat: x.cLat, lng: x.cLng }).km));
      const dyMin = Math.min(...fleet.map((d) => calcDrive({ lat: d.depotLat, lng: d.depotLng }, { lat: y.cLat, lng: y.cLng }).km));
      return dyMin - dxMin;
    });
    const targetPer = Math.max(1, Math.ceil(ships.length / fleet.length));
    sorted.forEach((s) => {
      if (usePreAssign && preAsgn[s.id]) { a[s.id] = preAsgn[s.id]; loads[preAsgn[s.id]]++; return; }
      let bestD: string | null = null, bestScore = Infinity;
      fleet.forEach((d) => {
        const km = calcDrive({ lat: d.depotLat, lng: d.depotLng }, { lat: s.cLat, lng: s.cLng }).km;
        const fullPen = loads[d.id] >= targetPer ? 40 : 0;
        const emptyBonus = loads[d.id] === 0 ? -25 : 0;
        const score = km + fullPen + emptyBonus;
        if (score < bestScore) { bestScore = score; bestD = d.id; }
      });
      if (!bestD) bestD = fleet[0].id;
      a[s.id] = bestD; loads[bestD]++;
    });
    return a;
  }

  function greedyPunctual(): Record<string, string> {
    const a: Record<string, string> = {};
    const driverTime: Record<string, number> = {};
    const driverLat: Record<string, number> = {};
    const driverLng: Record<string, number> = {};
    const loads: Record<string, number> = {};
    fleet.forEach((d) => {
      driverTime[d.id] = toM(d.shift[0])!;
      driverLat[d.id] = d.depotLat;
      driverLng[d.id] = d.depotLng;
      loads[d.id] = 0;
    });
    const sorted = ships.slice().sort((x, y) => {
      const xDL = toM(x.dBefore) || 1080;
      const yDL = toM(y.dBefore) || 1080;
      return xDL - yDL;
    });
    sorted.forEach((s) => {
      if (usePreAssign && preAsgn[s.id]) { a[s.id] = preAsgn[s.id]; loads[preAsgn[s.id]]++; return; }
      const dl = toM(s.dBefore) || 1080;
      let bestD: string | null = null, bestSlack = -Infinity;
      fleet.forEach((d) => {
        const colDrv = calcDrive({ lat: driverLat[d.id], lng: driverLng[d.id] }, { lat: s.cLat, lng: s.cLng }, driverTime[d.id]);
        const colReady = toM(s.cAfter) || 0;
        const colArrive = driverTime[d.id] + colDrv.min;
        const colEnd = Math.max(colArrive, colReady) + svcTime("C", s.pcs);
        const delDrv = calcDrive({ lat: s.cLat, lng: s.cLng }, { lat: s.dLat, lng: s.dLng }, colEnd);
        const eta = colEnd + delDrv.min;
        const slack = dl - eta;
        const balPen = loads[d.id] > Math.ceil(ships.length / fleet.length) ? -20 : 0;
        const emptyBonus = loads[d.id] === 0 ? 10 : 0;
        const score = slack + balPen + emptyBonus;
        if (score > bestSlack) { bestSlack = score; bestD = d.id; }
      });
      if (!bestD) bestD = fleet[0].id;
      a[s.id] = bestD;
      loads[bestD]++;
      const colDrv = calcDrive({ lat: driverLat[bestD], lng: driverLng[bestD] }, { lat: s.cLat, lng: s.cLng }, driverTime[bestD]);
      const colReady = toM(s.cAfter) || 0;
      const colArrive = driverTime[bestD] + colDrv.min;
      const colEnd = Math.max(colArrive, colReady) + svcTime("C", s.pcs);
      const delDrv = calcDrive({ lat: s.cLat, lng: s.cLng }, { lat: s.dLat, lng: s.dLng }, colEnd);
      driverTime[bestD] = colEnd + delDrv.min + svcTime("D", s.pcs);
      driverLat[bestD] = s.dLat;
      driverLng[bestD] = s.dLng;
    });
    return a;
  }

  function similarity(a: Record<string, string>): number {
    if (!isReopt) return 0;
    let same = 0;
    freeShips.forEach((s) => { if (a[s.id] === currentAsgn![s.id]) same++; });
    return freeShips.length > 0 ? same / freeShips.length : 0;
  }

  const isReopt = currentAsgn && Object.keys(currentAsgn).length > 0;
  const candidates: Record<string, string>[] = [
    greedyProx(), greedyDeadline(), greedyZone(), greedyBalanced(), greedyPunctual()
  ];

  if (isReopt) {
    for (let p = 0; p < 35; p++) {
      const moveCount = Math.max(2, Math.ceil(freeShips.length * (0.3 + Math.random() * 0.4)));
      candidates.push(perturb(currentAsgn!, moveCount));
    }
    [greedyProx(), greedyDeadline(), greedyZone(), greedyPunctual()].forEach((base) => {
      const inv = { ...base };
      freeShips.forEach((s) => {
        const others = fids.filter((did) => did !== base[s.id]);
        if (others.length) inv[s.id] = others[Math.floor(Math.random() * others.length)];
      });
      candidates.push(inv);
    });
  }
  for (let r = 0; r < 50; r++) candidates.push(randAsgn());

  if (isReopt) {
    candidates.push({ ...currentAsgn! });
  }

  const scored: { a: Record<string, string>; cost: number }[] = [];
  candidates.forEach((a) => {
    const cost = evalAssignment(ships, fleet, a, isSaturday, handoffPoints);
    scored.push({ a, cost });
  });
  scored.sort((a, b) => a.cost - b.cost);

  const top = scored.slice(0, 10);
  if (!top.length) return { asgn: randAsgn(), cost: 9999, passes: 0 };

  let globalBest = top[0].a;
  let globalBestCost = top[0].cost;

  top.forEach((entry) => {
    let cur = entry.a;
    let curCost = entry.cost;
    const temps = [200, 100, 50, 25, 12, 6, 3, 1.5, 0.5, 0.2, 0.05];
    temps.forEach((temp) => {
      for (let i = 0; i < 30; i++) {
        const n = temp > 10 ? Math.max(2, Math.ceil(freeShips.length * 0.4)) :
          temp > 2 ? Math.max(1, Math.ceil(freeShips.length * 0.2)) : 1;
        const trial = perturb(cur, n);
        const trialCost = evalAssignment(ships, fleet, trial, isSaturday, handoffPoints);
        const delta = trialCost - curCost;
        if (delta < 0 || Math.random() < Math.exp(-delta / Math.max(temp, 0.01))) {
          cur = trial; curCost = trialCost;
          if (curCost < globalBestCost) {
            globalBestCost = curCost; globalBest = cur;
          }
        }
      }
    });
  });

  let improved = true, passes = 0;
  while (improved && passes < 20) {
    improved = false; passes++;
    freeShips.forEach((s) => {
      fleet.forEach((d) => {
        if (d.id === globalBest[s.id]) return;
        const trial = { ...globalBest }; trial[s.id] = d.id;
        const tc = evalAssignment(ships, fleet, trial, isSaturday, handoffPoints);
        if (tc < globalBestCost - 0.1) { globalBestCost = tc; globalBest = trial; improved = true; }
      });
    });
    for (let i = 0; i < freeShips.length; i++) {
      for (let j = i + 1; j < freeShips.length; j++) {
        if (globalBest[freeShips[i].id] === globalBest[freeShips[j].id]) continue;
        const trial = { ...globalBest };
        trial[freeShips[i].id] = globalBest[freeShips[j].id];
        trial[freeShips[j].id] = globalBest[freeShips[i].id];
        const tc = evalAssignment(ships, fleet, trial, isSaturday, handoffPoints);
        if (tc < globalBestCost - 0.1) { globalBestCost = tc; globalBest = trial; improved = true; }
      }
    }
    for (let i = 0; i < freeShips.length; i++) {
      for (let j = i + 1; j < freeShips.length; j++) {
        for (let k = j + 1; k < freeShips.length; k++) {
          const ids = [freeShips[i].id, freeShips[j].id, freeShips[k].id];
          const drivers = ids.map((id) => globalBest[id]);
          if (new Set(drivers).size < 2) continue;
          const perms = [[1,2,0],[2,0,1]];
          for (const perm of perms) {
            const trial = { ...globalBest };
            ids.forEach((id, idx) => { trial[id] = drivers[perm[idx]]; });
            const tc = evalAssignment(ships, fleet, trial, isSaturday, handoffPoints);
            if (tc < globalBestCost - 0.1) { globalBestCost = tc; globalBest = trial; improved = true; }
          }
        }
      }
    }
  }

  if (isReopt && currentAsgn) {
    const countWarningsViaBuildSched = (a: Record<string, string>): number => {
      const schedResult = buildSched(ships, a, {}, selectedDay, fleet);
      let total = 0;
      Object.values(schedResult).forEach((td) => { total += td.warnings.length; });
      return total;
    };
    const currentCost = evalAssignment(ships, fleet, currentAsgn, isSaturday, handoffPoints);
    const currentWarn = countWarningsViaBuildSched(currentAsgn);
    const bestWarn = countWarningsViaBuildSched(globalBest);
    console.log("[Optimizer] Current assignment warnings:", currentWarn, "cost:", currentCost, "| Best found warnings:", bestWarn, "cost:", globalBestCost);
    if (currentCost < globalBestCost) {
      console.log("[Optimizer] Keeping current assignment (lower total cost)");
      globalBest = { ...currentAsgn };
      globalBestCost = currentCost;
    }
  }

  return { asgn: globalBest, cost: Math.round(globalBestCost), passes };
}

export function autoGenerateHandoffs(
  ships: Shipment[],
  fleet: Driver[],
  asgn: Record<string, string>,
  points: HandoffPoint[],
  selectedDay?: string
): HandoffEvent[] {
  const activePoints = points.filter((p) => p.active);
  if (!activePoints.length || fleet.length < 2 || !ships.length) return [];

  const candidates: {
    shipId: string;
    fromDriverId: string;
    toDriverId: string;
    pointId: string;
    saving: number;
    meetStart: number;
    meetEnd: number;
  }[] = [];

  ships.forEach((sh) => {
    const assignedId = asgn[sh.id];
    if (!assignedId) return;
    const colDelDist = haversine({ lat: sh.cLat, lng: sh.cLng }, { lat: sh.dLat, lng: sh.dLng });
    if (colDelDist <= 20) return;
    const assignedDriver = fleet.find((d) => d.id === assignedId);
    if (!assignedDriver) return;
    const assignedDepot = { lat: assignedDriver.depotLat, lng: assignedDriver.depotLng };
    const assignedToDelDist = haversine(assignedDepot, { lat: sh.dLat, lng: sh.dLng });

    let bestCandidate: typeof candidates[0] | null = null;

    fleet.forEach((otherD) => {
      if (otherD.id === assignedId) return;
      const otherDepot = { lat: otherD.depotLat, lng: otherD.depotLng };
      const otherToDelDist = haversine(otherDepot, { lat: sh.dLat, lng: sh.dLng });
      if (otherToDelDist >= assignedToDelDist * 0.8) return;

      activePoints.forEach((hp) => {
        const colToHp = calcDrive({ lat: sh.cLat, lng: sh.cLng }, { lat: hp.lat, lng: hp.lng });
        const hpToDel = calcDrive({ lat: hp.lat, lng: hp.lng }, { lat: sh.dLat, lng: sh.dLng });
        const directRoute = calcDrive({ lat: sh.cLat, lng: sh.cLng }, { lat: sh.dLat, lng: sh.dLng });
        const saving = directRoute.km - (colToHp.km + hpToDel.km + 5);
        if (saving <= 0) return;

        const shiftStart = toM(assignedDriver.shift[0]) || 360;
        const colReady = toM(sh.cAfter) || shiftStart;
        const colDrv = calcDrive({ lat: assignedDriver.depotLat, lng: assignedDriver.depotLng }, { lat: sh.cLat, lng: sh.cLng });
        const colArrive = Math.max(shiftStart + colDrv.min, colReady);
        const colEnd = colArrive + svcTime("C", sh.pcs);
        const meetStart = colEnd + colToHp.min;
        const meetEnd = meetStart + 15;

        const otherShiftStart = toM(otherD.shift[0]) || 360;
        const otherShiftEnd = toM(otherD.shift[1]) || 1080;
        if (meetStart < otherShiftStart || meetEnd > otherShiftEnd) return;

        if (!bestCandidate || saving > bestCandidate.saving) {
          bestCandidate = {
            shipId: sh.id,
            fromDriverId: assignedId,
            toDriverId: otherD.id,
            pointId: hp.id,
            saving,
            meetStart,
            meetEnd,
          };
        }
      });
    });

    if (bestCandidate) candidates.push(bestCandidate);
  });

  candidates.sort((a, b) => b.saving - a.saving);

  const handoffEvents: HandoffEvent[] = [];
  const usedShipIds = new Set<string>();

  candidates.forEach((c) => {
    if (usedShipIds.has(c.shipId)) return;
    usedShipIds.add(c.shipId);

    const existing = handoffEvents.find(
      (h) => h.fromDriverId === c.fromDriverId && h.toDriverId === c.toDriverId && h.pointId === c.pointId &&
        Math.abs(toM(h.plannedMeetStart)! - c.meetStart) < 20
    );

    if (existing) {
      existing.shipmentIds.push(c.shipId);
      const newEnd = Math.max(toM(existing.plannedMeetEnd)!, c.meetEnd);
      existing.plannedMeetEnd = fmM(newEnd);
    } else {
      handoffEvents.push({
        id: "hx_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
        shipmentIds: [c.shipId],
        fromDriverId: c.fromDriverId,
        toDriverId: c.toDriverId,
        pointId: c.pointId,
        plannedMeetStart: fmM(c.meetStart),
        plannedMeetEnd: fmM(c.meetEnd),
        status: "planned",
        fromConfirmed: true,
        toConfirmed: true,
      });
    }
  });

  return handoffEvents;
}

export interface WarningItem {
  sev: string;
  msg: string;
}

export interface FallbackItem {
  type: string;
  msg: string;
}

export interface TripStats {
  shipments: number;
  totalKm: number;
  peakLoad: number;
  startTime?: string;
  endTime?: string;
  revenue: number;
  cogs: number;
  fuelLitres: number;
  fuelCost: number;
  margin: number;
  deadKm: number;
  depotToFirstKm: number;
  returnToDepotKm: number;
  lateCount?: number;
  atRiskCount?: number;
  resilience?: number;
  capacityScore?: number;
  mileage?: number;
}

export interface TripData {
  driver: Driver;
  stops: Stop[];
  warnings: WarningItem[];
  fallbacks: FallbackItem[];
  stats: TripStats;
}

export function buildSched(
  ships: Shipment[],
  asgn: Record<string, string>,
  stopSt: Record<string, string>,
  selectedDay?: string,
  fleetOverride?: Driver[],
  handoffs?: HandoffEvent[],
  handoffPointsList?: HandoffPoint[]
): Record<string, TripData> {
  const isSaturday = selectedDay ? new Date(selectedDay + "T00:00:00").getDay() === 6 : false;
  const activeFleet = fleetOverride || getFleet();
  const settings = getFleetSettings();
  const result: Record<string, TripData> = {};

  // Drop shipments whose overall lifecycle is terminal (delivered, failed,
  // cancelled, returned, exception). These shouldn't appear as unscheduled
  // stops on any driver's route — they're done. Collected-but-not-yet-
  // delivered shipments stay; their delivery stop is still pending and is
  // handled by the per-stop `status` field via `stopSt`.
  ships = ships.filter((s) => !isShipmentTerminal((s as any).status));

  const activeHandoffs = (handoffs || []).filter((h) => h.status !== "cancelled");
  const handoffFromShips = new Map<string, HandoffEvent>();
  const handoffToShips = new Map<string, HandoffEvent>();
  activeHandoffs.forEach((h) => {
    h.shipmentIds.forEach((sid) => {
      handoffFromShips.set(sid + "_" + h.fromDriverId, h);
      handoffToShips.set(sid + "_" + h.toDriverId, h);
    });
  });

  const handoffPointsMap = new Map<string, HandoffPoint>();
  if (activeHandoffs.length > 0) {
    const pointsSource = handoffPointsList || DEFAULT_HANDOFF_POINTS;
    pointsSource.forEach((p) => handoffPointsMap.set(p.id, p));
  }

  const driverNameMap = new Map<string, string>();
  activeFleet.forEach((d) => driverNameMap.set(d.id, d.name));

  activeFleet.forEach((d) => {
    const handoffShipIdsForFromDriver = new Set<string>();
    const handoffShipIdsForToDriver = new Set<string>();
    activeHandoffs.forEach((h) => {
      h.shipmentIds.forEach((sid) => {
        if (h.fromDriverId === d.id) handoffShipIdsForFromDriver.add(sid);
        if (h.toDriverId === d.id) handoffShipIdsForToDriver.add(sid);
      });
    });

    const myRegularShips = ships.filter((s) => {
      if (asgn[s.id] !== d.id) return false;
      if (handoffShipIdsForFromDriver.has(s.id)) return false;
      return true;
    });

    const myFromHandoffShips = ships.filter((s) => handoffShipIdsForFromDriver.has(s.id) && asgn[s.id] === d.id);
    const myToHandoffShips = ships.filter((s) => handoffShipIdsForToDriver.has(s.id));

    const hasWork = myRegularShips.length > 0 || myFromHandoffShips.length > 0 || myToHandoffShips.length > 0;

    if (!hasWork) {
      result[d.id] = {
        driver: d, stops: [], warnings: [], fallbacks: [],
        stats: { shipments: 0, totalKm: 0, peakLoad: 0, revenue: 0, cogs: 0, fuelLitres: 0, fuelCost: 0, margin: 0, deadKm: 0, depotToFirstKm: 0, returnToDepotKm: 0 }
      };
      return;
    }

    // Already-collected shipments (collected / in-transit / out-for-delivery)
    // are physically on this driver's vehicle — they need a delivery stop only,
    // never another collection leg. Splitting them out here means they are
    // routed delivery-only (see interleaveSequence's `preCollected` seed) and
    // still get a driver assignment + next-stop ETA, instead of being dragged
    // through a bogus collection stop (or a (0,0) batch when the CSV for a
    // collected shipment omits collection GPS).
    const myColShips = myRegularShips.filter((s) => !isShipmentCollected((s as any).status));
    const myDelOnlyShips = myRegularShips.filter((s) => isShipmentCollected((s as any).status));

    const colShips = [...myColShips, ...myFromHandoffShips];
    const delShips = [...myRegularShips, ...myToHandoffShips];

    const batches = buildBatches(colShips);
    const sequence = interleaveSequence(batches, toM(d.shift[0])!, d.depotLat, d.depotLng, myDelOnlyShips);
    const stops: Stop[] = [];
    const warnings: WarningItem[] = [];
    const fallbacks: FallbackItem[] = [];
    let totalKm = 0, peakLoad = 0, curLoad = 0, seq = 0, revenue = 0;
    let satMorning = 0, satAfternoon = 0;
    let curTime = toM(d.shift[0])!;
    let prevLabel = d.depot + " (Home)";

    const homeToFirstKm = sequence.length ? sequence[0].legKm : 0;

    sequence.forEach((act) => {
      if (act.type === "C" && act.batch) {
        const batch = act.batch;
        let bPcs = 0, bKg = 0;
        batch.ships.forEach((x) => { bPcs += x.pcs; bKg += x.kg; });
        const colSvc = svcTime("C", bPcs);
        totalKm += act.legKm;
        const arriveCol = curTime + act.legMin;
        const colM = toM(batch.cAfter) || 0;
        const actualCol = Math.max(arriveCol, colM);
        const colEndM = toM(batch.cBefore) || colM;
        const colLate = arriveCol > colEndM + 10;
        if (colLate) warnings.push({ sev: "MED", msg: batch.ships.map((x) => x.wb).join(",") + ": Col arrive " + fmM(arriveCol) + ", " + Math.round(arriveCol - colEndM) + "m late" });
        const colSlack = colEndM - arriveCol;
        if (colSlack < 15 && colSlack >= 0) warnings.push({ sev: "LOW", msg: batch.ships.map((x) => x.wb).join(",") + ": Col window tight (" + Math.round(colSlack) + "m slack)" });
        seq++;
        const sKey = "C_" + batch.ships.map((x) => x.id).sort().join("_");
        // Surface dispatcher collection-override metadata so the trip
        // sheet can show "REQ <orig>" and a pin icon for pinned-time stops.
        // For multi-shipment batches we take the first ship that carries
        // the metadata — single-shipment collections (the common case for
        // a pinned arrival) work cleanly.
        const cPinShip = batch.ships.find((x) => x.pinnedColTime);
        const cOrigShip = batch.ships.find((x) => x.origCAfter || x.origCBefore);
        const cOrigWin = cOrigShip
          ? (cOrigShip.origCAfter || cOrigShip.cAfter || "?") +
              (cOrigShip.origCBefore && cOrigShip.origCBefore !== cOrigShip.origCAfter ? "-" + cOrigShip.origCBefore : "")
          : undefined;
        stops.push({
          seq, type: "C", key: sKey, wbs: batch.ships.map((x) => x.wb),
          ids: batch.ships.map((x) => x.id), sub: batch.cSub, city: batch.cCity, addr: batch.cAddr,
          acc: batch.acc, pcs: bPcs, kg: Math.round(bKg * 10) / 10,
          win: batch.cAfter + (batch.cBefore && batch.cBefore !== batch.cAfter ? "-" + batch.cBefore : ""),
          eta: fmM(actualCol), etaM: actualCol, arriveM: arriveCol, legKm: act.legKm, legMin: act.legMin,
          svcMin: colSvc, fromLoc: prevLabel, contact: batch.cContact, phone: batch.cPhone,
          instr: batch.iCol || "", spx: batch.ships.some((x) => x.svc === "SPX"),
          late: colLate, waitMin: Math.max(0, actualCol - arriveCol), lat: batch.cLat, lng: batch.cLng,
          status: toDispatchStopStatus(stopSt[sKey]),
          parcelType: [...new Set(batch.ships.map((x) => x.parcelType).filter(Boolean))].join(", ") || undefined,
          parcelCategory: [...new Set(batch.ships.map((x) => x.parcelCategory).filter(Boolean))].join(", ") || undefined,
          clientName: [...new Set(batch.ships.map((x) => x.clientName).filter(Boolean))].join(", ") || undefined,
          origWin: cOrigWin,
          pinnedTime: cPinShip?.pinnedColTime,
        });
        prevLabel = batch.cSub + " (Col)";
        curTime = actualCol + colSvc;
        curLoad += bPcs;
        if (curLoad > peakLoad) peakLoad = curLoad;

        const handoffBatchShips = batch.ships.filter((x) => handoffShipIdsForFromDriver.has(x.id));
        if (handoffBatchShips.length > 0) {
          const eventsForBatch = new Map<string, { event: HandoffEvent; ships: Shipment[] }>();
          handoffBatchShips.forEach((x) => {
            const ev = handoffFromShips.get(x.id + "_" + d.id);
            if (ev) {
              const existing = eventsForBatch.get(ev.id);
              if (existing) existing.ships.push(x);
              else eventsForBatch.set(ev.id, { event: ev, ships: [x] });
            }
          });
          eventsForBatch.forEach(({ event: hev, ships: hShips }) => {
            const hp = handoffPointsMap.get(hev.pointId);
            if (!hp) return;
            const lastLat = stops.length ? stops[stops.length - 1].lat : d.depotLat;
            const lastLng = stops.length ? stops[stops.length - 1].lng : d.depotLng;
            const xDrv = calcDrive({ lat: lastLat, lng: lastLng }, { lat: hp.lat, lng: hp.lng }, curTime);
            totalKm += xDrv.km;
            curTime += xDrv.min;
            let xPcs = 0, xKg = 0;
            hShips.forEach((x) => { xPcs += x.pcs; xKg += x.kg; });
            const toDriverName = driverNameMap.get(hev.toDriverId) || "Driver";
            seq++;
            const xKey = "X_" + hev.id + "_from_" + d.id;
            stops.push({
              seq, type: "X", key: xKey, wbs: hShips.map((x) => x.wb),
              ids: hShips.map((x) => x.id), sub: hp.name, city: "", addr: hp.address,
              acc: "", pcs: xPcs, kg: Math.round(xKg * 10) / 10,
              win: hev.plannedMeetStart + "-" + hev.plannedMeetEnd,
              eta: fmM(curTime), etaM: curTime, legKm: xDrv.km, legMin: xDrv.min,
              svcMin: 8, fromLoc: prevLabel, contact: toDriverName, phone: "",
              instr: "Handoff to " + toDriverName, spx: false, late: false,
              lat: hp.lat, lng: hp.lng, status: toDispatchStopStatus(stopSt[xKey])
            });
            prevLabel = hp.name + " (Exchange)";
            curTime += 8;
            curLoad -= xPcs;
          });
        }
      } else if (act.ship) {
        if (handoffShipIdsForFromDriver.has(act.ship.id)) {
          return;
        }
        const sh = act.ship;
        const isToHandoff = handoffShipIdsForToDriver.has(sh.id);
        if (isToHandoff) return;
        const delSvc = svcTime("D", sh.pcs);
        totalKm += act.legKm;
        const arriveDel = curTime + act.legMin;
        const dAM = toM(sh.dAfter || "") || 0;
        const actualDel = Math.max(arriveDel, dAM);
        const dBM = toM(sh.dBefore) || 1080;
        const slack = dBM - actualDel;
        const delLate = slack < -5;
        if (delLate) warnings.push({ sev: Math.abs(slack) > 20 ? "HIGH" : "MED", msg: sh.wb + ": ETA " + fmM(actualDel) + ", " + Math.abs(Math.round(slack)) + "m past " + sh.dBefore });
        if (slack >= 0 && slack < 15) warnings.push({ sev: "LOW", msg: sh.wb + ": Del window tight (" + Math.round(slack) + "m slack)" });
        if (isSaturday) {
          if (actualDel < SAT_MORNING_END) satMorning++;
          else satAfternoon++;
        }
        revenue += sh.rate || 0;
        seq++;
        const dKey = "D_" + sh.id;
        const dOrigWin = (sh.origDAfter || sh.origDBefore)
          ? (sh.origDAfter || sh.dAfter || "?") + "-" + (sh.origDBefore || sh.dBefore || "?")
          : undefined;
        stops.push({
          seq, type: "D", key: dKey, wbs: [sh.wb], ids: [sh.id], sub: sh.dSub,
          city: sh.dCity || "", addr: sh.dAddr, acc: sh.acc, pcs: sh.pcs, kg: sh.kg,
          win: (sh.dAfter || "?") + "-" + (sh.dBefore || "?"), deadline: sh.dBefore,
          eta: fmM(actualDel), etaM: actualDel, arriveM: arriveDel, legKm: act.legKm, legMin: act.legMin,
          svcMin: delSvc, fromLoc: prevLabel, contact: sh.dContact, phone: sh.dPhone,
          instr: sh.iDel || "", spx: sh.svc === "SPX", late: delLate,
          slack: Math.round(slack), sid: sh.id, lat: sh.dLat, lng: sh.dLng,
          status: toDispatchStopStatus(stopSt[dKey]),
          waitMin: Math.max(0, actualDel - arriveDel),
          parcelType: sh.parcelType || undefined,
          parcelCategory: sh.parcelCategory || undefined,
          clientName: sh.clientName || undefined,
          origWin: dOrigWin,
          pinnedTime: sh.pinnedDelTime,
        });
        prevLabel = sh.dSub + " (Del)";
        curTime = actualDel + delSvc;
        curLoad -= sh.pcs;
      }
    });

    const toHandoffEvents = new Map<string, { event: HandoffEvent; ships: Shipment[] }>();
    myToHandoffShips.forEach((sh) => {
      const ev = handoffToShips.get(sh.id + "_" + d.id);
      if (ev) {
        const existing = toHandoffEvents.get(ev.id);
        if (existing) existing.ships.push(sh);
        else toHandoffEvents.set(ev.id, { event: ev, ships: [sh] });
      }
    });
    toHandoffEvents.forEach(({ event: hev, ships: hShips }) => {
      const hp = handoffPointsMap.get(hev.pointId);
      if (!hp) return;
      const lastLat = stops.length ? stops[stops.length - 1].lat : d.depotLat;
      const lastLng = stops.length ? stops[stops.length - 1].lng : d.depotLng;
      const xDrv = calcDrive({ lat: lastLat, lng: lastLng }, { lat: hp.lat, lng: hp.lng }, curTime);
      totalKm += xDrv.km;
      curTime += xDrv.min;
      let xPcs = 0, xKg = 0;
      hShips.forEach((x) => { xPcs += x.pcs; xKg += x.kg; });
      const fromDriverName = driverNameMap.get(hev.fromDriverId) || "Driver";
      seq++;
      const xKey = "X_" + hev.id + "_to_" + d.id;
      stops.push({
        seq, type: "X", key: xKey, wbs: hShips.map((x) => x.wb),
        ids: hShips.map((x) => x.id), sub: hp.name, city: "", addr: hp.address,
        acc: "", pcs: xPcs, kg: Math.round(xKg * 10) / 10,
        win: hev.plannedMeetStart + "-" + hev.plannedMeetEnd,
        eta: fmM(curTime), etaM: curTime, legKm: xDrv.km, legMin: xDrv.min,
        svcMin: 8, fromLoc: prevLabel, contact: fromDriverName, phone: "",
        instr: "Pickup from " + fromDriverName, spx: false, late: false,
        lat: hp.lat, lng: hp.lng, status: toDispatchStopStatus(stopSt[xKey])
      });
      prevLabel = hp.name + " (Exchange)";
      curTime += 8;
      curLoad += xPcs;
      if (curLoad > peakLoad) peakLoad = curLoad;

      hShips.forEach((sh) => {
        const delSvc = svcTime("D", sh.pcs);
        const delDrv = calcDrive({ lat: hp.lat, lng: hp.lng }, { lat: sh.dLat, lng: sh.dLng }, curTime);
        totalKm += delDrv.km;
        const arriveDel = curTime + delDrv.min;
        const dAM = toM(sh.dAfter || "") || 0;
        const actualDel = Math.max(arriveDel, dAM);
        const dBM = toM(sh.dBefore) || 1080;
        const slack = dBM - actualDel;
        const delLate = slack < -5;
        if (delLate) warnings.push({ sev: Math.abs(slack) > 20 ? "HIGH" : "MED", msg: sh.wb + ": ETA " + fmM(actualDel) + ", " + Math.abs(Math.round(slack)) + "m past " + sh.dBefore });
        if (slack >= 0 && slack < 15) warnings.push({ sev: "LOW", msg: sh.wb + ": Del window tight (" + Math.round(slack) + "m slack)" });
        if (isSaturday) {
          if (actualDel < SAT_MORNING_END) satMorning++;
          else satAfternoon++;
        }
        revenue += sh.rate || 0;
        seq++;
        const dKey = "D_" + sh.id;
        const dOrigWin2 = (sh.origDAfter || sh.origDBefore)
          ? (sh.origDAfter || sh.dAfter || "?") + "-" + (sh.origDBefore || sh.dBefore || "?")
          : undefined;
        stops.push({
          seq, type: "D", key: dKey, wbs: [sh.wb], ids: [sh.id], sub: sh.dSub,
          city: sh.dCity || "", addr: sh.dAddr, acc: sh.acc, pcs: sh.pcs, kg: sh.kg,
          win: (sh.dAfter || "?") + "-" + (sh.dBefore || "?"), deadline: sh.dBefore,
          eta: fmM(actualDel), etaM: actualDel, arriveM: arriveDel, legKm: delDrv.km, legMin: delDrv.min,
          svcMin: delSvc, fromLoc: prevLabel, contact: sh.dContact, phone: sh.dPhone,
          instr: sh.iDel || "", spx: sh.svc === "SPX", late: delLate,
          slack: Math.round(slack), sid: sh.id, lat: sh.dLat, lng: sh.dLng,
          status: toDispatchStopStatus(stopSt[dKey]),
          waitMin: Math.max(0, actualDel - arriveDel),
          parcelType: sh.parcelType || undefined,
          parcelCategory: sh.parcelCategory || undefined,
          clientName: sh.clientName || undefined,
          origWin: dOrigWin2,
          pinnedTime: sh.pinnedDelTime,
        });
        prevLabel = sh.dSub + " (Del)";
        curTime = actualDel + delSvc;
        curLoad -= sh.pcs;
      });
    });

    if (isSaturday) {
      if (satMorning > SAT_MORNING_CAP) warnings.push({ sev: "HIGH", msg: d.name + ": " + satMorning + " morning deliveries exceeds Saturday cap of " + SAT_MORNING_CAP + " (07:00-12:00)" });
      if (satAfternoon > SAT_AFTERNOON_CAP) warnings.push({ sev: "HIGH", msg: d.name + ": " + satAfternoon + " afternoon deliveries exceeds Saturday cap of " + SAT_AFTERNOON_CAP + " (12:00-17:00)" });
    }

    const isVitz = VEHICLE_VITZ_IDS.includes(d.id);
    const isI10Driver = VEHICLE_I10_IDS.includes(d.id);
    if (isVitz) {
      const cakeShips = myRegularShips.filter((s) =>
        (s.parcelType || "").toLowerCase().includes("3-tier") || (s.parcelType || "").toLowerCase().includes("3 tier") ||
        (s.parcelCategory || "").toLowerCase().includes("3-tier") || (s.parcelCategory || "").toLowerCase().includes("3 tier")
      );
      if (cakeShips.length > 0) warnings.push({ sev: "HIGH", msg: d.name + " (Vitz): Cannot carry 3-tier cakes — " + cakeShips.map((s) => s.wb).join(", ") });
      const platterShips = myRegularShips.filter((s) =>
        (s.parcelType || "").toLowerCase().includes("platter") || (s.parcelCategory || "").toLowerCase().includes("platter")
      );
      const totalPlatterPcs = platterShips.reduce((sum, s) => sum + s.pcs, 0);
      if (totalPlatterPcs > VITZ_RULES.maxPlatterConsignments) warnings.push({ sev: "HIGH", msg: d.name + " (Vitz): " + totalPlatterPcs + " platter pieces exceeds max " + VITZ_RULES.maxPlatterConsignments + " — " + platterShips.map((s) => s.wb).join(", ") });
      const totalParcels = myRegularShips.reduce((sum, s) => sum + s.pcs, 0);
      if (totalParcels > VITZ_RULES.maxParcels) warnings.push({ sev: "MED", msg: d.name + " (Vitz): " + totalParcels + " parcels exceeds recommended max " + VITZ_RULES.maxParcels });
    }
    if (!isI10Driver) {
      const sweShips = myRegularShips.filter((s) => s.acc === "SWE001");
      if (sweShips.length > 0) warnings.push({ sev: "HIGH", msg: d.name + ": SWE001 bread consignments must go to i10 drivers — " + sweShips.map((s) => s.wb).join(", ") });
    }

    const lastStop = stops.length ? stops[stops.length - 1] : null;
    let returnKm = 0, returnMin = 0;
    if (lastStop && lastStop.lat && lastStop.lng) {
      const ret = calcDrive({ lat: lastStop.lat, lng: lastStop.lng }, { lat: d.depotLat, lng: d.depotLng }, curTime);
      returnKm = ret.km; returnMin = ret.min;
      totalKm += returnKm; curTime += returnMin;
      seq++;
      stops.push({
        seq, type: "RTN", key: "RTN_" + d.id, wbs: [], ids: [], sub: d.depot,
        city: "", addr: d.depot, acc: "", pcs: 0, kg: 0, win: "",
        eta: fmM(curTime), etaM: curTime, legKm: returnKm, legMin: returnMin,
        svcMin: 0, fromLoc: prevLabel, contact: "", phone: "", instr: "",
        spx: false, late: false, lat: d.depotLat, lng: d.depotLng,
        status: "PENDING"
      });
    }

    // Linger post-pass: convert "wait at next stop" into "linger at previous stop"
    // so the driver doesn't appear to arrive hours before a window opens. The
    // first stop's wait stays as a depot linger (we shift the trip start instead).
    let depotLingerMin = 0;
    for (let i = 0; i < stops.length; i++) {
      const st = stops[i];
      const w = Math.round(st.waitMin || 0);
      if (w <= 0) continue;
      if (i === 0) {
        depotLingerMin += w;
      } else {
        const prev = stops[i - 1];
        prev.lingerMin = (prev.lingerMin || 0) + w;
      }
      st.arriveM = st.etaM;
      st.waitMin = 0;
    }

    const fuelPer100City = d.fuelPer100 * settings.cityFactor;
    const fuelLitres = totalKm * fuelPer100City / 100;
    const fuelCost = Math.round(fuelLitres * settings.fuelPrice);
    const cogs = fuelCost;
    const deadKm = Math.round(homeToFirstKm + returnKm);
    let lateCount = 0, atRiskCount = 0;
    stops.forEach((st) => { if (st.late) lateCount++; if (st.slack != null && st.slack >= 0 && st.slack < 15) atRiskCount++; });
    const deliveryStops = stops.filter((st) => st.type === "D").length;
    const onTimeStops = deliveryStops - lateCount;
    const resilience = deliveryStops > 0 ? Math.round((onTimeStops / deliveryStops) * 100) : 100;

    const totalShipCount = myRegularShips.length + myFromHandoffShips.length + myToHandoffShips.length;
    const morningCap = 12;
    const afternoonCap = 8;
    const maxCap = morningCap + afternoonCap;
    const capacityScore = totalShipCount > 0 ? Math.min(100, Math.round((totalShipCount / maxCap) * 100)) : 0;

    const mileage = totalKm > 0 && fuelLitres > 0 ? Math.round((totalKm / fuelLitres) * 10) / 10 : 0;

    result[d.id] = {
      driver: d, stops, warnings, fallbacks,
      stats: {
        shipments: totalShipCount, totalKm: Math.round(totalKm), peakLoad,
        startTime: stops.length ? fmM(toM(d.shift[0])! + depotLingerMin) : "--", endTime: stops.length ? fmM(curTime) : "--",
        revenue: Math.round(revenue), cogs, fuelLitres: Math.round(fuelLitres * 10) / 10,
        fuelCost, margin: Math.round(revenue) - cogs, deadKm,
        depotToFirstKm: Math.round(homeToFirstKm), returnToDepotKm: Math.round(returnKm),
        lateCount, atRiskCount, resilience, capacityScore, mileage
      }
    };
  });
  return result;
}

export type InsightCategory = "road" | "fuel" | "punctuality" | "capacity" | "alternative" | "general";
export type InsightSeverity = "info" | "tip" | "warning" | "success";

export interface Insight {
  cat: InsightCategory;
  sev: InsightSeverity;
  title: string;
  detail: string;
  driver?: string;
}

const PRETORIA_CORRIDORS: Record<string, { avoid: string; use: string; why: string; suburbs: string[] }> = {
  n1_south: {
    avoid: "N1 South between Solomon Mahlangu & Atterbury",
    use: "Lynnwood Rd or Simon Vermooten via Menlyn",
    why: "N1 South congestion peaks 06:30-08:30 and 16:00-18:00",
    suburbs: ["centurion", "lyttelton", "wierdapark", "wierda park", "eldoraigne", "clubview", "zwartkop", "pierre van ryneveld"]
  },
  n4_west: {
    avoid: "N4 Bakwena / Quagga Rd corridor",
    use: "Lavender Rd or Rachel De Beer St",
    why: "N4 West heavy trucks slow flow 07:00-09:00",
    suburbs: ["rosslyn", "akasia", "orchards", "the orchards", "karenpark", "annlin"]
  },
  n14_krugersdorp: {
    avoid: "N14 between Centurion and Midrand during peak hours",
    use: "R101 Old Johannesburg Rd",
    why: "Roadworks and congestion frequent on N14 interchange",
    suburbs: ["midrand", "halfway house", "carlswald", "vorna valley", "noordwyk"]
  },
  garsfontein: {
    avoid: "Garsfontein Rd between Atterbury & Lynnwood",
    use: "De Villebois Mareuil Dr via Woodlands Blvd",
    why: "School traffic peak 07:00-08:00 makes Garsfontein slow",
    suburbs: ["garsfontein", "moreleta park", "faerie glen", "woodhill", "waterkloof ridge"]
  },
  church_st: {
    avoid: "Church St (WF Nkomo) through CBD during office hours",
    use: "Stanza Bopape / Steve Biko for east-west crossing",
    why: "CBD congestion, taxis, and limited parking",
    suburbs: ["pretoria central", "sunnyside", "arcadia", "hatfield"]
  },
  r21_corridor: {
    avoid: "R21 during morning peak, heavy airport traffic",
    use: "Simon Vermooten Rd / Hans Strijdom Dr",
    why: "R21 airport-bound trucks 06:00-09:00",
    suburbs: ["irene", "rooihuiskraal", "erasmuskloof", "constantia park"]
  },
  zambezi_area: {
    avoid: "Zambezi Dr during school hours (07:00-08:00)",
    use: "Atterbury Rd to Simon Vermooten for southern routes",
    why: "School zone traffic around Montana / Zambezi",
    suburbs: ["montana", "montana park", "sinoville", "zambezi", "dorandia"]
  }
};

export interface RoadReport {
  id: string;
  roadId: string;
  roadName: string;
  category: "traffic" | "condition";
  type: string;
  severity: "high" | "medium" | "low";
  notes: string;
  reportedAt: string;
  active: boolean;
}

export function generateInsights(
  tl: Record<string, TripData>,
  ships: Shipment[],
  trafficCond: string,
  isSaturday: boolean,
  userReports?: RoadReport[]
): Insight[] {
  const settings = getFleetSettings();
  const insights: Insight[] = [];
  const fleet = Object.values(tl);
  const totalShips = ships.length;

  if (!totalShips) return insights;

  const totalKm = fleet.reduce((s, t) => s + t.stats.totalKm, 0);
  const totalDeadKm = fleet.reduce((s, t) => s + t.stats.deadKm, 0);
  const totalLate = fleet.reduce((s, t) => s + (t.stats.lateCount || 0), 0);
  const totalAtRisk = fleet.reduce((s, t) => s + (t.stats.atRiskCount || 0), 0);
  const totalFuelL = fleet.reduce((s, t) => s + t.stats.fuelLitres, 0);

  fleet.forEach((trip) => {
    const d = trip.driver;
    const st = trip.stats;
    if (!st.shipments) return;

    const delStops = trip.stops.filter((s) => s.type === "D");
    const colStops = trip.stops.filter((s) => s.type === "C");

    const suburbsVisited = new Set<string>();
    trip.stops.forEach((s) => {
      if (s.sub) suburbsVisited.add(s.sub.toLowerCase().trim());
    });

    Object.entries(PRETORIA_CORRIDORS).forEach(([, corridor]) => {
      const matchedSuburbs = corridor.suburbs.filter((cs) => suburbsVisited.has(cs));
      if (matchedSuburbs.length > 0) {
        const firstDelInArea = trip.stops.find((s) => s.type === "D" && matchedSuburbs.includes(s.sub.toLowerCase().trim()));
        const etaMin = firstDelInArea?.etaM || 0;
        const isRushHour = (etaMin >= 375 && etaMin <= 525) || (etaMin >= 915 && etaMin <= 1065);

        if (isRushHour || trafficCond !== "normal") {
          insights.push({
            cat: "road",
            sev: "tip",
            title: `${d.name}: Avoid ${corridor.avoid}`,
            detail: `Use ${corridor.use} instead. ${corridor.why}. Affects stops in ${matchedSuburbs.map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(", ")}.`,
            driver: d.id
          });
        }
      }
    });

    const longLegs = trip.stops.filter((s) => s.legKm > 15 && s.type !== "RTN" && s.type !== "H" && s.type !== "X");
    if (longLegs.length > 0) {
      const worst = longLegs.reduce((a, b) => a.legKm > b.legKm ? a : b);
      insights.push({
        cat: "road",
        sev: "warning",
        title: `${d.name}: Long leg to ${worst.sub} (${worst.legKm}km)`,
        detail: `This ${worst.legKm}km leg from ${worst.fromLoc} adds travel time. Consider grouping nearby deliveries or reassigning to a closer driver.`,
        driver: d.id
      });
    }

    if (st.deadKm > 0 && st.totalKm > 0) {
      const deadPct = Math.round((st.deadKm / st.totalKm) * 100);
      if (deadPct > 30) {
        const potentialSaveKm = Math.round(st.deadKm * 0.3);
        const potentialSaveL = Math.round(potentialSaveKm * d.fuelPer100 * settings.cityFactor / 100 * 10) / 10;
        const potentialSaveR = Math.round(potentialSaveL * settings.fuelPrice);
        insights.push({
          cat: "fuel",
          sev: "tip",
          title: `${d.name}: ${deadPct}% dead kilometres (${st.deadKm}km)`,
          detail: `Home-to-first-stop and return account for ${st.deadKm}km of ${st.totalKm}km total. If first collection is moved closer, could save ~${potentialSaveKm}km / ${potentialSaveL}L / R${potentialSaveR}.`,
          driver: d.id
        });
      }
    }

    if (st.mileage != null && st.mileage > 0 && st.mileage < 10 && st.totalKm > 10) {
      insights.push({
        cat: "fuel",
        sev: "warning",
        title: `${d.name}: Low mileage (${st.mileage} km/L)`,
        detail: `Expected ~${Math.round(100 / (d.fuelPer100 * settings.cityFactor) * 10) / 10} km/L city. Short stop-and-go legs increase consumption. Consolidate nearby stops where possible.`,
        driver: d.id
      });
    }

    if (delStops.length > 4) {
      const avgLeg = Math.round(delStops.reduce((s, st) => s + st.legKm, 0) / delStops.length * 10) / 10;
      if (avgLeg < 3) {
        insights.push({
          cat: "fuel",
          sev: "success",
          title: `${d.name}: Tight cluster — avg ${avgLeg}km between stops`,
          detail: `Short inter-stop distances are fuel efficient. ${d.name} is well-grouped with ${delStops.length} deliveries averaging ${avgLeg}km apart.`,
          driver: d.id
        });
      }
    }

    if ((st.lateCount || 0) > 0) {
      const lateStops = delStops.filter((s) => s.late);
      const suggestions: string[] = [];

      lateStops.forEach((ls) => {
        const slackAbs = Math.abs(ls.slack || 0);
        if (slackAbs <= 15) {
          suggestions.push(`${ls.wbs[0]} is ${slackAbs}m late — could be saved by departing ${Math.ceil(slackAbs / 2)}m earlier or skipping one prior stop`);
        } else {
          suggestions.push(`${ls.wbs[0]} is ${slackAbs}m past deadline — needs reassignment to a closer driver or earlier departure`);
        }
      });

      insights.push({
        cat: "punctuality",
        sev: "warning",
        title: `${d.name}: ${st.lateCount} late deliver${st.lateCount === 1 ? "y" : "ies"}`,
        detail: suggestions.join(". ") + ".",
        driver: d.id
      });
    }

    if ((st.atRiskCount || 0) > 0 && (st.lateCount || 0) === 0) {
      const atRiskStops = delStops.filter((s) => s.slack != null && s.slack >= 0 && s.slack < 15);
      const tightest = atRiskStops.reduce((a, b) => (a.slack || 99) < (b.slack || 99) ? a : b, atRiskStops[0]);
      insights.push({
        cat: "punctuality",
        sev: "tip",
        title: `${d.name}: ${st.atRiskCount} at-risk (tight windows)`,
        detail: `${tightest?.wbs[0] || "Stop"} has only ${tightest?.slack || 0}m slack. Any traffic delay could make it late. Consider leaving earlier or rerouting ${d.name} to reduce travel time before tight windows.`,
        driver: d.id
      });
    }

    if ((st.lateCount || 0) === 0 && (st.atRiskCount || 0) === 0 && st.shipments > 0) {
      insights.push({
        cat: "punctuality",
        sev: "success",
        title: `${d.name}: All ${st.shipments} deliveries on time`,
        detail: `Every delivery has comfortable slack. Current route is punctuality-safe.`,
        driver: d.id
      });
    }

    // After linger post-pass, waitMin is zeroed and idle time lives on the
    // previous stop as lingerMin. Surface those as the punctuality insight.
    const waitStops = trip.stops.filter((s) => ((s as any).lingerMin || 0) + (s.waitMin || 0) > 10);
    if (waitStops.length > 0) {
      const totalWait = waitStops.reduce((s, st) => s + (((st as any).lingerMin || 0) + (st.waitMin || 0)), 0);
      insights.push({
        cat: "punctuality",
        sev: "tip",
        title: `${d.name}: ${Math.round(totalWait)}min waiting at ${waitStops.length} collection${waitStops.length > 1 ? "s" : ""}`,
        detail: `${d.name} arrives early and waits. Negotiate earlier collection windows or route other deliveries before these pickups to fill wait time.`,
        driver: d.id
      });
    }
  });

  if (isSaturday) {
    fleet.forEach((trip) => {
      const d = trip.driver;
      const delStops = trip.stops.filter((s) => s.type === "D");
      const morningDel = delStops.filter((s) => s.etaM < 720).length;
      const afternoonDel = delStops.filter((s) => s.etaM >= 720).length;

      if (morningDel < SAT_MORNING_CAP && afternoonDel < SAT_AFTERNOON_CAP) {
        const morningSlots = SAT_MORNING_CAP - morningDel;
        const afternoonSlots = SAT_AFTERNOON_CAP - afternoonDel;
        insights.push({
          cat: "capacity",
          sev: "info",
          title: `${d.name}: Saturday capacity available`,
          detail: `Can accept ${morningSlots} more morning (07:00-12:00) and ${afternoonSlots} more afternoon (12:00-17:00) deliveries within Saturday caps.`,
          driver: d.id
        });
      }
    });
  } else {
    fleet.forEach((trip) => {
      const d = trip.driver;
      const st = trip.stats;
      if (st.shipments > 0 && st.shipments < 8) {
        const slotsAvail = 12 - st.shipments;
        insights.push({
          cat: "capacity",
          sev: "info",
          title: `${d.name}: Can take ${slotsAvail} more shipments`,
          detail: `Currently at ${st.shipments} deliveries. Optimal range is 8-12 per driver. ${d.name} has capacity for ${slotsAvail} more without impacting punctuality.`,
          driver: d.id
        });
      }
      if (st.shipments >= 8 && st.shipments <= 12) {
        insights.push({
          cat: "capacity",
          sev: "success",
          title: `${d.name}: Optimal load (${st.shipments} shipments)`,
          detail: `${d.name} is in the sweet spot of 8-12 deliveries for best balance of productivity and quality.`,
          driver: d.id
        });
      }
      if (st.shipments > 12) {
        insights.push({
          cat: "capacity",
          sev: "warning",
          title: `${d.name}: Heavy load (${st.shipments} shipments)`,
          detail: `${st.shipments} deliveries may compromise punctuality. Consider redistributing ${st.shipments - 12} to a lighter driver.`,
          driver: d.id
        });
      }
    });
  }

  const driverKms = fleet.filter((t) => t.stats.shipments > 0).map((t) => ({ name: t.driver.name, id: t.driver.id, km: t.stats.totalKm, ships: t.stats.shipments }));
  if (driverKms.length >= 2) {
    const maxKm = driverKms.reduce((a, b) => a.km > b.km ? a : b);
    const minKm = driverKms.reduce((a, b) => a.km < b.km ? a : b);
    if (maxKm.km > minKm.km * 2 && maxKm.ships > 3) {
      insights.push({
        cat: "alternative",
        sev: "tip",
        title: "Imbalanced routes: " + maxKm.name + " drives " + maxKm.km + "km vs " + minKm.name + " " + minKm.km + "km",
        detail: `Consider moving 1-2 stops from ${maxKm.name} to ${minKm.name} to balance distance and fuel. Re-optimizing may fix this automatically.`
      });
    }
  }

  if (trafficCond !== "normal") {
    const label = trafficCond === "heavy" ? "Heavy" : "Moderate";
    const pctSlower = trafficCond === "heavy" ? "30%" : "15%";
    insights.push({
      cat: "general",
      sev: "warning",
      title: `${label} traffic active — routes ${pctSlower} slower`,
      detail: `All ETAs account for ${label.toLowerCase()} traffic conditions. Consider departing 15-20 minutes earlier for time-critical deliveries. Tight-window stops are most at risk.`
    });
  }

  if (totalDeadKm > 0 && totalKm > 0) {
    const overallDeadPct = Math.round((totalDeadKm / totalKm) * 100);
    if (overallDeadPct > 25) {
      const fuelWaste = Math.round(totalDeadKm * (totalFuelL / totalKm) * settings.fuelPrice);
      insights.push({
        cat: "fuel",
        sev: "tip",
        title: `Fleet-wide: ${totalDeadKm}km dead driving (${overallDeadPct}% of total)`,
        detail: `Dead km (home-to-first + last-to-home) costs ~R${fuelWaste} in fuel. Starting closer to first collections or ending near home reduces this waste.`
      });
    }
  }

  if (totalLate === 0 && totalShips > 0) {
    insights.push({
      cat: "general",
      sev: "success",
      title: "All " + totalShips + " deliveries on schedule",
      detail: "Every shipment is within its delivery window. Great route planning."
    });
  }

  const activeReports = (userReports || []).filter(r => r.active);
  if (activeReports.length > 0) {
    const allAddrs: string[] = [];
    const allSubs: string[] = [];
    ships.forEach(s => {
      if (s.cAddr) allAddrs.push(s.cAddr.toLowerCase());
      if (s.dAddr) allAddrs.push(s.dAddr.toLowerCase());
      if (s.cSub) allSubs.push(s.cSub.toLowerCase());
      if (s.dSub) allSubs.push(s.dSub.toLowerCase());
    });

    activeReports.forEach(report => {
      const roadWords = report.roadName.toLowerCase().split(/[\s/()]+/).filter(w => w.length > 2);
      const matchesAddr = allAddrs.some(a => roadWords.some(w => a.includes(w)));
      let matchesSub = false;
      const road = getRoadById(report.roadId);
      if (road && road.suburbs) {
        matchesSub = road.suburbs.some((rs: string) => {
          const rsl = rs.toLowerCase();
          return allSubs.some(s => s.includes(rsl) || rsl.includes(s));
        });
      }

      if (matchesAddr || matchesSub) {
        const sevMap: Record<string, string> = { high: "warning", medium: "tip", low: "info" };
        const catLabel = report.category === "traffic" ? "Traffic" : "Road condition";
        insights.push({
          cat: "road",
          sev: (sevMap[report.severity] || "tip") as "warning" | "tip" | "info" | "success",
          title: `${catLabel}: ${report.type} on ${report.roadName}`,
          detail: `User-reported ${report.type.toLowerCase()} on ${report.roadName}. ${report.notes ? report.notes + ". " : ""}Reported ${new Date(report.reportedAt).toLocaleDateString()}. Affects stops on your planned routes — consider alternative routes or extra caution.`,
        });
      }
    });
  }

  insights.sort((a, b) => {
    const sevOrder: Record<string, number> = { warning: 0, tip: 1, info: 2, success: 3 };
    return (sevOrder[a.sev] || 2) - (sevOrder[b.sev] || 2);
  });

  return insights;
}

export interface HandoffSuggestion {
  shipmentId: string;
  waybill: string;
  fromDriverId: string;
  toDriverId: string;
  pointId: string;
  pointName: string;
  distanceSaved: number;
  meetWindowStart: string;
  meetWindowEnd: string;
  score: number;
}

export function suggestHandoffs(
  ships: Shipment[],
  fleet: Driver[],
  asgn: Record<string, string>,
  points: HandoffPoint[],
  tl: Record<string, TripData>
): HandoffSuggestion[] {
  const suggestions: HandoffSuggestion[] = [];
  const activePoints = points.filter((p) => p.active);
  if (!activePoints.length || fleet.length < 2) return suggestions;

  const driverDepots = new Map<string, { lat: number; lng: number }>();
  fleet.forEach((d) => driverDepots.set(d.id, { lat: d.depotLat, lng: d.depotLng }));

  ships.forEach((sh) => {
    const assignedDriverId = asgn[sh.id];
    if (!assignedDriverId) return;

    const colDelDist = haversine({ lat: sh.cLat, lng: sh.cLng }, { lat: sh.dLat, lng: sh.dLng });
    if (colDelDist <= 25) return;

    const assignedDriver = fleet.find((d) => d.id === assignedDriverId);
    if (!assignedDriver) return;

    const assignedDepot = { lat: assignedDriver.depotLat, lng: assignedDriver.depotLng };
    const assignedToDelDist = haversine(assignedDepot, { lat: sh.dLat, lng: sh.dLng });

    fleet.forEach((otherDriver) => {
      if (otherDriver.id === assignedDriverId) return;

      const otherDepot = { lat: otherDriver.depotLat, lng: otherDriver.depotLng };
      const otherToDelDist = haversine(otherDepot, { lat: sh.dLat, lng: sh.dLng });

      if (otherToDelDist >= assignedToDelDist * 0.8) return;

      let bestPoint: HandoffPoint | null = null;
      let bestPointDist = Infinity;
      activePoints.forEach((hp) => {
        const fromDriverToHp = haversine({ lat: sh.cLat, lng: sh.cLng }, { lat: hp.lat, lng: hp.lng });
        const hpToOtherDepot = haversine({ lat: hp.lat, lng: hp.lng }, otherDepot);
        const totalDist = fromDriverToHp + hpToOtherDepot;
        if (totalDist < bestPointDist) {
          bestPointDist = totalDist;
          bestPoint = hp;
        }
      });

      if (!bestPoint) return;
      const hp = bestPoint as HandoffPoint;

      const originalRoute = calcDrive({ lat: sh.cLat, lng: sh.cLng }, { lat: sh.dLat, lng: sh.dLng });
      const fromToHp = calcDrive({ lat: sh.cLat, lng: sh.cLng }, { lat: hp.lat, lng: hp.lng });
      const hpToDel = calcDrive({ lat: hp.lat, lng: hp.lng }, { lat: sh.dLat, lng: sh.dLng });

      const handoffOverhead = 5;
      const distanceSaved = Math.round((originalRoute.km - (fromToHp.km + hpToDel.km + handoffOverhead)) * 10) / 10;
      const score = distanceSaved;

      if (score <= 0) return;

      const tripData = tl[assignedDriverId];
      const otherTripData = tl[otherDriver.id];
      if (!tripData || !otherTripData) return;

      const colStops = tripData.stops.filter((s) => s.type === "C");
      let estimatedColEnd = toM(assignedDriver.shift[0]) || 360;
      if (colStops.length > 0) {
        const lastCol = colStops[colStops.length - 1];
        estimatedColEnd = lastCol.etaM + lastCol.svcMin;
      }

      const driveToHp = fromToHp.min;
      const meetStart = estimatedColEnd + driveToHp;
      const meetEnd = meetStart + 15;

      const otherShiftStart = toM(otherDriver.shift[0]) || 360;
      const otherShiftEnd = toM(otherDriver.shift[1]) || 1080;
      if (meetStart < otherShiftStart || meetEnd > otherShiftEnd) return;

      suggestions.push({
        shipmentId: sh.id,
        waybill: sh.wb,
        fromDriverId: assignedDriverId,
        toDriverId: otherDriver.id,
        pointId: hp.id,
        pointName: hp.name,
        distanceSaved,
        meetWindowStart: fmM(meetStart),
        meetWindowEnd: fmM(meetEnd),
        score,
      });
    });
  });

  suggestions.sort((a, b) => b.score - a.score);
  return suggestions;
}
