# 03 — Author Zone purpose on Event geofences

**What to build:** An Event resource author can say what a geofence is *for*.
Each geofence carries a **Zone purpose** — staging, corridor, venue, or other —
set in Event Map Authoring alongside its name and shape.

Purpose is authored, never inferred. It is not parsed from the geofence name and
not derived from polygon size. Existing geofences backfill to `other`, so every
already-authored scope stays valid and nothing an author has drawn is
invalidated by this change.

This is the data that ticket 04 turns into an operator-facing vehicle status.
**Prerequisites:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Geofences persist a purpose of staging, corridor, venue, or other.
- [ ] Existing geofences backfill to other and remain fully usable.
- [ ] Event Map Authoring offers a purpose selector when creating and when
      editing a geofence, and shows the current purpose.
- [ ] Purpose survives the reshape-and-autosave path without being reset.
- [ ] Purpose is carried on the shared geofence type and returned wherever
      geofences are read, including published operating scope.
- [ ] Deactivating a geofence leaves its purpose intact.
- [ ] Changing a purpose does not rewrite the meaning of a previously active
      operating period — pinned resource versions keep the purpose they were
      pinned with.
- [ ] The console package version is bumped.

**References:** Event AVL Live Command Surface — Spec; Event AVL monitoring
trust states (ADR 0020); Zone-derived vehicle status (ADR 0026); Event AVL
field view boundary (ADR 0027); CONTEXT.md — Domain Context.
