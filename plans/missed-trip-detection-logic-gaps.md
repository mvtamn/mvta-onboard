# Missed-Trip Detection — Logic Gaps & False-Positive Investigation

Scope: the real-time GTFS-based detector only (`functions-restapi/src/functions/gtfsMissedTripsPoll.ts`,
timer every 5 min). Not the Avail360 vendor-feed system (`availMissedTripsPoll.ts`) — that's a
separate, unrelated ingestion path for contractual reporting.

**Status (2026-08-06): the midnight-boundary bug and the 15-vs-30-minute/late-arrival-resolve gaps
below are now fixed** in `gtfsMissedTripsPoll.ts` — see "Implemented fixes" at the bottom. The
false-positive hypothesis section is still open and unconfirmed; that part still needs the
suggested next step (sampling `resolved` rows) run against real data.

## How detection currently works

Two independent signals write into `MonitoredMissedTrips`:

1. **Explicit cancellation** (`flagCanceled`, lines 71-92) — GTFS-RT TripUpdate feed carries
   `schedule_relationship = CANCELED`. No grace period; inserted immediately as
   `detection_type='explicit_cancellation'`.
2. **Silent no-show** (`detectSilentNoShows`, lines 134-202) — a trip in `GtfsScheduledTrips`
   (parsed from static `stop_times.txt`) whose `first_departure_seconds` is ≥15 min in the past,
   that has never appeared in `GtfsObservedTrips` (written independently by `gtfsDelaysPoll.ts`
   whenever it sees the trip_id in the realtime feed) and isn't already tracked, is flagged as
   `detection_type='silent_no_show'`.

A tracked row auto-flips to `status='resolved'` (`resolveLateArrivals`, lines 204-217) the moment
`GtfsObservedTrips` shows the trip did eventually appear — i.e., "arrived late" rather than
"never ran."

## Confirmed bug: midnight/past-24:00 boundary makes late trips unreachable

```ts
// gtfsMissedTripsPoll.ts:146-154
const secondsSinceMidnightUtc = now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds();
...
cutoff_seconds = secondsSinceMidnightUtc - graceSeconds   // GRACE_MINUTES = 15
...
WHERE st.first_departure_seconds <= @cutoff_seconds
```

`secondsSinceMidnightUtc` is always in `[0, 86399]`. The condition can only be true when
`first_departure_seconds <= ~85499` (≈23:44:59). Consequences:

- Any trip scheduled between ~23:45 and midnight is never checked that service day.
- Any trip using standard GTFS past-midnight notation (`25:10:00` = 90600s — the normal way a
  late-night trip stays attached to the *previous* day's `service_id`, see
  `gtfsStatic.ts:140-151`) has `first_departure_seconds > 86400` and can **never** satisfy the
  cutoff, ever, on any poll run.
- `detectSilentNoShows` only queries "today's" `service_id`/`service_date`
  (`activeServiceIdsToday`, lines 114-132) — once the calendar date rolls over there is no
  retroactive pass, so these trips silently fall out of scope permanently. Never flagged, never
  resolved, no record either way.

**Fix shape:** compare in "seconds since the start of the *service* day" using the trip's own
GTFS time scale (which legitimately exceeds 86400), not wall-clock-seconds-since-midnight capped
at 86400. Likely needs either (a) extending the live cutoff calc to allow values >86400 for a few
hours after local midnight, or (b) a rollover pass that re-checks yesterday's still-unflagged
late trips before purging them from scope.

## Working hypothesis: current iteration is surfacing false positives

Not yet root-caused — flagged here for the next investigation pass. Candidate mechanisms, roughly
in order of suspicion:

1. **RT feed fetch latency/gaps vs. the 15-min grace window.** `GtfsObservedTrips` is only
   populated when `gtfsDelaysPoll.ts` successfully fetches and parses the realtime feed and sees
   the trip_id. If that poll has a transient failure, a delayed vendor publish, or simply hasn't
   picked up a just-started trip yet, a real trip can look unobserved right up until grace expires
   — producing an escalated row that `resolveLateArrivals` then flips to `resolved` minutes later.
   From a staff perspective this reads as "false positive that fixes itself," which matches what
   you're seeing. Worth checking: how often does `flagCanceled`/`detectSilentNoShows` escalate a
   trip_id that resolves within one or two poll cycles afterward? A high rate there would confirm
   this path rather than a genuine no-show.
2. **Static schedule staleness vs. RT trip_id.** `GtfsScheduledTrips` is only as fresh as the last
   static-feed ingest. A schedule change (reroute, trip added/removed/re-IDed) that hasn't been
   re-ingested yet would leave stale rows in `GtfsScheduledTrips` that no longer correspond to
   anything the RT feed will ever emit under that trip_id — guaranteed false "missed" flags until
   the next static ingest catches up.
3. **UTC-vs-local day-of-week / calendar boundary** (`dowColumn`, `serviceDateToday`, lines
   94-106) — already flagged in the code's own comment as a "known simplification." Near local
   midnight this could compute the wrong `service_id` set for a few minutes, either producing
   trips that shouldn't be in scope or dropping ones that should be — compounds with the boundary
   bug above rather than being fully independent of it.
4. **Special-event / detour routes using different trip_ids than the static feed expects.**
   Neither detector cross-references `RouteClassification` (migration 016) — a route running a
   substitute/special-event trip_id that was never in the ingested `GtfsScheduledTrips` wouldn't
   trigger this, but the reverse (a classified special-event trip still present in
   `GtfsScheduledTrips` from the base schedule, but legitimately not run today) could.
