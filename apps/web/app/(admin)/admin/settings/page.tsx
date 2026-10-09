"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CompanyTaxProfile,
  OperationsSettings,
  SettingsBundle,
  BookingLimits,
  SettlementRules,
  VatSettings,
} from "@delicate/contracts";
import { api, ApiRequestError } from "@/lib/api";
import { rands } from "@/lib/money";
import { useMe } from "@/components/use-me";

/**
 * The numbers the business owns. Everything here was seed-only until now, which meant the VAT
 * number on a tax invoice and the rate a driver is paid could only be changed by a developer.
 */
export default function AdminSettings() {
  const qc = useQueryClient();
  const me = useMe();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const onError = (e: unknown) => {
    setSaved(null);
    setError(e instanceof ApiRequestError ? e.message : String(e));
  };

  const s = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: () => api<SettingsBundle>("/v1/admin/settings"),
  });
  const integrations = useQuery({
    queryKey: ["admin", "integrations"],
    queryFn: () => api<Integration[]>("/v1/admin/integrations"),
  });

  const canWrite = me.data?.user.platformRole === "super_admin";

  // Each group saves separately, so the audit trail says which numbers actually changed.
  const saved_ = (label: string) => () => {
    setError(null);
    setSaved(`${label} saved.`);
    void qc.invalidateQueries({ queryKey: ["admin"] });
  };
  const company = useMutation({
    mutationFn: (body: CompanyTaxProfile) =>
      api("/v1/admin/settings/company-profile", { method: "PUT", json: body }),
    onSuccess: saved_("Company identity"),
    onError,
  });
  const terms = useMutation({
    mutationFn: (body: { terms: string }) =>
      api("/v1/admin/settings/waybill-terms", { method: "PUT", json: body }),
    onSuccess: saved_("Waybill terms"),
    onError,
  });
  const vat = useMutation({
    mutationFn: (body: VatSettings) => api("/v1/admin/settings/vat", { method: "PUT", json: body }),
    onSuccess: saved_("VAT"),
    onError,
  });
  const ops = useMutation({
    mutationFn: (body: OperationsSettings) =>
      api("/v1/admin/settings/operations", { method: "PUT", json: body }),
    onSuccess: saved_("Operations"),
    onError,
  });
  const bookingLimits = useMutation({
    mutationFn: (body: BookingLimits) =>
      api("/v1/admin/settings/booking-limits", { method: "PUT", json: body }),
    onSuccess: saved_("What one delivery can carry"),
    onError,
  });
  const settlement = useMutation({
    mutationFn: (body: SettlementRules) =>
      api("/v1/admin/settings/settlement-rules", { method: "PUT", json: body }),
    onSuccess: saved_("Driver earnings & fuel"),
    onError,
  });

  if (!s.data) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <h1 className="page-title">Settings</h1>
        <p className="text-sm text-muted">
          Who the company is on a tax invoice, whether it charges VAT, and what a delivery costs to
          run. Every change is audited.
        </p>
      </header>

      {error && <p className="alert-error">{error}</p>}
      {saved && <p className="alert-success">{saved}</p>}
      {!canWrite && (
        <p className="rounded-xl border border-[#DAD6CF] bg-white p-3 text-sm text-muted">
          You can see these, but only a super admin can change them.
        </p>
      )}

      <Readiness readiness={s.data.readiness} />

      <CompanyCard
        initial={s.data.company}
        disabled={!canWrite || company.isPending}
        onSave={(v) => company.mutate(v)}
      />
      <VatCard
        initial={s.data.vat}
        disabled={!canWrite || vat.isPending}
        onSave={(v) => vat.mutate(v)}
      />
      <OperationsCard
        initial={s.data.operations}
        disabled={!canWrite || ops.isPending}
        onSave={(v) => ops.mutate(v)}
      />
      <BookingLimitsCard
        initial={s.data.bookingLimits}
        disabled={!canWrite || bookingLimits.isPending}
        onSave={(v) => bookingLimits.mutate(v)}
      />
      <SettlementCard
        initial={s.data.settlement}
        disabled={!canWrite || settlement.isPending}
        onSave={(v) => settlement.mutate(v)}
      />

      <WaybillTermsCard
        initial={s.data.waybillTerms}
        disabled={!canWrite || terms.isPending}
        onSave={(v) => terms.mutate({ terms: v })}
      />

      {integrations.data && <Integrations rows={integrations.data} />}
    </div>
  );
}

interface Integration {
  key: string;
  name: string;
  purpose: string;
  configured: boolean;
  using: string;
  changeIn: "console" | "environment";
  action: string | null;
}

/**
 * Everything the engine depends on outside itself. Secrets stay in the environment — an API key
 * typed into a web form ends up in a database backup — so this says which is which.
 */
