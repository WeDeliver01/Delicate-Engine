# Delicate Couriers

Multi-tenant courier / shipping platform. Two main pieces:

- `delicate-couriers-frontend/` — Next.js 16 (React 19) frontend
- `DelicateCouriers/DelicateCouriers.ApiService/` — .NET 8 Web API (EF Core, JWT auth via Supabase, Hangfire, WooCommerce + Shiplogic integrations)

Other .NET projects in `DelicateCouriers/` (`AppHost`, `Web`, `Contracts`, `Domain`, `ServiceDefaults`, `Tests`) are part of the original Aspire-based solution but are not used in the Replit dev setup.

## Replit Dev Environment

### Workflows

- **Start application** — `cd delicate-couriers-frontend && npm run dev -- -p 5000 -H 0.0.0.0`
  Next.js dev server bound to `0.0.0.0:5000` (the only externally proxied port in Replit).
- **Backend API** — `cd DelicateCouriers/DelicateCouriers.ApiService && dotnet run --no-launch-profile --urls http://0.0.0.0:8080`
  ASP.NET Core API on `0.0.0.0:8080`. Internal-only; the user reaches it through the frontend proxy.

### Frontend ↔ Backend wiring

- `delicate-couriers-frontend/next.config.ts` adds `rewrites()` so the frontend transparently proxies these paths to the backend on `127.0.0.1:8080`:
  `/api/*`, `/swagger`, `/swagger/*`, `/hangfire`, `/hangfire/*`, `/health`, `/alive`.
- `delicate-couriers-frontend/lib/api.ts` axios `baseURL` defaults to `'/api'`. Frontend code calls relative paths like `api.post('/auth/me')`, which resolve to `/api/auth/me` and are rewritten to the backend.
- The axios request interceptor pulls the **current Supabase access token** from `supabase.auth.getSession()` and attaches it as `Authorization: Bearer …` on every request. supabase-js auto-refreshes the token in the background.
- `allowedDevOrigins` in `next.config.ts` allows the Replit dev domain to talk to the Next.js dev server (it's served behind a proxy iframe).

### Database

- Uses **Supabase Postgres** for both the application data and Supabase Auth. The .NET connection string lives in env var `ConnectionStrings__delicatedb` (points at the Supabase pooler).
- EF Core migrations run automatically on backend startup (`dbContext.Database.Migrate()`). The migration `20260514120000_SupabaseAuthMigration` drops `PasswordHash`/`InviteCodes`, adds `SupabaseUserId UUID UNIQUE` on `User`, and a global unique index on `User.Email`.
- A default platform tenant (`TenantID = 1`, "Delicate Couriers") is seeded on startup if missing.
- A bootstrap SuperAdmin (email/password from `ADMIN_EMAIL` / `ADMIN_PASSWORD` secrets) is provisioned in **Supabase Auth** AND in the local `User` table on startup if missing — so there is always at least one admin able to sign in.
- Hangfire uses the same DB for background jobs.

### Auth (Supabase)

Authentication is handled entirely by **Supabase Auth**. There is no custom JWT issuance, no password hashing in the .NET code, and no invite codes anywhere in the system. The previous dev-bypass has been removed.

**Sign-in methods (frontend):**

- Email + password
- Google OAuth
- GitHub OAuth
- "Forgot password" sends a Supabase password-reset email; user lands on `/auth/callback` to set a new password (handled by the same code-exchange flow as OAuth).

**Token shape:** Supabase issues HS256 JWTs signed with the project JWT secret. We validate them on the backend with `Microsoft.AspNetCore.Authentication.JwtBearer`:

- Issuer: `<NEXT_PUBLIC_SUPABASE_URL>/auth/v1`
- Audience: `authenticated`
- Signing key: `SUPABASE_JWT_SECRET` (HS256)
- `MapInboundClaims = false` so we read the raw `sub`/`email`/`app_metadata` claims.

**Tenant + role propagation:** The .NET API needs `tenant_id` (int) and `app_role` (string) on every request. Those live on the `public."User"` row. To get them into the JWT, install the **Supabase Custom Access Token Hook** at `DelicateCouriers/SUPABASE_AUTH_HOOK.sql` — it joins `auth.users.id` to `public."User".SupabaseUserId` and stamps both as **top-level claims** on every issued access token. `Infrastructure/Auth/SupabaseClaimsTransformer.cs` lifts those claims into the .NET `ClaimsPrincipal` (with a fallback that scrapes `app_metadata` if the hook is ever disabled).

**Provisioning new users:** Admins/SuperAdmins go to `/users/create`, which POSTs to `POST /api/admin/users` (`Features/Users/AdminUsersController.cs`). That endpoint:

1. Creates the user inside Supabase Auth via the service-role API (`SupabaseAdminService.CreateUserAsync`), stamping `tenant_id` + `app_role` into `app_metadata`.
2. Inserts the matching local profile row, linked by `SupabaseUserId`.
3. Rolls back the Supabase user if the local insert fails.

Tenant Admins can only provision users into their own tenant and cannot grant the SuperAdmin role; SuperAdmins can do both. Both checks are enforced server-side in `AdminUsersController`.

**Hangfire dashboard** (`/hangfire`) is gated by `JwtDashboardAuthorizationFilter` which requires a Supabase JWT with `app_role` in (`Admin`, `SuperAdmin`).

**Files involved:**

- Backend: `Program.cs` (JwtBearer + claims transformer + Supabase admin client + bootstrap SuperAdmin seed), `Infrastructure/Auth/SupabaseClaimsTransformer.cs`, `Infrastructure/Services/SupabaseAdminService.cs`, `Infrastructure/Filters/JwtDashboardAuthorizationFilter.cs`, `Features/Users/AdminUsersController.cs`, `Features/Auth/AuthController.cs` (now just `/api/auth/me`).
- Frontend: `lib/supabase.ts` (PKCE singleton), `lib/api.ts` (token from `supabase.auth.getSession`), `components/providers/auth-provider.tsx` (session + global route guard), `app/login/page.tsx` (email/password + OAuth + reset), `app/auth/callback/page.tsx` (PKCE code exchange).
- SQL hook: `DelicateCouriers/SUPABASE_AUTH_HOOK.sql` — install once per Supabase project, then enable in Dashboard → Authentication → Hooks → Custom Access Token.

**Supabase Dashboard checklist (one-time per environment):**

1. Authentication → Providers → enable Email + Google + GitHub. Set the redirect URL to the frontend's `/auth/callback` (e.g. `https://app2.delicatecourier.co.za/auth/callback` and the Replit dev domain's `/auth/callback`).
2. Authentication → URL Configuration → add the same redirect URLs to the allow-list.
3. SQL Editor → run `DelicateCouriers/SUPABASE_AUTH_HOOK.sql`.
4. Authentication → Hooks → Custom Access Token → select `public.custom_access_token_hook` → Save.

