# OTP Compliance: live-data rethink + broader Avail-feed findings

**Status: RESOLVED 2026-08-06 (OTP Monthly).** What started as "OTP
Compliance has no data" turned out to be two real, confirmed, fixed bugs -
a wrong envelope key and a too-narrow column - not a missing-data problem.
OTP Monthly is now verified end-to-end with 2,232 real rows across three
months and zero failures. See "What's been implemented" at the bottom for
the full sequence. Missed Trips is very likely fixed the same way but
hasn't finished a clean confirmed run yet (see that section). AVL Reports
is separately fixed and verified. Pullout Reports remains genuinely broken,
pending its real API spec. The UI rethink section below (splitting the
three "no data" states) is still just proposal.

## Why this exists

Ty flagged that OTP Compliance's live data "seems all broken" after the new
service-month selector showed **July 2026** - a fully completed month that
should definitely have real Avail data - still returning "no rows... showing
sample data," same as August. That prompted a real investigation (Application
Insights query, not guessing) rather than another silent assumption. What
came back was bigger than just OTP Monthly, so this covers all of it.

## What's actually confirmed, from live telemetry today (2026-08-05)

| Feed | Status | Evidence |
|---|---|---|
| **OTP Monthly** (`otpMonthlyFeedPoll`) | Runs cleanly, hourly. Returns a **genuinely valid, empty** response every time - `success: true`, real envelope, zero rows. Confirmed for both August (current) and July (fully closed) via our own stored data. | Manually triggered run: `"Avail OTP Monthly poll: 0 reports seen, 0 rows upserted for 202608."` No exception. |
| **Missed Trips** (`availMissedTripsPoll`) | Same pattern - runs cleanly, zero rows, every hour. | `"Avail Missed Trips poll: 0 reports seen, 0 rows reloaded for 202608."` |
| **Avail Detours sync** (`availDetoursSync`) | **Was actually broken** - guessed envelope key (`Detours`, capital D) was wrong. Real key is lowercase `detours`. **Fixed and deployed today** once the diagnostic added earlier this session caught it firing for real. | `Error: Avail Detours response has no "Detours" key under result - found [detours, results] instead.` - recurring on every run from 17:45 onward once Avail actually had a real detour to return. |
| **AVL Reports** (`availAvlPoll`) | **100% failure, every 5-minute run, since deployment** (at least 2026-07-30, likely earlier - that's the retention window checked). Never once succeeded in production. | `Failed to fetch Avail AVL Reports: Error: Avail AVL Reports request failed: 404` - 1823+ consecutive failures. |
| **Fixed Route Departures / Pullout** (`fixedRouteDeparturesPoll`) | **Same: 100% failure since deployment.** Never once succeeded. | `Failed to fetch Avail Pullout Reports: Error: Avail Pullout Reports request failed: 404` - 1823+ consecutive failures. |

**The takeaway:** this project's own code comments have flagged "KNOWN
UNCONFIRMED ASSUMPTION" on nearly every Avail feed's envelope key since the
very first one was built - and today is the first time any of them were
actually checked against real production traffic. Doing that immediately
surfaced one confirmed wrong key (Detours, now fixed) and one confirmed
malformed request pattern (AVL Reports + Pullout, both 404ing 100% of the
time). **Live AVL vehicle positions and Fixed Route Departures have likely
never shown real data since they were built**, silently, because the UI's
graceful-degradation-to-sample-data design (built deliberately, for good
reasons) also means a total, ongoing failure looks identical to "just not
configured yet" - nothing ever alarmed anyone.

## AVL Reports / Pullout 404s - likely root cause (not yet fixed)

`availAvl.ts`/`availPullout.ts` both build their request URL as:
```
${baseUrl}/${formatDateYyyyMmDd(date)}
```
— a single date segment. But `OTP-Feed-Evaluation-and-Recommendation (2).md`'s
own AVL Reports section documents the real shape as:
```
GET /{Property}/{Start DateTime}/{End DateTime}
```
— **two** date segments, not one. Our code is very likely missing an entire
required path segment, which would explain a 404 (API Management can't match
any route without the full path shape) far more precisely than an auth or
account-provisioning problem would. Pullout's exact documented shape wasn't
captured in any markdown doc in this repo (unlike AVL Reports), but given it
was built in the same style and fails identically, the same missing-segment
hypothesis is the leading candidate there too - **needs the real Pullout API
spec to confirm before touching the code**, not a guess-and-deploy.

This wasn't fixed in this pass - it needs the actual OpenAPI spec (or a raw
successful example call) for both endpoints before writing a real fix, not
another guess. Flagging prominently rather than shipping a second unverified
guess on top of the first one.

