# Decision Matrix reader prototype verdict

This is the evaluation record for the throwaway prototype on
`codex/decision-matrix-reader-prototype`. It supplements the
[prototype handoff](decision-matrix-read-experience-prototype-handoff-2026-08-24.md).

## Run

From `frontend`, run:

```sh
npm run dev --workspace @mvta/onboard-console
```

After signing in locally, open `/console/occ?prototype=reader&variant=split`.
Use `variant=split`, `variant=action-first`, or `variant=progressive`; the
floating bottom bar and left/right arrow keys switch layouts without a rebuild.

## Provisional recommendation

Choose **Action-first detail** as the production starting point. It places the
first required action directly after the Procedure identity and severity, keeps
Criteria in the same reading flow, and makes visual/document material a
deliberate secondary disclosure. The Split detail remains a useful comparison
for wide screens; Progressive detail is useful for search-heavy work but adds a
selection step under pressure.

## Specialist view choice

Keep all four reader views: **Action-first detail**, **Split detail**,
**Progressive detail**, and the existing **Grid** browse pattern. A specialist
may switch between them according to the task at hand. The prototype represents
that choice in the shareable URL; production implementation must decide and
test a durable per-specialist preference separately from the operational
Procedure content.

## Supporting-document interaction

An attached **QRG** opens in an inline OnBoard view, subject to the controller's
SharePoint entitlement; its SharePoint action remains available as a fallback.
The QRG is supporting guidance only and never replaces the governing Procedure
text or primary SOP/Reference. **SOP**, **REF**, and **APP** document actions
open their source documents in SharePoint rather than rendering inline. The
prototype uses a labelled placeholder for the QRG; production requires an
authorized SharePoint viewer/stream and must not expose credentials or durable
download URLs.

## Required controller validation before production UI

The authenticated local route prevented an agent-only visual walkthrough.
An OCC controller must still evaluate every variant at desktop and narrow
widths using keyboard-only navigation, confirm screen-reader labels and focus
order, open a placeholder rendition then the secondary SharePoint action, and
check the Valid, Needs review, Unavailable, withdrawn, and no-match states.

Open questions: whether the action-first visual/document disclosure should be
open by default on wide displays, and whether controller search should preserve
an explicit selection when its result set changes.
