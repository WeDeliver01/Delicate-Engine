import { Controller, Get, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  AssignRequest,
  IsoDate,
  JournalKind,
  Pagination,
  ScheduleShiftRequest,
  UpdateShipmentStatusRequest,
  UpsertDriverRequest,
  UpsertVehicleRequest,
  Uuid,
} from "@delicate/contracts";
import { PlatformRoles } from "../../auth/decorators.js";
import { Body, Params, Query } from "../../common/zod.js";
import { DbService } from "../../infra/db.module.js";
import { FleetService } from "./fleet.service.js";
import { AssignmentService } from "../dispatch/assignment.service.js";
import { DispatchService } from "../dispatch/dispatch.service.js";
import { SettlementService } from "../dispatch/settlement.service.js";
import { LedgerService } from "../ledger/ledger.service.js";

const IdParam = z.object({ id: Uuid });

@ApiTags("admin")
@ApiBearerAuth()
@Controller("v1/admin/fleet")
@PlatformRoles("super_admin", "dispatcher")
export class AdminFleetController {
  constructor(private readonly fleet: FleetService) {}

  @Get("drivers")
  drivers() {
    return this.fleet.listDrivers();
  }
  @Post("drivers")
  createDriver(@Body(UpsertDriverRequest) body: UpsertDriverRequest) {
    return this.fleet.upsertDriver(null, body);
  }
  @Put("drivers/:id")
  updateDriver(
    @Params(IdParam) p: { id: string },
    @Body(UpsertDriverRequest) body: UpsertDriverRequest,
  ) {
    return this.fleet.upsertDriver(p.id, body);
  }

  @Get("vehicles")
  vehicles() {
    return this.fleet.listVehicles();
  }
  @Post("vehicles")
  createVehicle(@Body(UpsertVehicleRequest) body: UpsertVehicleRequest) {
    return this.fleet.upsertVehicle(null, body);
  }
  @Put("vehicles/:id")
  updateVehicle(
    @Params(IdParam) p: { id: string },
    @Body(UpsertVehicleRequest) body: UpsertVehicleRequest,
  ) {
    return this.fleet.upsertVehicle(p.id, body);
  }

  @Get("shifts")
  shifts(
    @Query(z.object({ dateFrom: IsoDate, dateTo: IsoDate }))
    q: {
      dateFrom: string;
      dateTo: string;
    },
  ) {
    return this.fleet.listShifts(q.dateFrom, q.dateTo);
  }
  @Post("shifts")
  schedule(@Body(ScheduleShiftRequest) body: z.infer<typeof ScheduleShiftRequest>) {
    return this.fleet.scheduleShift(body.driverId, body.date, body.vehicleId ?? null);
  }

  @Get("positions")
  positions() {
    return this.fleet.positions();
  }

  @Get("fuel-logs")
  fuelLogs(@Query(z.object({ driverId: Uuid.optional() })) q: { driverId?: string }) {
    return this.fleet.fuelLogs(q.driverId ?? null, 200);
  }
}

@ApiTags("admin")
@ApiBearerAuth()
@Controller("v1/admin/dispatch")
@PlatformRoles("super_admin", "dispatcher")
export class AdminDispatchController {
  constructor(
    private readonly dbs: DbService,
    private readonly assignment: AssignmentService,
    private readonly dispatch: DispatchService,
    private readonly settlement: SettlementService,
  ) {}

  @Get("unassigned")
  unassigned() {
    return this.assignment.unassigned();
  }

  @Get("shipments/:id/candidates")
  candidates(@Params(IdParam) p: { id: string }) {
    return this.assignment.candidates(p.id);
  }

  @Post("shipments/:id/assign")
  assign(
    @Params(IdParam) p: { id: string },
    @Body(AssignRequest) body: z.infer<typeof AssignRequest>,
  ) {
    return this.dbs.transaction((tx) =>
      this.assignment.assign(tx, p.id, body.driverId, "dispatcher", body.note ?? null),
    );
  }

  @Post("shipments/:id/auto-assign")
  autoAssign(@Params(IdParam) p: { id: string }) {
    return this.assignment.autoAssign(p.id);
  }

  @Post("shipments/:id/unassign")
  async unassign(
    @Params(IdParam) p: { id: string },
    @Body(z.object({ reason: z.string().min(3).max(200) })) body: { reason: string },
  ) {
    await this.dbs.transaction((tx) => this.assignment.unassign(tx, p.id, body.reason));
    return { ok: true };
  }

  /** Replaces the Phase 1 status endpoint: delivered/failed now settle. */
  @Post("shipments/:id/status")
  status(
    @Params(IdParam) p: { id: string },
    @Body(UpdateShipmentStatusRequest) body: UpdateShipmentStatusRequest,
  ) {
    return this.dispatch.adminStatus(p.id, body.status, body.note ?? null);
  }

  @Get("shipments/:id/settlement")
  async settlementFor(@Params(IdParam) p: { id: string }) {
    const [settlement, pod, assignment] = await Promise.all([
      this.settlement.forShipment(p.id),
      this.dispatch.pod(p.id),
      this.assignment.activeAssignment(p.id),
    ]);
    return {
      settlement,
      pod,
      assignment: assignment
        ? {
            driverId: assignment.driverId,
            plannedKm: Number(assignment.plannedKm),
            source: assignment.source,
          }
        : null,
      files: await this.dispatch.podFiles(p.id),
    };
  }

  @Get("bookings/:id/settlements")
  bookingSettlements(@Params(IdParam) p: { id: string }) {
    return this.settlement.forBooking(p.id);
  }
}

@ApiTags("admin")
@ApiBearerAuth()
@Controller("v1/admin/ledger")
@PlatformRoles("super_admin", "finance")
export class AdminLedgerController {
  constructor(private readonly ledger: LedgerService) {}

  @Get("trial-balance")
  trialBalance() {
    return this.ledger.trialBalance();
  }

  @Get("journals")
  journals(
    @Query(Pagination.extend({ kind: JournalKind.optional(), refId: z.string().optional() }))
    q: Pagination & { kind?: z.infer<typeof JournalKind>; refId?: string },
  ) {
    return this.ledger.listJournals(q);
  }
}
