"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Address,
  Booking,
  CatalogResponse,
  Quote,
  SlotAvailability,
  WalletSummary,
} from "@delicate/contracts";
import { useMe } from "@/components/use-me";
import { api, ApiRequestError } from "@/lib/api";
import { rands } from "@/lib/money";
import { AddressInput } from "@/components/booking/address-input";
import { Breakdown } from "@/components/booking/breakdown";

type Drop = {
  address: Address | null;
  name: string;
  phone: string;
  email: string;
  instructions: string;
  packageTypeId: string;
  quantity: number;
  weightKg: string;
  description: string;
};

const emptyDrop = (): Drop => ({
  address: null,
  name: "",
  phone: "",
  email: "",
  instructions: "",
  packageTypeId: "",
  quantity: 1,
  weightKg: "",
  description: "",
});

/**
 * New booking: details → quote (persisted, on the account's rate card) → slot (Standard only)
 * → confirm. The confirm step is one engine call that reserves the slot and holds the funds
 * atomically, so the customer sees exactly one of: confirmed, insufficient funds, slot taken.
 *
 * Laid out across the full width rather than as a narrow column with a mostly-empty margin.
 * The form is long, most of it is short fields, and stacking them one per row means scrolling
 * past a screen of whitespace to reach the button. Collection and options are settings you set
 * once and leave; drops are the part that grows. So those get their own columns, and the price
 * stays in view beside them instead of arriving at the bottom.
 */
export default function BookPage() {
  return (
    <Suspense fallback={<p className="lede">Loading…</p>}>
      <Book />
    </Suspense>
  );
}

