import { Logger } from "nestjs-pino";
import { createHttpApp } from "./bootstrap.js";
import { ENV, type Env } from "./config/env.js";

async function main(): Promise<void> {
  const app = await createHttpApp();
  const env = app.get<Env>(ENV);
  await app.listen(env.API_PORT, "0.0.0.0");
  // Swagger is only mounted outside production, so do not advertise it when it is not there.
  const docs = env.NODE_ENV === "production" ? "" : "; docs at /docs";
  app.get(Logger).log(`api listening on :${env.API_PORT} (${env.NODE_ENV})${docs}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
