import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module.js";
import { ENV, type Env } from "./config/env.js";
import { requestContextMiddleware } from "./common/request-context.js";
import { APP_VERSION } from "./version.js";

/**
 * Builds a fully configured HTTP application. Shared by `main.ts` and the integration tests so
 * tests exercise exactly the middleware/guards/filters that production runs.
 */
export async function createHttpApp(overrides: Partial<Env> = {}): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(overrides), {
    bufferLogs: true,
  });
  const env = app.get<Env>(ENV);

  app.useLogger(app.get(Logger));
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(requestContextMiddleware);
  app.enableCors({
    origin: env.CORS_ORIGINS,
    credentials: true,
    exposedHeaders: ["x-request-id"],
  });
  app.enableShutdownHooks();

  if (env.NODE_ENV !== "production") {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle("Delicate Engine API")
        .setVersion(APP_VERSION)
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup("docs", app, doc, { jsonDocumentUrl: "docs/openapi.json" });
  }

  return app;
}
