# Missed-Trip Detection — Logic Gaps & False-Positive Investigation

Scope: the real-time GTFS-based detector only (`functions-restapi/src/functions/gtfsMissedTripsPoll.ts`,
timer every 5 min). Not the Avail360 vendor-feed system (`availMissedTripsPoll.ts`) — that's a
separate, unrelated ingestion path for contractual reporting.

For the prioritized feature-completion plan spanning GTFS, Avail, Spare, API, and UI/UX, see
`plans/missed-trip-feature-finish-plan.md`.

**Status (reassessed 2026-08-07): do not treat the current GTFS-derived rows as reliable evidence
of actual missed trips yet.** The midnight-boundary and 15-vs-30-minute fixes are written, but a
more fundamental agency-local-vs-UTC error remains, and `first_observed_at` measures when a trip
first appeared in a prediction feed, not when it actually started. See "Feed/clock reassessment"
at the bottom. The Avail Missed Trips feed is a promising retrospective compliance source, but a
direct sample now shows unresolved filter/field semantics and a broken time parser; it is not yet
safe to treat as authoritative. A reworked multi-signal detector is needed for live operational
candidates.

**Implementation update:** the detector is now contained and rebuilt behind safety gates in the
current worktree. Silent no-shows default paused; agency-local schedule conversion, raw feed
evidence, positive VehiclePosition underway evidence, feed health, detector versioning, legacy-row
exclusion, and review audit history are implemented in migrations 026–028 and the associated
pollers/API/UI. Existing legacy rows remain unverified by design. See the finish plan's
implementation-status section for deployment order.

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

## Real-data findings (2026-08-07) — false-positive hypothesis rejected; deploy gap found instead

User exported the live `GET /missed-trips` response (~1,500 rows spanning 2026-07-28 through
2026-08-07, active + resolved) and pasted it in for analysis. Two findings:

### 1. The fix above has not actually reached production

Every row in the export — including rows from today, `last_checked_at` as late as 17:25 UTC on
2026-08-07 — shows a **15-minute** gap between `scheduled_departure_at` and `grace_deadline_at`
(e.g. `t52C-b2E-sl2B-v62`: sched 13:24 → grace 13:39; `t519-bF-sl2B-v62`: sched 13:05 → grace
13:20). If `GRACE_MINUTES = 30` were live, every gap would be 30 minutes. It isn't, anywhere in
the sample. (Correction: an earlier draft of this note misattributed the fix to commit `a3f4295`
— that's the unrelated "Route 420 · 420" label fix from 2026-08-07. The actual fix is commit
`baad35f`, "Fix missed-trip detection: 30-min grace, midnight boundary, late-arrival resolve",
committed 2026-08-06 15:51 local / 20:51 UTC. See the deploy-pipeline finding below — verified
2026-08-07 against GitHub Actions run history and confirmed this really is a stuck deploy, not a
misattribution.)

### 1a. Deploy-pipeline root cause, confirmed via `gh run list` + `gh run view` (2026-08-07)

- `baad35f` sits on `main` (`git branch --contains` and `git log --oneline main` both confirm),
  between `78a383d` and `ffa3c2c`.
- The push that should have shipped it triggered `api.yml` run `31124674775` — but that run has
  sat in GitHub Actions' `queued` state for 24+ hours and never executed. Its `headSha` is
  `ffa3c2c3...`, one commit past `baad35f`, so it would have carried the fix if it had ever run.
- Someone (or something) then triggered three manual `workflow_dispatch` runs on 2026-08-07 at
  05:31, 05:55, and 06:00 UTC — all three completed successfully, and all three also built
  `headSha` `ffa3c2c3...`, i.e. they deployed code that includes `baad35f`'s fix.
- **The discrepancy**: the pasted data export has rows scheduled as late as 13:24 UTC on
  2026-08-07 — more than 7 hours after that 06:00 UTC "successful" deploy — still showing the old
  15-minute grace window. A deploy the pipeline reports as successful, containing the fix,
  followed hours later by behavior consistent with the *unfixed* code. That's not "deploy hasn't
  happened yet," which was the original theory; it's "the deploy pipeline says it shipped, but the
  running Function App doesn't reflect it." Candidates: a second/stale Function App slot, a worker
  process that didn't recycle after the zip deploy, or the deploy landing in a location other than
  where the timer trigger actually runs. Kudu deployment-log and running-file-content checks were
  attempted to pin this down further but were blocked by this session's tool-use policy (raw
  publishing-credential curl calls); **someone with portal/CLI access outside this restriction
  should check `func-mvta-restapi-dev`'s actual running `dist/functions/gtfsMissedTripsPoll.js` for
  the `GRACE_MINUTES` value directly, and check whether the app needs a manual restart to pick up
  code that a zip deploy already placed on disk.**

