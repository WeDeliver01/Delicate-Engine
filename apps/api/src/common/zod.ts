import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import type { z } from "zod";

/**
 * Zod-validated request parts. Throws ZodError, which the global filter maps to a 422
 * `validation_failed` ApiError with the issue list.
 *
 *   create(@Body(CreateAccountRequest) body: CreateAccountRequest)
 *
 * The schema is wrapped in an object on purpose: Nest treats any decorator argument that has a
 * `transform` method as a pipe, and every Zod schema has one.
 */
type Wrapped = { schema: z.ZodTypeAny };

const BodyParam = createParamDecorator(({ schema }: Wrapped, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return schema.parse(req.body ?? {});
});

const QueryParam = createParamDecorator(({ schema }: Wrapped, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return schema.parse(req.query ?? {});
});

const ParamsParam = createParamDecorator(({ schema }: Wrapped, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return schema.parse(req.params ?? {});
});

export const Body = (schema: z.ZodTypeAny) => BodyParam({ schema });
export const Query = (schema: z.ZodTypeAny) => QueryParam({ schema });
export const Params = (schema: z.ZodTypeAny) => ParamsParam({ schema });