5. **No dedupe/backoff on repeated escalation** — worth confirming whether a trip that resolves
   and then, for whatever reason, "disappears" from `GtfsObservedTrips` context again isn't
   re-flagged and double-counted (schema has a PK check in `alreadyTracked`, so this is lower
   suspicion, but worth a sanity check against real data).

## Business definition (from ops) — not yet reconciled with code

> A missed trip is a scheduled public transportation run — a specific bus, on a specific
> route/trip — that does not operate, or fails to provide service. **Any trip that starts more
> than 30 minutes after its scheduled time is considered a missed trip.**

This is the definition the detection logic should be measured against. Two divergences from what
the code currently does:

1. **Grace threshold is 15 minutes, not 30.** `GRACE_MINUTES = 15` (`gtfsMissedTripsPoll.ts:25`)
   drives both the silent-no-show cutoff and the cancellation grace-deadline display. Per the
   business definition this should be **30**. This affects the boundary-bug fix above too — the
   cutoff math changes accordingly (`85499` becomes `84599` if grace stays wall-clock-relative,
   though the boundary bug needs fixing regardless of which grace value is used).
2. **Bigger gap: "started late" is not currently evaluated at resolution time — only "started at
   all."** `resolveLateArrivals` (lines 204-217) flips ANY tracked row to `status='resolved'` the
   instant the trip_id shows up anywhere in `GtfsObservedTrips`, with no check on *how* late that
   first observation was:

   ```sql
   UPDATE mmt
   SET status = 'resolved', detected_late_arrival_at = ot.first_observed_at, ...
   FROM MonitoredMissedTrips mmt
   INNER JOIN GtfsObservedTrips ot
     ON ot.trip_id = mmt.trip_id AND ot.service_date = mmt.service_date
   WHERE mmt.status IN ('watching', 'escalated')
   ```

   Under the stated business definition, a trip that finally starts 45 or 90 minutes late is
   **still a missed trip** (it exceeded the 30-minute threshold), not a resolved non-event. As
   written, the code treats "showed up at all, however late" as fully resolved — which
   undercounts real missed trips whenever a trip is very late rather than a total no-show. This
   is a second, independent source of false negatives (not just the false positives discussed
   above) and is likely the bigger compliance-reporting gap of the two, since it silently
   reclassifies genuinely-missed (by definition) trips as fine.

   Fix shape: `resolveLateArrivals` needs to compare `ot.first_observed_at` against
   `mmt.scheduled_departure_at` and only resolve when the gap is **≤30 minutes**; anything beyond
   that should stay flagged (perhaps as a distinct `detection_type` or a note that it ran, just
   outside the compliance window) rather than being marked resolved.

## Suggested next step

Pull a sample of recently `resolved` rows from `MonitoredMissedTrips` and check the gap between
`scheduled_departure_at`/`grace_deadline_at` and `detected_late_arrival_at`. A cluster of
resolutions landing just 1-2 poll cycles (5-10 min) after escalation would strongly support
hypothesis #1 (feed latency racing the grace window) as the dominant false-positive source, over
a genuine dispatch-side no-show that happened to run late. Still open as of this fix — the
false-positive hypotheses above weren't addressed by the changes below and need real-data
follow-up.

## Implemented fixes (2026-08-06)

Both confirmed logic gaps above are now fixed in `gtfsMissedTripsPoll.ts`:

1. **Grace threshold is now 30 minutes** (`GRACE_MINUTES = 30`), matching the ops definition,
   used consistently for both the silent-no-show cutoff and the late-arrival resolve check below.
2. **Midnight/past-24:00 boundary bug fixed.** `detectSilentNoShows` now takes a `dayOffset`
   parameter (`0` = today, `-1` = yesterday) and the timer handler runs both every poll. Elapsed
   time is computed as `secondsSinceMidnightUtc - dayOffset * 86400`, which is uncapped — it can
   exceed 86400 for the `-1` pass, matching the scale `first_departure_seconds` is stored on. This
   closes both failure modes: an ordinary trip scheduled just before midnight (grace deadline
   crosses into the next calendar day) and a trip using GTFS's `>24:00:00` past-midnight
   convention (`first_departure_seconds` itself exceeds 86400). No separate rollover job needed —
   the `NOT EXISTS` filters already make a repeat check a no-op once a trip is observed or
   tracked, so re-checking "yesterday" every 5 minutes is cheap.
3. **`resolveLateArrivals` now checks how late, not just whether it showed up.** It's two `UPDATE`
   statements instead of one: arrivals within `GRACE_SECONDS` of `scheduled_departure_at` resolve
   normally (`status='resolved'`); arrivals beyond that stay flagged (status untouched — still
   `escalated`/`watching`) but get `detected_late_arrival_at` recorded anyway, so staff reviewing
   the queue can see the vehicle did eventually run, just too late to count per the 30-minute
   definition. This was the bigger of the two fixes — the old behavior silently reclassified any
   very-late trip as a non-event.

Verification: `npx tsc --noEmit` and `npm run build` both pass clean in `functions-restapi`. No
existing unit tests cover this file (it's a timer function against a live DB/feed, consistent
with the other pollers in this codebase — no test harness exists for any of them). Not verified
against a live database or live GTFS-RT feed; that would need a deploy or a local SQL Server
instance with migration 011/023 applied and seeded `GtfsScheduledTrips`/`GtfsCalendar` data,
neither of which exists in this dev environment.
