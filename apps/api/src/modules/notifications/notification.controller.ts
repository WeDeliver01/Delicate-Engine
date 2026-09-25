import { Controller, Get, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  NotificationChannel,
  NotificationStatus,
  UpdateNotificationPreferencesRequest,
  UpdateTemplateRequest,
  Uuid,
} from "@delicate/contracts";
import {
  AccountRoles,
  ActiveAccountId,
  PlatformRoles,
  RequireAccount,
} from "../../auth/decorators.js";
import { Body, Params, Query } from "../../common/zod.js";
import { NotificationService } from "./notification.service.js";

const IdParam = z.object({ id: Uuid });
const ListQuery = z.object({
  status: NotificationStatus.optional(),
  channel: NotificationChannel.optional(),
  accountId: Uuid.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

/** A customer decides how we may contact them and their recipients. */
@ApiTags("account")
@ApiBearerAuth()
@Controller("v1/account/notifications")
@RequireAccount()
@AccountRoles("customer_owner", "customer_staff")
export class AccountNotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Get("preferences")
  preferences(@ActiveAccountId() accountId: string) {
    return this.notifications.preferences(accountId);
  }

  @Put("preferences")
  setPreferences(
    @ActiveAccountId() accountId: string,
    @Body(UpdateNotificationPreferencesRequest) body: UpdateNotificationPreferencesRequest,
  ) {
    return this.notifications.setPreferences(accountId, body);
  }

  /** Their own message history, so "I never got the SMS" has an answer. */
  @Get()
  mine(@ActiveAccountId() accountId: string, @Query(ListQuery) q: { limit?: number }) {
    return this.notifications.list({ accountId, limit: q.limit });
  }
}

/** Staff see the whole pipeline: what is wired up, what went out, and what did not. */
@ApiTags("admin")
@ApiBearerAuth()
@Controller("v1/admin/notifications")
@PlatformRoles("super_admin", "finance", "dispatcher")
export class AdminNotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Get("channels")
  channels() {
    return this.notifications.channels();
  }

  @Get()
  list(
    @Query(ListQuery)
    q: {
      status?: NotificationStatus;
      channel?: NotificationChannel;
      accountId?: string;
      limit?: number;
    },
  ) {
    return this.notifications.list(q);
  }

  @Get("templates")
  templates() {
    return this.notifications.templates();
  }

  /** The copy belongs to the operator, so only a super admin rewrites it. */
  @Put("templates/:id")
  @PlatformRoles("super_admin")
  updateTemplate(
    @Params(IdParam) p: { id: string },
    @Body(UpdateTemplateRequest) body: UpdateTemplateRequest,
  ) {
    return this.notifications.updateTemplate(p.id, body);
  }

  @Post(":id/requeue")
  @PlatformRoles("super_admin", "finance")
  requeue(@Params(IdParam) p: { id: string }) {
    return this.notifications.requeue(p.id);
  }
}
