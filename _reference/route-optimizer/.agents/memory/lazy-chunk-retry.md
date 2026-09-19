---
name: Lazy chunk stale-deploy recovery
description: Why route-level lazy imports need a one-time reload-on-failure wrapper
---

Route components are loaded with `React.lazy` and bundled into hash-named chunks.
After a new deploy the old hash no longer exists on the server, so a browser tab
that was opened before the deploy fails the dynamic import with
"Failed to fetch dynamically imported module: .../assets/<name>-<hash>.js" the
moment the user navigates to that route.

**Rule:** Wrap route-level lazy imports so an import failure triggers exactly one
automatic `window.location.reload()` (guarded by a sessionStorage flag so a
genuinely-broken chunk can't loop), then clear the flag on success. A second
failure rethrows and is caught by the app ErrorBoundary's manual reload UI.

**Why:** Without this, a routine deploy strands every already-open tab on a hard
error screen until the user manually reloads.

**How to apply:** Always route new `lazy(() => import(...))` calls through the
retry wrapper, not raw `lazy`. The wrapper is browser-only (touches `window`),
which is fine for this Vite SPA (no SSR).
