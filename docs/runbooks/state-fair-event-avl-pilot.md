# State Fair Event AVL pilot

## Goal

Determine whether Event AVL gives OCC a trustworthy, timely view of State Fair
shuttle service and exposes actionable Monitoring Area crossings without
creating an external communications risk.

This is an internal, supervised pilot. It does not publish rider alerts.

## Guardrails

- Keep **Automatic Teams delivery off** for the State Fair operating period.
  The Event AVL Status queue remains the source of internal work.
- Do not use a queue item to change live scope. Use the existing Event Plan
  revision workflow for any route or Monitoring Area correction.
- Treat stale, degraded, unavailable, and authentication-required states as
  operational findings; do not infer that an empty map is healthy.

## Before the pilot

1. Deploy the Event AVL API and console build and apply
   `functions-restapi/sql/migration-077-event-notification-delivery-lease.sql`.
2. Confirm an OCC Admin can sign in, open Event AVL, and select the State Fair
   Event and its one active operating period.
3. Confirm the plan has the correct SpecialEvent route classifications,
   Monitoring Areas, and direction rules. Activation must remain the only way
   those resources become live scope.
4. Confirm the Event AVL health row reports a recent successful
   `shared_avl_ingestion`, `event_projection`, and `crossing_detection` run.
5. Confirm at least one real vehicle arrives in the map with a current report
   time. Record the actual report age before treating the pilot as live.
6. In Admin or Event AVL, verify **Automatic Teams delivery is Off** for the
   operating period.

Do not start the pilot if a component is failed, the map is stale, the Event
scope cannot be selected, or the live AVL feed has no confirmed current report.

## During the pilot

At start, mid-shift, and end of shift, record these observations in a GitHub
issue using the `needs-triage` label:

| Time (Central) | Feed state / report age | Vehicles expected / shown | Crossings expected / shown | Queue actions | Operator note |
| --- | --- | --- | --- | --- | --- |
| | | | | | |

Open a separate issue immediately for any of these:

- A vehicle is missing for more than two expected polling intervals.
- A position is shown as fresh when the AVL report is older than expected.
- A known boundary movement is not recorded, is duplicated, or has the wrong
  direction/Monitoring Area.
- A status queue item cannot be acknowledged or dismissed.
- The page presents an empty result, degraded feed, or expired sign-in as a
  healthy state.

## Decision after the State Fair

Promote Event AVL from pilot only if all are true:

- Operators could identify current vehicles and open Status queue work without
  a separate data source for the majority of the shift.
- Every reported issue has enough time, vehicle, route, Monitoring Area, and
  feed-state evidence to reproduce or rule it out.
- No false confidence was caused by stale, empty, or degraded data.
- The operation team says the map, Status queue, and Monitoring Area crossings
  changed at least one operational decision or reduced investigation time.

Otherwise, retain it as an internal diagnostic tool and prioritize the evidence
collected above before enabling external notification delivery.