function Book() {
  const me = useMe();
  const params = useSearchParams();
  const resumeQuoteId = params.get("quote");
  const router = useRouter();
  const qc = useQueryClient();
  const account = me.activeAccount;

  const catalog = useQuery({
    queryKey: ["catalog"],
    queryFn: () => api<CatalogResponse>("/v1/public/catalog", { account: null }),
  });
  const wallet = useQuery({
    queryKey: ["account", account?.id, "wallet"],
    queryFn: () => api<WalletSummary>("/v1/account/wallet"),
    enabled: !!account,
  });

  const [serviceLevel, setServiceLevel] = useState("standard");
  const [collection, setCollection] = useState<Address | null>(null);
  const [collectionName, setCollectionName] = useState("");
  const [collectionPhone, setCollectionPhone] = useState("");
  const [collectionNotes, setCollectionNotes] = useState("");
  const [customerReference, setCustomerReference] = useState("");
  const [drops, setDrops] = useState<Drop[]>([emptyDrop()]);
  const [opts, setOpts] = useState({
    liabilityCover: false,
    declaredValue: "",
    earlyCollection: false,
    signatureOnDelivery: false,
    weddingVenue: false,
  });

  const [quote, setQuote] = useState<Quote | null>(null);
  const [slot, setSlot] = useState<{ date: string; windowKey: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [idempotencyKey] = useState(() => `web-${crypto.randomUUID()}`);

  /**
   * Arriving from a saved quote: fill the form back in from the request it was priced on, and
   * show its price straight away. Booking still goes through the same confirm step, because a
   * quote that expired while it sat in the list must be refused the same way as any other.
   */
  const resumed = useQuery({
    queryKey: ["quote", resumeQuoteId],
    queryFn: () => api<Quote>(`/v1/account/quotes/${resumeQuoteId}`),
    enabled: !!resumeQuoteId,
  });

  useEffect(() => {
    const q = resumed.data;
    if (!q) return;
    const r = q.request;
    setServiceLevel(q.serviceLevelCode);
    setCollection(r.collection.address);
    setCollectionName(r.collection.contact?.name ?? "");
    setCollectionPhone(r.collection.contact?.phone ?? "");
    setCollectionNotes(r.collection.instructions ?? "");
    setDrops(
      r.drops.map((d) => ({
        address: d.address,
        name: d.recipient.name,
        phone: d.recipient.phone,
        email: d.recipient.email ?? "",
        instructions: d.instructions ?? "",
        packageTypeId: d.parcels[0]?.packageTypeId ?? "",
        quantity: d.parcels[0]?.quantity ?? 1,
        weightKg: d.parcels[0]?.weightKg != null ? String(d.parcels[0].weightKg) : "",
        description: d.parcels[0]?.description ?? "",
      })),
    );
    setOpts({
      liabilityCover: r.options.liabilityCover ?? false,
      declaredValue: r.options.declaredValueCents ? String(r.options.declaredValueCents / 100) : "",
      earlyCollection: r.options.earlyCollection ?? false,
      signatureOnDelivery: r.options.signatureOnDelivery ?? false,
      weddingVenue: r.options.weddingVenue ?? false,
    });
    // Only offer to book it if the price is still live.
    if (q.status === "priced" && Date.parse(q.expiresAt) > Date.now()) setQuote(q);
  }, [resumed.data]);

  const sl = catalog.data?.serviceLevels.find((s) => s.code === serviceLevel);
  const needsSlot = sl?.requiresSlot ?? true;
  const slots = useQuery({
    queryKey: ["slots"],
    queryFn: () => api<SlotAvailability[]>("/v1/public/slots/availability", { account: null }),
    enabled: !!quote && needsSlot,
  });

  const detailsComplete = useMemo(
    () =>
      !!collection &&
      drops.every(
        (d) =>
          d.address && d.name.trim().length >= 2 && d.phone.trim().length >= 6 && d.packageTypeId,
      ),
    [collection, drops],
  );

  function setDrop(i: number, patch: Partial<Drop>) {
    setDrops((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  }

  /** Any edit invalidates the price, so the customer can never confirm a stale one. */
  const clearQuote = () => setQuote(null);

  async function getQuote() {
    setBusy(true);
    setError(null);
    try {
      const q = await api<Quote>("/v1/account/quotes", {
        method: "POST",
        json: {
          serviceLevelCode: serviceLevel,
          collection: {
            address: collection,
            contact: collectionName
              ? { name: collectionName, phone: collectionPhone, email: null }
              : null,
            instructions: collectionNotes || null,
          },
          drops: drops.map((d) => ({
            address: d.address,
            recipient: { name: d.name, phone: d.phone, email: d.email || null },
            instructions: d.instructions || null,
            parcels: [
              {
                packageTypeId: d.packageTypeId,
                quantity: d.quantity,
                weightKg: d.weightKg ? Number(d.weightKg) : null,
                description: d.description || null,
              },
            ],
          })),
          options: {
            liabilityCover: opts.liabilityCover,
            declaredValueCents: opts.liabilityCover
              ? Math.round(Number(opts.declaredValue || 0) * 100)
              : 0,
            earlyCollection: opts.earlyCollection,
            signatureOnDelivery: opts.signatureOnDelivery,
            weddingVenue: opts.weddingVenue,
          },
        },
      });
      setQuote(q);
      setSlot(null);
    } catch (err) {
      setError(err instanceof ApiRequestError ? describeError(err) : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!quote) return;
    setBusy(true);
    setError(null);
    try {
      const b = await api<Booking>("/v1/account/bookings", {
        method: "POST",
        json: {
          quoteId: quote.id,
          slot: needsSlot ? slot : undefined,
          idempotencyKey,
          customerReference: customerReference.trim() || undefined,
        },
      });
      await qc.invalidateQueries({ queryKey: ["account", account?.id] });
      router.replace(`/portal/bookings/${b.id}?new=1`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? describeError(err) : String(err));
      if (err instanceof ApiRequestError && err.code === "slot_unavailable") {
        void slots.refetch();
        setSlot(null);
      }
    } finally {
      setBusy(false);
    }
  }

  if (!account) return null;
  const available = wallet.data?.availableCents ?? 0;
  const short = quote ? Math.max(0, quote.breakdown.totalCents - available) : 0;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">{account.name}</p>
          <h1 className="page-title mt-1">New booking</h1>
        </div>
        <div className="text-right text-sm">
          <span className="label-mini block">Available to spend</span>
          <span className="figure text-lg font-semibold">
            {wallet.data ? rands(available) : "…"}
          </span>
          {wallet.data?.billingMode === "postpaid" && (
            <span className="block text-xs text-muted">includes your credit limit</span>
          )}
        </div>
      </header>

      {/* ── Service level: one row across the top, because it is one choice ── */}
      <section className="panel p-4">
        <p className="field-label mb-2">Service level</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {catalog.data?.serviceLevels.map((s) => (
            <label
              key={s.code}
              className={`cursor-pointer rounded-xl border p-3 transition-colors ${
                serviceLevel === s.code
                  ? "border-ink bg-[#FAFAF9]"
                  : "border-line hover:border-[#DAD6CF]"
              }`}
            >
              <input
                type="radio"
                className="sr-only"
                checked={serviceLevel === s.code}
                onChange={() => {
                  setServiceLevel(s.code);
                  clearQuote();
                }}
              />
              <span className="block text-[14px] font-semibold">{s.name}</span>
              <span className="mt-0.5 block text-xs leading-snug text-[#6B6661]">
                {s.description}
              </span>
            </label>
          ))}
        </div>
      </section>

      {/* ── The body: settings · drops · price, side by side on a wide screen ── */}
      <div className="grid gap-5 xl:grid-cols-12">
        {/* Collection and options: set once, then left alone. */}
        <div className="space-y-5 xl:col-span-4">
          <section className="panel p-5">
            <h2 className="section-title mb-3">Collection</h2>
            <AddressInput
              label="Collect from"
              value={collection}
              onChange={(a) => {
                setCollection(a);
                clearQuote();
              }}
            />
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field
                label="Contact name"
                optional
                value={collectionName}
                onChange={setCollectionName}
              />
              <Field label="Contact phone" value={collectionPhone} onChange={setCollectionPhone} />
            </div>
            <Field
              label="Collection notes"
              optional
              value={collectionNotes}
              onChange={setCollectionNotes}
              className="mt-3"
              placeholder="Ring the bell at the side gate…"
            />
            <Field
              label="Your reference"
              optional
              value={customerReference}
              onChange={setCustomerReference}
              className="mt-3"
              placeholder="Your own order number"
              hint="Shown on your invoice and searchable in your shipment list."
            />
          </section>

          <section className="panel p-5">
            <h2 className="section-title mb-3">Options</h2>
            <div className="space-y-1">
              <Check
                label="Liability cover"
                checked={opts.liabilityCover}
                onChange={(v) => {
                  setOpts({ ...opts, liabilityCover: v });
                  clearQuote();
                }}
              />
              {opts.liabilityCover && (
                <Field
                  label="Declared value (R)"
                  type="number"
                  value={opts.declaredValue}
                  onChange={(v) => {
                    setOpts({ ...opts, declaredValue: v });
                    clearQuote();
                  }}
                  className="pb-1 pl-6"
                />
              )}
              <Check
                label="Early collection"
                checked={opts.earlyCollection}
                onChange={(v) => {
                  setOpts({ ...opts, earlyCollection: v });
                  clearQuote();
                }}
              />
              <Check
                label="Signature on delivery"
                checked={opts.signatureOnDelivery}
                onChange={(v) => {
                  setOpts({ ...opts, signatureOnDelivery: v });
                  clearQuote();
                }}
              />
              <Check
                label="Wedding venue"
                checked={opts.weddingVenue}
                onChange={(v) => {
                  setOpts({ ...opts, weddingVenue: v });
                  clearQuote();
                }}
              />
            </div>
          </section>
        </div>

        {/* Drops: the part that grows, so it gets the most room. */}
        <div className="space-y-4 xl:col-span-5">
          <div className="flex items-center justify-between">
            <h2 className="section-title">
              {drops.length === 1 ? "Delivery" : `${drops.length} deliveries`}
            </h2>
            {drops.length < 20 && (
              <button
                type="button"
                onClick={() => {
                  setDrops((ds) => [...ds, emptyDrop()]);
                  clearQuote();
                }}
                className="btn btn-secondary btn-sm"
              >
                + Add a drop
              </button>
            )}
          </div>

          {drops.map((d, i) => (
            <section key={i} className="panel p-5">
              <div className="flex items-center justify-between">
                <p className="eyebrow">Drop {i + 1}</p>
                {drops.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      setDrops((ds) => ds.filter((_, j) => j !== i));
                      clearQuote();
                    }}
                    className="text-xs text-muted transition-colors hover:text-[#C13B73]"
                  >
                    Remove
                  </button>
                )}
              </div>

              <div className="mt-3">
                <AddressInput
                  label="Deliver to"
                  value={d.address}
                  onChange={(a) => {
                    setDrop(i, { address: a });
                    clearQuote();
                  }}
                />
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field
                  label="Recipient name"
                  value={d.name}
                  onChange={(v) => setDrop(i, { name: v })}
                />
                <Field
                  label="Recipient phone"
                  value={d.phone}
                  onChange={(v) => setDrop(i, { phone: v })}
                  hint="We message this number when the driver is on the way."
                />
              </div>

              <Field
                label="Recipient email"
                optional
                type="email"
                value={d.email}
                onChange={(v) => setDrop(i, { email: v })}
                className="mt-3"
              />

              <div className="mt-3 grid gap-3 sm:grid-cols-4">
                <label className="block sm:col-span-2">
                  <span className="field-label">Package</span>
                  <select
                    value={d.packageTypeId}
                    onChange={(e) => {
                      setDrop(i, { packageTypeId: e.target.value });
                      clearQuote();
                    }}
                    className="input mt-1"
                  >
                    <option value="">Select…</option>
                    {catalog.data?.packageTypes.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.maxWeightKg ? ` (≤ ${p.maxWeightKg} kg)` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <Field
                  label="Qty"
                  type="number"
                  value={String(d.quantity)}
                  onChange={(v) => {
                    setDrop(i, { quantity: Math.max(1, Number(v) || 1) });
                    clearQuote();
                  }}
                />
                <Field
                  label="Weight kg"
                  optional
                  type="number"
                  value={d.weightKg}
                  onChange={(v) => {
                    setDrop(i, { weightKg: v });
                    clearQuote();
                  }}
                />
              </div>

              <Field
                label="Delivery instructions"
                optional
                value={d.instructions}
                onChange={(v) => setDrop(i, { instructions: v })}
                className="mt-3"
                placeholder="Gate code, leave with reception…"
              />
            </section>
          ))}
        </div>

        {/* Price: in view the whole time, not waiting at the bottom. */}
        <aside className="xl:col-span-3">
          <div className="space-y-4 xl:sticky xl:top-6">
            {!quote ? (
              <section className="panel p-5">
                <h2 className="section-title">Your price</h2>
                <p className="lede mt-1">
                  Fill in the collection address and each drop, then we will price it on your rate
                  card.
                </p>
                <button
                  disabled={!detailsComplete || busy}
                  onClick={getQuote}
                  className="btn btn-primary mt-4 w-full"
                >
                  {busy ? "Pricing…" : "Get my price"}
                </button>
                {!detailsComplete && (
                  <p className="mt-2 text-xs text-muted">
                    Each drop needs an address, a recipient name and phone, and a package type.
                  </p>
                )}
              </section>
            ) : (
              <>
                <section className="panel p-5">
                  <h2 className="section-title">Your price</h2>
                  <div className="mt-3">
                    <Breakdown b={quote.breakdown} />
                  </div>
                  {quote.distanceProvider === "haversine" && (
                    <p className="mt-2 text-xs text-muted">
                      Distance estimated; live routing arrives with the maps key.
                    </p>
                  )}
                  <button type="button" onClick={clearQuote} className="link-quiet mt-3 text-xs">
                    Edit details
                  </button>
                </section>

                {needsSlot && (
                  <section className="panel p-5">
                    <h2 className="section-title">Delivery slot</h2>
                    <SlotPicker slots={slots.data ?? []} value={slot} onChange={setSlot} />
                  </section>
                )}

                <section className="panel p-5">
                  {short > 0 ? (
                    <>
                      <p className="text-sm text-[#C13B73]">
                        You are {rands(short)} short for this booking.
                      </p>
                      <a href="/portal/wallet" className="btn btn-primary mt-3 w-full">
                        Top up your wallet
                      </a>
                    </>
                  ) : (
                    <button
                      disabled={busy || (needsSlot && !slot)}
                      onClick={confirm}
                      className="btn w-full bg-brand-pink text-white hover:bg-ink"
                    >
                      {busy ? "Booking…" : `Confirm · ${rands(quote.breakdown.totalCents)}`}
                    </button>
                  )}
                  <p className="mt-2 text-xs text-muted">
                    The amount is reserved from your wallet now and charged when delivered. Cancel
                    free of charge before collection.
                  </p>
                </section>
              </>
            )}

            {error && <p className="alert-error">{error}</p>}
          </div>
        </aside>
      </div>
    </div>
  );
}

function SlotPicker({
  slots,
  value,
  onChange,
}: {
  slots: SlotAvailability[];
  value: { date: string; windowKey: string } | null;
  onChange: (v: { date: string; windowKey: string }) => void;
}) {
  const days = [...new Set(slots.map((s) => s.date))];
  const [day, setDay] = useState<string | null>(null);
  const activeDay =
    day ?? days.find((d) => slots.some((s) => s.date === d && s.bookable)) ?? days[0] ?? null;
  return (
    <div className="mt-3 space-y-3 text-sm">
      <div className="flex flex-wrap gap-1.5">
        {days.map((d) => {
          const any = slots.some((s) => s.date === d && s.bookable);
          return (
            <button
              key={d}
              type="button"
              disabled={!any}
              onClick={() => setDay(d)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-40 ${
                activeDay === d ? "border-ink bg-ink text-white" : "border-[#DAD6CF]"
              }`}
            >
              {new Date(`${d}T00:00:00`).toLocaleDateString("en-ZA", {
                weekday: "short",
                day: "numeric",
                month: "short",
              })}
            </button>
          );
        })}
      </div>
      <div className="space-y-2">
        {slots
          .filter((s) => s.date === activeDay)
          .map((s) => {
            const selected = value?.date === s.date && value?.windowKey === s.windowKey;
            return (
              <button
                key={s.windowKey}
                type="button"
                disabled={!s.bookable}
                onClick={() => onChange({ date: s.date, windowKey: s.windowKey })}
                className={`flex w-full items-center justify-between rounded-xl border p-3 text-left transition-colors disabled:opacity-40 ${
                  selected ? "border-ink bg-[#FAFAF9]" : "border-line"
                }`}
              >
                <span>{s.label}</span>
                <span className="text-xs text-muted">
                  {s.bookable ? `${s.remaining} left` : s.closedReason?.replace("_", " ")}
                </span>
              </button>
            );
          })}
      </div>
    </div>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  className?: string;
  placeholder?: string;
  hint?: string;
  optional?: boolean;
}) {
  return (
    <label className={`block ${props.className ?? ""}`}>
      <span className="field-label">
        {props.label}
        {props.optional && <span className="ml-1 normal-case text-[#B5AFA7]">optional</span>}
      </span>
      <input
        type={props.type ?? "text"}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        className="input mt-1"
      />
      {props.hint && <span className="field-hint">{props.hint}</span>}
    </label>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 py-1.5 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="checkbox"
      />
      <span>{label}</span>
    </label>
  );
}

function describeError(err: ApiRequestError): string {
  if (err.code === "insufficient_funds")
    return `Insufficient funds: you are ${rands((err.error.details as { shortfallCents: number }).shortfallCents)} short. Top up your wallet and try again.`;
  if (err.code === "slot_unavailable") return "That slot just filled up. Please pick another.";
  if (err.code === "validation_failed") {
    const issues = err.error.details as
      { path: (string | number)[]; message: string }[] | undefined;
    return issues?.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") ?? err.message;
  }
  return err.message;
}
