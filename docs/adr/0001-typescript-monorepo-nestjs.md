# ADR 0001 — One TypeScript monorepo; NestJS for the engine

Date: 2026-09-19 · Status: accepted

## Context

Five prior attempts spanned Django, Node/Express, a pnpm monorepo and .NET. None talked to
each other. Ashley chose one language for engine, web, worker and driver app.

## Decision

- pnpm workspaces + Turborepo; `apps/*` deployables, `packages/*` shared code.
- The engine API is **NestJS 11** (Express adapter) on Node 24, ESM, strict TypeScript.
- The worker is a second entrypoint of the same app (`dist/worker.js`), sharing DI and modules.
- Contracts (Zod) are shared through `@delicate/contracts`; the DB layer through `@delicate/db`.

## Consequences

- NestJS needs `emitDecoratorMetadata`: dev compiles with SWC (`.swcrc`, watch mode) and
  restarts with nodemon; tests use SWC via `unplugin-swc`; `tsc` is the typecheck gate and the
  production build. esbuild/tsx are not used for the API.
- Zod schemas must be wrapped when passed to Nest param decorators (Nest treats anything with
  `.transform` as a pipe) — see `common/zod.ts`.
