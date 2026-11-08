import type { Address, CustomerQuoteBreakdown } from "@delicate/contracts";

/**
 * Handoff between the estimator form and the printable download page.
 *
 * An anonymous estimate is never persisted — there is no account to save it against — so it
 * cannot be reopened by id the way a signed-in customer's quote can. sessionStorage is the
 * whole backing store: good enough to survive the one navigation to the print view, gone the
 * moment the tab closes, which matches what this number actually is.
 */
export const PENDING_ESTIMATE_KEY = "delicate.pending-estimate";

export interface PendingEstimate {
  serviceLevelCode: string;
  serviceLevelName: string;
  collection: Address;
  drops: Address[];
  packageTypeName: string;
  breakdown: CustomerQuoteBreakdown;
  createdAt: string;
}