### 2. Hypothesis #1 (RT feed latency racing the grace window) is not supported by the data

Looked for `resolved` rows where `detected_late_arrival_at` landed 5-10 minutes after
`first_seen_watching_at`/`grace_deadline_at` (one or two poll cycles) — the signature that would
indicate a real trip getting falsely flagged and then quickly self-resolving. Found none. Every
resolved row sampled shows the vehicle first observed **60-120+ minutes** after its scheduled
time:

```
t52C-b2E-sl2B-v62   scheduled 13:24 → resolved 14:40   (76 min late)
t516-b2A-sl2B-v62   scheduled 13:02 → resolved 15:00   (118 min late)
t4EA-b36-sl2B-v62   scheduled 12:58 → resolved 15:00   (122 min late)
```

A 5-minute poll cadence doesn't produce 2-hour lag on its own — these read as genuinely late
vehicles that eventually started running and were picked up by `gtfsDelaysPoll.ts` once they
appeared in the RT feed, not false flags. The false-positive hypothesis this investigation set out
to confirm does not hold up against real data; deprioritize it pending contrary evidence.

### The actual live-system problem this exposes

Because the deployed code still runs the *old* `resolveLateArrivals` logic (any arrival at all,
however late, → `status='resolved'`), and finding #2 shows arrivals routinely land 60-120+ minutes
late, the live system is marking trips **resolved that are missed trips by the ops definition**
("any trip that starts more than 30 minutes after its scheduled time"). This is the **opposite**
of the false-positive problem this doc was investigating: it's undercounting genuine missed trips,
which is worse for compliance reporting than over-flagging would be. It should resolve itself once
the already-written fix (`resolveLateArrivals` two-statement version, section above) actually
deploys — but that deploy needs to be confirmed, not assumed, given finding #1.

## Feed/clock reassessment (2026-08-07) — earlier live-data conclusion is not supportable

The earlier interpretation above — that a row whose stored timestamps differ by 60–120 minutes
represents a vehicle that really started 60–120 minutes late — assumes two things the code and
feeds do not establish:

1. `scheduled_departure_at` is a real UTC instant.
2. `GtfsObservedTrips.first_observed_at` is the trip's actual start time.

Both assumptions are false in the current implementation.

### 1. Static GTFS schedule times are agency-local, but this detector treats them as UTC

`first_departure_seconds` comes from GTFS `stop_times.txt`. It is seconds on the agency's local
service-day clock (MVTA: `America/Chicago`), not seconds after UTC midnight. The detector compares
it with `now.getUTCHours()` and constructs display/comparison timestamps with `Date.UTC(...)` plus
`setUTCSeconds(...)`.

During daylight time this moves the effective threshold five hours early. For example, a static
GTFS start time of 13:24 means 13:24 Central (18:24 UTC), but the detector stores and evaluates it
as 13:24 UTC. At 13:54 UTC — only 08:54 Central and still 4.5 hours before the scheduled trip —
the detector can already call it a 30-minute no-show.

This also changes how the pasted samples must be read. A stored `scheduled_departure_at` of 13:24
and `first_observed_at` of 14:40 does **not** prove a 76-minute-late start. If 13:24 is the original
GTFS wall time, the real scheduled instant that August day was 18:24 UTC; a 14:40 UTC feed
observation was 3 hours 44 minutes *before* the scheduled start. That is consistent with a
prediction feed publishing a future trip, not a vehicle departing late.

The previous midnight fix corrected the `>24:00:00` scale mismatch but did not correct the time
zone. The correct calculation must anchor each service date in `America/Chicago`, then add the
uncapped GTFS seconds. This must use a real time-zone conversion so CST/CDT and DST transition
days are handled correctly; a hardcoded five- or six-hour offset is not sufficient.

### 2. "Observed in TripUpdate" does not mean "started service"

`GtfsObservedTrips` is written by `gtfsDelaysPoll.ts` at ingestion time (`SYSUTCDATETIME()`). The
row is written only after `mapTripUpdateEntity()` finds at least one StopTimeUpdate with a delay,
but none of those checks establish that the vehicle has departed the first stop. GTFS-RT
TripUpdates are predictions and may legitimately contain future scheduled trips before they
begin. Their entity `Timestamp` is the update time, not an actual-departure timestamp.

Consequences:

- A future trip can be marked "observed" hours before its scheduled start.
- A present TripUpdate with no usable StopTimeUpdate/delay is ignored and looks unobserved.
- `first_observed_at - scheduled_departure_at` is neither a measured start delay nor a valid OTP
  observation.
