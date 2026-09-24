import { Injectable } from "@nestjs/common";
import { formatCents, type PaymentProposal } from "@delicate/contracts";

export interface FuelLoadInstruction {
  /** How the load will actually be made. */
  channel: "paycentral_portal" | "paycentral_api";
  /** Copy-paste ready steps for the person doing it. */
  steps: string[];
  /** What must be pasted back into the engine to close the proposal. */
  proofRequired: string;
  portalUrl: string;
  /** True only once a real API integration is configured AND enabled by a human. */
  automated: boolean;
}

/**
 * PayCentral fuel cards.
 *
 * This adapter does **not** load a fuel card. Invariant #7 — the engine proposes, a human
 * executes — applies most sharply here: a bug in an assignment or a GPS trail would otherwise
 * push real money onto a card with no one in the loop. So the adapter's job is to turn an
 * approved proposal into precise instructions for a person, and to state exactly what proof
 * closes the loop.
 *
 * When the PayCentral API documentation and sandbox credentials arrive, the HTTP client belongs
 * here and nowhere else: one class, called only from `PaymentsService.execute`, and still only
 * after a human has approved the proposal. `automated` stays false until that exists.
 */
@Injectable()
export class PayCentralAdapter {
  readonly portalUrl = "https://www.paycentral.co.za";

  instructionsFor(proposal: PaymentProposal, cardNumber: string | null): FuelLoadInstruction {
    const card = cardNumber ? `card ${mask(cardNumber)}` : "the driver's fuel card";
    return {
      channel: "paycentral_portal",
      steps: [
        `Sign in to the PayCentral portal (${this.portalUrl}).`,
        `Load ${formatCents(proposal.amountCents)} onto ${card} for ${proposal.driverName ?? "the driver"}.`,
        "Confirm the load and copy the PayCentral transaction reference.",
        `Record it against ${proposal.reference} in the engine to post the journal.`,
      ],
      proofRequired: "PayCentral transaction reference",
      portalUrl: this.portalUrl,
      automated: false,
    };
  }
}

function mask(cardNumber: string): string {
  const digits = cardNumber.replace(/\D/g, "");
  return digits.length <= 4 ? "••••" : `•••• ${digits.slice(-4)}`;
}
