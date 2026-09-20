import { z } from "zod";

export const LatLng = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type LatLng = z.infer<typeof LatLng>;

/** A resolved postal address. `formatted` is what we show; `place` is the provider's handle. */
export const Address = z.object({
  formatted: z.string().min(3).max(300),
  line1: z.string().max(200).nullable().default(null),
  suburb: z.string().max(120).nullable().default(null),
  city: z.string().max(120).nullable().default(null),
  postalCode: z.string().max(12).nullable().default(null),
  country: z.string().length(2).default("ZA"),
  location: LatLng,
  placeId: z.string().max(200).nullable().default(null),
});
export type Address = z.infer<typeof Address>;

export const GeocodeRequest = z.object({ query: z.string().min(3).max(200) });
export const GeocodeSuggestion = z.object({
  formatted: z.string(),
  location: LatLng,
  placeId: z.string().nullable(),
  suburb: z.string().nullable(),
  city: z.string().nullable(),
  postalCode: z.string().nullable(),
});
export type GeocodeSuggestion = z.infer<typeof GeocodeSuggestion>;
