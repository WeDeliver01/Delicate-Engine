"use client";

import type { PaymentProviderName, TopUpInstructions } from "@delicate/contracts";

/** What the customer calls each way of paying. Their words, not the provider's slug. */
export const PROVIDER_LABELS: Record<PaymentProviderName, string> = {
  manual_eft: "Bank transfer (EFT)",
  payfast: "Card / Instant EFT via PayFast",
  yoco: "Card via Yoco",
  bobpay: "Bob Pay",
};

/**
 * Money arrives the moment the gateway says so, which for a bank transfer is whenever
 * somebody in finance matches it against the statement. Fine for topping up in advance;
 * no use at all to a customer who is short with a booking waiting on the screen.
 */
export const INSTANT_PROVIDERS: PaymentProviderName[] = ["payfast", "yoco", "bobpay"];

/**
 * Hand the browser over to the payment provider.
 *
 * Some want a GET, some a signed POST body they will not accept as a query string, so the
 * POST case is a real form submission: no fetch, because the customer has to end up on
 * their page rather than us reading the response of one.
 */
export function submitRedirect(i: Extract<TopUpInstructions, { type: "redirect" }>): void {
  if (i.method === "GET") {
    window.location.assign(i.url);
    return;
  }
  const form = document.createElement("form");
  form.method = "POST";
  form.action = i.url;
  for (const [k, v] of Object.entries(i.fields ?? {})) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = k;
    input.value = v;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}
