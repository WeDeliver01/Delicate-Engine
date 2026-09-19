---
name: Project assignments optimistic concurrency
description: Why writes to projects.assignments that originate outside the normal autosave path must use updatedAt CAS to avoid clobbering manual dispatcher edits.
---

# projects.assignments lost-update guard

`projects.assignments` (JSONB shipmentId→assignmentId) is written by several
independent producers: the dispatcher's TripsTab autosave (manual reassigns),
webhook auto-import greedy assignment, and the reassignment-suggestion apply
endpoint. They all read-modify-write the whole blob.

**Rule:** any endpoint that read-modifies-writes the assignments blob and is NOT
the user's own autosave must commit with optimistic concurrency:
`WHERE id = projectId AND updatedAt = <value read>`, and on a CAS miss re-read,
re-merge, and retry (a few attempts), returning 409 rather than overwriting.

**Why:** a plain `WHERE id = projectId` write commits a stale snapshot, silently
discarding a concurrent manual edit/autosave that landed between read and write
(classic lost update). `storage.updateProject` bumps `updatedAt` on every write,
which is what makes the CAS comparison reliable.

**How to apply:** see the suggestion-apply endpoint in `server/routes.ts`
(`/api/dispatch/reassignment-suggestions/apply`) for the retry-loop pattern. Reuse
it for any future "system-initiated" assignment mutation.
