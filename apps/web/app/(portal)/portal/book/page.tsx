"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
 */
export default function BookPage() {
  const me = useMe();
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
        json: { quoteId: quote.id, slot: needsSlot ? slot : undefined, idempotencyKey },
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
    <div className="grid gap-8 lg:grid-cols-5">
      <div className="space-y-6 lg:col-span-3">
        <h1 className="page-title">New booking</h1>

        <Section title="1 · Service">
          <div className="grid grid-cols-2 gap-3">
            {catalog.data?.serviceLevels.map((s) => (
              <label
                key={s.code}
                className={`cursor-pointer rounded-xl border p-4 ${serviceLevel === s.code ? "border-[#0A0A0A] bg-[#FAFAF9]" : "border-line"}`}
              >
                <input
                  type="radio"
                  className="sr-only"
                  checked={serviceLevel === s.code}
                  onChange={() => {
                    setServiceLevel(s.code);
                    setQuote(null);
                  }}
                />
                <span className="block font-semibold">{s.name}</span>
                <span className="mt-1 block text-xs text-[#6B6661]">{s.description}</span>
              </label>
            ))}
          </div>
        </Section>

        <Section title="2 · Collection">
          <AddressInput
            label="Collect from"
            value={collection}
            onChange={(a) => {
              setCollection(a);
              setQuote(null);
            }}
          />
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Input
              label="Contact name (optional)"
              value={collectionName}
              onChange={setCollectionName}
            />
            <Input label="Contact phone" value={collectionPhone} onChange={setCollectionPhone} />
          </div>
          <Input
            label="Collection notes (optional)"
            value={collectionNotes}
            onChange={setCollectionNotes}
            className="mt-3"
          />
        </Section>

        <Section title="3 · Drops">
          {drops.map((d, i) => (
            <div key={i} className="mb-4 panel p-4 last:mb-0">
              <div className="flex items-center justify-between">
                <p className="font-semibold">Drop {i + 1}</p>
                {drops.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      setDrops((ds) => ds.filter((_, j) => j !== i));
                      setQuote(null);
                    }}
                    className="text-sm text-muted hover:text-[#C13B73]"
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
                    setQuote(null);
                  }}
                />
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <Input
                  label="Recipient name"
                  value={d.name}
                  onChange={(v) => setDrop(i, { name: v })}
                />
                <Input
                  label="Recipient phone"
                  value={d.phone}
                  onChange={(v) => setDrop(i, { phone: v })}
                />
                <Input
                  label="Recipient email (optional)"
                  value={d.email}
                  onChange={(v) => setDrop(i, { email: v })}
                />
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-4">
                <label className="block text-sm sm:col-span-2">
                  <span className="font-medium">Package</span>
                  <select
                    value={d.packageTypeId}
                    onChange={(e) => {
                      setDrop(i, { packageTypeId: e.target.value });
                      setQuote(null);
                    }}
                    className="mt-1 w-full rounded-xl border border-[#DAD6CF] p-3 bg-white"
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
                <Input
                  label="Qty"
                  type="number"
                  value={String(d.quantity)}
                  onChange={(v) => {
                    setDrop(i, { quantity: Math.max(1, Number(v) || 1) });
                    setQuote(null);
                  }}
                />
                <Input
                  label="Weight kg (optional)"
                  type="number"
                  value={d.weightKg}
                  onChange={(v) => {
                    setDrop(i, { weightKg: v });
                    setQuote(null);
                  }}
                />
              </div>
              <Input
                label="Delivery instructions (optional)"
                value={d.instructions}
                onChange={(v) => setDrop(i, { instructions: v })}
                className="mt-3"
                placeholder="Gate code, leave with reception…"
              />
            </div>
          ))}
          {drops.length < 20 && (
            <button
              type="button"
              onClick={() => {
                setDrops((ds) => [...ds, emptyDrop()]);
                setQuote(null);
              }}
              className="mt-3 text-sm font-medium text-brand-pink hover:text-ink"
            >
              + Add another drop
            </button>
          )}
        </Section>

        <Section title="4 · Options">
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <Check
              label="Liability cover"
              checked={opts.liabilityCover}
              onChange={(v) => {
                setOpts({ ...opts, liabilityCover: v });
                setQuote(null);
              }}
            />
            {opts.liabilityCover && (
              <Input
                label="Declared value (R)"
                type="number"
                value={opts.declaredValue}
                onChange={(v) => {
                  setOpts({ ...opts, declaredValue: v });
                  setQuote(null);
                }}
              />
            )}
            <Check
              label="Early collection"
              checked={opts.earlyCollection}
              onChange={(v) => {
                setOpts({ ...opts, earlyCollection: v });
                setQuote(null);
              }}
            />
            <Check
              label="Signature on delivery"
              checked={opts.signatureOnDelivery}
              onChange={(v) => {
                setOpts({ ...opts, signatureOnDelivery: v });
                setQuote(null);
              }}
            />
            <Check
              label="Wedding venue"
              checked={opts.weddingVenue}
              onChange={(v) => {
                setOpts({ ...opts, weddingVenue: v });
                setQuote(null);
              }}
            />
          </div>
        </Section>

        {!quote && (
          <button
            disabled={!detailsComplete || busy}
            onClick={getQuote}
            className="w-full rounded-2xl bg-ink py-3 font-medium text-white hover:bg-brand-pink transition-colors disabled:opacity-40"
          >
            {busy ? "Pricing…" : "Get my price"}
          </button>
        )}
      </div>

      <aside className="space-y-4 lg:col-span-2">
        <div className="sticky top-6 space-y-4">
          <div className="panel p-5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-[#6B6661]">Available to spend</span>
              <span className="font-mono font-semibold">
                {wallet.data ? rands(available) : "…"}
              </span>
            </div>
            {wallet.data?.billingMode === "postpaid" && (
              <p className="mt-1 text-xs text-muted">Includes your account credit limit.</p>
            )}
          </div>

          {quote && (
            <div className="panel p-5">
              <h2 className="section-title">Your price</h2>
              <div className="mt-3">
                <Breakdown b={quote.breakdown} />
              </div>
              {quote.distanceProvider === "haversine" && (
                <p className="mt-2 text-xs text-muted">
                  Distance estimated; live routing arrives with the maps key.
                </p>
              )}
              <button
                type="button"
                onClick={() => setQuote(null)}
                className="mt-3 text-xs text-muted hover:underline"
              >
                Edit details
              </button>
            </div>
          )}

          {quote && needsSlot && (
            <div className="panel p-5">
              <h2 className="section-title">Pick a delivery slot</h2>
              <SlotPicker slots={slots.data ?? []} value={slot} onChange={setSlot} />
            </div>
          )}

          {quote && (
            <div className="panel p-5">
              {short > 0 ? (
                <>
                  <p className="text-sm text-[#C13B73]">
                    You are {rands(short)} short for this booking.
                  </p>
                  <a
                    href="/portal/wallet"
                    className="mt-3 block rounded-2xl bg-ink py-3 text-center text-sm font-medium text-white hover:bg-brand-pink"
                  >
                    Top up your wallet
                  </a>
                </>
              ) : (
                <button
                  disabled={busy || (needsSlot && !slot)}
                  onClick={confirm}
                  className="w-full rounded-2xl bg-brand-pink py-3 font-medium text-white hover:bg-ink transition-colors disabled:opacity-40"
                >
                  {busy ? "Booking…" : `Confirm booking · ${rands(quote.breakdown.totalCents)}`}
                </button>
              )}
              <p className="mt-2 text-xs text-muted">
                The amount is reserved from your wallet now and charged when delivered. Cancel free
                of charge before collection.
              </p>
            </div>
          )}
          {error && <p className="alert-error">{error}</p>}
        </div>
      </aside>
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
      <div className="flex flex-wrap gap-2">
        {days.map((d) => {
          const any = slots.some((s) => s.date === d && s.bookable);
          return (
            <button
              key={d}
              type="button"
              disabled={!any}
              onClick={() => setDay(d)}
              className={`rounded-full border px-3 py-1 ${activeDay === d ? "border-[#0A0A0A] bg-ink text-white" : "border-[#DAD6CF]"} disabled:opacity-40`}
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
                className={`flex w-full items-center justify-between rounded-xl border p-3 text-left ${selected ? "border-[#0A0A0A] bg-[#FAFAF9]" : "border-line"} disabled:opacity-40`}
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel p-5">
      <h2 className="mb-3 section-title">{title}</h2>
      {children}
    </section>
  );
}

function Input(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  className?: string;
  placeholder?: string;
}) {
  return (
    <label className={`block text-sm ${props.className ?? ""}`}>
      <span className="font-medium">{props.label}</span>
      <input
        type={props.type ?? "text"}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        className="mt-1 w-full rounded-xl border border-[#DAD6CF] p-3"
      />
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
    <label className="flex items-center gap-2 py-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
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
