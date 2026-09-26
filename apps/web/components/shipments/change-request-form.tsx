"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  CHANGE_REQUEST_KIND_LABELS,
  type Address,
  type ChangeRequestKind,
  type Shipment,
  type SlotAvailability,
} from "@delicate/contracts";
import { useQuery } from "@tanstack/react-query";
import { api, ApiRequestError } from "@/lib/api";
import { AddressInput } from "@/components/booking/address-input";

/**
 * Asking for one thing about a shipment to change.
 *
 * The form says up front whether the change will take effect immediately or go to our team,
 * because the difference matters to someone deciding whether to also phone us. That text comes
 * from the same rule the engine applies, so the two cannot drift apart into a promise the
 * engine does not keep.
 */
export function ChangeRequestForm({
  shipment,
  kind,
  onDone,
  onCancel,
}: {
  shipment: Shipment;
  kind: ChangeRequestKind;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(shipment.recipient.name);
  const [phone, setPhone] = useState(shipment.recipient.phone);
  const [email, setEmail] = useState(shipment.recipient.email ?? "");
  const [address, setAddress] = useState<Address | null>(null);
  const [instructions, setInstructions] = useState(shipment.instructions ?? "");
  const [slot, setSlot] = useState<{ date: string; windowKey: string } | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const slots = useQuery({
    queryKey: ["slots"],
    queryFn: () => api<SlotAvailability[]>("/v1/public/slots/availability", { account: null }),
    enabled: kind === "reschedule",
  });

  const needsApproval = kind === "delivery_address" || kind === "reschedule";

  const submit = useMutation({
    mutationFn: () => {
      const payload =
        kind === "recipient_contact"
          ? { kind, recipient: { name, phone, email: email || null } }
          : kind === "delivery_address"
            ? { kind, deliveryAddress: address }
            : kind === "instructions"
              ? { kind, instructions: instructions || null }
              : { kind, slotDate: slot?.date, slotWindowKey: slot?.windowKey };
      return api(`/v1/account/shipments/${shipment.id}/changes`, {
        method: "POST",
        json: { payload, reason: reason.trim() || undefined },
      });
    },
    onSuccess: onDone,
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : String(e)),
  });

  const ready =
    kind === "recipient_contact"
      ? name.trim().length >= 2 && phone.trim().length >= 6
      : kind === "delivery_address"
        ? !!address
        : kind === "reschedule"
          ? !!slot
          : true;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="eyebrow">{CHANGE_REQUEST_KIND_LABELS[kind]}</p>
        <button type="button" onClick={onCancel} className="link-quiet text-xs">
          Cancel
        </button>
      </div>

      {kind === "recipient_contact" && (
        <>
          <Field label="Recipient name" value={name} onChange={setName} />
          <Field label="Phone" value={phone} onChange={setPhone} />
          <Field label="Email" optional value={email} onChange={setEmail} type="email" />
        </>
      )}

      {kind === "delivery_address" && (
        <>
          <p className="text-xs text-muted">Currently {shipment.deliveryAddress.formatted}</p>
          <AddressInput label="New delivery address" value={address} onChange={setAddress} />
        </>
      )}

      {kind === "instructions" && (
        <label className="block">
          <span className="field-label">Delivery instructions</span>
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="Gate code, leave with reception…"
            className="input mt-1"
          />
        </label>
      )}

      {kind === "reschedule" && (
        <div className="space-y-2">
          <p className="text-xs text-muted">
            Currently {shipment.slotDate ?? "unscheduled"}
            {shipment.slotWindowKey && ` · ${shipment.slotWindowKey}`}
          </p>
          {slots.data
            ?.filter((s) => s.bookable)
            .slice(0, 12)
            .map((s) => {
              const on = slot?.date === s.date && slot?.windowKey === s.windowKey;
              return (
                <button
                  key={`${s.date}-${s.windowKey}`}
                  type="button"
                  onClick={() => setSlot({ date: s.date, windowKey: s.windowKey })}
                  className={`flex w-full items-center justify-between rounded-xl border p-2.5 text-left text-sm transition-colors ${
                    on ? "border-ink bg-[#FAFAF9]" : "border-line hover:border-[#DAD6CF]"
                  }`}
                >
                  <span>
                    {s.date} · {s.label}
                  </span>
                  <span className="text-xs text-muted">{s.remaining} left</span>
                </button>
              );
            })}
          {!slots.isLoading && !slots.data?.some((s) => s.bookable) && (
            <p className="text-sm text-muted">No open slots at the moment.</p>
          )}
        </div>
      )}

      <label className="block">
        <span className="field-label">
          Why<span className="ml-1 normal-case text-[#B5AFA7]">optional</span>
        </span>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={300}
          placeholder="They have moved office"
          className="input mt-1"
        />
      </label>

      <p className={needsApproval ? "alert-info" : "alert-success"}>
        {needsApproval
          ? "Our team checks this one before it takes effect — an address or a new date can change the price or the route. We will let you know."
          : "This takes effect straight away and reaches the driver."}
      </p>

      {error && <p className="alert-error">{error}</p>}

      <button
        type="button"
        disabled={!ready || submit.isPending}
        onClick={() => {
          setError(null);
          submit.mutate();
        }}
        className="btn btn-primary btn-sm w-full"
      >
        {submit.isPending ? "Sending…" : needsApproval ? "Request this change" : "Save change"}
      </button>
    </div>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  optional?: boolean;
}) {
  return (
    <label className="block">
      <span className="field-label">
        {props.label}
        {props.optional && <span className="ml-1 normal-case text-[#B5AFA7]">optional</span>}
      </span>
      <input
        type={props.type ?? "text"}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="input mt-1"
      />
    </label>
  );
}
