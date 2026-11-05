# Avail vs GTFS-RT as the source for fixed-route missed trips — 2026-11-04

An assessment, not a build. It asks whether Avail's missed-trips feed could augment or replace
GTFS-RT as the source for detecting fixed-route missed trips. Every figure comes from dev
(`sql-mvta-dev-mvta-jx4471` / `sqldb-mvta-onboard-dev`, confirmed with `@@SERVERNAME, DB_NAME()`),
read on 2026-11-04. The queries are in the appendix.

## Recommendation

**Keep GTFS-RT as the detector (option a) and leave Avail's missed-trips report as corroboration
only. Do not let it open cases, and do not use it for assessment.** The report's "entire trip
missed" records do not describe missed service. They describe Avail's own stop detection failing
at a handful of origin stations, and they carry no start time, so they cannot be placed on a trip.

The GTFS detector *is* noisy: 62% of its escalations are contradicted by a recorded start. That
noise comes from the detector's rules, not from GTFS-RT, and Avail cannot fix it. The useful Avail
contribution is a different feed. Avail **OTP Daily** stop-hour departures at a trip's origin
(option d) can *contradict* a GTFS case the next day, as review-queue evidence. They cannot open a
case.

Ranked: **(a) + (d) as contradicting evidence** > (a) unchanged > (c) > (b). Details follow.

## Sources read

