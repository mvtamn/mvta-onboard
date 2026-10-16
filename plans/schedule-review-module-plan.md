# Schedule Review Module Plan

Status: increments 1–3 built 2026-10-16 (v1.5.324–327, ADR 0040);
increment 0 (SQL handed over), 4 and 5 open. Written 2026-10-15 against main `7129c8e2` (v1.5.323) and the live MVTA feed (`feed_version` 20260909, valid to
2026-11-01).

Goal: grow the one-table schedule check shipped in v1.5.319
([lib/gtfsPredictionRisk.ts](../functions-restapi/src/lib/gtfsPredictionRisk.ts),
PR #405) into a module that explains *why* a route is flagged, shows the
specific stops, segments, blocks and hours behind each flag, pairs the
schedule with what Avail observed, and says who can fix what.

---

## 0. What exists today

| Piece | Where | What it does |
|---|---|---|
| Review | `lib/gtfsPredictionRisk.ts` | Pure: four CSVs in, per-route table out. Seven checks, each a single number per route and a flag against a fixed threshold. |
| Storage | `GtfsPredictionRiskReviews` (migration 143) | One JSON row per daily static sync, whether or not the feed changed. ~10 KB a day. |
| API | `GET /gtfs-prediction-risk` | Latest row, check definitions read from code. Any OnBoard role. |
| Console | `SchedulePredictionRisk.tsx` on Integrations & Data Health | Route × check table, flagged cells highlighted, legend of thresholds. |

What it cannot do: say *which* stop pairs are placeholders, *which* timepoint
pair is the 45-minute gap, *which* route a bus comes off, how the scheduled
running time changes across the day, how any of this lines up with the OTP
Avail measured, or what changed between two feed versions. The review walks
every hop and every block pair to compute its tallies and then throws that
evidence away.

---

## 1. Are drill-downs possible? Yes, cheaply

The feed is small. Measured on the live 20260909 feed:

| File | Rows |
|---|---|
| routes | 19 |
| trips | 1,991 |
| stops | 624 (94 are timepoints) |
| stop_times | 49,233 (all carry `shape_dist_traveled`) |
| blocks (service × block_id) | 451 (158 serve two routes, 15 serve three) |
| service ids | 4 |

Every stop-, trip- and block-level fact for a route fits in a few tens of KB
of JSON. Nothing needs a new ingestion, a new feed, or a bigger database tier.
The work is to keep the evidence the review already computes, model the
schedule once (patterns, timepoint segments, blocks), and give each check a
list of evidence rows beside its number.

Three drill-down levels are available from data OnBoard already holds:

1. **Route → check → evidence.** The stop pairs that are placeholders and how
   many trips carry each; the timepoint pair behind the longest gap; the
   blocks that interline and from which route; the trips with a tight or
   negative layover. All from the static feed.
2. **Route → timepoint segment → hour of day.** Scheduled minutes between
   consecutive timepoints for every trip, grouped by start hour, laid against
   `OtpDailyRouteStopHour` (route × stop × hour × day, early/on-time/late
   counts). Avail's OTP route ids are the GTFS route ids (420, 425, …) and its
   86 OTP stops sit in the same id space as the feed's 94 timepoint stops
   (handoff 2026-09-22: "the identifier spaces are identical"). **One query on
   dev confirms the stop join before anything is built on it** (section 6).
3. **Feed version → feed version.** Migration 143 already keeps every review.
   Comparing the last review of each `feed_version` gives "flags gained and
   lost in the November feed".

---

## 2. What the probe found that the current checks miss

A throwaway script over the live feed (not committed) surfaced four kinds of
schedule problem the seven checks do not see. These are the enhancements worth
building; each becomes a check with evidence and a suggested owner.

### 2a. Time-of-day-blind running times (the big one)

Nine of nineteen routes schedule **exactly one running time for every trip on
a pattern, from 5am to 7pm**: 420 is 40 minutes at every hour, Orange LINK
59, 442 25, and 440, 446, 447, 497, 499 and most of 436 likewise. Only the
express routes vary (490: 67–84 minutes; 470: 52–58).

The current `run_time_spread` check treats zero spread as *good* (no flag).
For a local route crossing arterials at 7:30 and at 13:00 it is the opposite:
the schedule denies that traffic exists, so peak trips run late and midday
trips run early, and a prediction that starts from the schedule inherits that
error every day. This is the one place the schedule can be improved by MVTA's
own scheduler without any vendor involvement.

Check: *Running time varies by hour* — flagged when a pattern with trips in
both peak and off-peak hours has the same running time in all of them.
Evidence: the pattern, its trips per hour, the one running time. Paired with
observed OTP by hour (section 4) it becomes a recommendation with numbers.

### 2b. Timepoint density

Local routes hold 4–10 timepoints over 50–90 stops: 420 has **4 timepoints
for 69 stops** (one per 17 stops), 440 6 for 55, 442 7 for 50. Between
timepoints the engine interpolates over placeholder times (2a and the
existing placeholder check compound here). Check: *Stops per timepoint* and
*longest run of stops with no timepoint*, with the run itself as evidence.

### 2c. Distance and implied speed per timepoint segment

`shape_dist_traveled` is populated on every stop_time, **in feet** (median
ratio to straight-line distance is 3.68; 3.28 would be a straight road). The
existing `longest_hop` uses straight-line distance and undercounts the stop-free
run: 490's longest hop is 14.9 miles as the crow flies but **22.1 miles along
the route**; 480's is 14.0 vs 20.3. Dividing shape distance by scheduled
minutes gives an implied speed per segment: 5–9 mph downtown on 460, 470, 477,
480, 490 (eight segments on 477 alone), 8–9 mph on two Orange LINK station
hops. Some of that is real downtown running; some is padding the engine will
read as "early". Check: *Implied speed* flagged under 8 or over 55 mph, with the
segment and its minutes as evidence. Distance must be **calibrated**, never
assumed: GTFS leaves the unit unspecified, so the module derives feet/metres
from the ratio to straight-line distance each import, or walks `shapes.txt`.

### 2d. Layover distribution and interlining partners

`tight_turnarounds` is one percentage at a three-minute line. The distribution
says more: before a trip, 442 has a **median layover of 3 minutes** (max 13),
447 1 minute, 497 2 minutes, 445 3 minutes, while 460/470/477/490 sit at
45–72. And interlining is pairwise, not a percentage: 440↔442 hand a bus over
97 times a day, 497↔499 81 times, 420↔Orange LINK 69. A late 440 *is* a late
442. Check: *Recovery time* (median layover below N minutes) with the layover
histogram as evidence; interlining shown as partners with counts, so the
reader sees where lateness is inherited from.

### 2e. Smaller things the data also offers

- Headway regularity: a lone 57- or 64-minute gap on a clock-face route
  (Orange LINK, 436, 440) is a typo candidate. Low value; list as evidence,
  do not flag.
- Timed holds: `arrival_time ≠ departure_time` on 12–64 stop_times per route
  (transit stations). Useful context in the segment view, not a check.
- Service ids: four, one of them (`28-v63`) a single-day leftover. Belongs in
  the feed header, not a check.

---

## 3. Who fixes what

A check is only useful if the reader knows whose problem it is. Each check
definition gains an `owner` and a `fix` sentence shown with its evidence:

| Finding | Owner | Fix |
|---|---|---|
| Placeholder stop times | Avail (schedule export) | Export interpolated stop times instead of +1 s increments; or MVTA adds timepoints so the interpolation span shrinks. |
| Flat running time, low timepoint density, implied speed | MVTA scheduling | Peak/off-peak running times on the pattern; add timepoints on long local runs; correct padded or starved segments. |
| Tight recovery, interlining | MVTA scheduling / operations | Recovery at the terminal where the lateness lands; break or keep an interline knowingly. |
| Long timepoint gap, stop-free miles | Structural (express routes) | Not a schedule error. Mitigation is on the prediction side (GPS-based progress, not schedule-based); the module should say so rather than flag it as fixable. |

This is the "solutions" half of the request: the page stops being a list of
numbers and becomes a worklist with a named next step per route.

---

## 4. Pairing the schedule with what Avail observed

`OtpDailyRouteStopHour` has, for every service day since the poll was fixed
(PR #389, 2026-10-04), the early/on-time/late departure counts per route, stop
and hour. Joining each timepoint segment's scheduled minutes by hour to the
downstream timepoint's early/late share by hour yields the statement the
scheduler actually needs:

> Route 420, 157th St Station → Apple Valley TS: scheduled 10 minutes at every
> hour. 15h–18h: 38% of departures late at AVTS. 10h–14h: 11% early. The
> schedule under-runs the peak and over-runs midday.

Limits to state on the page, not hide: Avail OTP is departure-based at
timepoints under the OtpSettings early/late tolerances; it measures the bus,
not the prediction; a late share can be traffic, operator, or schedule. The
module presents it as *evidence for* a schedule change, never as the change.
Read-only over the OTP tables; it changes no figure and touches no
`lib/otpMonth` rule (ADR 0033/0034 boundary holds).

Live `MonitoredTripDelays` is cleared at the freshness limit and keeps no
history, so it is not a source here. Retaining a per-trip daily delay summary
is a separate, later decision.

---

## 5. Module shape

Deepen rather than widen: one module owns the schedule model, the checks and
their evidence, and the join to observed OTP. Callers get a report; nobody
re-derives a rule.

```
functions-restapi/src/lib/scheduleReview/
  index.ts          reviewSchedule(feed): ScheduleReview   (summary + per-route detail)
  feedModel.ts      parse once: stops, trips, stopTimes, blocks, patterns, timepoint segments
  distance.ts       shape_dist_traveled with unit calibration; haversine fallback
  checks/           one file per check: definition (label, unit, threshold, why, owner, fix)
                    + evaluate(routeModel) → { value, flagged, evidence[] }
  observed.ts       pure join of timepoint segments × OtpDailyRouteStopHour rows by hour
  diff.ts           compare two reviews: flags gained/lost per route
  store.ts          save/load (today's gtfsPredictionRiskStore.ts, moved)
```

`gtfsPredictionRisk.ts` becomes a thin re-export so PR #405's callers and
tests keep working until they are moved. Adding a check is one file plus one
registration line; its evidence shape is declared with it.

### Storage

Keep `GtfsPredictionRiskReviews` as the summary row. Add a child table for
detail so a single route can be read without parsing the whole review:

```
GtfsScheduleReviewRoutes (review_id FK, route_id, detail_json)   -- migration 145 (built)
```

Write detail **only when the feed version or the summary changes**; otherwise
touch `reviewed_at` on the existing row. Today 143 writes an identical row
every day, which makes version-to-version history noisy. (*Number to confirm
against open PRs at build time: PR #408 claims 144.) Size: ~19 rows × 5–20 KB
per feed version. Measured on the live feed: about 30 KB per route, 52 KB at most.

### API

| Endpoint | Returns |
|---|---|
| `GET /gtfs-prediction-risk` (existing) | Summary; add `history`: one entry per feed version with flagged-route count. |
| `GET /gtfs-prediction-risk/routes/{route_id}` | Checks with evidence, timepoint segments with scheduled minutes by hour, interlining partners, layover histogram, owner/fix per flag; `observed` (OTP by hour for the last N service days) when the OTP tables have rows. |
| `GET /gtfs-prediction-risk/diff?from=&to=` | Two feed versions compared. |

Access: the summary stays any-role (schedule data only). The route detail
with observed OTP reads compliance data, so it requires
`compliance-review.view`, the same as `/otp-daily`.

### Console

Where it lives is the one design decision to make up front. Two defensible
answers:

- **A. Stay on Integrations & Data Health**, expand a route row in place
  (the `OtpStopChart` open-one-route pattern). Simple; but Health is about
  whether feeds answer, and a scheduler reading segment profiles is not a
  health reader.
- **B. Put the analysis where the route already is: Compliance › OTP › Route
  Summary.** Its per-route drill-down already shows OTP by timepoint, worst
  first. Recommended at first, and built that way, then **moved out before
  landing**: OTP is compliance and the schedule review is analysis (the user's
  call, 2026-10-16). Putting an analysis view inside the compliance module
  would have made a schedule flag read like a contract finding.
- **C. Its own page, `/schedule-review`, under Specialist Operations** beside
  OCC Tools. Health keeps the summary table and links each route to it. Every
  signed-in role sees it, matching the endpoint. **Built (v1.5.325).** The
  observed overlay (increment 3) goes on this page, under the run-time grid.

Views, in build order:

1. Route detail: flagged checks with their evidence lists (stop pairs with
   counts, the gap's timepoint pair, interline partners, tight trips).
2. Run-time profile: timepoint segments as rows, hours as columns, scheduled
   minutes in the cells, flat rows marked. Hand-rolled like `OtpStopChart`;
   no chart dependency.
3. Observed overlay: late/early share per cell from `OtpDailyRouteStopHour`,
   with the limits of section 4 stated under the grid.
4. Feed diff: "Since feed 20260909: 2 flags gained (442 recovery, 446 implied
   speed), 1 lost" on Health, with a link into the route.

---

## 6. Increments

Each is one PR, one changelog entry, tests first on the pure parts.

| # | Increment | Depends on | Size |
|---|---|---|---|
| 0 | **Confirm the stop join on dev** (one SQL, user runs it since public SQL access is denied): `SELECT COUNT(*) FROM OtpDailyRouteStopHour o JOIN GtfsStops s ON s.stop_id = CAST(o.stop_id AS NVARCHAR(50))` against distinct OTP stops. | — | minutes |
| 1 | **Module + evidence.** `lib/scheduleReview/` with `feedModel`, `distance` (calibrated), the seven existing checks moved to `checks/` with evidence, four new checks (2a–2d) with owner/fix, `GtfsScheduleReviewRoutes` + write-on-change, route detail endpoint. ADR: *Keep the schedule review's evidence beside its verdict*. CONTEXT.md gains "Schedule review" (distinct from "Schedule snapshot"). | — | large |
| 2 | **Console route detail + run-time profile** (views 1–2) on the Schedule Review page, Health links in. **Built, v1.5.325.** | 1 | medium |
| 3 | **Observed overlay** (`observed.ts`, view 3). | 0, 1, 2 | medium |
| 4 | **Feed diff + history** (`diff.ts`, view 4, Health summary gains history). | 1 | small |
| 5 | Retune thresholds now that evidence is visible; drop `run_time_spread` in favour of 2a or keep both with clear words. | 2 | small |

Not in scope: changing any OTP figure or rule; writing anything back to Avail;
retaining live TripUpdate delays.

---

## 7. Risks and open questions

- **Stop id join** (increment 0) is assumed from the handoff's "identifier
  spaces are identical" between the two Avail OTP feeds, not yet from Avail
  OTP to GTFS. If it fails, section 4 degrades to route × hour, which is
  still useful for 2a.
- **Units.** `shape_dist_traveled` is feet in this feed and unspecified in the
  standard; calibrate per import and record the factor in the review header.
- **Vendor framing.** Several fixes are Avail's. The page should say "Avail
  schedule export" plainly as the owner, as the changelog for v1.5.319
  already does for the prediction engine, without implying a contract claim.
- **Where it lives** (section 5, A vs B) is a product call; everything else
  is derivable from the data.

---

## 8. Increment 0: confirm the OTP ↔ GTFS joins on dev

Public SQL access to dev is denied from this machine, so these are handed over
to run. They read only. Expected results are stated so the answer is a yes or
a no, not a judgement.

```sql
-- 1. Stop ids: every OTP timepoint of the last 30 service days should match a
--    GTFS stop by id, and the names should agree. Expect unmatched = 0.
WITH otp AS (
  SELECT DISTINCT o.route_id, o.stop_id, o.stop_name
  FROM OtpDailyRouteStopHour o
  WHERE o.calendar_date >= CONVERT(CHAR(8), DATEADD(DAY, -30, GETDATE()), 112)
)
SELECT COUNT(*)                                                     AS otp_stops,
       SUM(CASE WHEN g.stop_id IS NULL THEN 1 ELSE 0 END)           AS unmatched,
       SUM(CASE WHEN g.stop_id IS NOT NULL
                 AND g.stop_name <> ISNULL(otp.stop_name, '') THEN 1 ELSE 0 END) AS name_differs
FROM otp
LEFT JOIN GtfsStops g ON g.stop_id = CAST(otp.stop_id AS NVARCHAR(50));

-- 2. The unmatched ones, if any (expect no rows).
WITH otp AS (
  SELECT DISTINCT o.route_id, o.stop_id, o.stop_name
  FROM OtpDailyRouteStopHour o
  WHERE o.calendar_date >= CONVERT(CHAR(8), DATEADD(DAY, -30, GETDATE()), 112)
)
SELECT otp.route_id, otp.stop_id, otp.stop_name
FROM otp
LEFT JOIN GtfsStops g ON g.stop_id = CAST(otp.stop_id AS NVARCHAR(50))
WHERE g.stop_id IS NULL
ORDER BY otp.route_id, otp.stop_id;

-- 3. Route ids: every OTP route of the last 30 days should be a GTFS route.
--    Expect unmatched = 0 and 19 rows.
SELECT o.route_id, MAX(o.route_label) AS route_label, r.route_short_name,
       CASE WHEN r.route_id IS NULL THEN 'UNMATCHED' ELSE '' END AS note
FROM OtpDailyRouteStopHour o
LEFT JOIN GtfsRoutes r ON r.route_id = CAST(o.route_id AS NVARCHAR(50))
WHERE o.calendar_date >= CONVERT(CHAR(8), DATEADD(DAY, -30, GETDATE()), 112)
GROUP BY o.route_id, r.route_id, r.route_short_name
ORDER BY o.route_id;

-- 4. Are the OTP stops the schedule's timepoints? Needs migration 145 and one
--    static sync after it. Reads the latest review's segment endpoints per
--    route. Expect not_a_timepoint = 0 (a handful is tolerable: a terminal that
--    Avail measures arrivals at rather than departures).
WITH latest AS (
  SELECT TOP 1 review_id FROM GtfsPredictionRiskReviews ORDER BY reviewed_at DESC, review_id DESC
),
tp AS (
  SELECT d.route_id, s.stop_id
  FROM GtfsScheduleReviewRoutes d
  JOIN latest ON latest.review_id = d.review_id
  CROSS APPLY OPENJSON(d.detail_json, '$.segments')
    WITH (from_stop_id NVARCHAR(50) '$.from_stop_id', to_stop_id NVARCHAR(50) '$.to_stop_id') seg
  CROSS APPLY (VALUES (seg.from_stop_id), (seg.to_stop_id)) s(stop_id)
),
otp AS (
  SELECT DISTINCT o.route_id, o.stop_id
  FROM OtpDailyRouteStopHour o
  WHERE o.calendar_date >= CONVERT(CHAR(8), DATEADD(DAY, -30, GETDATE()), 112)
)
SELECT COUNT(*) AS otp_route_stops,
       SUM(CASE WHEN tp.stop_id IS NULL THEN 1 ELSE 0 END) AS not_a_timepoint
FROM otp
LEFT JOIN tp ON tp.route_id = CAST(otp.route_id AS NVARCHAR(50)) AND tp.stop_id = CAST(otp.stop_id AS NVARCHAR(50));

-- 5. Volume and window, for sizing the overlay query. Expect roughly 2,000
--    rows per service day since 2026-10-04 (the poll fix, PR #389).
SELECT MIN(calendar_date) AS first_day, MAX(calendar_date) AS last_day,
       COUNT(DISTINCT calendar_date) AS days, COUNT(*) AS rows_total,
       COUNT(*) / NULLIF(COUNT(DISTINCT calendar_date), 0) AS rows_per_day
FROM OtpDailyRouteStopHour;
```

If 1 and 3 come back clean, the join is `route_id` and `stop_id` cast to
`NVARCHAR(50)`, and increment 3 needs no mapping table. If 4 shows a few
terminals, the overlay shows them as extra rows rather than dropping them.

---

## 9. Increment 3: what Avail observed, beside what the schedule says

**The question it answers.** Increment 2 shows that route 420 is scheduled
the same 10 minutes from 157th Street Station to Apple Valley TS at every
hour. Whether that is wrong is a question for the buses: if departures at
Apple Valley run 38% late at 4–6pm and 11% early at 10am–2pm, the flat
running time is the cause and the fix is a peak running time. Avail already
measures this; `OtpDailyRouteStopHour` holds it per route, stop, hour and
service day since 2026-10-04.

**Not compliance.** The overlay reads Avail's early/on-time/late counts as
Avail classified them (its own tolerances, not the Review Queue's bias
threshold), over whatever window the reader picks. It is not the Official
Departure OTP figure, applies no stop or date exclusions, changes nothing in
`lib/otpMonth`, and says so under the grid. It lives on the Schedule Review
page, not in the OTP module (section 5, option C).

### Shape

Join at the **timepoint stop**, not the segment. The run-time grid's columns
are the hour a trip *starts*; OTP's `hour_of_day` is the hour of departure
*at the stop*. Shifting one onto the other needs the trip's elapsed time to
each stop, which the detail does not carry and which is exactly what is in
doubt on a flat schedule. So the overlay is a second grid with the same hour
columns: rows are the route's timepoints in segment order, cells are what
Avail saw there in that hour.

```
What Avail observed at each timepoint, by hour of departure (28 weekdays to Oct 14)
TIMEPOINT                    5a   6a   7a   8a   9a  10a  11a  12p   1p   2p   3p   4p   5p   6p
Apple Valley TS NB            ·  4%L  9%L 14%L  6%E 11%E 12%E 10%E  9%E  7%L 21%L 38%L 34%L 12%L
157th Street Station        ...
```

A cell is the late share (L) or early share (E), whichever is larger, with
departures and the full split in its title; coloured on the warning scale by
the larger share. Under the grid, one sentence per flat segment whose
downstream timepoint shows the signature: *"Scheduled 10 min at every hour;
late share at Apple Valley TS rises from 9% (10a–2p) to 36% (3p–6p). The peak
is under-run."* The sentence is derived by one rule (peak late share at least
15 points above off-peak, or off-peak early share at least 15 points above
peak), declared in code with its threshold, and is evidence for a schedule
change, not the change.

### Server

- `lib/scheduleReview/observed.ts` (pure): rows `{stop_id, hour_of_day,
  early, ontime, late, total}` in, per-stop-per-hour shares out, plus the
  flat-segment sentences given the route's segments. Tested with no database.
- `lib/scheduleReview/observedStore.ts`: one aggregate query over
  `OtpDailyRouteStopHour` for a route, a window of service days and a
  day-of-week set (weekdays by default; the schedule grid is weekday service),
  grouped by `stop_id, hour_of_day`. Window capped at 90 days.
- `GET /gtfs-prediction-risk/routes/{routeId}/observed?days=28&dow=weekday`
  — a **separate endpoint** requiring `compliance-review.view`, because it
  reads OTP data; the schedule-only detail stays any-role. Returns the grid
  rows, the window actually covered (first and last service day with rows),
  departures counted, and the sentences. 404 when the route has no OTP rows
  in the window; the console then says Avail has nothing for it rather than
  showing an empty grid.
- No migration. No change to the sync.

### Console

- `ScheduleRouteView` gains a third block under the run-time grid, loaded
  only when the signed-in user has `compliance-review.view` (otherwise a one
  line note that the observed view needs that access). Window picker:
  7 / 28 / 90 days; day-of-week: weekdays / Saturday / Sunday.
- Same hour columns as the run-time grid, same sticky first column, same
  phone-width behaviour.
- The sentences render above the grid, one per segment, with the segment
  name linking the two grids by eye.

### Increments inside the increment

| # | Piece | Size |
|---|---|---|
| 3a | `observed.ts` + tests, store, endpoint. **Built, v1.5.326** (the reading rule of 3c came with it; only its render is left). | small–medium |
| 3b | Console grid + window picker. **Built, v1.5.327.** | medium |
| 3c | Flat-segment sentences (rule + tests + render). **Built**: rule in v1.5.326, render in v1.5.327. | small |

### Open questions, answered by increment 0 or stated as assumptions

- Stop and route ids join by cast (queries 1 and 3). If not, a mapping table
  is a migration and 3a grows.
- OTP's `Direction` is a label, not GTFS `direction_id`; a timepoint served
  in both directions (a transit station) is one OTP row per direction. The
  overlay shows one row per (stop, direction) when Avail gives a direction,
  so the two sides of a station are not averaged together.
- Hours are Central service-day hours on both sides (`calendar_date` is a
  Central service day; the review folds GTFS clock hours past 24 into 0–23).
- Weekday service: the schedule grid mixes every service id; the overlay
  defaults to weekdays. A later increment could split the run-time grid by
  service id as well.
