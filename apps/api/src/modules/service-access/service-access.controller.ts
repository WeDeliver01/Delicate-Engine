import { Controller, Delete, Get, Patch, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  CreateServiceClientRequest,
  CreateWebhookSubscriptionRequest,
  LinkAccountExternalRefRequest,
  UpdateServiceClientRequest,
  Uuid,
} from "@delicate/contracts";
import { PlatformRoles } from "../../auth/decorators.js";
import { Body, Params, Query } from "../../common/zod.js";
import { ServiceAccessService } from "./service-access.service.js";

const IdParam = z.object({ id: Uuid });
const RefQuery = z.object({ accountId: Uuid.optional() });

/**
 * Who may let another system in: super_admin only.
 *
 * Issuing a credential grants standing authority to book against a customer's wallet, which
 * is a bigger decision than any single booking, so it does not sit with finance or dispatch.
 */
@ApiTags("admin")
@ApiBearerAuth()
@Controller("v1/admin/service-clients")
@PlatformRoles("super_admin")
export class AdminServiceClientsController {
  constructor(private readonly svc: ServiceAccessService) {}

  @Get()
  list() {
    return this.svc.list();
  }

  @Get(":id")
  get(@Params(IdParam) p: { id: string }) {
    return this.svc.get(p.id);
  }

  /** The response carries the secret. It is not recoverable afterwards. */
  @Post()
  create(@Body(CreateServiceClientRequest) body: CreateServiceClientRequest) {
    return this.svc.create(body);
  }

  @Patch(":id")
  update(
    @Params(IdParam) p: { id: string },
    @Body(UpdateServiceClientRequest) body: UpdateServiceClientRequest,
  ) {
    return this.svc.update(p.id, body);
  }

  @Post(":id/rotate")
  rotate(@Params(IdParam) p: { id: string }) {
    return this.svc.rotate(p.id);
  }

  @Post(":id/revoke")
  revoke(@Params(IdParam) p: { id: string }) {
    return this.svc.revoke(p.id);
  }
}

@ApiTags("admin")
@ApiBearerAuth()
@Controller("v1/admin/account-external-refs")
@PlatformRoles("super_admin", "finance")
export class AdminAccountExternalRefsController {
  constructor(private readonly svc: ServiceAccessService) {}

  @Get()
  list(@Query(RefQuery) q: { accountId?: string }) {
    return this.svc.listExternalRefs(q.accountId);
  }

  @Post()
  link(@Body(LinkAccountExternalRefRequest) body: LinkAccountExternalRefRequest) {
    return this.svc.linkExternalRef(body);
  }

  @Delete(":id")
  async unlink(@Params(IdParam) p: { id: string }) {
    await this.svc.unlinkExternalRef(p.id);
    return { ok: true };
  }
}

/**
 * Where the engine tells another system that something happened.
 *
 * super_admin only, like issuing a credential: a subscription sends customer names and
 * addresses to a URL, and choosing that URL is the same weight of decision as choosing who may
 * book against a wallet.
 */
@ApiTags("admin")
@ApiBearerAuth()
@Controller("v1/admin/webhook-subscriptions")
@PlatformRoles("super_admin")
export class AdminWebhookSubscriptionsController {
  constructor(private readonly svc: ServiceAccessService) {}

  @Get()
  list(@Query(z.object({ serviceClientId: Uuid.optional() })) q: { serviceClientId?: string }) {
    return this.svc.listSubscriptions(q.serviceClientId);
  }

  /** The response carries the signing secret. It is not readable afterwards. */
  @Post()
  create(@Body(CreateWebhookSubscriptionRequest) body: CreateWebhookSubscriptionRequest) {
    return this.svc.createSubscription(body);
  }

  @Post(":id/enable")
  enable(@Params(IdParam) p: { id: string }) {
    return this.svc.enableSubscription(p.id);
  }

  @Delete(":id")
  async remove(@Params(IdParam) p: { id: string }) {
    await this.svc.deleteSubscription(p.id);
    return { ok: true };
  }
}