| Source | What it establishes |
|---|---|
| `avail-missed-trips-by-route-stop-day.json`, `avail-missed-trips-by-route-stop-hour.json` (Avail's OpenAPI specs, supplied by the user) | The vendor's own contract: route, stops, date (or hour of day), three missed flags and `DepartureTripStartTime`. No trip, block, run or vehicle. Avail's own example response has `DepartureTripStartTime: null` on an entire-trip miss. |
| [`availMissedTripsFeed.ts`](../../functions-restapi/src/lib/availMissedTripsFeed.ts), [`availClient.ts:93-95`](../../functions-restapi/src/lib/availClient.ts#L93) | OnBoard requests `Full Trip Only=0` and `Include Deadheads=0`. |
| [`availMissedTripsPoll.ts`](../../functions-restapi/src/functions/availMissedTripsPoll.ts) | Timer `0 0 3 * * *`. Deletes and reloads the current month plus the 2 before it, then reconciles against cases. |
| [`migration-015`](../../functions-restapi/sql/migration-015-avail-missed-trips.sql) | No natural key per record. |
| [`adapters/avail.ts`](../../functions-restapi/src/lib/missedTripCase/adapters/avail.ts), [`availLinks.ts`](../../functions-restapi/src/lib/missedTripCase/adapters/availLinks.ts) | exact / probable / unmatched, on route + service date + start to the minute. |
| [ADR-0035](../adr/0035-corroborate-missed-trip-cases-with-avail-without-letting-it-decide.md), [ADR-0036](../adr/0036-promote-a-detector-on-a-service-date.md) | Avail corroborates but never opens a case. Promotion needs 95% precision over a service week. |
| [`adapters/gtfs.ts`](../../functions-restapi/src/lib/missedTripCase/adapters/gtfs.ts) header | The silent detector refuses "the schedule repeated" and "the last prediction standing in" as start evidence. |
| [`migration-012`](../../functions-restapi/sql/migration-012-avail-avl-reports.sql), [`migration-020`](../../functions-restapi/sql/migration-020-otp-daily.sql) | AVL Reports carry Avail route/block/run/trip but no GTFS key. OTP Daily is per route × stop × hour. |
| [`plans/missed-trip-detection-logic-gaps.md`](../../plans/missed-trip-detection-logic-gaps.md) | Avail's feeds and MVTA's GTFS-RT may come from the same Avail platform, so they are not independent sources. |

**Windows.** For the Avail checks: 2026-10-06 to 2026-11-02, four complete Monday-to-Sunday service
weeks after the #440–#447 fixes. For the GTFS v4 detector: every case it has opened
(2026-09-17 onward), so that the post-#470 period is included.

## What the data says

### 1. The Avail missed-trips report cannot be tied to a scheduled run

Every month from 2026-01 to 2026-11 has the same shape (Q1):

- `departure_only = 0` in every month. A missed departure only ever arrives as part of an entire
  trip.
- **Every** entire-trip record has a NULL `departure_trip_start_time`: 1,989 of 1,989 in October,
  and the same in every other month. Avail's own spec example shows the same thing, so this is the
  contract, not an ingestion bug.
- Partial records are all *arrival-only*, and every one has a start time.

In the four-week window, Avail reported **1,840 entire-trip misses** on 18 routes at only 25
departure stops. Six stops account for 92.9% of them (Q10):

| Departure stop | Whole misses | % | cumulative |
|---|---:|---:|---:|
| BVille Ctr | 776 | 42.2 | 42.2 |
| Mystic Lake Bus | 331 | 18.0 | 60.2 |
| Marschall Rd TS | 258 | 14.0 | 74.2 |
| AVTS NB | 168 | 9.1 | 83.3 |
| MOA Station Gt | 112 | 6.1 | 89.4 |
| Savage P&R | 65 | 3.5 | 92.9 |

**These are Avail's stop-detection gaps, not missed service.** Avail's own OTP Daily feed records no
departure at all for 776 of the 776 scheduled origin-hours at Burnsville Center. That is exactly
Avail's 776 whole misses there. The pattern holds stop by stop (Q17):

| Origin stop | Scheduled origin-hours | Hours with no OTP Daily row | Avail whole misses |
|---|---:|---:|---:|
| Burnsville Center | 776 | **776** | 776 |
| Mystic Lake Casino | 812 | **331** | 331 |
| Marschall Road TS | 736 | **257** | 258 |
| Apple Valley TS NB | 1,876 | 147 | 168 |
| Savage Park & Ride | 480 | 43 | 65 |
| MSP Terminal 1 | 532 | 25 | 25 |

The Dispatch Log (TripStartLog) records a realised start for the same trips. On the 226 route-days
with an Avail whole miss, Avail reported 1,840 misses, but the Dispatch Log had only 515 trips
without a realised start. **At least 1,443 (78%) of Avail's whole misses fall on trips the
Dispatch Log saw leave** (Q11), so the upper bound on Avail's whole-miss precision is 22%. Across all
13,860 scheduled trips in the window, 1,170 (8.4%) had no realised start.

Partial records name real trips. Of the 2,018 arrival-only records, 1,039 (51%) match a scheduled
start to the minute (1,022 of them uniquely). Another 865 (43%) are 1–5 minutes off (Q12–13).
ADR-0035's minute-exact rule therefore drops about 43% of the placeable partials. That is a side
finding; it does not change the recommendation.

The current link table reflects all of this (Q4, 95-day window): **exact 141, all of them
partials**. Probable: 337 (336 whole misses, all "no start time"). Unmatched: 10,710. That is why
the scorecard's Avail recall is 0.

**What Avail would have to send** before an entire-trip miss could be placed on a trip, in order of
value:

1. A trip identity on every record. The GTFS `trip_id`, or Avail's trip id plus block/run, with
   `DepartureTripStartTime` populated on entire-trip misses as well as partials.
2. Fixed origin detection at the stations above (stop radius, or a departure inferred from leaving
   the station). Without this, entire-trip misses and OTP Daily both stay blind at those stops,
   even with a trip id.
3. Optionally, a per-block logon/assignment status (vehicle logged on to a block and run). That
   would separate "bus never logged on" from "bus ran but was not detected".

The AVL Reports feed (migration 012) already carries Avail route/block/run/trip, but
`AvailAvlVehiclePositions` has **0 rows on dev** (Q2), and it would need a GTFS↔Avail trip
crosswalk anyway. The hourly endpoint adds `HourOfDay` but returns a whole month per call and still
names no trip, so it narrows a whole miss to a route-hour (typically 1–4 trips) and no further.

### 2. Timeliness

| Use | GTFS-RT silent detector | Avail missed-trips report | Avail OTP Daily |
|---|---|---|---|
| Live operations | Yes. A case 30 minutes after scheduled start, re-checked every 5 minutes. | No. Pulled at 03:00 UTC and covers up to the previous service day (last ingest 2026-11-05 03:00 UTC, data through 2026-11-03). | No, next day. |
| Review queue | Yes, the source of cases. | Corroboration only. Restates three months nightly, so an earlier statement can be withdrawn (`retracted_at`). | Yes, as next-day contradicting evidence. |
| Monthly assessment | Only after promotion, which needs reviewed precision. None exists yet (§3). | No. Not placeable, and 78%+ of whole misses are contradicted. | Not as a count. Usable as an exclusion or contradiction signal. |

### 3. Precision and recall

**Reviewer outcomes cannot score either feed: there are none.** The whole system holds 8 reviews
(4 confirmed and 4 timely service), all from 2026-08-05 to 2026-08-07 on pre-v4 legacy cases. There
are 12 Dispatch Log verifications, from September, and none of them is on a case. Nothing has been
promoted (Q20). Any precision figure has to come from cross-source evidence instead. The figures
below do that, and they are only as good as the sources.

**GTFS-RT silent no-show (`gtfs-silent-v4`)**, 182 cases since 2026-09-17: 67 escalated, 106 closed
by evidence, 9 still watching (`block_never_reported`). The 58 escalated through 2026-11-03,
triangulated against the realised Dispatch Log start and OTP Daily at the origin stop and local
hour (Q19):

| Evidence | Cases | Reading |
|---|---:|---|
| Dispatch Log realised start before the deadline | 19 | False positive |
| No Dispatch Log start, but OTP Daily shows every scheduled origin departure in that hour | 17 | Probable false positive |
| No Dispatch Log start, OTP Daily has no row (the blind stops) | 19 | Unknown |
| No Dispatch Log start, and OTP Daily departures short of schedule | 3 | Probable real miss |

- **Precision is at best 38% (22/58) and at worst 5% (3/58).** 36 of 58 (62%) are contradicted by
  at least one start source. The 95% promotion bar is far away.
- Of the 19 contradicted by the Dispatch Log, 7 are races: the start landed within the last minute
  before the deadline and the reading arrived 1–7 minutes after it. The other **12 had a realised
  reading 12–29 minutes before the deadline and were escalated anyway**, and 8 of those 12 are
  from 2026-11-01 to 2026-11-03 (Q9). Escalations jumped from 1–7 a week in October to 30 in the
  four days from 2026-11-01 (Q5). That coincides with #470 (merged 2026-11-01) and the
  `v64`→`v65` schedule version in trip ids on 2026-11-02. This is a regression to diagnose. It is
  not something a second feed solves.
- **Recall proxy:** 29 trips in the window had no realised Dispatch Log start *and* an OTP Daily
  shortfall at their origin hour. The detector opened a case for 3 of them and escalated 2 (Q21).
  This is a weak proxy, because an hour-level shortfall can belong to a different trip in that
  hour. Read it as "recall is unknown and may be low", not as 10%.
- Explicit cancellations (`gtfs-cancel-v1`) have opened no cases on dev (Q4).

**Avail missed-trips report:**

- *Whole misses:* precision is at most 22% (§1). Recall is 0 by construction, because none can be
  placed on a trip.
- *Partials:* 141 exact links, all of them partial-service evidence, not missed trips.
- "Corroboration" by route-day is meaningless. Avail reports whole misses on 226 of the window's
  route-days, so 52 of the 58 escalated GTFS cases have an Avail whole miss on the same route-day
  regardless of whether the trip ran.

### 4. Options, ranked

**1. (a) Keep GTFS-RT, with Avail corroborating as today, plus (d) OTP Daily as contradicting
evidence. Recommended.**

- *What changes:* the nightly reconciliation also reads OTP Daily departures at the case's origin
  stop and local hour. When departures ≥ scheduled trips, it records an Evidence conflict or a
  "departure observed" note on the case. It never opens a case and never closes a reviewed one, as
  ADR-0035 already establishes. The detector regression since 2026-11-01 (12 escalations with an
  in-hand start) gets diagnosed separately.
- *Risk:* hour-level evidence. A route with two trips in the hour from the same origin can hide one
  miss behind an extra departure. Origins with no rows (Burnsville Center etc.) get no help.
  OTP Daily is Avail data, so it may share failure modes with GTFS-RT.
- *Prerequisites from Avail:* none to start. Origin detection at the six stations would widen
  coverage.

**2. (a) unchanged.** Safe, but the queue keeps 62% contradicted escalations, which reviewers have
to clear by hand.

**3. (c) Replace GTFS-RT with Avail for assessment only. Not viable today.** Entire-trip misses
cannot be placed on a trip, and at least 78% fall on trips that ran. Assessing on them would
charge the contractor for Avail's stop-detection gaps.
*Prerequisites:* items 1 and 2 under "What Avail would have to send", then a fresh measurement.

**4. (b) Let Avail open cases. Reject.** ADR-0035 deferred this until a detector leaves Shadow
detection, and none has. On current data it would open about 65 unplaceable cases a day, a
three-month backfill on the first run, and few or no real misses among them.
*Prerequisites:* a trip identity on every record, fixed origin detection, and then its own Shadow
period under ADR-0036.

## Caveats

- **Dispatch Log readings are themselves GTFS-RT TripUpdate readings** (`actual_start_source =
  trip_update` for 13,246 of 13,340 starts in the window; Q3/Q7). "Realised" here means "not the
  schedule repeated, and captured at or after the time", the detector's own rule. That rule is
  stronger than raw presence, but it is not a dispatcher's eyes.
- OTP Daily joins on the GTFS origin stop id. The ids match Avail's on spot checks (Q16), but this
  was not proven for every stop.
- Local hour is computed with `AT TIME ZONE 'Central Standard Time'`, which handles DST. A trip
  scheduled near an hour boundary can still fall into the neighbouring hour's bucket in Avail.

## Follow-ups (not done here)

1. Diagnose why `gtfs-silent-v4` escalated 12 trips holding a realised start 12–29 minutes before
   the deadline, 8 of them since 2026-11-01.
2. Prototype OTP Daily origin-hour departures as Evidence-conflict input to the nightly
   reconciliation.
3. Ask Avail for a trip id and start time on entire-trip misses, and about origin detection at the
   six stations.
4. Consider widening ADR-0035's match tolerance for partials. 865 of 2,018 are 1–5 minutes off.

## Appendix: SQL run (dev, read-only)

Numbering matches the references above. Each block is one `sqlcmd -i` file, run as written.

```sql
SELECT @@SERVERNAME srv, DB_NAME() db;
SELECT name FROM sys.tables WHERE name LIKE '%Avail%' OR name LIKE '%Missed%' OR name LIKE '%TripStart%' OR name LIKE '%Otp%' OR name LIKE '%Dispatch%' ORDER BY name;
```

```sql
SET NOCOUNT ON;
-- Q1 Avail missed-trips feed: shape per month
SELECT service_month, COUNT(*) records,
  SUM(CAST(entire_trip_missed AS int)) whole,
  SUM(CASE WHEN entire_trip_missed=0 AND departure_missed=1 AND arrival_missed=0 THEN 1 ELSE 0 END) departure_only,
  SUM(CASE WHEN entire_trip_missed=0 AND departure_missed=0 AND arrival_missed=1 THEN 1 ELSE 0 END) arrival_only,
  SUM(CASE WHEN entire_trip_missed=0 AND departure_missed=1 AND arrival_missed=1 THEN 1 ELSE 0 END) both_not_whole,
  SUM(CASE WHEN entire_trip_missed=1 AND departure_trip_start_time IS NULL THEN 1 ELSE 0 END) whole_null_start,
  SUM(CASE WHEN entire_trip_missed=0 AND departure_trip_start_time IS NULL THEN 1 ELSE 0 END) partial_null_start,
  MIN(calendar_date) first_d, MAX(calendar_date) last_d, MAX(ingested_at) ingested
FROM AvailMissedTripsRouteStopDay GROUP BY service_month ORDER BY service_month;
-- Q2 AVL positions feed
SELECT COUNT(*) n, COUNT(DISTINCT vehicle_id) vehicles, MIN(report_timestamp) first_ts, MAX(report_timestamp) last_ts,
  SUM(CASE WHEN trip IS NULL OR trip='' THEN 1 ELSE 0 END) no_trip, SUM(CASE WHEN block IS NULL OR block='' THEN 1 ELSE 0 END) no_block
FROM AvailAvlVehiclePositions;
SELECT TOP 5 vehicle_id, route, block, run, trip, report_timestamp FROM AvailAvlVehiclePositions ORDER BY report_timestamp DESC;
-- Q3 TripStartLog start sources
SELECT actual_start_source, COUNT(*) n FROM TripStartLog WHERE service_date >= '20261001' GROUP BY actual_start_source;
SELECT TOP 3 service_date, trip_id, block_id, route_id, scheduled_start_at, actual_start_at, start_status FROM TripStartLog WHERE service_date='20261102';
-- Q4 detectors / detection types
SELECT detector_version, detection_type, source_system, COUNT(*) n, MIN(service_date) mn, MAX(service_date) mx FROM MonitoredMissedTrips GROUP BY detector_version, detection_type, source_system ORDER BY n DESC;
SELECT status, validation_status, COUNT(*) n FROM MonitoredMissedTrips WHERE ISNULL(source_system,'gtfs')<>'spare' GROUP BY status, validation_status ORDER BY n DESC;
SELECT observation, COUNT(*) n, MIN(service_date) mn, MAX(service_date) mx FROM TripStartVerifications GROUP BY observation;
SELECT match_confidence, entire_trip_missed, resolution, CASE WHEN retracted_at IS NULL THEN 0 ELSE 1 END retracted, COUNT(*) n FROM AvailEvidenceLinks GROUP BY match_confidence, entire_trip_missed, resolution, CASE WHEN retracted_at IS NULL THEN 0 ELSE 1 END;
```

```sql
SET NOCOUNT ON;
-- Q5 v4 cases by week, status, and whether the Dispatch Log saw a start
SELECT LEFT(m.service_date,6)+'-'+CAST(DATEPART(ISO_WEEK, CONVERT(date,m.service_date)) AS varchar) wk,
  COUNT(*) cases,
  SUM(CASE WHEN m.status='escalated' THEN 1 ELSE 0 END) escalated,
  SUM(CASE WHEN m.status='resolved' THEN 1 ELSE 0 END) resolved,
  SUM(CASE WHEN t.actual_start_at IS NOT NULL THEN 1 ELSE 0 END) tsl_started,
  SUM(CASE WHEN t.trip_id IS NULL THEN 1 ELSE 0 END) not_in_tsl,
  SUM(CASE WHEN m.status='escalated' AND t.actual_start_at IS NOT NULL THEN 1 ELSE 0 END) escalated_but_started
FROM MonitoredMissedTrips m
LEFT JOIN TripStartLog t ON t.service_date=m.service_date AND t.trip_id=m.trip_id
WHERE m.detector_version='gtfs-silent-v4'
GROUP BY LEFT(m.service_date,6)+'-'+CAST(DATEPART(ISO_WEEK, CONVERT(date,m.service_date)) AS varchar)
ORDER BY 1;
SELECT m.status, m.undecided_reason, m.data_quality_status, COUNT(*) n FROM MonitoredMissedTrips m WHERE m.detector_version='gtfs-silent-v4' GROUP BY m.status, m.undecided_reason, m.data_quality_status ORDER BY n DESC;
-- TripStartLog daily coverage: scheduled trips vs with actual start
SELECT service_date, COUNT(*) sched, SUM(CASE WHEN actual_start_at IS NOT NULL THEN 1 ELSE 0 END) started, SUM(CASE WHEN start_status IS NULL OR start_status NOT IN ('on_time','late','early') THEN 1 ELSE 0 END) other_status
FROM TripStartLog WHERE service_date BETWEEN '20261020' AND '20261104' GROUP BY service_date ORDER BY service_date;
SELECT start_status, COUNT(*) n FROM TripStartLog WHERE service_date BETWEEN '20261006' AND '20261103' GROUP BY start_status;
```

```sql
SET NOCOUNT ON;
-- Q7 How often does a TripStartLog "actual" start equal the scheduled start to the second?
SELECT actual_start_source,
  COUNT(*) started,
  SUM(CASE WHEN actual_start_at = scheduled_start_at THEN 1 ELSE 0 END) equals_schedule,
  SUM(CASE WHEN DATEPART(SECOND, actual_start_at)=0 THEN 1 ELSE 0 END) whole_minute
FROM TripStartLog WHERE service_date BETWEEN '20261006' AND '20261103' AND actual_start_at IS NOT NULL
GROUP BY actual_start_source;
-- same, for v4 cases
SELECT m.status, SUM(CASE WHEN t.actual_start_at = t.scheduled_start_at THEN 1 ELSE 0 END) equals_schedule, SUM(CASE WHEN t.actual_start_at IS NOT NULL AND t.actual_start_at<>t.scheduled_start_at THEN 1 ELSE 0 END) differs, COUNT(*) n
FROM MonitoredMissedTrips m LEFT JOIN TripStartLog t ON t.service_date=m.service_date AND t.trip_id=m.trip_id
WHERE m.detector_version='gtfs-silent-v4' GROUP BY m.status;
```

```sql
SET NOCOUNT ON;
-- Q8 classify every v4 case's Dispatch Log reading the way the detector's comment says it must be read
SELECT m.status,
  CASE WHEN t.actual_start_at IS NULL THEN 'a no reading'
       WHEN t.actual_start_at = t.scheduled_start_at THEN 'b schedule repeated'
       WHEN t.actuals_updated_at < t.actual_start_at THEN 'c prediction captured before the time'
       WHEN t.actual_start_at <= m.grace_deadline_at THEN 'd realised start before deadline'
       ELSE 'e realised start after deadline' END reading,
  COUNT(*) n
FROM MonitoredMissedTrips m LEFT JOIN TripStartLog t ON t.service_date=m.service_date AND t.trip_id=m.trip_id
WHERE m.detector_version='gtfs-silent-v4'
GROUP BY m.status, CASE WHEN t.actual_start_at IS NULL THEN 'a no reading'
       WHEN t.actual_start_at = t.scheduled_start_at THEN 'b schedule repeated'
       WHEN t.actuals_updated_at < t.actual_start_at THEN 'c prediction captured before the time'
       WHEN t.actual_start_at <= m.grace_deadline_at THEN 'd realised start before deadline'
       ELSE 'e realised start after deadline' END
ORDER BY 1,2;
-- Q8b same for the whole Dispatch Log, 4 weeks
SELECT CASE WHEN t.actual_start_at IS NULL THEN 'a no reading'
       WHEN t.actual_start_at = t.scheduled_start_at THEN 'b schedule repeated'
       WHEN t.actuals_updated_at < t.actual_start_at THEN 'c prediction captured before the time'
       ELSE 'd realised' END reading, COUNT(*) n
FROM TripStartLog t WHERE service_date BETWEEN '20261006' AND '20261102'
GROUP BY CASE WHEN t.actual_start_at IS NULL THEN 'a no reading'
       WHEN t.actual_start_at = t.scheduled_start_at THEN 'b schedule repeated'
       WHEN t.actuals_updated_at < t.actual_start_at THEN 'c prediction captured before the time'
       ELSE 'd realised' END;
```

```sql
SET NOCOUNT ON;
-- Q9 escalated v4 cases whose Dispatch Log shows a realised start before the deadline: when did that reading arrive?
SELECT m.service_date, m.route_id, m.trip_id, m.scheduled_departure_at, m.grace_deadline_at, t.actual_start_at, t.actuals_updated_at,
  DATEDIFF(MINUTE, m.grace_deadline_at, t.actuals_updated_at) reading_arrived_min_after_deadline, m.last_checked_at
FROM MonitoredMissedTrips m JOIN TripStartLog t ON t.service_date=m.service_date AND t.trip_id=m.trip_id
WHERE m.detector_version='gtfs-silent-v4' AND m.status='escalated'
  AND t.actual_start_at <> t.scheduled_start_at AND t.actuals_updated_at >= t.actual_start_at AND t.actual_start_at <= m.grace_deadline_at
ORDER BY m.service_date;
```

```sql
SET NOCOUNT ON;
-- Window for Avail checks: 2026-10-06 .. 2026-11-02 (four full service weeks, Mon..Sun)
DECLARE @f CHAR(8)='20261006', @t CHAR(8)='20261102';
-- Q10 stop concentration of whole-trip misses
WITH w AS (SELECT departure_stop_name s, COUNT(*) n FROM AvailMissedTripsRouteStopDay WHERE entire_trip_missed=1 AND calendar_date BETWEEN @f AND @t GROUP BY departure_stop_name),
x AS (SELECT s, n, 100.0*n/SUM(n) OVER () pct FROM w)
SELECT TOP 10 s, n, CAST(pct AS decimal(5,1)) pct, CAST(SUM(pct) OVER (ORDER BY n DESC ROWS UNBOUNDED PRECEDING) AS decimal(5,1)) cum_pct FROM x ORDER BY n DESC;
SELECT COUNT(*) whole, COUNT(DISTINCT departure_stop_name) stops, COUNT(DISTINCT route_id) routes FROM AvailMissedTripsRouteStopDay WHERE entire_trip_missed=1 AND calendar_date BETWEEN @f AND @t;
-- Q11 route-day: Avail whole misses vs Dispatch Log trips with no realised start
WITH a AS (SELECT calendar_date d, CAST(route_id AS varchar(20)) r, COUNT(*) avail_whole FROM AvailMissedTripsRouteStopDay WHERE entire_trip_missed=1 AND calendar_date BETWEEN @f AND @t GROUP BY calendar_date, route_id),
t AS (SELECT service_date d, route_id r, COUNT(*) sched,
        SUM(CASE WHEN actual_start_at IS NULL OR actual_start_at=scheduled_start_at OR actuals_updated_at<actual_start_at THEN 1 ELSE 0 END) no_realised
      FROM TripStartLog WHERE service_date BETWEEN @f AND @t GROUP BY service_date, route_id)
SELECT COUNT(*) avail_route_days, SUM(a.avail_whole) avail_whole, SUM(t.sched) sched_on_those_days, SUM(t.no_realised) dl_no_realised_on_those_days,
  SUM(CASE WHEN t.d IS NULL THEN 1 ELSE 0 END) route_days_not_in_dl,
  SUM(CASE WHEN a.avail_whole > ISNULL(t.no_realised,0) THEN a.avail_whole-ISNULL(t.no_realised,0) ELSE 0 END) avail_excess_over_dl,
  SUM(CASE WHEN a.avail_whole > ISNULL(t.sched,0) THEN 1 ELSE 0 END) route_days_avail_exceeds_scheduled
FROM a LEFT JOIN t ON t.d=a.d AND t.r=a.r;
SELECT SUM(sched) dl_trips, SUM(no_realised) dl_no_realised FROM (SELECT COUNT(*) sched, SUM(CASE WHEN actual_start_at IS NULL OR actual_start_at=scheduled_start_at OR actuals_updated_at<actual_start_at THEN 1 ELSE 0 END) no_realised FROM TripStartLog WHERE service_date BETWEEN @f AND @t) x;
-- Q12 partial (arrival-only) records: does DepartureTripStartTime name a real trip?
WITH p AS (SELECT calendar_date d, CAST(route_id AS varchar(20)) r, departure_trip_start_time st FROM AvailMissedTripsRouteStopDay WHERE entire_trip_missed=0 AND calendar_date BETWEEN @f AND @t),
m AS (SELECT p.d, p.r, p.st, (SELECT COUNT(*) FROM TripStartLog t WHERE t.service_date=p.d AND t.route_id=p.r AND DATEDIFF(MINUTE,t.scheduled_start_at,p.st)=0) k FROM p)
SELECT COUNT(*) partials, SUM(CASE WHEN st IS NULL THEN 1 ELSE 0 END) no_start, SUM(CASE WHEN k>=1 THEN 1 ELSE 0 END) one_or_more_trip_at_minute, SUM(CASE WHEN k=1 THEN 1 ELSE 0 END) exactly_one_trip FROM m;
```

```sql
SET NOCOUNT ON;
DECLARE @f CHAR(8)='20261006', @t CHAR(8)='20261102';
-- Q13 partial records whose start names no trip: offset to the nearest scheduled start on that route-day
WITH p AS (SELECT calendar_date d, CAST(route_id AS varchar(20)) r, departure_trip_start_time st FROM AvailMissedTripsRouteStopDay WHERE entire_trip_missed=0 AND calendar_date BETWEEN @f AND @t),
n AS (SELECT p.d, p.r, p.st, MIN(ABS(DATEDIFF(MINUTE,t.scheduled_start_at,p.st))) nearest FROM p LEFT JOIN TripStartLog t ON t.service_date=p.d AND t.route_id=p.r GROUP BY p.d, p.r, p.st)
SELECT CASE WHEN nearest IS NULL THEN 'route not in DL' WHEN nearest=0 THEN '0' WHEN nearest<=5 THEN '1-5' WHEN nearest<=30 THEN '6-30' WHEN nearest<=90 THEN '31-90' ELSE '>90' END bucket, COUNT(*) n
FROM n GROUP BY CASE WHEN nearest IS NULL THEN 'route not in DL' WHEN nearest=0 THEN '0' WHEN nearest<=5 THEN '1-5' WHEN nearest<=30 THEN '6-30' WHEN nearest<=90 THEN '31-90' ELSE '>90' END;
-- the stop pair of partials that do vs don't match: is the start the trip's origin time or the departure stop's time?
SELECT TOP 8 departure_stop_name, arrival_stop_name, COUNT(*) n FROM AvailMissedTripsRouteStopDay WHERE entire_trip_missed=0 AND calendar_date BETWEEN @f AND @t GROUP BY departure_stop_name, arrival_stop_name ORDER BY n DESC;
-- Q14 OTP daily feed: grain and missed counts in the window
SELECT COUNT(*) rows_, MIN(calendar_date) mn, MAX(calendar_date) mx, SUM(missed) missed_stop_events, SUM(actual_departures) actual_departures, SUM(total) total_stop_events FROM OtpDailyRouteStopHour WHERE calendar_date BETWEEN @f AND @t;
-- Q15 escalated v4 cases in the window: did Avail report a whole miss on the same route-day?
WITH c AS (SELECT m.status, CASE WHEN EXISTS (SELECT 1 FROM AvailMissedTripsRouteStopDay a WHERE a.calendar_date=m.service_date AND CAST(a.route_id AS varchar(20))=m.route_id AND a.entire_trip_missed=1) THEN 1 ELSE 0 END avail_same_route_day
  FROM MonitoredMissedTrips m WHERE m.detector_version='gtfs-silent-v4' AND m.service_date BETWEEN @f AND @t)
SELECT status, COUNT(*) n, SUM(avail_same_route_day) avail_whole_same_route_day FROM c GROUP BY status;
```

```sql
SET NOCOUNT ON;
DECLARE @f CHAR(8)='20261006', @t CHAR(8)='20261102';
-- Q16 Avail OTP Daily as origin-departure evidence: scheduled trips per (day, route, origin stop, local hour) vs OTP actual departures there
WITH s AS (
  SELECT service_date d, route_id r, origin_stop_id st,
         DATEPART(HOUR, CAST(scheduled_start_at AS datetimeoffset) AT TIME ZONE 'Central Standard Time') h,
         COUNT(*) sched,
         SUM(CASE WHEN actual_start_at IS NOT NULL AND actual_start_at<>scheduled_start_at AND actuals_updated_at>=actual_start_at THEN 1 ELSE 0 END) dl_realised
  FROM TripStartLog WHERE service_date BETWEEN @f AND @t
  GROUP BY service_date, route_id, origin_stop_id, DATEPART(HOUR, CAST(scheduled_start_at AS datetimeoffset) AT TIME ZONE 'Central Standard Time')),
o AS (SELECT calendar_date d, CAST(route_id AS varchar(20)) r, CAST(stop_id AS varchar(40)) st, hour_of_day h, SUM(actual_departures) dep FROM OtpDailyRouteStopHour WHERE calendar_date BETWEEN @f AND @t GROUP BY calendar_date, route_id, stop_id, hour_of_day)
SELECT COUNT(*) origin_hours, SUM(s.sched) sched_trips,
  SUM(CASE WHEN o.d IS NULL THEN 1 ELSE 0 END) origin_hours_with_no_otp_row,
  SUM(CASE WHEN o.dep >= s.sched THEN 1 ELSE 0 END) otp_covers_all,
  SUM(CASE WHEN o.dep < s.sched THEN 1 ELSE 0 END) otp_short,
  SUM(CASE WHEN s.dl_realised = s.sched THEN 1 ELSE 0 END) dl_all_realised,
  SUM(CASE WHEN s.dl_realised = s.sched AND o.dep >= s.sched THEN 1 ELSE 0 END) both_agree_all_ran
FROM s LEFT JOIN o ON o.d=s.d AND o.r=s.r AND o.st=s.st AND o.h=s.h;
-- does OTP's stop_id even share GTFS's origin stop ids?
SELECT TOP 5 t.origin_stop_id, t.origin_stop_name, (SELECT TOP 1 CONCAT(o.stop_id,' ',o.stop_name) FROM OtpDailyRouteStopHour o WHERE o.stop_name LIKE LEFT(t.origin_stop_name,8)+'%') otp_stop
FROM (SELECT DISTINCT origin_stop_id, origin_stop_name FROM TripStartLog WHERE service_date='20261102') t;
```

```sql
SET NOCOUNT ON;
DECLARE @f CHAR(8)='20261006', @t CHAR(8)='20261102';
-- Q17 origin stops with no OTP Daily row for a scheduled origin-hour (where OTP is blind)
WITH s AS (
  SELECT service_date d, route_id r, origin_stop_id st, origin_stop_name nm,
         DATEPART(HOUR, CAST(scheduled_start_at AS datetimeoffset) AT TIME ZONE 'Central Standard Time') h, COUNT(*) sched
  FROM TripStartLog WHERE service_date BETWEEN @f AND @t
  GROUP BY service_date, route_id, origin_stop_id, origin_stop_name, DATEPART(HOUR, CAST(scheduled_start_at AS datetimeoffset) AT TIME ZONE 'Central Standard Time'))
, o AS (SELECT DISTINCT calendar_date d, CAST(route_id AS varchar(20)) r, CAST(stop_id AS varchar(40)) st, hour_of_day h FROM OtpDailyRouteStopHour WHERE calendar_date BETWEEN @f AND @t)
SELECT TOP 8 s.nm, COUNT(*) origin_hours, SUM(CASE WHEN o.d IS NULL THEN 1 ELSE 0 END) no_otp_row
FROM s LEFT JOIN o ON o.d=s.d AND o.r=s.r AND o.st=s.st AND o.h=s.h GROUP BY s.nm ORDER BY no_otp_row DESC;
-- Q18 every v4 case in the window, against OTP Daily at its origin stop and local hour
WITH c AS (
  SELECT m.status, m.service_date d, m.route_id r, t.origin_stop_id st,
         DATEPART(HOUR, CAST(m.scheduled_departure_at AS datetimeoffset) AT TIME ZONE 'Central Standard Time') h
  FROM MonitoredMissedTrips m JOIN TripStartLog t ON t.service_date=m.service_date AND t.trip_id=m.trip_id
  WHERE m.detector_version='gtfs-silent-v4' AND m.service_date BETWEEN @f AND @t),
k AS (SELECT c.*, (SELECT COUNT(*) FROM TripStartLog x WHERE x.service_date=c.d AND x.route_id=c.r AND x.origin_stop_id=c.st AND DATEPART(HOUR, CAST(x.scheduled_start_at AS datetimeoffset) AT TIME ZONE 'Central Standard Time')=c.h) sched,
             (SELECT SUM(o.actual_departures) FROM OtpDailyRouteStopHour o WHERE o.calendar_date=c.d AND CAST(o.route_id AS varchar(20))=c.r AND CAST(o.stop_id AS varchar(40))=c.st AND o.hour_of_day=c.h) dep FROM c)
SELECT status, COUNT(*) n, SUM(CASE WHEN dep IS NULL THEN 1 ELSE 0 END) no_otp_row, SUM(CASE WHEN dep>=sched THEN 1 ELSE 0 END) otp_says_all_departed, SUM(CASE WHEN dep<sched THEN 1 ELSE 0 END) otp_says_short FROM k GROUP BY status;
```

```sql
SET NOCOUNT ON;
-- Q19 every escalated gtfs-silent-v4 case (2026-09-17 .. 2026-11-03), triangulated:
--   DL  = Dispatch Log realised start (not the schedule repeated, not a prediction) before the deadline
--   OTP = Avail OTP Daily departures at the origin stop/local hour >= trips scheduled there
--   AV  = Avail whole-trip miss reported on the same route-day
WITH c AS (
  SELECT m.trip_id, m.service_date d, m.route_id r, m.grace_deadline_at, t.origin_stop_id st, t.origin_stop_name nm,
         t.actual_start_at, t.scheduled_start_at, t.actuals_updated_at,
         DATEPART(HOUR, CAST(m.scheduled_departure_at AS datetimeoffset) AT TIME ZONE 'Central Standard Time') h
  FROM MonitoredMissedTrips m JOIN TripStartLog t ON t.service_date=m.service_date AND t.trip_id=m.trip_id
  WHERE m.detector_version='gtfs-silent-v4' AND m.status='escalated' AND m.service_date <= '20261103'),
k AS (SELECT c.*,
   CASE WHEN actual_start_at IS NOT NULL AND actual_start_at<>scheduled_start_at AND actuals_updated_at>=actual_start_at AND actual_start_at<=grace_deadline_at THEN 1 ELSE 0 END dl,
   (SELECT COUNT(*) FROM TripStartLog x WHERE x.service_date=c.d AND x.route_id=c.r AND x.origin_stop_id=c.st AND DATEPART(HOUR, CAST(x.scheduled_start_at AS datetimeoffset) AT TIME ZONE 'Central Standard Time')=c.h) sched,
   (SELECT SUM(o.actual_departures) FROM OtpDailyRouteStopHour o WHERE o.calendar_date=c.d AND CAST(o.route_id AS varchar(20))=c.r AND CAST(o.stop_id AS varchar(40))=c.st AND o.hour_of_day=c.h) dep,
   CASE WHEN EXISTS (SELECT 1 FROM AvailMissedTripsRouteStopDay a WHERE a.calendar_date=c.d AND CAST(a.route_id AS varchar(20))=c.r AND a.entire_trip_missed=1) THEN 1 ELSE 0 END av
  FROM c)
SELECT dl, CASE WHEN dep IS NULL THEN 'no row' WHEN dep>=sched THEN 'all departed' ELSE 'short' END otp, av, COUNT(*) n
FROM k GROUP BY dl, CASE WHEN dep IS NULL THEN 'no row' WHEN dep>=sched THEN 'all departed' ELSE 'short' END, av ORDER BY dl, otp, av;
```

```sql
SET NOCOUNT ON;
-- Q20 reviewer outcomes and Dispatch Log verifications that exist to score against
SELECT ISNULL(detector_version,'(none)') detector, validation_status, COUNT(*) n, MIN(service_date) mn, MAX(service_date) mx
FROM MonitoredMissedTrips WHERE validation_status <> 'unreviewed' GROUP BY detector_version, validation_status;
SELECT v.observation, CASE WHEN m.trip_id IS NULL THEN 'no case' ELSE ISNULL(m.detector_version,'(none)')+' '+m.status END case_, COUNT(*) n
FROM TripStartVerifications v LEFT JOIN MonitoredMissedTrips m ON m.service_date=v.service_date AND m.trip_id=v.trip_id GROUP BY v.observation, CASE WHEN m.trip_id IS NULL THEN 'no case' ELSE ISNULL(m.detector_version,'(none)')+' '+m.status END;
SELECT COUNT(*) promotions FROM MissedTripDetectorPromotions;
```

```sql
SET NOCOUNT ON;
DECLARE @f CHAR(8)='20261006', @t CHAR(8)='20261102';
-- Q21 GTFS recall proxy: trips with no realised Dispatch Log start AND an Avail OTP Daily shortfall at their origin hour
WITH s AS (
  SELECT service_date d, trip_id, route_id r, origin_stop_id st,
         DATEPART(HOUR, CAST(scheduled_start_at AS datetimeoffset) AT TIME ZONE 'Central Standard Time') h,
         CASE WHEN actual_start_at IS NOT NULL AND actual_start_at<>scheduled_start_at AND actuals_updated_at>=actual_start_at THEN 1 ELSE 0 END realised
  FROM TripStartLog WHERE service_date BETWEEN @f AND @t),
g AS (SELECT d, r, st, h, COUNT(*) sched FROM s GROUP BY d, r, st, h),
o AS (SELECT calendar_date d, CAST(route_id AS varchar(20)) r, CAST(stop_id AS varchar(40)) st, hour_of_day h, SUM(actual_departures) dep FROM OtpDailyRouteStopHour WHERE calendar_date BETWEEN @f AND @t GROUP BY calendar_date, route_id, stop_id, hour_of_day),
cand AS (SELECT s.* FROM s JOIN g ON g.d=s.d AND g.r=s.r AND g.st=s.st AND g.h=s.h JOIN o ON o.d=s.d AND o.r=s.r AND o.st=s.st AND o.h=s.h WHERE s.realised=0 AND o.dep < g.sched)
SELECT COUNT(*) strong_miss_candidates,
  SUM(CASE WHEN m.trip_id IS NOT NULL THEN 1 ELSE 0 END) with_any_case,
  SUM(CASE WHEN m.status='escalated' THEN 1 ELSE 0 END) escalated
FROM cand LEFT JOIN MonitoredMissedTrips m ON m.service_date=cand.d AND m.trip_id=cand.trip_id;
```
