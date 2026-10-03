import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module.js";
import { OutboxDispatcher } from "./worker/outbox-dispatcher.js";
import { NotificationDispatcher } from "./modules/notifications/notification.dispatcher.js";
import { RiskDispatcher } from "./modules/operations/risk.dispatcher.js";

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