### Public endpoint URLs

All public-facing URLs are `*2` subdomains of `delicatecourier.co.za` (api2 / app2 / webhooks2):

| Purpose                      | Production                                | Dev                                           | Staging                                           |
| ---------------------------- | ----------------------------------------- | --------------------------------------------- | ------------------------------------------------- |
| Backend API                  | `https://api2.delicatecourier.co.za`      | `https://api2-dev.delicatecourier.co.za`      | `https://api2-staging.delicatecourier.co.za`      |
| Frontend platform            | `https://app2.delicatecourier.co.za`      | `https://app2-dev.delicatecourier.co.za`      | `https://app2-staging.delicatecourier.co.za`      |
| WooCommerce webhook callback | `https://webhooks2.delicatecourier.co.za` | `https://webhooks2-dev.delicatecourier.co.za` | `https://webhooks2-staging.delicatecourier.co.za` |
| Mobile/app frontend          | `https://app2.delicatecourier.co.za`      | —                                             | —                                                 |

Where they're configured in code:

- Backend `appsettings.json` → `PublicUrls.ApiBaseUrl`, `PublicUrls.PlatformBaseUrl`, `PublicUrls.WebhookCallbackBaseUrl`
- Backend CORS allow-list → `Program.cs` (defaults) and `CORS__AllowedOrigins` env var (overrides)
- Frontend production API URL → `NEXT_PUBLIC_API_URL` env var; frontend axios falls back to `/api` (same-origin proxy) when unset
- Frontend dev → talks to backend via same-origin Next.js proxy (no public URL needed)

### External (third-party) endpoints

