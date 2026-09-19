import { Global, Inject, Injectable, Module, type OnModuleDestroy } from "@nestjs/common";
import { createDb, type Database, type DbExecutor, type DbHandle } from "@delicate/db";
import { ENV, type Env } from "../config/env.js";

export type { Database, DbExecutor };

/**
 * Owns the connection pool for the process. Domain services receive a `DbExecutor` (either
 * the root db or a transaction) so the caller decides the transaction boundary.
 */
@Injectable()
export class DbService implements OnModuleDestroy {
  private readonly handle: DbHandle;

  constructor(@Inject(ENV) env: Env) {
    this.handle = createDb(env.DATABASE_URL, { max: env.NODE_ENV === "test" ? 4 : 10 });
  }

  get db(): Database {
    return this.handle.db;
  }

  /** Run `fn` inside one transaction; rolls back on throw. */
  transaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T> {
    return this.handle.db.transaction(fn);
  }

  async ping(): Promise<number> {
    const started = performance.now();
    await this.handle.pool.query("select 1");
    return Math.round(performance.now() - started);
  }

  async onModuleDestroy(): Promise<void> {
    await this.handle.close();
  }
}

@Global()
@Module({ providers: [DbService], exports: [DbService] })
export class DbModule {}
