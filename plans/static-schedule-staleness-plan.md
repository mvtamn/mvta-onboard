# Static Schedule Staleness — Service Change Handling Plan

MVTA runs **4 service changes (picks) per year**. Every one of them swaps out route
patterns, trip_ids, service_ids, and sometimes stop_ids underneath a static-GTFS ingest
that today has no idea versions exist. This plan covers what breaks, what to build, and
in what order.

## 1. What exists today

`functions-restapi/src/functions/gtfsStopsSync.ts` — one timer, `0 0 9 * * *` (09:00 UTC
= 3:00/4:00 AM Central). It fetches `GTFS_STATIC_URL`
(`https://mvta-dispatch.myavail.cloud/.../google_transit.zip`), parses it via
`fetchAndParseStatic` (`src/lib/gtfsStatic.ts`), then in a single transaction does
`TRUNCATE` + row-by-row `INSERT` into:

| Table | PK | Consumers |
|---|---|---|
| `GtfsStops` | `stop_id` | stop names in alert text, delay/departure views |
| `GtfsTripDirections` | `trip_id` | NB/SB/EB/WB labels (only source — no RT feed has direction) |
| `GtfsRoutes` | `route_id` | authoritative route registry, `routes.ts`, Route Classification picker |
| `GtfsCalendar` | `service_id` | which services run today |
| `GtfsCalendarDates` | `(service_id, service_date)` | holiday/exception overrides |
| `GtfsScheduledTrips` | `trip_id` | **missed-trip silent-no-show detection** |

The only safety net is a zero-row guard (`gtfsStopsSync.ts:32`): if stops *and* trips
*and* routes all parse to zero, keep the existing data. Anything else is applied blind.

**Good news found while reading:** `activeServiceIdsToday` in `gtfsMissedTripsPoll.ts:113`
already filters with `@service_date BETWEEN c.start_date AND c.end_date`. So a feed
containing **two overlapping picks at once is already handled correctly** by
schedule-based detection — no downstream logic change needed for the overlap case. The
danger is not "both picks loaded," it is "the *wrong single* pick loaded."

## 2. Failure modes a service change actually produces

**F1 — Early publish (highest risk).** Agencies routinely post the next pick's feed days
or weeks before its effective date. If Avail replaces `google_transit.zip` with a
new-pick-only feed on, say, the Thursday before a Monday pick, the 09:00 UTC run wipes
the current schedule and loads trips that will not run for four more days. Result:
`GtfsScheduledTrips` is full of trip_ids the RT feed will never emit → **every trip in
scope escalates as a silent no-show**, all day, for days. This is gap #2 in
[missed-trip-detection-logic-gaps.md](plans/missed-trip-detection-logic-gaps.md) and it is
the single most expensive failure here.

