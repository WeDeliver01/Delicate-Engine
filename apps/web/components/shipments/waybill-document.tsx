"use client";

import type { WaybillDocument as Waybill } from "@delicate/contracts";
import { rands } from "@/lib/money";

/**
 * The printable waybill: the paper that travels with the parcel and gets signed on the doorstep.
 *
 * `print:` classes strip the page chrome so Ctrl-P produces a clean A4 sheet, the same approach
 * the invoice takes. Two signature blocks, not one, because a waybill is evidence in both
 * directions: we sign for what we collected, they sign for what they received.
 */
export function WaybillDocument({ doc }: { doc: Waybill }) {
  const address = (a: { formatted: string }) => a.formatted;

  return (
    <article className="mx-auto max-w-[210mm] rounded-xl border border-line bg-white p-8 text-[13px] print:max-w-none print:rounded-none print:border-0 print:p-0">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-start justify-between gap-6 border-b-2 border-ink pb-4">
        <div>
          <div className="font-display text-xl font-extrabold tracking-tight">
            {doc.carrier.legalName}
          </div>
          {doc.carrier.tradingName && doc.carrier.tradingName !== doc.carrier.legalName && (
            <div className="text-muted">t/a {doc.carrier.tradingName}</div>
          )}
          <div className="mt-1 whitespace-pre-line text-[#6B6661]">
            {address(doc.carrier.address)}
          </div>
          <div className="mt-0.5 text-[#6B6661]">
            {doc.carrier.email} · {doc.carrier.phone}
          </div>
          <div className="text-muted">
            {doc.carrier.registrationNumber && <>Reg no. {doc.carrier.registrationNumber} </>}
            {doc.carrier.vatNumber && <>· VAT no. {doc.carrier.vatNumber}</>}
          </div>
        </div>

        <div className="text-right">
          <div className="font-display text-lg font-bold tracking-wide">WAYBILL</div>
          <div className="figure mt-1 text-2xl font-extrabold">{doc.waybill}</div>
          <div className="mt-1 text-muted">Booking {doc.bookingReference}</div>
          {doc.customerReference && (
            <div className="text-muted">Your ref: {doc.customerReference}</div>
          )}
          <div className="mt-1 text-muted">
            Printed {new Date(doc.issuedAt).toLocaleString("en-ZA")}
          </div>
        </div>
      </header>

      {/* ── Parties ─────────────────────────────────────────────────────── */}
      <section className="mt-5 grid gap-5 sm:grid-cols-2">
        <Party
          title="Collect from"
          name={doc.sender.accountName}
          address={address(doc.sender.address)}
          contact={doc.sender.contact}
          instructions={doc.sender.instructions}
        />
        <Party
          title="Deliver to"
          name={doc.recipient.contact.name}
          address={address(doc.recipient.address)}
          contact={doc.recipient.contact}
          instructions={doc.recipient.instructions}
          emphasis
        />
      </section>

      {/* ── Service ─────────────────────────────────────────────────────── */}
      <section className="mt-5 grid grid-cols-2 gap-3 rounded-xl border border-line p-3 sm:grid-cols-4 print:rounded-none">
        <Cell label="Service" value={doc.service.name} />
        <Cell label="Scheduled" value={doc.service.slotDate ?? "On demand"} />
        <Cell label="Window" value={doc.service.slotWindow ?? "—"} />
        <Cell
          label="Declared value"
          value={doc.declaredValueCents != null ? rands(doc.declaredValueCents) : "Not declared"}
        />
      </section>

      {/* ── Parcels ─────────────────────────────────────────────────────── */}
      <section className="mt-5">
        <h2 className="label-mini">Consignment · {doc.parcelCount} parcels</h2>
        <table className="mt-2 w-full border-collapse text-left">
          <thead>
            <tr className="border-y border-line text-[11px] uppercase tracking-wide text-muted">
              <th className="py-1.5 pr-2 font-medium">#</th>
              <th className="py-1.5 pr-2 font-medium">Description</th>
              <th className="py-1.5 pr-2 text-right font-medium">Qty</th>
              <th className="py-1.5 text-right font-medium">Weight</th>
            </tr>
          </thead>
          <tbody>
            {doc.parcels.map((p, i) => (
              <tr key={i} className="border-b border-[#F0EDE9]">
                <td className="py-1.5 pr-2 text-muted">{i + 1}</td>
                <td className="py-1.5 pr-2">{p.description ?? "Parcel"}</td>
                <td className="figure py-1.5 pr-2 text-right">{p.quantity}</td>
                <td className="figure py-1.5 text-right">
                  {p.weightKg != null ? `${p.weightKg} kg` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ── Proof of delivery, captured electronically ──────────────────── */}
      {doc.proofOfDelivery && (
        <section className="mt-5 rounded-xl border border-[#BEE3CD] bg-[#E7F5EC] p-3 print:rounded-none">
          <p className="label-mini">Delivered</p>
          <p className="mt-0.5">
            Received by <strong>{doc.proofOfDelivery.receivedBy}</strong> on{" "}
            {new Date(doc.proofOfDelivery.capturedAt).toLocaleString("en-ZA")}
            {doc.proofOfDelivery.note && <> · {doc.proofOfDelivery.note}</>}
          </p>
        </section>
      )}

      {/* ── Signatures ──────────────────────────────────────────────────── */}
      <section className="mt-6 grid gap-6 sm:grid-cols-2">
        <SignatureBlock title="Collected by (driver)" />
        <SignatureBlock title="Received by (recipient)" />
      </section>

      {/* ── Terms ───────────────────────────────────────────────────────── */}
      <footer className="mt-6 border-t border-line pt-3 text-[10px] leading-relaxed text-muted">
        {doc.terms}
      </footer>
    </article>
  );
}

function Party({
  title,
  name,
  address,
  contact,
  instructions,
  emphasis,
}: {
  title: string;
  name: string;
  address: string;
  contact: { name: string; phone: string; email: string | null } | null;
  instructions: string | null;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-3 print:rounded-none ${
        emphasis ? "border-ink" : "border-line"
      }`}
    >
      <p className="label-mini">{title}</p>
      <p className="mt-1 font-semibold">{name}</p>
      <p className="mt-0.5 whitespace-pre-line text-[#6B6661]">{address}</p>
      {contact && (
        <p className="mt-1 text-[#6B6661]">
          {contact.name !== name && <>{contact.name} · </>}
          {contact.phone}
          {contact.email && <> · {contact.email}</>}
        </p>
      )}
      {instructions && (
        <p className="mt-1.5 border-t border-dashed border-line pt-1.5 text-[#6B6661]">
          <span className="label-mini">Instructions</span>
          <br />
          {instructions}
        </p>
      )}
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="label-mini">{label}</p>
      <p className="mt-0.5 font-medium">{value}</p>
    </div>
  );
}

/**
 * Left blank to be signed by hand. Printed even when a POD was captured in the app, because
 * the paper copy is what a recipient keeps and what gets photographed in a dispute.
 */
function SignatureBlock({ title }: { title: string }) {
  return (
    <div>
      <p className="label-mini">{title}</p>
      <div className="mt-6 border-b border-ink" />
      <div className="mt-1 flex justify-between text-[10px] text-muted">
        <span>Name and signature</span>
        <span>Date / time</span>
      </div>
      <div className="mt-5 border-b border-dashed border-[#DAD6CF]" />
      <p className="mt-1 text-[10px] text-muted">Notes / exceptions</p>
    </div>
  );
}
