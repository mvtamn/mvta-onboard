# ADR 0040: Keep the schedule review's evidence beside its verdict

Status: accepted (2026-10-16)

## Context

v1.5.319 (PR #405) added a review of the static GTFS feed: per route, seven
numbers, each flagged against a threshold, shown as a table on Integrations &
Data Health. It said *that* route 490 had a 45-minute gap between timepoints
and *that* a fifth of Orange LINK's stop times were placeholders. It could not
say which timepoints, which stop pairs, or which route the late bus comes off,
because the review walked every hop and every block hand-over to compute its
tallies and then kept only the tallies.

A number without its evidence is a verdict nobody can act on. The scheduler
who could add a timepoint needs the segment; the person who talks to Avail
about placeholder times needs the stop pairs; whoever decides whether to break
an interline needs the partner route and the count. Each of those is a second
question the table could not answer, and the only way to answer it was to
re-run the analysis by hand against the feed.

Probing the live feed also showed the seven checks miss the biggest schedule
problem on local routes: nine of nineteen routes schedule one running time for
every trip on a pattern from 5am to 7pm. The run-time-spread check reads that
as good.

## Decision

One module, `functions-restapi/src/lib/scheduleReview`, owns the schedule
model, every check, and the evidence behind each check's value.

- **The feed is modelled once** (`feedModel.ts`): trips with their stop times,
  stop patterns, hops, timepoint segments and block hand-overs. Every check
  reads the model; none re-parses the CSVs.
- **A check is one file** under `checks/`, declaring its id, label, unit,
  threshold, which way the threshold reads, why it hurts predictions, who owns
  the fix and what the fix is, plus a pure `evaluate(route, model)` that
  returns the value **and its evidence rows**. The console renders evidence
  generically (text, count, value, stop ids, trip ids), so a new check needs
  no console change to be explained.
- **Distances are calibrated, not assumed.** GTFS leaves the unit of
  `shape_dist_traveled` unspecified and the MVTA feed uses feet. `distance.ts`
  measures the unit against the stop coordinates on every import and falls
  back to straight-line distance, saying so, when it cannot. A check that
  would be wrong on straight lines (implied speed) reports no value rather than
  a guess.
- **The summary is derived from the detail**, never computed separately, so
  the health page's table and a route's detail cannot disagree.
- **Stored on change** (migration 145). A review identical to the last one
  stamps `confirmed_at`; a different one (new feed, new code) is a new row with
  one detail row per route. `reviewed_at` means first seen.
- **Four checks are added** for what the probe found: the same running time
  all day, the longest run of stops between timepoints, implausible scheduled
  speed along the route, and typical recovery time. The structural checks
  (timepoint gap, stop-free miles) are kept but say plainly that they are not
  schedule fixes.

## Consequences

- `GET /gtfs-prediction-risk/routes/{route_id}` returns a route's checks with
  evidence, its timepoint segments with scheduled minutes per start hour, and
  the owner and fix for each flag. The console view that reads it is the next
  increment (`plans/schedule-review-module-plan.md`).
- `lib/gtfsPredictionRisk.ts` and `lib/gtfsPredictionRiskStore.ts` remain as
  re-exports so PR #405's tests still prove the summary unchanged.
  (v1.6.16 deleted both; the PR #405 test now imports `lib/scheduleReview` and
  still proves the summary unchanged.)
- Thresholds are declared beside each check and were set against the 20260909
  feed. They are a starting point; the evidence now visible is what will tune
  them, and a later increment pairs them with the OTP Avail measured by hour.
- Detail is about 30 KB per route per feed version. The daily insert of
  migration 143 stops once 145 is applied; until then it carries on unchanged.