## OTP Monthly / Missed Trips - RESOLVED (2026-08-06)

**Both feeds were never actually empty - they were misread from day one.**
Confirmed live once the trailing-window daily backfill (below) actually ran
at 3:00am UTC on 2026-08-06: the diagnostic that had been sitting dormant
(matching the guessed key on every prior check) finally fired, because that
run's requests happened to land on a response shape where `result` carried
other keys instead of an empty object.

- **OTP Monthly**: guessed `OtpByRouteStopDayAgg` (PascalCase) - real key is
  lowercase **`otp`**, confirmed across all three months in the trailing
  window (202608, 202607, 202606).
- **Missed Trips**: guessed `MissedTripsByRouteStopDay` (PascalCase) - real
  key is lowercase **`missed`**.

Both have a sibling `results` metadata key, matching Detours' exact pattern
(`Detours` -> `detours`) and the same `RefreshTime`/`Property` shape already
documented for Pullout. **Avail's real convention across every one of these
feeds appears to be a short lowercase key + sibling `results` array - not
the PascalCase operation-model-name pattern this project guessed for every
single feed built this session.** Both fixed in `otpMonthlyFeed.ts` /
`availMissedTripsFeed.ts`, tests updated, deployed.

This also resolves the earlier open question about whether Avail has OTP
data for MVTA at all - Ty confirmed via Avail's own portal that it does,
which is consistent with this finding (the data was there; the code just
couldn't see it under the wrong key).

One thing worth separately verifying per
`plans/Missed-Trips-and-Supporting-Feeds-Evaluation.md`'s own note: whether
`{Property}=MVTA` is confirmed character-for-character correct. Ty has since
confirmed this - Property is `MVTA` and is correctly baked into the URL for
every feed except AVL Reports (which needs it as an explicit code segment
instead, already fixed). No further action needed there.

## UI rethink

### Remove the "Service Week" stat strip - confirmed dead

Every OTP Compliance page currently renders a hardcoded strip:
```
SERVICE WEEK        METRIC                IMPORTED
Jul 7 – Jul 13, 2026 Departure adherence   18,036 timepoint events
```
Per Ty's own confirmation and `MVTA_ONBOARD_MANUAL.md` §17: this is a literal
relic of the **original CSV-import design** (`OtpImportBatch`/`OtpRawRecord`,
a weekly `OTP/OTP_weekOf_Jul-08.csv` export) that this project's live Avail
feed integration was built to replace. It was never updated when the module
pivoted to live data, and now sits on every page - including pages viewing a
month other than July 2026 - showing a fixed, meaningless date range and a
made-up "18,036" import count with **no live meaning whatsoever**. **Remove
it entirely.**

### Three different "no data" states currently look identical

The banner conflates:
- feed genuinely not configured (env vars missing),
- table doesn't exist yet (migration not run), and
- table exists, feed is configured, request succeeds, but returns zero rows
  for the selected month (today's actual state)

...into one message: *"Avail OTP Monthly feed has no rows for `<month>` yet -
showing sample data."* The diagnostics object already returned by `GET
/otp-monthly` (`configured`, `table_ready`, `record_count`) has everything
needed to tell these apart - the banner just isn't using it. Worth splitting
into three distinct, accurate messages so "not configured" (an owner action)
and "genuinely zero rows for this month" (an Avail-side or backfill question)
stop looking like the same problem.

### Threshold Tuner's message ignores the new month selector

Minor, found while wiring the selector: the Threshold Tuner page's empty-state
text is hardcoded to say "current month's live OTP Monthly feed data,"
regardless of which month is actually selected. Small copy fix once the
above is settled.

## Proposed data-pull changes

**Interpreting "there should also be daily data pulls"** (flagging this as
an interpretation to confirm, not a restated instruction - the phrase is
ambiguous without more context):

- **Not** finer-than-monthly granularity - `OtpByRouteStopDayAgg` is
  inherently a month-level aggregate; passing a different date within the
  same month returns the same rows (confirmed in the feed doc itself). There
  is no way to get genuinely daily OTP numbers from this particular endpoint.
- **Most likely intent: a daily rolling backfill job**, distinct from the
  existing hourly "refresh whatever month is current" poll - once a day,
  re-fetch a trailing window (e.g., current month + prior 2) for both OTP
  Monthly and Missed Trips, so any Avail-side aggregation lag or late
  correction to a recently-closed month gets picked up automatically instead
  of our system being permanently stuck on whatever it saw the one time it
  asked. This directly addresses the "we never go back and check" gap
  described above.
- Secondary, lower-priority consideration: hourly polling of a month-level
  aggregate may simply be more frequent than useful (the data can't change
  meaningfully hour-to-hour for numbers that took a whole month to
  accumulate) - worth deciding whether to drop to a daily cadence for the
  *current*-month refresh too, separate from the backfill job above.

## Open questions for Ty

1. ~~Confirm via Avail's own portal: does OTP Monthly / Missed Trips data
   exist for MVTA's account at all, for any month?~~ **Resolved -
   confirmed yes**, and now doubly explained: the data was there all
   along, just misread under the wrong envelope key (see above).
2. ~~Is "daily pulls" the rolling-backfill interpretation above, or
   something else?~~ **Resolved** - trailing-window daily backfill,
   implemented and live.
3. ~~OK to remove the Service Week/Metric/Imported strip entirely?~~
   **Resolved - removed entirely**, along with Missed Trips off Monthly
   Assessments and service-month formatting fixed to `MM/YYYY`.
4. AVL Reports/Pullout's 404s need the real API spec (or one confirmed
   working raw call) before a fix gets written and deployed - **AVL
   Reports resolved** (real spec found, fixed, verified live); **Pullout
   still open** - who has access to get its real spec?
5. Should the three conflated "no data" states get split into distinct
   messages now, or bundled with whatever UI rework comes out of this
   review? - **Still open**, though likely lower priority now that OTP
   Monthly/Missed Trips are expected to actually show data going forward.

## What's been implemented

### 2026-08-05

- `availDetoursFeed.ts`: fixed the confirmed-wrong `Detours` → `detours`
  envelope key, with tests.
- `availMissedTripsFeed.ts`: added the same "throw with the real key names"
  diagnostic already built for OTP Monthly/Detours, so a future wrong-key
  guess here is loud instead of another silent zero, with tests.

### 2026-08-06

- `otpMonthlyFeed.ts`: fixed the confirmed-wrong `OtpByRouteStopDayAgg` →
  `otp` envelope key, caught by tonight's first trailing-window backfill
  run. Every month this feed has ever polled was never actually empty.
- `availMissedTripsFeed.ts`: fixed the confirmed-wrong
  `MissedTripsByRouteStopDay` → `missed` envelope key, caught the same run.
- Both feeds' data should start actually appearing in Route Summary/Review
  Queue/Monthly Assessments/the Dashboard trend chart on their next poll
  now that they're reading the real key. Verify after the next scheduled
  run (daily, 3:00am UTC) or by manually re-triggering.
- **Confirmed by manually re-triggering after deploy: real data flows.**
  `otpMonthlyFeedPoll` logged `414 reports seen, 260 rows upserted for
  202608` - genuine live OTP data, in the database, for the first time.
  Found one more real bug in the process: 154 of those 414 rows failed on
  a SQL error (`Data type 0xE7 has an invalid data length`) -
  `OtpMonthlyRouteStopDay.day_of_week` was `NVARCHAR(3)` (sized for
  "Mon"/"Tue" per the doc's only sample record), too narrow for at least
  some of Avail's real values. **Fixed** -
  `migration-021-otp-monthly-day-of-week-width.sql` widens it to
  `NVARCHAR(20)`; exact overflowing value never confirmed, widened
  generously rather than guessing the precise format.
- **Re-verified after migration-021 ran and the fix deployed: 100% success,
  all three months.** `414/414` rows for 202608, `908/908` for 202607,
  `910/910` for 202606 - **2,232 real OTP records now in the database,
  zero failures.** OTP Monthly is fully working end to end. Route
  Summary/Review Queue/Monthly Assessments/the Dashboard trend chart
  should all show real data on next load.
- **Separately observed, not yet a confirmed problem:** the same manual
  re-trigger of `availMissedTripsPoll` was still running with no
  completion log after 7+ minutes (no error either - just slow). Likely
  explanation: the trailing-window widening (1 month → 3 months) tripled
  the incident-record volume for a design that inserts one row at a time,
  sequentially, inside a single transaction - fine for a month, possibly
  not for three. Worth watching whether this becomes a real timeout risk
  once it's running on the daily schedule rather than a one-off manual
  trigger; batching the inserts would be the fix if so.

### Implemented per `OTP-Feed-Evaluation-and-Recommendation (3).md`'s plan

- **AVL Reports fixed**: `availAvl.ts` now sends `GET
  /{Property}/{StartDateTime}/{EndDateTime}` - all three segments, per Ty's
  explicit direction: an explicit `MVTA` Property segment (hardcoded
  constant, matching the app's single-agency scope) plus full `YYYY-MM-DD
  HH:MI:SS` datetimes (URL-encoded) - instead of the single date-only
  segment that 404'd on all ~1800 consecutive runs. `AVAIL_AVL_REPORTS_URL`
  no longer bakes Property into its base URL (unlike every other Avail feed
  setting in this app) - **needs the live app setting updated to end at
  `.../AVLReports/v1` before this deploys**, or the request will 404 on a
  duplicated Property segment. `availAvlPoll.ts` now requests a rolling
  10-minute window (`now - 10min` to `now`) each 5-minute run. **Pullout
  deliberately left untouched** - doc (3) explicitly cautions against
  guess-extrapolating a fix from AVL's shape without Pullout's own real
  spec; it still 404s on every run pending that.
- **Trailing-window daily backfill**: `otpMonthlyFeedPoll.ts` and
  `availMissedTripsPoll.ts` both changed from hourly-current-month-only to
  DAILY, re-fetching current month + prior 2 every run
  (`otpMonthlyFeed.ts`'s new `subtractMonths()` helper). Addresses the
  "poller has no way to notice a month that filled in late" gap directly.
- **New: `OtpByRouteStopDayHour` daily feed** for sub-monthly trending
  (`otpDailyFeed.ts`, `migration-020-otp-daily.sql`'s `OtpDailyRouteStopHour`
  table, `otpDailyFeedPoll.ts` daily timer pulling yesterday + 90-day
  rolling purge, `GET /otp-daily`). **This is the least-confirmed
  integration in the whole project** - unlike every other Avail feed built
  here, zero sample response exists anywhere for this specific operation,
  so the envelope key, field names, and URL param order are all guessed by
  analogy to sibling feeds. The envelope-key diagnostic was built in from
  the start this time (not added reactively after a silent failure, like
  every other feed) specifically because of that low confidence. **No UI
  reads this yet** - built the ingestion + read endpoint only; a trending
  view (7-day OTP by stop, week-over-week) is a follow-up once the field
  mapping is confirmed against a real response.
- New app setting: `AVAIL_OTP_DAILY_URL` (reuses `AVAIL_AVL_REPORTS_API_KEY`).
- All builds/tests pass (159 backend tests, frontend build clean). Nothing
  in this section has been deployed/pushed yet - still needs migration-020
  run against the dev DB, `AVAIL_OTP_DAILY_URL` set on
  `func-mvta-restapi-dev`, and an explicit push/deploy.

### Still open (unchanged from the original findings)

- Pullout Reports' 404 - needs its real API spec before a fix is written.
- Whether Avail has any OTP/Missed Trips data at all for MVTA's account -
  still pending Ty's portal check.
- The UI rethink section above (Service Week strip removal, splitting the
  three "no data" states, Threshold Tuner's hardcoded "current month" text)
  - proposal only, no build yet.
