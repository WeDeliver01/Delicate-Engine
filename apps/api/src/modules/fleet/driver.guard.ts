import {
  createParamDecorator,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import type { Request } from "express";
import type { Driver } from "@delicate/contracts";
import { AppError } from "../../common/errors.js";
import { requireUser, type Principal } from "../../auth/principal.js";
import { FleetService } from "./fleet.service.js";

/**
 * Runs after the global AuthGuard. Resolves the driver row for the signed-in user (linking by
 * email on first contact) and attaches it as `req.driver`. Staff may not use driver endpoints
 * unless they are also drivers.
 */
@Injectable()
export class DriverGuard implements CanActivate {
  constructor(private readonly fleet: FleetService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { principal?: Principal; driver?: Driver }>();
    const p = req.principal;
    if (!p) throw AppError.unauthorized();
    const user = requireUser(p);
    const driver = await this.fleet.driverForUser(user.id, user.email);
    if (!driver) throw AppError.forbidden("no active driver profile is linked to this login");
    if (driver.status !== "active") throw AppError.forbidden("driver profile is inactive");
    req.driver = driver;
    return true;
  }
}

export const CurrentDriver = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<Request & { driver?: Driver }>().driver;
});
