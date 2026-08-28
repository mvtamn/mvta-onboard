# KPI trust observability implementation plan

## Goal

Let an operator determine whether each feed-backed KPI is usable now, without
confusing a healthy empty result, old data, a feed connection test, or another
source stream's status for that answer.

## Scope

The first release covers these KPI source streams:

| KPI | Required dependencies | Supporting dependencies |
| --- | --- | --- |
| Fixed-route delay risk | GTFS Trip Updates; static GTFS | GTFS Vehicle Positions |
| Fixed-route departures | Avail Pullout | — |
| OTP | Avail OTP Monthly | Avail OTP Daily |
| Event AVL | Avail AVL | — |
| On-Demand risk | Authoritative On-Demand reconciliation | Spare Request Status, Spare Slots |
| Missed trips | Fixed-route and Spare streams independently | Avail Missed Trips retrospective evidence |

## Non-goals

- Do not alter a service-risk threshold or feed polling schedule.
- Do not send a vendor request from a console page.
- Do not replace App Insights, existing feed checks, or the existing service
  risk diagnostic states.
- Do not make dependency or lateness thresholds freely editable in the first
  release; show the approved policy in Admin instead.

## Delivery slices

### 1. Capture a common ingestion-health snapshot

Add the smallest PII-free persistence shape needed for each producer to record
successful completion, failure, observed source time, covered service period,
and record count. Reuse existing per-feed health writes where present; adapt
them to the common shape instead of retaining parallel health paths.

Record outcomes at the existing poller/reconciliation boundary only. A UI read
must never probe a vendor endpoint or infer success from rows that happen to be
present.

### 2. Centralize dependency and trust calculation

Create one server-side KPI trust resolver with an initial, reviewed dependency
map and the real-time contracts from ADR 0027. It returns, for every source
stream:

- `current`, `stale`, `unavailable`, or `current_but_empty`;
- required and supporting dependency status;
- last successful ingestion and source coverage period;
- the applicable freshness contract and a short operator explanation.

Expose the resolver through a staff-only PII-free API. Reuse this response in
each KPI API rather than duplicating threshold logic in browser components.

### 3. Admin KPI trust view

Add a submodule under Admin Feed Health that lists every KPI source stream,
its dependencies, delivery freshness, data coverage, current trust state, and
the approved contract. It is the cross-KPI diagnostic and policy view.

Retain the existing individual feed connection checks, but label them as
connectivity diagnostics rather than KPI currency. The KPI trust view is
read-only in this release.

### 4. Put trust at the point of use

Add one compact trust summary to each of the six KPI views. A stale stream
shows its last-known result, source/coverage timestamps, and the reason it is
not current. Other source streams remain usable.

Gate only actions that rely on a stale stream: automatic Suggested Alert
preparation and assessment promotion. Preserve read-only historical context.

### 5. Audit manual stale-data use

Require a reason before a dispatcher/OCC user creates a manual communication
from a stale source stream. Persist the KPI stream, actor, timestamp, reason,
and communication reference in an append-only acknowledgement record. Do not
offer this control for automatic actions.

### 6. Periodic-feed activation

Before enabling automatic stale status for daily/monthly streams, Operations
must approve each source's expected reporting window and Data coverage rule.
Until then, show delivery information and mark the automatic stale contract as
pending rather than inventing a deadline.

## Tests

- Pure resolver: required vs supporting dependency, per-stream isolation,
  real-time limits, and Current-but-empty.
- Producer integration: each poller records success, failure, coverage, and no
  records without storing PII.
- API/UI: Admin and each KPI surface render the same state and explanation.
- Action guards: stale input cannot prepare an automatic alert or promote an
  assessment; a manual communication requires its acknowledgement record.
- Authorization and audit: only the permitted roles may acknowledge; entries
  are immutable and attributable.

## Rollout and acceptance

1. Deploy ingestion snapshots and resolver without changing operator actions.
2. Verify the Admin view against known healthy, empty, and deliberately stale
   streams.
3. Enable in-view summaries and action guards after Operations validates the
   explanations.
4. Obtain periodic-feed reporting deadlines, then enable their stale states.

The release is accepted when an operator can identify the current/stale state
and evidence for each KPI source stream, an empty successful run is not called
stale, a stale stream cannot trigger automation, and every manual stale-data
communication is auditable.
