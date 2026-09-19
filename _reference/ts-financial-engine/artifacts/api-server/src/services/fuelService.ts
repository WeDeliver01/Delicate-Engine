import { db } from "@workspace/db";
import { walletService } from "./walletService.js";

export class FuelService {
  async balance(driverId: string): Promise<number> {
    return walletService.balance(driverId, "fuel");
  }

  async spend(driverId: string, amountCents: number, reference: string, description?: string): Promise<void> {
    await walletService.post({
      driverId,
      account: "fuel",
      type: "fuel_spend",
      amountCents: -Math.abs(amountCents),
      idempotencyKey: `fuel-spend:${reference}`,
      description: description ?? `Fuel card swipe ${reference}`,
    });
  }
}

export const fuelService = new FuelService();
