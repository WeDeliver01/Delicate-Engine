"use client";

import { useEffect, useRef, useState } from "react";
import type { Address, GeocodeSuggestion } from "@delicate/contracts";
import { api } from "@/lib/api";

/**
 * Address autocomplete backed by the engine's geocode endpoint (Google when configured, OSM
 * otherwise). Emits a full Address with coordinates; free text alone is never accepted.
 */
export function AddressInput(props: {
  label: string;
  value: Address | null;
  onChange: (a: Address | null) => void;
  placeholder?: string;
  id?: string;
  required?: boolean;
  /** Set once the form has been submitted and this one is still empty. */
  error?: string | null;
}) {
  const [text, setText] = useState(props.value?.formatted ?? "");
  const [suggestions, setSuggestions] = useState<GeocodeSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (props.value && props.value.formatted !== text) setText(props.value.formatted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.value]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (text.trim().length < 4 || props.value?.formatted === text) {
      setSuggestions([]);
      return;
    }
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api<GeocodeSuggestion[]>(
          `/v1/public/geocode?query=${encodeURIComponent(text.trim())}`,
          { account: null },
        );
        setSuggestions(res);
        setOpen(true);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 450);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  function pick(s: GeocodeSuggestion) {
    props.onChange({
      formatted: s.formatted,
      line1: null,
      suburb: s.suburb,
      city: s.city,
      postalCode: s.postalCode,
      country: "ZA",
      location: s.location,
      placeId: s.placeId,
    });
    setText(s.formatted);
    setOpen(false);
  }

  return (
    <label className="relative block text-sm">
      <span className="font-medium text-ink">
        {props.label}
        {props.required && (
          <span className="ml-0.5 text-[#C13B73]" aria-hidden="true" title="Required">
            *
          </span>
        )}
      </span>
      <input
        id={props.id}
        aria-invalid={props.error ? true : undefined}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (props.value) props.onChange(null);
        }}
        onFocus={() => suggestions.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={props.placeholder ?? "Start typing an address…"}
        className={`mt-1 w-full rounded-xl border p-3 outline-none ${
          props.error
            ? "border-[#C13B73] focus:border-[#C13B73]"
            : `focus:border-[#0A0A0A] ${props.value ? "border-[#0A0A0A]" : "border-[#DAD6CF]"}`
        }`}
        autoComplete="off"
      />
      {loading && <span className="absolute right-3 top-9 text-xs text-muted">…</span>}
      {open && suggestions.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-line bg-white shadow-lg">
          {suggestions.map((s, i) => (
            <li key={`${s.placeId ?? i}`}>
              <button
                type="button"
                onMouseDown={() => pick(s)}
                className="block w-full px-3 py-2 text-left hover:bg-[#FAFAF9]"
              >
                {s.formatted}
              </button>
            </li>
          ))}
        </ul>
      )}
      {props.error ? (
        <span className="mt-1 block text-xs text-[#C13B73]">{props.error}</span>
      ) : (
        !props.value &&
        text.length >= 4 &&
        !loading &&
        suggestions.length === 0 && (
          <span className="mt-1 block text-xs text-muted">
            Pick an address from the list so we can measure the route.
          </span>
        )
      )}
    </label>
  );
}
