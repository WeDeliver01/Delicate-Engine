# ADR 0004 — Service credentials for machine callers

**Status:** proposed, 2026-10-01. Supersedes nothing. Needs sign-off before the seam is used
against real merchants.

## Context

Everything the engine does for a customer assumes a person: `AuthGuard` verifies a Supabase
JWT, provisions a `users` row, and resolves `X-Account-Id` against a membership. That is right
for the portal and for the driver app.

The Delicate Courier API (`WeDeliver01/Delicate-Courier-API-2`) is not a person. It is a server
acting for a merchant whose customer has already checked out, and it has no user principal at
all. Every endpoint it needs — quote, book, label, track, cancel — is `@RequireAccount()`, so
without a second way to authenticate, none of the migration off ShipLogic can begin. This is
gap 1 of eight in that repository's analysis, and the other seven are all behind it.

Two further mismatches come with it:

- It books in **one call**. The engine quotes, then books that quote.
- Its booking job **retries for about 24 hours**, while a quote is single-use and expires in
  24 hours. So a retry almost always meets a quote that is consumed or expired.

## Decision

### 1. A credential, checked on every request

A `service_clients` row holds a public `key_id` and a SHA-256 hash of a 256-bit random secret.
The caller sends `Authorization: Bearer dsk_<keyId>_<secret>`; the guard recognises the `dsk_`
prefix and takes the service path instead of the JWT path.

Rejected: an OAuth2 client-credentials exchange issuing short-lived tokens. It is the more
conventional answer, and it keeps the secret off most requests. We chose the simpler one
because revocation matters more here than secret exposure: the credential is held by one
server we operate, over TLS, but when it has to be withdrawn it must stop working _now_, not
when a token expires. Reading the row every request gives that for free. If a third party ever
holds a credential, revisit this.

A plain SHA-256 rather than a slow KDF, deliberately: the secret is random, not chosen, so
there is no dictionary to make expensive, and a per-request bcrypt would be real latency for
no security.

### 2. Closed by default

A route is reachable by a credential only if it declares `@Scopes(...)`. Everything else — the
whole portal surface, the entire admin console — refuses service credentials outright, whatever
scopes the credential holds. New endpoints are therefore closed to integrations until someone
decides otherwise, rather than open until someone notices.

Staff authority stays a property of a person: `@PlatformRoles` can never be satisfied by a
credential, so no integration can reach an admin route by being over-granted.

### 3. Explicit account grants

`service_client_accounts` lists the accounts a credential may act for. No row, no access. A
leaked key reaches exactly the accounts it was granted and nothing else, and the blast radius
of an integration is a decision someone made rather than a consequence of how it authenticated.

### 4. The caller keeps its own identifiers

`account_external_refs` maps `(system, external_id)` to an account, where `system` is always the
calling credential's own slug — never a value the caller sends, so one integration cannot
resolve another's references by guessing a name. A merchant platform sends
`X-Account-Ref: store-42` and never stores an engine uuid. The mapping is a row: auditable, and
correctable without a deploy.

### 5. One-call booking, with the quote still real

`POST /v1/service/bookings` takes the whole job and does both halves itself. It still creates a
persisted quote first, so the price remains explainable and the booking is backed by the same
evidence a portal booking is.

The caller may also pass `quoteId` — the quote it priced at checkout — to charge the price its
customer was shown. It is safe to send a stale one: an expired quote is re-priced from the body
of the same request, and a consumed one is resolved to the booking that consumed it.

The retry semantics are the point of the endpoint:

| What the caller meets          | What it means                        | What we do                                                              |
| ------------------------------ | ------------------------------------ | ----------------------------------------------------------------------- |
| Idempotency key already booked | Success, arriving late               | Return that booking, `replayed: true`, before paying for a routing call |
| `quote_used`                   | Another attempt won the race         | Resolve the booking that consumed it and return it                      |
| `quote_expired`                | Nothing booked; price may have moved | Quote again and book the new one                                        |

All three resolve against the **caller's** idempotency key, derived from its order id, so it
survives re-quoting; the unique index on `(account_id, idempotency_key)` is what makes two
concurrent attempts one booking.

`maxTotalCents` lets a caller refuse a price that has risen since its checkout quoted. A
booking nobody agreed the price of becomes an argument on an invoice weeks later.

### 6. A quote is used once, enforced where it can be

`QuoteService.markBooked` now updates `WHERE status = 'priced'` and raises `quote_used` when it
matches nothing. The previous check read the status outside the transaction, which decides
nothing when two bookings race: both read `priced`, and the loser failed on a unique-constraint
violation nobody could interpret.

## Consequences

- Issuing a credential is a `super_admin` action and is audited. The secret appears once, in
  the response that created or rotated it; we store a hash, so there is nothing to show later
  and nothing to leak from the database.
- `Principal.user` is now nullable and `Principal.service` exists. Routes that only ever serve
  a person call `requireUser()`, which states that expectation instead of implying it.
- `audit_log.actor_service_client_id` and `bookings.created_by_service_client_id` record which
  system acted. Reconciliation during a parallel run can ask the data rather than infer from
  reference formats.
- Rotation has no overlap window: the old secret dies when the new one is issued. Rotating is a
  coordinated change, not a background tidy-up. If zero-downtime rotation is wanted later, it
  needs a second active key per client, which is a schema change, not a policy one.
- **Wallet gating is unchanged and is the real gate.** Every booking still needs
  `balance + credit_limit − holds ≥ price`. A credential lets a system book; it does not let it
  book for free. No merchant can be migrated before its account is funded or on agreed credit
  terms, and that is a commercial conversation, not a deployment.