**F2 — Late publish.** Pick goes into effect Monday; the feed lands Tuesday. Stop names,
direction labels, and the route registry are a pick behind. Silent-no-show detection is
mostly self-limiting here (unknown trip_ids simply aren't in scope), but reports and alert
text are quietly wrong and nobody is told.

**F3 — Silent total failure.** A fetch error, a 404 from a changed vendor path, or a PK
violation mid-transaction is caught, logged with `context.error`, and swallowed
(`gtfsStopsSync.ts:212-222`). Nothing surfaces in the console. The app then runs on last
quarter's schedule **indefinitely** — this is exactly the staleness scenario, and today
there is no signal at all that it is happening. Note `GtfsScheduledTrips.trip_id` and
`GtfsCalendar.service_id` are single-column PKs: a feed that reuses an id across two picks
(spec-invalid, but vendor feeds do it) aborts the whole transaction and lands here.

**F4 — Orphaned operator configuration.** Staff-maintained tables key off ids the pick
changes, and nothing reconciles them:
- `RouteClassification` (migration 016) — retired route_ids leave dead rows; new route_ids
  are unclassified, and consumers `LEFT JOIN` + `COALESCE` them into "unclassified" rather
  than failing loudly.
- OTP stop exclusions (migrations 018/022) keyed by `stop_id`.
- Detour definitions (migration 017) keyed by route/stop.

**F5 — Historical records that reference reassigned ids.** OTP history, missed-trip rows,
and AVL reports store `route_id`/`trip_id` values whose *meaning* changed at the pick
boundary. Comparing month-over-month across a service change is not apples-to-apples and
nothing marks the seam.

## 3. Plan

### Phase 1 — Know what version you're running (foundation)

**1a. Parse `feed_info.txt` and hash the zip.** Extend `fetchAndParseStatic` to return
`feedInfo` (`feed_version`, `feed_start_date`, `feed_end_date`, `feed_publisher_name`) —
optional per spec, so tolerate its absence — plus a SHA-256 of the raw zip bytes as a
fallback identity when `feed_info.txt` is missing or the publisher never bumps
`feed_version`.

**1b. New migration: `GtfsFeedVersions`.**

```
content_hash        CHAR(64)     NOT NULL PRIMARY KEY
feed_version        NVARCHAR(100) NULL
feed_start_date     CHAR(8)      NULL
feed_end_date       CHAR(8)      NULL
first_seen_at       DATETIME2    NOT NULL
applied_at          DATETIME2    NULL
status              NVARCHAR(20) NOT NULL   -- applied | rejected | held
reject_reason       NVARCHAR(500) NULL
stop_count / route_count / trip_count / calendar_count  INT NULL
```

Plus a `GtfsSyncRuns` row per execution (started_at, outcome, content_hash, duration) so
"last successful sync" is answerable — that's what F3 needs.

**1c. Conditional GET.** Send `If-None-Match` / `If-Modified-Since` from the last run. On
304, record a heartbeat and skip parse + transaction entirely. This makes running the sync
frequently nearly free, which Phase 3 depends on.

### Phase 2 — Validation gate (the part that prevents F1)

Run these checks after parsing, *before* commit. The sync is already inside a transaction,
so a rejection is just a rollback.

**Hard rejects — keep existing data, record `status='rejected'` with reason:**

1. **No active service today.** Using the parsed `calendar`/`calendar_dates`, evaluate the
   same predicate `activeServiceIdsToday` uses against *today's* date. If the incoming
   feed yields zero active service_ids for today, it is either a future-only pick (F1) or
   an expired one (F2). **This single check is the highest-value guard in the plan** —
   it catches both directions, costs nothing, and needs no version history.
2. Any required file parses to zero rows (tighten today's guard from AND to OR).
3. Trip count drops more than ~40%, or route count drops more than ~25%, vs. the currently
   applied version. Tune the thresholds against real pick-to-pick deltas once
   `GtfsFeedVersions` has a few quarters of history; start permissive.
4. Duplicate `trip_id` or `service_id` in the incoming feed — detect in the parser and
   reject with a clear message rather than letting SQL Server abort the transaction with
   a PK violation.

**Soft warnings — apply, but flag on the admin surface:** routes added/removed, >N%
trip_id churn, stop_ids removed that are still referenced by active OTP exclusions or
detours, new route_ids absent from `RouteClassification`.

**Held state for a future-dated pick.** When check 1 rejects because
`feed_start_date > today`, mark the version `held` rather than `rejected` and log
"new pick <version> seen, effective YYYYMMDD, holding." No blob storage needed — the sync
re-fetches on its own schedule and will apply it naturally on the effective date once the
active-service check passes. Surface the countdown to staff.

### Phase 3 — Timing

Keep the daily 09:00 UTC full run, and add **hourly** invocations that short-circuit on
304 / unchanged hash. Cost is one conditional HTTP request per hour. Payoff: a pick that
publishes mid-day is picked up within the hour instead of up to 24 hours later, and the
held-pick auto-apply lands close to the start of the effective service day rather than
whenever the daily timer happens to fire.

Also add a **"Sync now"** admin action — on pick day, staff should not have to wait for a
timer.

### Phase 4 — Make it visible and reconcilable (Admin → Schedule Feed)

A new Admin panel is what turns 4x/year from "discovered via a broken report" into a
routine checklist:

- **Current feed:** version, `feed_start_date`–`feed_end_date`, applied_at, row counts.
- **Health:** last successful sync, last rejected sync + reason, held pick + effective
  date countdown.
- **Diff vs. previous applied version:** routes added/removed, stops added/removed, trip
  count delta.
- **Reconciliation worklist** (the F4 fix): new route_ids missing from
  `RouteClassification`; classified route_ids no longer in the feed; OTP stop exclusions
  and detours referencing removed stop_ids/route_ids. Each with a link to the module that
  fixes it.
- **Sync now** button.

### Phase 5 — Alerting

Route to the existing admin notification path. Trigger on:
- No successful sync in > 36 hours (catches F3).
- A sync rejected by the validation gate.
- Applied feed's `feed_end_date` within 14 days with no newer version seen — a pick is
  expiring and no replacement has been published (catches F2 *before* it bites).

### Phase 6 — Nice-to-haves, not blockers

- Replace the row-by-row `INSERT` loops with bulk table-valued inserts. Not urgent at
  MVTA's scale, but a feed carrying two overlapping picks roughly doubles the row count
  and lengthens the transaction.
- Stamp a `feed_content_hash` (or pick label) on OTP/missed-trip history rows so
  cross-pick comparisons can be flagged as spanning a service change (F5).

## 4. Recommended order

1. **Phase 2 check #1 alone**, hard-coded against the existing parse output — no new
   tables, no schema change. This removes the F1 blast radius in a single small change and
   is the right thing to ship first.
2. Phase 1 (version tracking + conditional GET) — prerequisite for everything below.
3. Phase 5 alerting — cheap once `GtfsSyncRuns` exists, and closes the silent-failure hole.
4. Phase 3 hourly + Sync now.
5. Phase 2 remainder (delta thresholds, soft warnings, held state).
6. Phase 4 admin panel + reconciliation worklist.
7. Phase 6.

## 5. Open question worth answering with data

Does the Avail-hosted `google_transit.zip` carry **both** picks across a service change, or
only one? Pull the current zip, read `calendar.txt`, and check whether `end_date` extends
past the next scheduled pick date.

- **Both picks** → the date-gated `activeServiceIdsToday` already does the right thing;
  the validation gate is a safety net and F1 is largely theoretical.
- **One pick only** → F1 is a live, recurring, four-times-a-year outage of missed-trip
  detection, and Phase 2 check #1 plus the held state are mandatory before the next pick.

This changes only urgency, not the design — every phase above is correct either way.
