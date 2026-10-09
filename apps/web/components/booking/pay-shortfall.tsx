"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CreateTopUpResponse, PaymentProviderName } from "@delicate/contracts";
import { api, ApiRequestError } from "@/lib/api";
import { rands } from "@/lib/money";
import { INSTANT_PROVIDERS, PROVIDER_LABELS, submitRedirect } from "@/lib/pay";

/** The smallest card payment worth taking, and what the engine will accept. */
const MINIMUM_CENTS = 5_000;

/**
 * Pay for a booking the wallet cannot cover, without leaving the booking.
 *
 * The wallet comes first — balance, then credit — and this covers whatever is left. It is
 * still a top-up underneath, because the wallet is the only thing a booking is ever charged
 * against and putting a second path to the money in would mean two ledgers that have to agree.
 * What changes is where the customer lands afterwards: back on this booking with the money
 * in, rather than on the wallet page wondering what became of their cake.
 */
export function PayShortfall({
  shortCents,
  totalCents,
  availableCents,
  returnTo,
}: {
  shortCents: number;
  totalCents: number;
  availableCents: number;
  /** A path inside the portal; the engine refuses anything else. */
  returnTo: string;
}) {
  const providers = useQuery({
    queryKey: ["wallet", "providers"],
    queryFn: () => api<{ providers: PaymentProviderName[] }>("/v1/account/wallet/providers"),
  });
  const instant = (providers.data?.providers ?? []).filter((p) => INSTANT_PROVIDERS.includes(p));
  const [provider, setProvider] = useState<PaymentProviderName | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!provider && instant[0]) setProvider(instant[0]);
  }, [instant, provider]);

  // Card gateways will not take R7,50, and the engine's own floor is R50. The extra is not
  // lost — it stays in the wallet — but saying so beforehand is the difference between a
  // generous rounding and a surprise.
  const chargeCents = Math.max(shortCents, MINIMUM_CENTS);

  async function pay() {
    if (!provider) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<CreateTopUpResponse>("/v1/account/wallet/top-ups", {
        method: "POST",
        json: { provider, amountCents: chargeCents, returnTo },
      });
      if (res.instructions.type !== "redirect") {
        setError("That way of paying cannot be used here. Try a card.");
        setBusy(false);
        return;
      }
      submitRedirect(res.instructions);
      // No setBusy(false): the browser is on its way to the provider, and a button that
      // springs back to life invites a second payment.
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium text-ink">Pay the difference</p>
        <p className="mt-1 text-xs text-muted">
          Your wallet covers {rands(Math.max(0, Math.min(availableCents, totalCents)))} of{" "}
          {rands(totalCents)}. Pay the remaining{" "}
          <strong className="text-ink">{rands(shortCents)}</strong> and we will bring you straight
          back here to confirm.
        </p>
      </div>

      {providers.isLoading ? (
        <p className="text-xs text-muted">Loading ways to pay…</p>
      ) : instant.length === 0 ? (
        <p className="text-xs text-muted">
          Card payment is not switched on at the moment. Top up your wallet by bank transfer and
          come back to this booking.
        </p>
      ) : (
        <>
          {instant.length > 1 && (
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as PaymentProviderName)}
              className="input"
            >
              {instant.map((p) => (
                <option key={p} value={p}>
                  {PROVIDER_LABELS[p]}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={pay}
            disabled={busy || !provider}
            className="btn w-full bg-brand-pink text-white hover:bg-ink"
          >
            {busy ? "Taking you to pay…" : `Pay ${rands(chargeCents)} now`}
          </button>
          {chargeCents > shortCents && (
            <p className="text-xs text-muted">
              {rands(MINIMUM_CENTS)} is the smallest card payment we can take. The extra{" "}
              {rands(chargeCents - shortCents)} stays in your wallet for next time.
            </p>
          )}
        </>
      )}

      {error && <p className="text-xs text-[#C13B73]">{error}</p>}

      <a href="/portal/wallet" className="link-quiet block text-xs">
        Or top up your wallet another way →
      </a>
    </div>
  );
}
