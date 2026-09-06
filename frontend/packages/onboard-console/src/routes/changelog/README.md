# One file per release

Each file here is one released version of the staff console, shown on the
Changelog page and in the "What's new" panel. `../changelogData.ts` collects
them and sorts by the `version` inside each file — **the filename has no effect
on ordering**.

## Adding a release

Create a new file named after *what changed*, not after the version:

```
garage-departure-fleet-numbers.ts    ← yes
v1-5-128.ts                          ← no, for anything new
```

The name matters for exactly one reason: two branches open at the same time
must never write the same path. Names like `v1-5-128.ts` collide, because both
branches read the same `main` and both think 1.5.128 is next. A name describing
the change does not collide, so the two branches merge without conflict and
without anyone deciding whose entry survives.

The historical files are named `v1-5-127.ts` and so on because they were
migrated in bulk from the old single array and are immutable — they can never
collide with anything.

## What still needs care

The version *inside* your file can still duplicate another branch's, since both
branches read the same `main`. `../changelogData.test.ts` fails on a duplicate
or out-of-order version, so this surfaces in CI rather than on `main`. If it
fires, bump yours and re-run.

Add the matching entry to the repo-root `CHANGELOG.md` too — that file is the
developer-facing record and carries fuller prose; this one is written for staff
reading the console. The same test checks the two agree on the newest release,
which is also the version the app displays.
