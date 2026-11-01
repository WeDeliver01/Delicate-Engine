import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module.js";
import { OutboxDispatcher } from "./worker/outbox-dispatcher.js";
import { NotificationDispatcher } from "./modules/notifications/notification.dispatcher.js";
import { RiskDispatcher } from "./modules/operations/risk.dispatcher.js";
import { JOBS, Scheduler } from "./worker/scheduler.js";
import { MembershipService } from "./modules/membership/membership.service.js";

/**
 * Worker entrypoint: same module graph as the API, no HTTP listener. Runs the outbox
 * dispatcher (and, in later phases, scheduled jobs). Deploy as a separate container using the
 * same image: `node dist/worker.js`.
 */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule.forRoot(), { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  const dispatcher = app.get(OutboxDispatcher);
  await dispatcher.reclaimStale();
  dispatcher.start();

  // Its own loop: reaching a mail host is slow and fails in ways the event stream must not inherit.
  const notifications = app.get(NotificationDispatcher);
  notifications.start();

  // Also its own loop: a missed window is a fact about the clock, so no event can announce it.
  const risk = app.get(RiskDispatcher);
  risk.start();

  /*
    Scheduled work, which only the worker runs.

    The API process can enqueue a job but must never claim one, or every web container would
    race the others for the same renewal. Daily rather than monthly: a membership renews on
    its own anniversary, so the sweep has to come round often enough to catch each one on the
    day it falls due, and renewing is a no-op for everybody whose period still has time left.
  */
  const scheduler = app.get(Scheduler);
  const memberships = app.get(MembershipService);
  try {
    await scheduler.schedule(JOBS.membershipRenewals, "15 2 * * *", async () => {
      const done = await memberships.renewDue();
      if (done > 0) app.get(Logger).log(`renewed ${done} membership(s)`);
    });
  } catch (err) {
    /*
      Deliberately swallowed. A membership that renews a day late is a billing question
      somebody can answer by hand from the membership board; an outbox that stops dispatching
      is every email, every settlement and every status change in the platform. Letting a
      failure to register a cron kill this process trades the second for the first, which is
      the wrong way round -- and did exactly that in production once.
    */
    app.get(Logger).error({ err }, "could not register scheduled jobs; continuing without them");
  }

  const shutdown = async (signal: string) => {
    app.get(Logger).log(`${signal} received; draining`);
    notifications.stop();
    risk.stop();
    await dispatcher.stop();
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
