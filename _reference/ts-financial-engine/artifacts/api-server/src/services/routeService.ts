import { db, routes } from "@workspace/db";

interface Coord { lat: number; lng: number }

function haversineKm(a: Coord, b: Coord): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

export interface RouteResult {
  distanceKm: number;
  durationSeconds: number;
  provider: string;
}

export class RouteService {
  async compute(depot: Coord, pickup: Coord, customer: Coord): Promise<RouteResult> {
    const d1 = haversineKm(depot, pickup);
    const d2 = haversineKm(pickup, customer);
    const d3 = haversineKm(customer, depot);
    const distanceKm = d1 + d2 + d3;
    return {
      distanceKm: Math.round(distanceKm * 10) / 10,
      durationSeconds: Math.round((distanceKm / 40) * 3600),
      provider: "mock",
    };
  }

  async persist(tx: typeof db, deliveryId: string, route: RouteResult): Promise<void> {
    await tx.insert(routes).values({
      deliveryId,
      distanceKm: route.distanceKm,
      durationSeconds: route.durationSeconds,
      provider: route.provider,
    });
  }
}

export const routeService = new RouteService();
