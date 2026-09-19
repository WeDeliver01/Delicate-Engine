---
name: Inspector store nodes need their context providers
description: Why the dispatcher Inspector must render inside the dispatch context provider
---

The dispatcher's right-hand Inspector renders arbitrary React nodes pushed into a
zustand store (opened via `openWith`). Some of those nodes (e.g. the trip sheet)
consume the dispatch React context (`useDispatchData` etc.), which throws if
rendered outside its provider.

**Rule:** The Inspector — and anything else that renders inspector-store nodes —
must render *inside* the dispatch context provider, not as a sibling of the
dispatch page in the layout shell.

**Why:** It was originally a sibling of the page in the layout shell, outside the
provider. Opening a trip sheet crashed production with "useDispatchData must be
used inside <DispatchPage>".

**How to apply:** When adding a new inspector node kind, check which dispatch
hooks it (transitively) calls; it's covered as long as the Inspector stays inside
the provider. Never lift the Inspector back up into the layout shell above the
dispatch page. Layout was preserved by laying out [main(flex-1), Inspector(fixed
width)] side by side, identical to the old sibling layout.
