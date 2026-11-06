# 48. Split missed-trip review, attribution and the excusable decision

Date: 2026-11-06

## Status

Accepted. Applies [ADR-0032](0032-own-roles-in-onboard-and-keep-sign-in-in-entra.md) (app-owned roles) to plan step 0.8 in
`plans/missed-trips-production-plan.md`.

## Context

OnBoard's Confirmed missed trips are meant to become the official count in the contractor
performance assessment from 2027-01-01. CONTEXT.md already separates **Missed-trip review
authority** (what happened) from **Service attribution** (whose fault it was). But one action,
`compliance-review.review`, gated both. The reviewer chose an attribution in the same act as the
outcome, and the default was contractor error. So one person could confirm a trip and charge it
in one click. The same action also gated every occurrence edit, excusable included.

MVTA answered question Q8 on 2026-11-06: "A transportation specialist reviews, managers decide
attribution, the COO decides if it is excusable; all are MVTA staff."

## Decision

There are three acts, and each has its own Module Action.

| Act | Action | Seeded on |
| --- | --- | --- |
| Record the outcome (Confirmed, Timely service, Partial-service failure, Indeterminate), or dismiss or reopen an occurrence as not having happened | `compliance-review.review` | Compliance Analyst, Compliance Manager (unchanged) |
| Attribute: contractor error, MVTA-directed, or back to undetermined | `compliance-review.attribute` | Compliance Manager |
| Decide excusable, or move an occurrence off excusable | `compliance-review.excuse` | Excusability Authority (new role, for the COO) |

- A review never sets attribution. A confirmed trip's occurrence is raised as a `candidate` with
  `attribution='undetermined'`. Only `confirmed` rows are scored, so it counts for nothing until a
  manager attributes it.
- A superseding confirmation leaves an attribution that was already decided as it is. A review
  that the trip did not miss dismisses the occurrence and clears its attribution.
- The occurrence intake module decides which authority a change needs. Excusable on either side
  needs `excuse`, and every other change needs `attribute`. The endpoint passes in what the caller
  holds. The console offers only the choices the server accepts from that person.
- `ComplianceOccurrences.attributed_by` / `attributed_at` (migration 167a) record who decided the
  attribution, next to `reviewed_by` (the outcome) and the case's `validated_by`.
- A hand-entered occurrence is charged on entry only if the person entering it holds `attribute`.

**Why `excuse` is a new action, not `performance-assessment.decide`.** Compliance Manager already
holds `decide` (finalize, reopen, issue, decide exceptions), and managers are the people who
attribute. Reusing `decide` would let every manager decide excusable, which is what Q8 rules out.
It would also make the COO hold finalization and issuance just to decide excusable. A separate
action keeps that decision with one named holder.

## Consequences

- Each authority is held by a separate role, but a person granted two roles holds both
  authorities. Compliance Manager inherits `review`, so a manager can review and attribute the
  same case in two separate acts. OnBoard does not stop one person from doing both. If MVTA wants
  that blocked, it needs a separation-of-duties rule, which is a follow-up.
- System Administrator holds `attribute` and `excuse` through its all-actions flag (ADR-0032).
- Excusable Delay Claims are still decided under `performance-assessment.decide`. Approving a claim
  and linking it as relief also takes an occurrence out of the count. Whether that should move to
  `excuse` is an open question for MVTA.
- Until migration 167a is applied, the intake module reports `schema_not_ready`. Reviews still
  save, but nothing reaches the assessment.
