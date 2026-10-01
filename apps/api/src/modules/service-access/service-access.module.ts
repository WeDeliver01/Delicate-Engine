import { Module } from "@nestjs/common";
import { ServiceAccessService } from "./service-access.service.js";
import {
  AdminAccountExternalRefsController,
  AdminServiceClientsController,
} from "./service-access.controller.js";

/**
 * How another system gets in, and which accounts it may act for. Issuing is a super_admin
 * action; the verifier that checks a credential on each request lives in `auth/`, because the
 * guard needs it before any module has run.
 */
@Module({
  controllers: [AdminServiceClientsController, AdminAccountExternalRefsController],
  providers: [ServiceAccessService],
  exports: [ServiceAccessService],
})
export class ServiceAccessModule {}
