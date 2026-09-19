import { Global, Module } from "@nestjs/common";
import { ENV, loadEnv, type Env } from "./env.js";

/**
 * Provides the validated `Env` object under the `ENV` token. Accepts an override so tests can
 * boot the app against a different database without touching process.env.
 */
@Global()
@Module({})
export class ConfigModule {
  static forRoot(overrides: Partial<Env> = {}) {
    const env: Env = { ...loadEnv(), ...overrides };
    return {
      module: ConfigModule,
      providers: [{ provide: ENV, useValue: env }],
      exports: [ENV],
    };
  }
}
