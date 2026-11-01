import {
  ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
  Optional,
} from "@nestjs/common";
import type { Request, Response } from "express";
import type { ApiError } from "@delicate/contracts";
import { ZodError } from "zod";
import { requestContext } from "./request-context.js";
import { SystemEventsService } from "../modules/system-events/system-events.service.js";

/**
 * Domain errors carry a stable machine-readable `code` that clients branch on, plus an HTTP
 * status. Services throw these; the filter below turns them into the shared `ApiError` shape.
 */
export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number = HttpStatus.BAD_REQUEST,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }

  static notFound(what: string, details?: unknown) {
    return new AppError("not_found", `${what} not found`, HttpStatus.NOT_FOUND, details);
  }
  static forbidden(message = "forbidden", details?: unknown) {
    return new AppError("forbidden", message, HttpStatus.FORBIDDEN, details);
  }
  static unauthorized(message = "unauthorized") {
    return new AppError("unauthorized", message, HttpStatus.UNAUTHORIZED);
  }
  static conflict(code: string, message: string, details?: unknown) {
    return new AppError(code, message, HttpStatus.CONFLICT, details);
  }
  static validation(details: unknown) {
    return new AppError("validation_failed", "request failed validation", 422, details);
  }
}

/**
 * 4xx codes worth seeing in bulk.
 *
 * Most 4xx is a client getting it wrong and is nobody's problem. These are different: each one
 * means a caller believes something about our API that is not true, and a sudden run of them is
 * a release that broke somebody or an integration pointed at the wrong field. One row an hour
 * per code is enough to see the shape of it.
 */
const NOTABLE_4XX = new Set(["validation_failed", "unauthorized", "forbidden", "not_found"]);

@Catch()
@Injectable()
export class GlobalExceptionFilter implements ExceptionFilter {
  /**
   * Optional on purpose, though today the only registration is through DI and always supplies
   * it. An error filter that cannot be constructed turns every failure in the system into a
   * different and worse failure, so it does not get a required dependency to make a feed work.
   */
  constructor(@Optional() private readonly events?: SystemEventsService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { log?: { error: (o: unknown, m?: string) => void } }>();
    const requestId = requestContext.get()?.requestId ?? (req.headers["x-request-id"] as string);

    const body = toApiError(exception, requestId);
    if (body.statusCode >= 500) {
      req.log?.error({ err: exception, requestId }, "unhandled error");
    }
    this.surface(exception, body, req);
    res.status(body.statusCode).json(body);
  }

  /**
   * Put the failure on the operational feed.
   *
   * 5xx goes on individually -- each one is a bug and the context is the whole point. The
   * notable 4xx are folded by code and route, because the useful signal there is "forty of
   * these since the deploy", not forty rows.
   */
  private surface(exception: unknown, body: ApiError, req: Request): void {
    if (!this.events) return;
    const route = `${req.method} ${req.route?.path ?? req.path}`;

    if (body.statusCode >= 500) {
      this.events.record({
        level: "error",
        category: "http.5xx",
        message: `${body.statusCode} on ${route}: ${errorMessage(exception)}`,
        context: {
          route,
          statusCode: body.statusCode,
          code: body.code,
          stack: exception instanceof Error ? stackLines(exception) : undefined,
        },
      });
      return;
    }
    if (NOTABLE_4XX.has(body.code)) {
      this.events.record({
        level: "warning",
        category: `http.${body.code}`,
        message: `${body.statusCode} on ${route}`,
        context: { route, statusCode: body.statusCode, code: body.code, details: body.details },
        dedupeKey: `http:${body.code}:${route}`,
      });
    }
  }
}

/** Enough stack to place the fault, not enough to fill the row. */
function stackLines(err: Error): string[] {
  return (err.stack ?? "").split("\n").slice(0, 12);
}

/** The message a human wants on the list, without the stack. */
function errorMessage(exception: unknown): string {
  if (exception instanceof Error) return exception.message;
  return String(exception);
}

export function toApiError(exception: unknown, requestId?: string): ApiError {
  if (exception instanceof AppError) {
    return {
      statusCode: exception.statusCode,
      code: exception.code,
      message: exception.message,
      details: exception.details,
      requestId,
    };
  }
  if (exception instanceof ZodError) {
    return {
      statusCode: 422,
      code: "validation_failed",
      message: "request failed validation",
      details: exception.issues,
      requestId,
    };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const resp = exception.getResponse();
    const message =
      typeof resp === "string"
        ? resp
        : ((resp as { message?: string }).message ?? exception.message);
    return {
      statusCode: status,
      code: HttpStatus[status]?.toLowerCase() ?? "http_error",
      message: Array.isArray(message) ? message.join("; ") : message,
      requestId,
    };
  }
  // Never leak internals in production; outside it, the message is the fastest debugging aid.
  const debug =
    process.env["NODE_ENV"] !== "production" && exception instanceof Error
      ? { name: exception.name, message: exception.message }
      : undefined;
  return {
    statusCode: 500,
    code: "internal_error",
    message: "internal server error",
    details: debug,
    requestId,
  };
}
