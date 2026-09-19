# ADR 0003 — Supabase Auth with just-in-time user provisioning

Date: 2026-09-19 · Status: accepted

## Context

Ashley chose Supabase for identity and Postgres. The engine must work for web and native
clients, and developers need to run it without a Supabase project.

## Decision

- Clients obtain Supabase access tokens; the API verifies them (HS256 secret or JWKS) and
  creates the `users` row on first sight (id = Supabase user id). Supabase owns credentials;
  the engine owns profile, platform role and memberships.
- Outside production a second issuer (`delicate-dev`, HS256 with `AUTH_DEV_SECRET`) lets
  `dev:token` and the integration tests mint identities.
- The active account is asserted per request via `X-Account-Id` and checked against
  memberships (staff roles bypass membership).

## Consequences

- No password handling anywhere in this codebase.
- Adding a member currently requires the invitee to have signed in once; email invitations for
  unknown users arrive with the notifications module (Phase 4).
