# 05 — Shared plan-to-revision resource copy

**What to build:** The logic that copies a plan's routes, geofences, and
locations into a fresh Plan revision exists once. Today it is duplicated across
the plan modification path and the vehicle assignment approval path, so a fix to
one can silently miss the other.

**Blocked by:** 02 — Scope publication is atomic.

**Status:** ready-for-agent

- [ ] The plan-to-revision resource copy exists once and is used by both the plan
      modification path and the vehicle assignment approval path
- [ ] The shared copy accepts its caller's transaction rather than managing its
      own, so a caller that already spans several writes is not forced to nest or
      split transactions
- [ ] The plan repair copy and the revision application copy are deliberately
      left alone — they move resources in different directions with different
      semantics, and folding all four behind a direction parameter would encode
      the differences in parameters rather than hide them
- [ ] Console version incremented
