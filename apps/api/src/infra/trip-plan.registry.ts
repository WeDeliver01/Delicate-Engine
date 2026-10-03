import { Injectable } from "@nestjs/common";
import type { TripSheet } from "@delicate/contracts";

/**
 * How dispatch asks operations for a driver's planned day without depending on it.
 *
 * Operations needs fleet (drivers, shifts), so fleet cannot import operations back without a
 * cycle. Rather than reach for `forwardRef`, this follows the pattern the engine already uses
 * for outbox consumers: a registry in global infra that the owning module fills at boot and
 * everyone else reads through.
 *
 * Nothing registers it in the worker process that only drains the outbox, and nothing needs to:
 * an unfilled registry answers `null` and the caller falls back to computing the day itself.
 */
@Injectable()
export class TripPlanRegistry {
  private source: ((driverId: string, date: string) => Promise<TripSheet | null>) | null = null;

  register(source: (driverId: string, date: string) => Promise<TripSheet | null>): void {
    this.source = source;
  }

  /** The driver's released or started trip for that date, or null when nobody built one. */
  async forDriver(driverId: string, date: string): Promise<TripSheet | null> {
    return this.source ? this.source(driverId, date) : null;
  }
}
