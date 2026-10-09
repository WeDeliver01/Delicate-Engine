"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Address,
  Booking,
  CatalogResponse,
  Quote,
  ServiceLevel,
  SlotAvailability,
  TimedWindow,
  WindowBandAvailability,
  WalletSummary,
} from "@delicate/contracts";
import { useMe } from "@/components/use-me";
import { api, ApiRequestError } from "@/lib/api";
import { rands } from "@/lib/money";
import { AddressInput } from "@/components/booking/address-input";
import { Breakdown } from "@/components/booking/breakdown";
import { SlotCalendar } from "@/components/booking/slot-calendar";
import { PayShortfall } from "@/components/booking/pay-shortfall";
import { useCollectionPoint } from "@/components/booking/use-collection-point";

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
  /*
    Back from the payment gateway. The money is credited by a webhook, not by this redirect,
    so arriving here proves nothing except that they went — the wallet is polled until it
    actually shows up, and the booking waits.
  */
  const paymentReturned = params.get("result") === "return";
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
    // Only while we are expecting money: the webhook lands seconds after the customer does.
    refetchInterval: paymentReturned ? 4_000 : false,
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

  /**
   * The customer's side of the form fills itself in. They collect from the same place every
   * time, and asking again on every booking is a question we already know the answer to.
   * Only applied while the fields are untouched, so it never overwrites something typed.
   */
  const collectionPoint = useCollectionPoint();
  useEffect(() => {
    const point = collectionPoint.point;
    if (!point || collection) return;
    setCollection(point.address);
    setCollectionName(point.contact.name);
    setCollectionPhone(point.contact.phone);
    setCollectionNotes(point.instructions ?? "");
  }, [collectionPoint.point, collection]);

  const [quote, setQuote] = useState<Quote | null>(null);
  const [slot, setSlot] = useState<{ date: string; windowKey: string } | null>(null);
  /**
   * The narrow window the customer wants, when they want one.
   *
   * It has to be chosen before the quote, not after: a timed window is priced, and a price the
   * customer did not see is one they did not agree to. The engine refuses a booking whose
   * window differs from the one its quote was priced with, so the two cannot drift.
   */
  const [timedWindow, setTimedWindow] = useState<TimedWindow | null>(null);
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
        // A quote may have been priced on the address alone, so these are often blank and
        // the booking form is where they get filled in.
        name: d.recipient?.name ?? "",
        phone: d.recipient?.phone ?? "",
        email: d.recipient?.email ?? "",
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
    // A timed window is part of what the quote was priced on, and the engine refuses a
    // booking whose window differs from its quote's. Losing it here would make every resumed
    // quote with a window unbookable.
    if (r.timedWindow?.delivery) setTimedWindow(r.timedWindow.delivery);
    // Only offer to book it if the price is still live.
    if (q.status === "priced" && Date.parse(q.expiresAt) > Date.now()) setQuote(q);
  }, [resumed.data]);

  /*
    The slot they had chosen before being sent off to pay. Carried in the URL rather than
    remembered on the server, because it is a choice, not a reservation — somebody else may
    well have taken the last place in it while the card was being typed, and the confirm step
    is where that is found out, exactly as it would be otherwise.
  */
  const resumeSlotDate = params.get("slotDate");
  const resumeSlotWindow = params.get("slotWindow");
  useEffect(() => {
    if (resumeSlotDate && resumeSlotWindow) {
      setSlot({ date: resumeSlotDate, windowKey: resumeSlotWindow });
    }
  }, [resumeSlotDate, resumeSlotWindow]);

  const sl = catalog.data?.serviceLevels.find((s) => s.code === serviceLevel);
  const needsSlot = sl?.requiresSlot ?? true;
  const windowDate = slot?.date ?? new Date().toISOString().slice(0, 10);
  const bands = useQuery({
    queryKey: ["window-bands", windowDate],
    queryFn: () =>
      api<WindowBandAvailability[]>(`/v1/public/slots/windows/${windowDate}`, { account: null }),
  });

  const slots = useQuery({
    queryKey: ["slots"],
    queryFn: () => api<SlotAvailability[]>("/v1/public/slots/availability", { account: null }),
    enabled: !!quote && needsSlot,
  });

  /**
   * Everything still missing, field by field.
   *
   * It used to be one boolean that greyed the button out, which tells somebody staring at a
   * long form that they have got something wrong and not a word about what. So the check
   * names each gap, the button stays live, and pressing it marks the fields and says so.
   */
  const problems = useMemo(() => {
    const out: { field: string; message: string }[] = [];
    if (!collection) {
      out.push({
        field: "collection",
        message: "Choose the collection address from the list of suggestions.",
      });
    }
    // The name alone is no use to a driver standing outside a locked gate.
    if (collectionName.trim() && collectionPhone.trim().length < 6) {
      out.push({
        field: "collectionPhone",
        message: "Add a phone number for the collection contact.",
      });
    }
    if (opts.liabilityCover && !(Number(opts.declaredValue) > 0)) {
      out.push({
        field: "declaredValue",
        message: "Liability cover needs the value of what you are sending.",
      });
    }
    drops.forEach((d, i) => {
      const where = drops.length > 1 ? `Drop ${i + 1}: ` : "";
      const add = (field: string, message: string) =>
        out.push({ field: `drop.${i}.${field}`, message: `${where}${message}` });
      if (!d.address) add("address", "choose the delivery address from the list of suggestions.");
      if (d.name.trim().length < 2) add("name", "who is receiving this?");
      if (d.phone.trim().length < 6) add("phone", "add a phone number for the recipient.");
      if (!d.packageTypeId) add("package", "choose what is being sent.");
    });
    return out;
  }, [collection, collectionName, collectionPhone, drops, opts.liabilityCover, opts.declaredValue]);

  /** Nothing is marked red until they have asked us for a price. Then everything is. */
  const [checked, setChecked] = useState(false);
  const problemAt = (field: string) =>
    checked ? (problems.find((p) => p.field === field)?.message ?? null) : null;

  function setDrop(i: number, patch: Partial<Drop>) {
    setDrops((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  }

  /** Any edit invalidates the price, so the customer can never confirm a stale one. */
  const clearQuote = () => setQuote(null);

  async function getQuote() {
    setChecked(true);
    if (problems.length > 0) {
      // Take them to the first gap rather than leaving them to find it. On a wide screen the
      // price panel is pinned beside the form, so the list is already in view; on a phone it
      // is at the bottom, and the field is where the answer goes.
      const first = problems[0]!.field;
      const el = document.getElementById(first);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      (el as HTMLInputElement | null)?.focus({ preventScroll: true });
      return;
    }
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
          ...(timedWindow ? { timedWindow: { collection: null, delivery: timedWindow } } : {}),
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
    if (needsSlot && !slot) {
      setError("Pick the day and the time window for the delivery first.");
      document
        .getElementById("delivery-slot")
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
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
          // Must match what the quote was priced with, or the engine refuses it.
          ...(timedWindow ? { timedWindow: { collection: null, delivery: timedWindow } } : {}),
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
      // The wallet moved under us — money spent on another booking in another tab, or a hold
      // we had not seen. Refetch it so the panel offers to take the difference instead of
      // leaving a dead Confirm button and a sentence about money.
      if (err instanceof ApiRequestError && err.code === "insufficient_funds") {
        void wallet.refetch();
      }
      // Somebody else took the last place in that hour between the quote and the confirm.
      if (err instanceof ApiRequestError && err.code === "window_unavailable") {
        void bands.refetch();
        setTimedWindow(null);
        setQuote(null);
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

      {/* ── First, and across the top, because it sets the price of everything below ── */}
      <section className="panel p-5">
        <h2 className="section-title">Choose your speed</h2>
        <p className="lede mt-1">
          Every delivery we do is same-day. The difference is how much notice we have — and it sets
          your price, so start here.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {catalog.data?.serviceLevels.map((s) => {
            const chosen = serviceLevel === s.code;
            return (
              <label
                key={s.code}
                className={`cursor-pointer rounded-xl border p-4 transition-colors ${
                  chosen ? "border-ink bg-[#FAFAF9]" : "border-line hover:border-[#DAD6CF]"
                }`}
              >
                <input
                  type="radio"
                  className="sr-only"
                  checked={chosen}
                  onChange={() => {
                    setServiceLevel(s.code);
                    clearQuote();
                  }}
                />
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-[15px] font-semibold">{s.name}</span>
                  {/* Read off the rate card rather than written here, so it cannot disagree
                      with what the quote comes back with. */}
                  <span className="text-xs text-muted">{priceEffect(s)}</span>
                </span>
                <span className="mt-1 block text-sm leading-snug text-[#6B6661]">
                  {s.description}
                </span>
                <span className="mt-2 block text-xs text-muted">
                  {s.requiresSlot
                    ? "You pick the day and the time slot."
                    : "No slot to pick — we go as soon as you confirm."}
                </span>
              </label>
            );
          })}
        </div>
      </section>

      {/* ── The body: settings · drops · price, side by side on a wide screen ── */}
      <div className="grid gap-5 xl:grid-cols-12">
        {/* Collection and options: set once, then left alone. */}
        <div className="space-y-5 xl:col-span-4">
          <section className="panel p-5">
            <h2 className="section-title mb-3">Collection</h2>
            <AddressInput
              id="collection"
              label="Collect from"
              required
              error={problemAt("collection")}
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
              <Field
                id="collectionPhone"
                label="Contact phone"
                optional
                hint="Who the driver calls at collection."
                error={problemAt("collectionPhone")}
                value={collectionPhone}
                onChange={setCollectionPhone}
              />
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
                  id="declaredValue"
                  label="Declared value (R)"
                  type="number"
                  error={problemAt("declaredValue")}
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
                  id={`drop.${i}.address`}
                  label="Deliver to"
                  required
                  error={problemAt(`drop.${i}.address`)}
                  value={d.address}
                  onChange={(a) => {
                    setDrop(i, { address: a });
                    clearQuote();
                  }}
                />
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field
                  id={`drop.${i}.name`}
                  label="Recipient name"
                  error={problemAt(`drop.${i}.name`)}
                  value={d.name}
                  onChange={(v) => setDrop(i, { name: v })}
                />
                <Field
                  id={`drop.${i}.phone`}
                  label="Recipient phone"
                  error={problemAt(`drop.${i}.phone`)}
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
                  <span className="field-label">
                    Package
                    <RequiredMark />
                  </span>
                  <select
                    id={`drop.${i}.package`}
                    value={d.packageTypeId}
                    onChange={(e) => {
                      setDrop(i, { packageTypeId: e.target.value });
                      clearQuote();
                    }}
                    aria-invalid={problemAt(`drop.${i}.package`) ? true : undefined}
                    className={`input mt-1 ${problemAt(`drop.${i}.package`) ? "input-invalid" : ""}`}
                  >
                    <option value="">Select…</option>
                    {catalog.data?.packageTypes.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.maxWeightKg ? ` (≤ ${p.maxWeightKg} kg)` : ""}
                      </option>
                    ))}
                  </select>
                  {problemAt(`drop.${i}.package`) && (
                    <span className="field-error">Choose what is being sent.</span>
                  )}
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

        {/* A narrow window is priced, so it is chosen before the price, not after. */}
        {(bands.data ?? []).length > 0 && (
          <section className="panel p-5 xl:col-span-8">
            <h2 className="section-title">Delivery window</h2>
            <p className="lede mt-1">
              Optional. Pick an hour and we will be there inside it; leave it and we will come some
              time in your slot.
            </p>
            <WindowPicker
              bands={bands.data ?? []}
              value={timedWindow}
              onChange={(w) => {
                setTimedWindow(w);
                clearQuote();
              }}
            />
          </section>
        )}

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
                <button disabled={busy} onClick={getQuote} className="btn btn-primary mt-4 w-full">
                  {busy ? "Pricing…" : "Get my price"}
                </button>
                {checked && problems.length > 0 ? (
                  <div className="alert-error mt-3">
                    <p className="font-medium">
                      {problems.length === 1
                        ? "One thing is missing:"
                        : `${problems.length} things are missing:`}
                    </p>
                    <ul className="mt-1.5 space-y-1">
                      {problems.map((p) => (
                        <li key={p.field}>
                          <button
                            type="button"
                            onClick={() => {
                              const el = document.getElementById(p.field);
                              el?.scrollIntoView({ behavior: "smooth", block: "center" });
                              (el as HTMLInputElement | null)?.focus({ preventScroll: true });
                            }}
                            className="text-left underline decoration-[#E8A9C5] underline-offset-2 hover:decoration-[#C13B73]"
                          >
                            {p.message}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-muted">
                    Fields marked <span className="text-[#C13B73]">*</span> are needed before we can
                    price it.
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
                  <button type="button" onClick={clearQuote} className="link-quiet mt-3 text-xs">
                    Edit details
                  </button>
                </section>

                {needsSlot && (
                  <section className="panel p-5" id="delivery-slot">
                    <h2 className="section-title">Delivery slot</h2>
                    <SlotCalendar slots={slots.data ?? []} value={slot} onChange={setSlot} />
                  </section>
                )}

                <section className="panel p-5">
                  {paymentReturned && short > 0 && (
                    <p className="alert-info mb-3">
                      We have not seen your payment yet. It usually lands within a minute — this
                      page is watching for it.
                    </p>
                  )}
                  {short > 0 ? (
                    <PayShortfall
                      shortCents={short}
                      totalCents={quote.breakdown.totalCents}
                      availableCents={available}
                      returnTo={payReturnPath(quote.id, slot)}
                    />
                  ) : (
                    <>
                      {paymentReturned && (
                        <p className="alert-success mb-3">
                          Payment received. Your booking is ready to confirm.
                        </p>
                      )}
                      <button
                        disabled={busy}
                        onClick={confirm}
                        className="btn w-full bg-brand-pink text-white hover:bg-ink"
                      >
                        {busy ? "Booking…" : `Confirm · ${rands(quote.breakdown.totalCents)}`}
                      </button>
                      {needsSlot && !slot && (
                        <p className="mt-2 text-xs text-[#C13B73]">
                          Pick a delivery date and time above first.
                        </p>
                      )}
                    </>
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

function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  className?: string;
  placeholder?: string;
  hint?: string;
  optional?: boolean;
  id?: string;
  /** What is wrong with it, once they have asked us to price the booking. */
  error?: string | null;
}) {
  return (
    <label className={`block ${props.className ?? ""}`}>
      <span className="field-label">
        {props.label}
        {props.optional ? (
          <span className="ml-1 normal-case text-[#B5AFA7]">optional</span>
        ) : (
          <RequiredMark />
        )}
      </span>
      <input
        id={props.id}
        type={props.type ?? "text"}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        aria-invalid={props.error ? true : undefined}
        className={`input mt-1 ${props.error ? "input-invalid" : ""}`}
      />
      {props.error ? (
        <span className="field-error">{props.error}</span>
      ) : (
        props.hint && <span className="field-hint">{props.hint}</span>
      )}
    </label>
  );
}

/**
 * The star next to a field we cannot do without.
 *
 * Marking the required ones rather than the optional ones is the wrong way round for most
 * forms — but this one is mostly required, and a customer scanning it wants to know what they
 * are obliged to fill in, not what they may skip. Both are marked, so neither is a guess.
 */
function RequiredMark() {
  return (
    <span className="ml-0.5 text-[#C13B73]" aria-hidden="true" title="Required">
      *
    </span>
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

/**
 * What picking this service level does to the price, in the customer's terms.
 *
 * Taken from the rate card rather than written into the page: the multiplier and the
 * surcharge are both editable in the console, and a hard-coded "+50%" would go on saying so
 * long after somebody changed it.
 */
function priceEffect(s: ServiceLevel): string {
  const times = s.multiplierBps / 10_000;
  const parts: string[] = [];
  if (times !== 1) parts.push(`${trimZeros(times)}× the distance`);
  if (s.surchargeCents > 0) parts.push(`${rands(s.surchargeCents)} more`);
  return parts.length === 0 ? "Our standard rate" : parts.join(" + ");
}

const trimZeros = (n: number): string => String(Number(n.toFixed(2)));

/**
 * Where the payment gateway should put the customer down: this booking, as they left it.
 *
 * The quote holds the addresses, the parcels and the price; the slot is the one thing chosen
 * after it, so it travels in the URL beside it.
 */
function payReturnPath(quoteId: string, slot: { date: string; windowKey: string } | null): string {
  const q = new URLSearchParams({ quote: quoteId });
  if (slot) {
    q.set("slotDate", slot.date);
    q.set("slotWindow", slot.windowKey);
  }
  return `/portal/book?${q.toString()}`;
}

function describeError(err: ApiRequestError): string {
  if (err.code === "insufficient_funds")
    return `You are ${rands((err.error.details as { shortfallCents: number }).shortfallCents)} short for this booking. Pay the difference below and we will come straight back here.`;
  if (err.code === "slot_unavailable") return "That slot just filled up. Please pick another.";
  if (err.code === "validation_failed") {
    const issues = err.error.details as
      { path: (string | number)[]; message: string }[] | undefined;
    return issues?.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") ?? err.message;
  }
  return err.message;
}

/**
 * Pick an hour, or none.
 *
 * Full hours are shown and disabled rather than hidden: "10:00 is taken" is useful, and a
 * silently missing option reads as a bug. Choosing one re-prices, because it is a different
 * promise and it costs differently.
 */
function WindowPicker({
  bands,
  value,
  onChange,
}: {
  bands: WindowBandAvailability[];
  value: TimedWindow | null;
  onChange: (w: TimedWindow | null) => void;
}) {
  const clock = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const chosen = (b: WindowBandAvailability) =>
    value?.startMinute === b.startMinute && value?.endMinute === b.endMinute;

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => onChange(null)}
        className={`chip ${value === null ? "chip-info" : "chip-outline"}`}
      >
        Any time in my slot
      </button>
      {bands.map((b) => (
        <button
          key={b.startMinute}
          type="button"
          disabled={!b.bookable}
          onClick={() => onChange({ startMinute: b.startMinute, endMinute: b.endMinute })}
          title={b.bookable ? `${b.remaining} left` : "fully booked"}
          className={`chip ${chosen(b) ? "chip-info" : "chip-outline"} ${
            b.bookable ? "" : "opacity-40"
          }`}
        >
          {clock(b.startMinute)}–{clock(b.endMinute)}
          {!b.bookable && " · full"}
        </button>
      ))}
    </div>
  );
}