- The two-statement `resolveLateArrivals` fix still compares the wrong quantities. Correcting the
  threshold to 30 minutes is necessary, but insufficient.

### Feeds currently available and what each can actually prove

| Feed | Useful signal | Cannot safely prove | Recommended role |
|---|---|---|---|
| Static GTFS (`GTFS_STATIC_URL`) | What trips/stops/times are scheduled; service calendar | Whether a trip operated | Expected-service baseline, converted from agency-local time correctly |
| GTFS-RT TripUpdate (`GTFS_RT_TRIPUPDATE_URL`) | Explicit `CANCELED`; assignment/predictions; progress through stop sequence | Actual start merely from entity presence or entity timestamp | Cancellation signal and one input to live start/progress evidence |
| GTFS-RT VehiclePosition (`GTFS_RT_VEHICLE_URL`) | Vehicle tied to `trip_id`, GPS, current stop sequence/status, source timestamp | Definitive start if only a pre-trip/layover position is seen | Stronger live evidence when stop-sequence/status or movement shows the trip is underway |
| Avail AVL Reports (`AVAIL_AVL_REPORTS_URL`) | Vehicle movement plus Avail route/block/run/trip IDs | Direct join to GTFS `trip_id` with the current schema | Corroboration after a GTFS-to-Avail run/block/trip crosswalk exists |
| Avail Pullout (`AVAIL_PULLOUT_URL`) | Garage check-in/login/pullout scheduled vs actual; operational risk | Passenger-service trip start; currently also blocked by unconfirmed endpoint/spec | Early warning/supporting reason only, not the final missed-trip decision |
| Avail Missed Trips By Route/Stop/Day (`AVAIL_MISSED_TRIPS_URL`) | Vendor's incident-level missed-departure/arrival/entire-trip result | Five-minute live detection; guaranteed GTFS `trip_id`; complete start time on every row | Candidate retrospective compliance feed; validate semantics, then use for nightly reconciliation |

The proprietary Avail feeds and MVTA's GTFS-RT may ultimately be generated from the same Avail
platform, so they should not automatically be described as statistically independent sources.
They are still distinct products with different grains and failure modes.

## Recommended alternative: live candidates plus retrospective reconciliation

Do not make one feed serve both the operational and compliance use cases.

### A. Live operational candidate detector

Keep static GTFS as the expected-trip baseline and explicit GTFS-RT `CANCELED` as an immediate
flag. Replace `GtfsObservedTrips`' binary "ever appeared in TripUpdate" test with a per-trip
evidence model:

- Store raw first/last observations from **both** TripUpdate and VehiclePosition independently of
  the delay mapper. Do not discard VehiclePositions just because `MonitoredTripDelays` has no row.
- Store source/entity timestamps, vehicle ID, current stop sequence/status, and the earliest
  evidence that the trip progressed beyond its first stop.
- Extend the static ingest to retain the first stop ID/sequence (and preferably `block_id`) so a
  VehiclePosition or TripUpdate can be evaluated against the actual beginning of the trip.
- Define `actual_start_at` from positive underway evidence — for example, progression past the
  first stop, or a position/status transition consistent with departure — not feed presence.
- At scheduled start + 30 minutes, classify:
  - explicit canceled → missed candidate;
  - positive underway evidence at/before deadline → operated within window;
  - first positive underway evidence after deadline → missed/started late;
  - no positive evidence, but feeds healthy → silent no-show candidate;
  - feeds stale/unhealthy → unknown/data outage, **not** a missed trip.

This last state is important: absence is only evidence when the observation systems were healthy
throughout the decision window. Feed-level freshness/coverage should therefore be persisted per
poll and included in every decision.

Avail AVL can strengthen this live path once a reliable crosswalk is built. The likely join is
service date + route + scheduled start + `block_id`/run/trip, not vehicle number alone. Until that
crosswalk is verified against real records, AVL should remain corroborating evidence rather than
silently resolving a GTFS trip.

### B. Retrospective compliance truth

Evaluate `MissedTripsByRouteStopDay` as the primary retrospective classification, since it is
designed to report missed departures/arrivals/trips and is now confirmed to return live MVTA data.
Do not promote it to contractual source of truth until the filter and flag contradictions in the
direct sample below are resolved. Once validated, poll it daily for a short trailing window, then
reconcile its incidents to live candidates using route, service date, departure start time when
present, and terminal stops. Because the feed has no guaranteed unique key and
`DepartureTripStartTime` can be null, store an explicit match quality (`exact`, `probable`,
`unmatched`) and preserve manual validation rather than forcing a join.