- **Shiplogic** — third-party courier API at `https://api.shiplogic.com`. Set via `Shiplogic:ApiBaseUrl` (env: `Shiplogic__ApiBaseUrl`).
- **Shiplogic → platform tracking webhook** — Shiplogic POSTs tracking updates to `POST /api/webhooks/shiplogic/tracking` (controller: `Features/Webhooks/ShiplogicTrackingWebhookController.cs`). The handler looks up the shipment by `ConsignmentID` (Shiplogic `shipment_id`) or `TrackingNumber` (Shiplogic `short_tracking_reference`), updates `Shipment.ShipmentStatus` / `ActualDeliveryDate` / `EstimatedDeliveryDate`, appends new `TrackingEvent` rows (deduped by `ExternalEventId`), and emits a `tracking.event_ingested` System Event. Auth: if env var `Shiplogic__WebhookSecret` is set, the handler requires that value on either the `Authorization` header (Shiplogic's "Auth key" field) or `X-Webhook-Secret`; if unset it accepts unauthenticated and logs a warning. Subscriptions are configured manually in each Shiplogic merchant portal — the SuperAdmin page at `/super-admin/shiplogic-webhook` (backed by `GET /api/admin/integrations/shiplogic-webhook`) renders the exact URL + auth-key value to paste, plus step-by-step instructions.
- **Supabase** — Auth + DB. URL set via `NEXT_PUBLIC_SUPABASE_URL` (also reused server-side as the JWT issuer prefix).

### Environment variables / Secrets

Backend:

- `ConnectionStrings__delicatedb` — Postgres connection string (Supabase pooler).
- `SUPABASE_JWT_SECRET` — HS256 signing key Supabase uses for access tokens. Required for JWT validation.
- `NEXT_PUBLIC_SUPABASE_URL` — also read server-side to derive the JWT issuer (`<url>/auth/v1`) and the admin REST endpoint.
- `SUPABASE_SERVICE_ROLE_KEY` — service-role key used by `SupabaseAdminService` to create/delete users.
- `ADMIN_EMAIL`, `ADMIN_PASSWORD` — bootstrap SuperAdmin credentials seeded on startup.
- `CORS__AllowedOrigins`, `ASPNETCORE_ENVIRONMENT`, `ASPNETCORE_URLS`, `PublicUrls__*`, `Shiplogic__*`.

Frontend:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — required by supabase-js in the browser.
- `NEXT_PUBLIC_API_URL` — optional; falls back to same-origin `/api`.

## Production / deployment notes

**Production is a Replit Deployment.** Hitting "Publish" in the Replit workspace builds and rolls out both the .NET API and the Next.js frontend to the same production deployment. There are no Docker images to build, no container registry to push to, no Azure / GCP / AWS / Kubernetes to manage — Replit handles the build, host, TLS, and health checks.

How it's wired (see `.replit` → `[deployment]`):

- `deploymentTarget = "gce"` — Replit's always-on VM deployment.
- `build` — `dotnet publish` the API into `./publish`, then `npm ci && npm run build` the frontend (Next.js standalone output).
- `run` — starts the .NET API on `:8080`, waits 40s, then starts the Next.js standalone server on `:5000`. The same `next.config.ts` rewrites from dev are reused in prod, so the frontend proxies `/api/*`, `/swagger`, `/hangfire`, `/health`, `/alive` to `127.0.0.1:8080`. Only port 5000 (frontend) is exposed publicly.

To deploy:

1. Click **Publish** in the Replit workspace.
2. Wait for the build to finish and the new revision to go live.
3. The app is served at the deployment's `.replit.app` URL and at any custom domain attached to the deployment.

Custom domains (`app2.delicatecourier.co.za`, etc.) are configured in the Replit Deployments dashboard — point the DNS CNAME at the deployment as instructed there. Once attached, every "Publish" updates the live custom-domain site automatically.

The production database connection string is read from `ConnectionStrings__delicatedb` — point this at the production Supabase project's pooler. Each environment (dev / staging / prod) should have its own Supabase project, and the auth hook (`DelicateCouriers/SUPABASE_AUTH_HOOK.sql`) must be installed in each one.

## Known issues / risks

- **Resolved (2026-05-19) — silent-hang on shipment booking.** Hangfire jobs were silently failing every Shiplogic booking and retrying for ~24h with no merchant-visible signal. Root cause: `ShipmentOrchestrationService.CreateShipmentForOrderAsync` opened a manual `BeginTransactionAsync` (for the per-order advisory lock) while `AppDbContext` is registered with `EnableRetryOnFailure` (`Program.cs:43`) — `NpgsqlRetryingExecutionStrategy` refuses manually-started transactions and throws `InvalidOperationException: The configured execution strategy 'NpgsqlRetryingExecutionStrategy' does not support user-initiated transactions`. Hangfire caught it, scheduled the next retry 30s away, and from the outside the merchant saw nothing happen for 24h. Fix: the transaction block is now wrapped in `Database.CreateExecutionStrategy().ExecuteAsync(...)`. Verified end-to-end against the Honey Bee Baker staging Shiplogic account on 2026-05-19 — real Consignment `113449601` / Tracking `XJ347V` were booked from a signed plugin webhook. The fix is safe to re-run because (a) the inside-the-lock re-check catches a sibling that already wrote a Shipment, and (b) the `FindShipmentByCustomerReferenceAsync` guard makes the Shiplogic create idempotent on retry.
- **Pre-existing committed secrets** in `DelicateCouriers.ApiService/appsettings.json` — Postgres password and Shiplogic bearer token. The JWT signing key field is now ignored (Supabase JWT secret comes from env). Rotate the others and move them to env vars / Replit Secrets before any production-like use.
- DNS for the `api2` / `app2` / `webhooks2` subdomains must be attached to the Replit Deployment in the Replit Deployments dashboard.
- Existing tenants whose WooCommerce stores were configured against the old webhook URL need their webhook subscriptions re-pointed at `https://webhooks2.delicatecourier.co.za/api/webhooks/woocommerce/order`.
- The two WooCommerce plugin ZIPs in `Plugins/WooCommerce/*/` have been rebuilt to embed the new `api2.delicatecourier.co.za` URL — re-distribute them to merchants whose sites have the old plugin installed.
- **All previous user accounts have been wiped** as part of the Supabase migration. Re-provision via the bootstrap SuperAdmin and the admin "Add User" flow.
