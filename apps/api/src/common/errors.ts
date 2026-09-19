import {
  ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import type { Request, Response } from "express";
import type { ApiError } from "@delicate/contracts";
import { ZodError } from "zod";
import { requestContext } from "./request-context.js";

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

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { log?: { error: (o: unknown, m?: string) => void } }>();
    const requestId = requestContext.get()?.requestId ?? (req.headers["x-request-id"] as string);

    const body = toApiError(exception, requestId);
    if (body.statusCode >= 500) {
      req.log?.error({ err: exception, requestId }, "unhandled error");
    }
    res.status(body.statusCode).json(body);
  }
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
