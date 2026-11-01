import { Global, Module } from "@nestjs/common";
import { SystemEventsService } from "./system-events.service.js";
import { SystemEventsController } from "./system-events.controller.js";

/**
 * The operational feed.
 *
 * `@Global`, like the audit log it sits beside, because the things worth recording happen
 * everywhere -- the exception filter, the outbox dispatcher, three webhook handlers, the
 * booking path -- and threading this module into each of their imports would mean the next
 * place that needs it quietly does without.
 */
@Global()
@Module({
  controllers: [SystemEventsController],
  providers: [SystemEventsService],
  exports: [SystemEventsService],
})
export class SystemEventsModule {}
