import { z } from "zod";

export const Uuid = z.string().uuid();

export const Pagination = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});
export type Pagination = z.infer<typeof Pagination>;

export const Page = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

/** Standard error body returned by the API for every 4xx/5xx. */
export const ApiError = z.object({
  statusCode: z.number().int(),
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
  requestId: z.string().optional(),
});
export type ApiError = z.infer<typeof ApiError>;

export const HealthResponse = z.object({
  status: z.enum(["ok", "degraded"]),
  version: z.string(),
  uptimeSeconds: z.number(),
  checks: z.record(z.object({ status: z.enum(["ok", "fail"]), latencyMs: z.number().optional() })),
});
export type HealthResponse = z.infer<typeof HealthResponse>;
