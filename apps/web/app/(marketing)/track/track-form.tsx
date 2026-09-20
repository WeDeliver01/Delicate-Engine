"use client";

import { useState } from "react";

export default function TrackForm() {
  const [waybill, setWaybill] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setMessage(
          `Live tracking for ${waybill.trim().toUpperCase()} opens with the new portal. Until then, message us on WhatsApp and we will check it for you.`,
        );
      }}
      className="mt-8 flex flex-col sm:flex-row gap-3 max-w-lg mx-auto"
    >
      <input
        value={waybill}
        onChange={(e) => setWaybill(e.target.value)}
        placeholder="e.g. DC-260919-00042"
        required
        className="flex-1 rounded-2xl border border-[#DAD6CF] px-5 py-3 font-mono text-[14px] focus:outline-none focus:border-[#0A0A0A]"
      />
      <button className="bg-[#0A0A0A] text-white px-8 py-3 rounded-2xl text-[14px] font-medium hover:bg-[#E84A8A] transition-colors active:scale-95">
        Track
      </button>
      {message && <p className="sm:basis-full text-sm text-[#6B6661] mt-2">{message}</p>}
    </form>
  );
}