This yields two honest outputs:

- **Operational candidates:** fast, explainable, and allowed to be pending/unknown.
- **Compliance incidents:** vendor-reported and reconciled after the fact, with an audit trail.

### Immediate priority order

1. Stop treating the existing `scheduled_departure_at`/`first_observed_at` delta as lateness.
2. Correct service-day and timestamp construction to `America/Chicago` before evaluating another
   export or deploying the 30-minute resolution comparison.
3. Capture raw TripUpdate and VehiclePosition observations independently of the delay UI mapper.
4. Measure Avail Missed Trips publication lag by comparing `CalendarDate`/start time with first
   ingestion time; if it is acceptably short, consider a more frequent current-day poll in
   addition to the existing daily three-month compliance backfill.
5. Build and validate a GTFS-to-Avail crosswalk before using AVL/Pullout to resolve individual
   GTFS trips.

## Direct Avail feed sample (2026-08-07) — useful, but not yet authoritative

Analyzed the successful response for:

```text
MissedTripsByRouteStopDay/v1/MVTA/
2026-07-29 00:00:00/2026-07-29 23:59:59/true/false
```

The response metadata confirms property `MVTA`, the requested one-day window, and refresh time
`2026-08-07T20:20:49.243`. It contains 171 rows for 2026-07-29 across 15 RouteIDs.

### What the response actually contains

| Flag combination (`Departure`, `Arrival`, `Entire`) | Rows | Start time present? |
|---|---:|---|
| `0, 1, 0` | 91 | Yes, all 91 (`HH:mm`) |
| `1, 0, 1` | 20 | No, all null |
| `1, 1, 1` | 60 | No, all null |

In this sample, `EntireTripMissed` is identical to `DepartureMissed` on every row; it does not act
like an independent "both ends missed" flag. A vendor definition/data-dictionary check is needed
before deriving business rules from these three columns.

### The requested filters do not match the returned rows

- The path requested `Full Trip Only=true`, yet 91/171 rows have
  `EntireTripMissed=0` and only `ArrivalMissed=1`.
- The path requested `Include Deadheads=false`, yet 32/171 rows are RouteID `999`, explicitly
  labeled `Deadhead` in both route-description fields.

Possible explanations include boolean-vs-numeric path values (`true/false` vs `1/0`), misleading
parameter names, inverted vendor semantics, or ignored filters. The app currently sends `/0/0`,
so a controlled four-call matrix (`0/0`, `0/1`, `1/0`, `1/1`) against the same date is the fastest
way to determine the real behavior. Compare total rows, RouteID 999 rows, and all three flag
combinations. Do not assume the current comments describing the two parameters are correct until
that matrix is run.

### The current parser discards every populated start time

The response sends `DepartureTripStartTime` as a time-only string such as `"14:31"`, not a full
ISO datetime. All 91 non-null values match `HH:mm`. `availMissedTripsFeed.ts` currently evaluates
`new Date(value)`; in Node, `new Date("14:31")` is invalid, so `parseNullableDate()` returns null.
As a result, the current ingestion loses every usable start time from this sample.

The parser must combine `CalendarDate` + `DepartureTripStartTime` in `America/Chicago` (or store
the raw `HH:mm`/minutes-since-midnight separately). It must not append `Z` or treat the time as UTC.

### Duplicate rows appear to carry multiplicity, not accidental duplication

There are 171 rows but only 127 distinct rows under every available field — 44 repeated copies
beyond the first. All 91 rows with a start time are distinct; the repeats are concentrated among
the 80 null-time departure/entire-trip misses, which collapse to only 36 distinct field
combinations. One route/stop/direction combination appears 12 times with every exposed field
identical.

Because the feed exposes no incident ID and omits start time precisely on these rows, those copies
may represent multiple separately scheduled misses that cannot be distinguished in the response.
The existing delete-and-reinsert ingestion correctly preserves multiplicity. A dedupe/upsert on
the visible fields would undercount unless Avail confirms the duplicates are erroneous.

### Revised role for this feed

This feed is valuable for daily aggregate counts and retrospective route/terminal patterns, but
the sample cannot reliably identify every individual scheduled trip:

- 80/171 rows have no start time;
- no GTFS `trip_id`, block, run, vehicle, or incident ID is present;
- filter behavior contradicts the request;
- the flag meanings are not self-consistent under the assumed definitions.

Use it for vendor reconciliation and aggregate compliance only after the filter/field semantics
are confirmed. It cannot replace the GTFS/vehicle-evidence path for individual live candidates,
and many null-time rows will remain `unmatched` by design.
