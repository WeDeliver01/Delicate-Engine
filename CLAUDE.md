# Delicate Engine — working notes for Claude

Read `docs/ARCHITECTURE.md` first. It is the signed-off design; build to it phase by phase and
get a sign-off before starting the next phase.

## Ground rules

- This is a **fresh build**. `_reference/` and `_archive/` are prior attempts: use them for
  domain context and design ideas, never assume anything in them works, never copy code across.
- **TypeScript everywhere.** No Python/.NET in the core. No Replit anything.
- **Money is integer cents**, ledgers are append-only, journals balance, every state change
  and its event commit in one transaction via `OutboxService.emit(tx, …)`, every retry-able
  write has an idempotency key, every privileged action goes through `AuditService.record`.
- **The engine proposes money movements; a human executes.** Never wire an automatic external
  payment/fuel-load/payout.
- Add new domain events to `packages/contracts/src/events/catalog.ts` (and the discriminated
  union) before emitting them; never edit an existing event's payload — add a version.

## How things fit

- `apps/api/src/modules/*` — one folder per bounded context (identity, admin, …). A module owns
  its service, controller and event handlers; it talks to other modules through services or
  events, not by reaching into their tables.
- Request validation: `@Body(ZodSchema)`, `@Query(...)`, `@Params(...)` from `common/zod.ts`.
  Errors: throw `AppError` (stable `code`); the global filter renders `ApiError`.
- Auth: `@Public()`, `@PlatformRoles(...)`, `@AccountRoles(...)`, `@RequireAccount()`;
  read the caller with `@CurrentPrincipal()` / `@ActiveAccountId()`. Active account comes from
  the `X-Account-Id` header.
- Money on delivery: `DispatchService` → `SettlementService.settle` writes ONE balanced journal
  per shipment (`LedgerService` is the only journal writer) and captures the booking's wallet
  hold when every live drop is settled. Never post a journal outside `LedgerService`.
- Worker handlers register in a module's `onModuleInit` via `EventHandlerRegistry.register`
  and must be idempotent (at-least-once delivery).
- DB changes: edit `packages/db/src/schema/*`, run `pnpm db:generate`, commit the SQL file,
  never hand-edit applied migrations.

## Commands

```bash
docker compose up -d postgres
pnpm install && pnpm --filter @delicate/contracts --filter @delicate/db run build
pnpm db:migrate && pnpm db:seed
pnpm typecheck && pnpm test && pnpm format:check     # the CI gates
pnpm --filter @delicate/api run dev | dev:worker | dev:token <admin|owner|…>
pnpm --filter @delicate/web run dev
```

Notes: API dev uses SWC (`.swcrc`) + nodemon because esbuild/tsx cannot emit decorator metadata
and `tsc --watch` / `node --watch` misbehave on Windows; `tsc` remains the typecheck gate and
the production build. Next standalone output is Docker-only (`NEXT_STANDALONE=1`). Repo is LF-only.
Always run commands from the repo root (that is where `.env` and `docker-compose.yml` live).