function Integrations({ rows }: { rows: Integration[] }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2 className="section-title">What is switched on</h2>
          <p className="mt-0.5 text-xs text-muted">
            Business details are changed here; credentials live in the environment, because an API
            key typed into a web form ends up in a backup.
          </p>
        </div>
        <span className={rows.every((r) => r.configured) ? "chip chip-good" : "chip chip-warn"}>
          {rows.filter((r) => r.configured).length} of {rows.length} live
        </span>
      </div>
      <ul className="divide-y divide-[#F0EDE9]">
        {rows.map((r) => (
          <li key={r.key} className="px-5 py-4 sm:px-6">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{r.name}</span>
              <span className={r.configured ? "chip chip-good" : "chip chip-warn"}>
                {r.configured ? "live" : "off"}
              </span>
              <span className="chip chip-outline">
                {r.changeIn === "console" ? "set here" : "set in environment"}
              </span>
            </div>
            <p className="mt-1 text-sm text-[#6B6661]">{r.purpose}</p>
            <p className="mt-1 text-xs text-muted">Currently: {r.using}</p>
            {r.action && <p className="mt-1 text-xs text-[#8A5A12]">{r.action}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Readiness({ readiness }: { readiness: SettingsBundle["readiness"] }) {
  const blocking = readiness.missing.filter((m) => m.severity === "blocking");
  return (
    <section
      className={`rounded-xl border p-5 ${blocking.length ? "border-[#F3C6D9] bg-[#FCEEF4]" : "border-line bg-white"}`}
    >
      <div className="flex items-center justify-between gap-4">
        <h2 className="section-title">Document readiness</h2>
        <span
          className={`rounded-full px-3 py-0.5 text-xs ${readiness.issuesTaxInvoices ? "bg-[#E7F5EC] text-[#1B7F4B]" : "bg-[#FDF3E3] text-[#8A5A12]"}`}
        >
          {readiness.issuesTaxInvoices ? "issuing TAX INVOICEs" : "issuing plain INVOICEs"}
        </span>
      </div>
      {readiness.missing.length === 0 ? (
        <p className="mt-2 text-sm text-[#1B7F4B]">Everything is filled in.</p>
      ) : (
        <ul className="mt-3 space-y-2 text-sm">
          {readiness.missing.map((m) => (
            <li key={m.field} className="flex gap-2">
              <span className={m.severity === "blocking" ? "text-[#C13B73]" : "text-[#8A5A12]"}>
                {m.severity === "blocking" ? "●" : "○"}
              </span>
              <span>
                <span className="font-mono text-xs">{m.field}</span> — {m.why}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted">
        {readiness.obligationCount} monthly bill(s) configured in{" "}
        <a href="/admin/treasury" className="underline">
          treasury
        </a>
        .
      </p>
    </section>
  );
}

function CompanyCard({
  initial,
  disabled,
  onSave,
}: {
  initial: CompanyTaxProfile;
  disabled: boolean;
  onSave: (v: CompanyTaxProfile) => void;
}) {
  const [v, setV] = useState(initial);
  useEffect(() => setV(initial), [initial]);
  const set = (patch: Partial<CompanyTaxProfile>) => setV({ ...v, ...patch });

  return (
    <Card
      title="Company identity"
      hint="Printed on every invoice and credit note, and snapshotted onto each document at issue — changing it later never rewrites an old invoice."
      disabled={disabled}
      onSave={() => onSave(v)}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Text label="Legal name" value={v.legalName} onChange={(x) => set({ legalName: x })} />
        <Text
          label="Trading name"
          value={v.tradingName ?? ""}
          onChange={(x) => set({ tradingName: x || null })}
        />
        <Text
          label="Company registration number"
          value={v.registrationNumber ?? ""}
          onChange={(x) => set({ registrationNumber: x || null })}
          placeholder="2019/123456/07"
        />
        <Text
          label="VAT number"
          value={v.vatNumber ?? ""}
          onChange={(x) => set({ vatNumber: x || null })}
          placeholder="4123456789"
          hint="Leave blank if not registered — documents then issue as a plain INVOICE."
        />
        <Text label="Accounts email" value={v.email} onChange={(x) => set({ email: x })} />
        <Text label="Phone" value={v.phone} onChange={(x) => set({ phone: x })} />
      </div>

      <h3 className="mt-6 label-mini">Registered address</h3>
      <AddressFields value={v.address} onChange={(address) => set({ address })} />

      <h3 className="mt-6 label-mini">Banking details</h3>
      <p className="text-xs text-muted">
        Printed on invoices so a postpaid customer knows where to pay.
      </p>
      <div className="mt-2 grid gap-4 sm:grid-cols-2">
        <Text
          label="Bank"
          value={v.bank.bankName}
          onChange={(x) => set({ bank: { ...v.bank, bankName: x } })}
        />
        <Text
          label="Account name"
          value={v.bank.accountName}
          onChange={(x) => set({ bank: { ...v.bank, accountName: x } })}
        />
        <Text
          label="Account number"
          value={v.bank.accountNumber}
          onChange={(x) => set({ bank: { ...v.bank, accountNumber: x } })}
        />
        <Text
          label="Branch code"
          value={v.bank.branchCode}
          onChange={(x) => set({ bank: { ...v.bank, branchCode: x } })}
        />
      </div>
    </Card>
  );
}

function VatCard({
  initial,
  disabled,
  onSave,
}: {
  initial: VatSettings;
  disabled: boolean;
  onSave: (v: VatSettings) => void;
}) {
  const [v, setV] = useState(initial);
  useEffect(() => setV(initial), [initial]);
  return (
    <Card
      title="VAT"
      hint="Switching VAT off stops it being added to quotes and removes the VAT line from documents. It does not touch invoices already issued."
      disabled={disabled}
      onSave={() => onSave(v)}
    >
      <label className="flex items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={v.registered}
          onChange={(e) => setV({ ...v, registered: e.target.checked })}
          className="h-4 w-4"
        />
        The company is registered for VAT
      </label>
      <div className="mt-4 max-w-xs">
        <Num
          label="VAT rate (basis points)"
          value={v.bps}
          onChange={(x) => setV({ ...v, bps: x })}
          hint={`${(v.bps / 100).toFixed(2)}% — South Africa is 1500.`}
        />
      </div>
    </Card>
  );
}

function OperationsCard({
  initial,
  disabled,
  onSave,
}: {
  initial: OperationsSettings;
  disabled: boolean;
  onSave: (v: OperationsSettings) => void;
}) {
  const [v, setV] = useState(initial);
  useEffect(() => setV(initial), [initial]);
  return (
    <Card
      title="Operations"
      hint="The depot is where every route starts and ends, so it is part of the price of every booking."
      disabled={disabled}
      onSave={() => onSave(v)}
    >
      <AddressFields
        value={v.depotAddress}
        onChange={(depotAddress) => setV({ ...v, depotAddress })}
      />
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Text label="Timezone" value={v.timezone} onChange={(x) => setV({ ...v, timezone: x })} />
        <Num
          label="Same-day cut-off (minutes past midnight)"
          value={v.sameDayCutoffMinutes}
          onChange={(x) => setV({ ...v, sameDayCutoffMinutes: x })}
          hint={clock(v.sameDayCutoffMinutes)}
        />
      </div>
    </Card>
  );
}

/**
 * What one driver may be asked to take to one address.
 *
 * A fleet question, not a software one, and it changes when the vehicles do — so it is here
 * rather than in a constant. The booking form reads the same numbers and stops a customer
 * before they have filled in a form the engine was always going to refuse.
 */
function BookingLimitsCard({
  initial,
  disabled,
  onSave,
}: {
  initial: BookingLimits;
  disabled: boolean;
  onSave: (v: BookingLimits) => void;
}) {
  const [v, setV] = useState(initial);
  useEffect(() => setV(initial), [initial]);
  return (
    <Card
      title="What one delivery can carry"
      hint="Applies to each address on a booking, from the moment you save. Bookings already made are untouched."
      disabled={disabled}
      onSave={() => onSave(v)}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Num
          label="Parcels per delivery"
          value={v.maxParcelsPerDrop}
          onChange={(x) => setV({ ...v, maxParcelsPerDrop: x })}
          hint="Counting quantities: six cupcake boxes is six."
        />
        <Num
          label="Different parcels per delivery"
          value={v.maxParcelLinesPerDrop}
          onChange={(x) => setV({ ...v, maxParcelLinesPerDrop: x })}
          hint="Lines on the booking form, whatever the quantities."
        />
        <Num
          label="Kilograms per delivery"
          value={v.maxWeightKgPerDrop ?? 0}
          onChange={(x) => setV({ ...v, maxWeightKgPerDrop: x > 0 ? x : null })}
          hint={
            v.maxWeightKgPerDrop == null
              ? "0 means no weight limit beyond each package type's own."
              : "Unweighed parcels count as what their package type holds."
          }
        />
      </div>
    </Card>
  );
}

function SettlementCard({
  initial,
  disabled,
  onSave,
}: {
  initial: SettlementRules;
  disabled: boolean;
  onSave: (v: SettlementRules) => void;
}) {
  const [v, setV] = useState(initial);
  useEffect(() => setV(initial), [initial]);
  return (
    <Card
      title="Driver earnings & fuel"
      hint="Applied to every delivery from the moment you save, and snapshotted onto each settlement — past settlements never change."
      disabled={disabled}
      onSave={() => onSave(v)}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Num
          label="Driver earning per drop (cents)"
          value={v.driverEarningPerDropCents}
          onChange={(x) => setV({ ...v, driverEarningPerDropCents: x })}
          hint={rands(v.driverEarningPerDropCents)}
        />
        <Num
          label="Driver earning per km (cents)"
          value={v.driverEarningPerKmCents}
          onChange={(x) => setV({ ...v, driverEarningPerKmCents: x })}
          hint={`${rands(v.driverEarningPerKmCents)} per km`}
        />
        <Num
          label="Fuel cost per km (cents)"
          value={v.fuelCostPerKmCents}
          onChange={(x) => setV({ ...v, fuelCostPerKmCents: x })}
          hint={`${rands(v.fuelCostPerKmCents)} per km, loaded to the fuel card`}
        />
      </div>
      <label className="mt-4 flex items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={v.chargeFailedAttempts}
          onChange={(e) => setV({ ...v, chargeFailedAttempts: e.target.checked })}
          className="h-4 w-4"
        />
        Charge the customer (and pay the driver) for a failed delivery attempt
      </label>
      <p className="mt-4 rounded-xl bg-[#FAFAF9] p-3 text-xs text-[#6B6661]">
        A 20 km drop earns the driver{" "}
        <span className="font-mono">
          {rands(v.driverEarningPerDropCents + v.driverEarningPerKmCents * 20)}
        </span>{" "}
        and costs <span className="font-mono">{rands(v.fuelCostPerKmCents * 20)}</span> in fuel.
      </p>
    </Card>
  );
}

// ── building blocks ───────────────────────────────────────────────────────────

function Card({
  title,
  hint,
  disabled,
  onSave,
  children,
}: {
  title: string;
  hint: string;
  disabled: boolean;
  onSave: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="panel p-5">
      <h2 className="section-title">{title}</h2>
      <p className="mt-1 text-sm text-muted">{hint}</p>
      <div className="mt-4">{children}</div>
      <button onClick={onSave} disabled={disabled} className="mt-5 btn btn-primary">
        Save {title.toLowerCase()}
      </button>
    </section>
  );
}

function AddressFields({
  value,
  onChange,
}: {
  value: CompanyTaxProfile["address"];
  onChange: (v: CompanyTaxProfile["address"]) => void;
}) {
  const set = (patch: Partial<CompanyTaxProfile["address"]>) => onChange({ ...value, ...patch });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Text
          label="Address as printed"
          value={value.formatted}
          onChange={(x) => set({ formatted: x })}
        />
      </div>
      <Text label="Street" value={value.line1 ?? ""} onChange={(x) => set({ line1: x || null })} />
      <Text
        label="Suburb"
        value={value.suburb ?? ""}
        onChange={(x) => set({ suburb: x || null })}
      />
      <Text label="City" value={value.city ?? ""} onChange={(x) => set({ city: x || null })} />
      <Text
        label="Postal code"
        value={value.postalCode ?? ""}
        onChange={(x) => set({ postalCode: x || null })}
      />
      <Num
        label="Latitude"
        value={value.location.lat}
        step="any"
        onChange={(x) => set({ location: { ...value.location, lat: x } })}
      />
      <Num
        label="Longitude"
        value={value.location.lng}
        step="any"
        onChange={(x) => set({ location: { ...value.location, lng: x } })}
      />
    </div>
  );
}

function Text({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="label-mini">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full input"
      />
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

function Num({
  label,
  value,
  onChange,
  hint,
  step,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  hint?: string;
  step?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="label-mini">{label}</span>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full input font-mono"
      />
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

function clock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/**
 * The small print at the foot of every waybill.
 *
 * A signed waybill is evidence in a dispute about what was handed over, so the wording is the
 * operator's, not ours. Changing it affects waybills printed from now on; one already printed
 * and signed carries whatever it was printed with, which is the point of it being paper.
 */
function WaybillTermsCard({
  initial,
  disabled,
  onSave,
}: {
  initial: string;
  disabled: boolean;
  onSave: (v: string) => void;
}) {
  const [text, setText] = useState(initial);
  return (
    <Card
      title="Waybill terms"
      hint="Printed at the foot of every waybill, above the signature blocks."
      disabled={disabled}
      onSave={() => onSave(text)}
    >
      <label className="block">
        <span className="field-label">Conditions of carriage</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={7}
          maxLength={4000}
          className="input mt-1 font-sans"
        />
        <span className="field-hint">
          {text.length} of 4000 characters. Keep it short enough to be read on a doorstep.
        </span>
      </label>
    </Card>
  );
}
