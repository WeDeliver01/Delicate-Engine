"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { Address, SavedAddress, UpsertSavedAddressRequest } from "@delicate/contracts";
import { api, ApiRequestError } from "@/lib/api";
import { AddressInput } from "@/components/booking/address-input";

/**
 * Add or change one saved address.
 *
 * The street goes through the same autocomplete the booking form uses, rather than a free-text
 * box, because an address saved without coordinates cannot be priced or routed and the customer
 * only finds that out later, at the point of booking.
 */
export function AddressForm({
  existing,
  onDone,
  onCancel,
}: {
  existing?: SavedAddress;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(existing?.label ?? "");
  const [address, setAddress] = useState<Address | null>(existing?.address ?? null);
  const [name, setName] = useState(existing?.contact.name ?? "");
  const [phone, setPhone] = useState(existing?.contact.phone ?? "");
  const [email, setEmail] = useState(existing?.contact.email ?? "");
  const [instructions, setInstructions] = useState(existing?.instructions ?? "");
  const [isCollectionPoint, setIsCollectionPoint] = useState(existing?.isCollectionPoint ?? false);
  const [isDefault, setIsDefault] = useState(existing?.isDefault ?? false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const save = useMutation({
    mutationFn: (body: UpsertSavedAddressRequest) =>
      api<SavedAddress>(
        existing ? `/v1/account/address-book/${existing.id}` : "/v1/account/address-book",
        { method: existing ? "PUT" : "POST", json: body },
      ),
    onSuccess: onDone,
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : String(e)),
  });

  const ready = label.trim() && address && name.trim().length >= 2 && phone.trim().length >= 6;

  return (
    <form
      className="panel space-y-4 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        setSubmitted(true);
        setError(null);
        if (!ready || !address) return;
        save.mutate({
          label: label.trim(),
          address,
          contact: {
            name: name.trim(),
            phone: phone.trim(),
            email: email.trim() || null,
            altPhone: null,
          },
          instructions: instructions.trim() || null,
          isCollectionPoint,
          isDefault,
        });
      }}
    >
      <h2 className="section-title">{existing ? `Edit ${existing.label}` : "New address"}</h2>
      {error && <p className="alert-error">{error}</p>}

      <label className="block text-sm">
        <span className="label-mini">Label</span>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Menlyn office, Mrs Dlamini"
          className="mt-1 w-full input"
        />
      </label>

      <AddressInput
        label="Street address"
        value={address}
        onChange={setAddress}
        required
        error={submitted && !address ? "Pick an address from the list" : null}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="label-mini">Contact name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full input"
          />
        </label>
        <label className="block text-sm">
          <span className="label-mini">Phone</span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="0821234567"
            className="mt-1 w-full input"
          />
        </label>
      </div>

      <label className="block text-sm">
        <span className="label-mini">Email (optional)</span>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full input"
        />
      </label>

      <label className="block text-sm">
        <span className="label-mini">Driver notes (optional)</span>
        <input
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="Gate code, which reception, where to park"
          className="mt-1 w-full input"
        />
      </label>

      <div className="flex flex-wrap gap-5 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={isCollectionPoint}
            onChange={(e) => setIsCollectionPoint(e.target.checked)}
          />
          We collect from here
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
          />
          Pre-select this when I book
        </label>
      </div>

      <div className="flex gap-3">
        <button type="submit" disabled={!ready || save.isPending} className="btn btn-primary">
          {save.isPending ? "Saving…" : existing ? "Save changes" : "Add address"}
        </button>
        <button type="button" onClick={onCancel} className="btn btn-secondary">
          Cancel
        </button>
      </div>
    </form>
  );
}
