# Delicate Engine

The central operating system for Delicate Courier: every booking, wallet movement, delivery,
driver earning and treasury allocation begins here and is accounted for here.

- **Architecture & phased plan:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **Decisions (ADRs):** [docs/adr](docs/adr)
- **Operating the VPS:** [docs/RUNBOOK.md](docs/RUNBOOK.md)
- **Prior attempts (context only, not code we run):** `_reference/`, `_archive/`

## Layout

```
apps/api        NestJS engine — HTTP API (dist/main.js) and worker (dist/worker.js)
apps/web        Next.js — marketing site, customer portal, ops console
packages/contracts  Zod schemas shared by every app: DTOs, enums, domain events
packages/db     Drizzle schema, SQL migrations, seed
packages/config shared tsconfig presets
infra/docker    Dockerfiles, production compose, Caddyfile
docs/           architecture, ADRs, runbook, handover material
```

## Local development

Requirements: Node 24, pnpm 12 (`corepack enable`), Docker.

```bash
cp .env.example .env            # defaults work as-is for local dev
docker compose up -d postgres   # Postgres 16 on :5433 (dev + test databases)
pnpm install
pnpm --filter @delicate/contracts --filter @delicate/db run build
pnpm db:migrate && pnpm db:seed
```

Run the pieces (separate terminals):

```bash
pnpm --filter @delicate/api run dev          # API on http://localhost:8080  (docs at /docs)
pnpm --filter @delicate/api run dev:worker   # outbox worker
pnpm --filter @delicate/web run dev          # web on http://localhost:3000
```

Sign in without a Supabase project: mint a dev token and paste it on `/login`.

```bash
pnpm --filter @delicate/api run dev:token owner    # seed customer owner (2 accounts)
pnpm --filter @delicate/api run dev:token admin    # super admin → /admin
```

Seed identities: `admin`, `dispatch`, `finance` (staff) and `owner`, `staff` (Honey Bee Bakers).

## Quality gates

```bash
pnpm typecheck      # every package
pnpm test           # contracts unit tests + API integration tests (needs postgres)
pnpm format:check
```

The API tests boot the real application (guards, filters, middleware) against
`TEST_DATABASE_URL` and truncate between tests. CI runs the same gates on every push.

## Invariants

The ten rules in [ARCHITECTURE.md §4](docs/ARCHITECTURE.md#4-invariants-never-violated) are
enforced in code and tests; a change that violates one is a bug, not a trade-off.

## Phase status

| Phase                 | Status                                                                                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 Foundation          | ✅ monorepo, Supabase JWT auth + dev tokens, accounts/orgs/memberships, transactional outbox + worker, audit log, admin console, Docker + CI                                 |
| 1 Book & pay          | ✅ catalog + pricing engine, geocoding, quotes, wallet/holds/top-ups (EFT, PayFast), credit terms, slots, bookings/shipments/waybills, public tracking, portal + ops console |
| 2 Deliver & settle    | next                                                                                                                                                                         |
| 3 Treasury & billing  |                                                                                                                                                                              |
| 4 Portal apps & comms |                                                                                                                                                                              |
| 5 Hardening           |                                                                                                                                                                              |
