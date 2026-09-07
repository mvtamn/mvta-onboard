# Changelog

All notable changes to MVTA OnBoard are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/); versions track
`frontend/packages/onboard-console/package.json` (the staff console's `v`
badge and footer read this version at build time - see `vite.config.ts`).

## [1.5.135] - 2026-09-06

- **The On-Demand group band shows a short Spare reference, not a 36-character id.** Grouped by operator or vehicle, the band printed the raw Spare id in full beside the driver's name or the fleet number - "Lofton, Miquita 6eeabed4-3a09-47b6-9584-211056ebb54b" - which crowded out the thing being read. The band now shows the driver identifier as a badge where Spare keeps one, else the first eight characters of the id, with the full id as hover text on both the name and the reference; a driver Spare has neither named nor numbered keeps its short reference in the title alone rather than repeating it alongside. Same treatment for a vehicle grouped by fleet number. Row cells and every other column are unchanged.

## [1.5.134] - 2026-09-06

- **Migration 102 is no longer a deploy-order dependency.** Merging deploys the application; applying the schema is a separate manual step against a server whose public access is closed by default, so the code has to work in the gap between them. `assessmentPeriods` referenced `AgreementStandards` unconditionally and would have taken opening an assessment period - existing functionality - down with a 500 until the migration ran. An unknown object or column fails at parse time, so no guard inside the SQL could have caught it; `lib/assessment/schemaScope.ts` now answers the question first, in TypeScript, and the SQL is composed from the answer. Before the migration a period snapshots the agency catalog exactly as it did before this feature existed, which is not a degraded guess but the only answer the older schema can express. The tier editor, which needs a column the migration adds, refuses with a 409 naming it and hides its save button rather than offering an edit the server would reject. One helper answers "has 102 run" for the catalog read, the tier write and the period snapshot, so a half-applied migration cannot let the page offer an assignment the snapshot then ignores.
- **Confirming an observation lands it in the month's assessment, in the same transaction.** Reviewing a missed trip used to be the first of two sittings: `complianceCandidatesPoll` noticed the confirmation minutes later, raised a `candidate`/`undetermined` occurrence, and someone re-reviewed it in a different module before it counted. `POST /missed-trips/validate` now takes an `attribution` and settles both at once through `lib/assessment/occurrenceIntake.ts`, which builds the same `source_ref` the poll does so the poll dedupes on it and nothing is raised twice. The second question is still a real one — Attachment G's excusable-delay relief turns on it — so it is asked, not assumed; `undetermined` reproduces the old behaviour exactly.
- **A false positive retracts an occurrence already raised from the trip.** The poll may have raised a candidate from an earlier confirmation, and a trip the agency has since decided never happened stayed in the month's queue scoring against the contractor.
- **The link never fails the review.** Whether a trip was missed is a fact about service and does not stop being true because no `PerformanceAgreement` covers the date, the standard is not scored on that Agreement, or the month is finalized. Each case commits the review and returns a reason the console shows, naming what to fix. A finalized or issued month is never mutated as a side effect: restating one stays a manager reopening the period with a logged reason.
- **Garage Departures says whether a judged breach was actually charged.** `GET /fixed-route-departures` and `/on-demand-departures` join each row to its occurrence on the same `source_ref` the poll writes, and both views carry an Assessment column beside Outcome — "Awaiting review", "Counted in September 2026", "Recorded, not charged", "Not raised" — with inline Charge / Excusable / MVTA-directed buttons on an unsettled row. They issue the same `PATCH /compliance-occurrences/{id}` the Performance Assessment queue does, so a duty settled in either place is indistinguishable afterwards. Both joins are guarded by `OBJECT_ID`, so an environment without migration 030 returns the lists unchanged.
- **Missed Trips shows a reviewed trip where its decision went.** `GET /missed-trips` returns the occurrence's review status, attribution, month and period status, and the detail pane reports them with a link into Performance Assessment. A confirmed trip that produced no occurrence reads "Not linked" rather than looking identical to one that scored.
- **The Occurrence Log names the observation behind each row.** It showed a description and nothing else; it now resolves `source_ref` into the module and reference — the trip, or the block and run — and links back to Compliance.

## [1.5.133] - 2026-09-06

- **Performance standards are assigned to an agreement, not to the agency (migration 102).** Migration 030 seeded the Attachment G catalog with no contractor dimension, and every assessment period since snapshotted it with a bare `WHERE is_scored=1`. That is correct for one contractor under one agreement and cannot express anything else: not a second contractor, not an amendment that changes a threshold mid-term, not a standard that applies to one agreement and not another. `AgreementStandards` now says which catalog standards an agreement scores and over which months, and `ContractorStandardTiers` gains a nullable `agreement_id` — NULL is the agency default, a row naming an agreement overrides it. An override governs a standard's whole ladder or none of it; a partial override would silently blend two ladders and produce bands nobody wrote. `UQ_CST_Version` is re-keyed to include the scope, since it forbade exactly the row this migration exists to allow. Finalized assessments are untouched: `AssessmentPeriodStandards`/`AssessmentPeriodTiers` already snapshot the governing rules per period and `rule_set_sha256` hashes them, so an issued period recomputes to the same numbers. Re-runnable; requires migration 102 on dev.
- **`UX_PA_Active` permitted one active agreement per *database*.** The filtered unique index was keyed on `is_active` alone, so the schema forbade a second contractor outright. It is re-keyed on `(contractor_id, is_active)`.
- **Administration › Performance Standards.** The catalog is now editable from the console: tier bands, priority, unit, direction, measurement source, resolver key, responsible team, owner and effective dates, plus adding new occurrence-based or threshold-based standards. Attachment G reserves the right to amend a threshold by amendment and the design has always said a contract amendment should be a data edit; until now it was a SQL migration. Saving a ladder closes the open version the day before the new one begins and inserts a new dated version, inside one transaction, so a concurrent compute sees the old ladder entire or the new one — never a half-applied band set — and periods already opened keep what they were scored against. A standard's `code` is fixed once created, because resolvers, the candidate poll and migration 088's dismissal rule all match on the literal string. All writes are `OCC.Admin`; no new Entra app role.
- **Performance Agreements can be created and amended.** No code path anywhere created one — migration 032's insert was a one-time backfill guarded by `NOT EXISTS`, so a contractor added through the console afterwards got no agreement, `complianceCandidatesPoll` then threw `50002` on every run, and no assessment period could be opened. `GET/PUT /performance-agreements` and `PUT /performance-agreements/{id}/standards` close that. Creating an agreement seeds its assignments from the catalog; assignments are merged, never deleted, because a period that already scored a standard has to keep resolving the row it scored.
- **An assessment period whose agreement assigns nothing is refused.** It would previously open, snapshot an empty rule set and compute a $0 assessment indistinguishable from a clean month. The error names the page that fixes it.
- **The Performance Assessment module's Standards tab shows the governing numbers.** It rendered a tier label and a dollar amount and nothing else, so a manager could not confirm from the console that on-time performance tier 1 is the 75–80% band. It now shows bounds, qualifier, CAP trigger, measurement source, owner and responsible team, flags an automated standard with no resolver behind it, and stays read-only — linking administrators to the new page.
## [1.5.132] - 2026-09-06

- **An expired sign-in no longer reads as a server outage.** `getToken` returned `null` whenever silent token renewal failed, and the shared API client sends the request regardless - just without an `Authorization` header. Easy Auth then attached no `x-ms-client-principal`, `requireRole` answered `401 "Not authenticated."`, and each module reported that in its own words: on 2026-09-06 the Decision Matrix admin workspace showed four panels saying the database was reachable and the fault was worth investigating, about an hour into a working session. Nothing was wrong with the database, and no request had reached it. `getToken` now throws a 401 `ApiError` naming the expired sign-in instead of returning `null`, so the request never leaves without an identity. Only `InteractionRequiredAuthError` used to trigger a re-authentication redirect, which missed the common case: silent renewal runs in a hidden iframe, so a browser blocking third-party cookies fails it with a `BrowserAuthError` and fell straight through to `null`; both now redirect. The Decision Matrix admin workspace tells an expired sign-in from a genuine fault and says it once at the top rather than in all five panels, and its failure copy no longer asserts the database is reachable - a claim it was in no position to make, since these requests never got that far.

## [1.5.131] - 2026-09-05

- **Release notes are one file per release, not one list everyone edits.** `changelogData.ts` was a 1,200-line array that every branch appended to at the top, so two branches open in the same release window always conflicted there, whatever they had actually changed - eight consecutive pull requests did, none of them over code, and main carries a commit (`244c6f0`) whose entire purpose was splitting two entries that had been merged into one. Each release is now its own file under `src/routes/changelog/`, collected with `import.meta.glob` and sorted by the `version` inside it; the filename has no effect on ordering. Two branches adding a release now write two different paths and merge without anyone arbitrating. The 126 existing entries were migrated mechanically and checked to produce a byte-identical list, order included. New files are named after the change rather than the version - `changelog/README.md` explains why: a name like `v1-5-128.ts` collides, because both branches read the same main and both believe 1.5.128 is next.
- **The build version now comes from `CHANGELOG.md` rather than the entry list.** `import.meta.glob` is rewritten by vite when it transforms application code, not when esbuild bundles `vite.config.ts`, so the config can no longer import the assembled entries - it reads the newest `## [x.y.z]` heading from the markdown instead. `changelogData.test.ts` already asserted the markdown and the entries name the same newest release, so the two cannot drift.

## [1.5.130] - 2026-09-06

- **The on-demand departures poll says how well labelled its rows are, and what a nameless Spare driver record looked like.** Migration 100 is applied on dev and the poll has run against it, yet the console still shows no driver names; from outside the app nothing says whether Spare returned no name, a differently shaped record, or a name that never reached the row. Each run now logs the label backfill's outcome even when it had nothing to do, followed by coverage for the last 30 days (rows with a driver id, named, with a driver identifier; with a vehicle id, with a fleet number), and warns once per record shape when a Spare driver record yields no name, giving its field names and whether each name field was set, blank or absent. Values are never logged. No API or console change.

## [1.5.129] - 2026-09-06

- **`ON_DEMAND_MONITORING_ENABLED` is declared in Bicep.** The activation gate for on-demand service-quality monitoring — read by both `onDemandSpareReconcile` and the `/on-demand-risks` read contract — existed only as an app setting nobody had set, and was absent from `infra-phase1/modules/functionapp.bicep`, whose appSettings block is the complete desired state. Setting it by hand would have been removed by the next routine infra deploy, which is exactly how `ACS_ENDPOINT` was lost on 2026-09-05. It now has a parameter at both template levels and an explicit `false` in the dev parameters file, so turning monitoring on is a one-line parameter change and a deploy rather than a Portal edit with a shelf life. `ON_DEMAND_MONITORING_SERVICE_IDS` ships with it: empty means the hourly reconciliation reads every Spare service the API key can see, so declaring the switch without its scope would leave the first person to flip it reconciling services that are not MVTA Connect. It is deliberately not defaulted to `SPARE_MISSED_TRIP_SERVICE_IDS` — ADR 0026 keeps missed-trip policy from deciding whether on-demand risk is trustworthy. Both default to off/empty: this declares the switch, it does not throw it.

- **A missing operational zone version no longer sheds two of every five Spare deliveries.** `storeOnDemandSpareRequest` throws when no zone version is active, and the webhook receiver called it without checking. The intake gate can only read a throw as a failure, so each one armed the fifteen-second cool-down, which then refused `vehicleLocation` and `dutyMatchingStatus` deliveries that need no zones at all. On dev, where no zone version has been active for at least a day, that was 1,012 errors in three hours and roughly 40% of all deliveries answered 503 - while the console still read Not connected, so nothing was gained by any of it. The receiver now checks for active zones inside the gate and, when there are none, skips the monitor write and accepts the delivery; `spareMissedTripsIngest` has guarded its own run this way since #128. The gap is warned about once a minute rather than once per delivery (`PeriodicLog`), and the ETA path checks before its outbound Spare reads instead of after. No API, data, or configuration changes - and the underlying gap is unchanged: no zone version is active on dev, and no production code path can import one.
- **On-Demand Service Quality stops reporting zero risks it has no source for.** With the monitor unconnected, the sign-in expired, or the first fetch still in flight, the four summary tiles read `0`, `0`, `0` and `0 min` - an all-clear drawn from an empty array the API had deliberately emptied, sitting directly above an empty state that correctly said the opposite. They now read `—` in those three states. A reconciliation that successfully found no active service, and last-known records held from a degraded source, are real claims and still count.
- **A feed-trust banner now shows its severity.** `KpiTrustSummary` has always emitted its state as a modifier class, but no stylesheet defined one, so an `unavailable` feed was painted the same accent blue as an informational note - two banners, one warning and one not, identical on screen. Stale and current-but-empty are now amber, unavailable red, current green, matching the tones the Feed Health table already uses.

## [1.5.128] - 2026-09-06

- **Migration 101: the list-valued Messages columns hold JSON arrays, all of them.** `routes_affected`, `stops_affected`, `zones_affected`, `tags` and `channels` are declared JSON arrays and every current writer stores one, but rows from before that convention hold a comma-separated string (`web,sms`) - the row that failed the Audit Log search in v1.5.119. The readers tolerate both shapes since then; this migration retires the old one so the schema comment is true again. Each legacy value is split on commas, trimmed, JSON-escaped and re-joined in its original order; blank strings become NULL, which already meant "none". Values that are already arrays are untouched, and the script reports the per-column count before and after (the after row must read all zeros). Re-runnable. No code changes; requires migration 101 on dev.

## [1.5.127] - 2026-09-05

- **The console's version stops being a line every branch has to fight over.** Eight consecutive pull requests conflicted on `frontend/packages/onboard-console/package.json`'s `version` and on the changelogs above it - never once on code. Twice the worse thing happened instead: two branches picked the same number, wrote identical text, and git merged them with no conflict at all, so a duplicate version reached main and was caught only because someone went looking. The number now has one home. `vite.config.ts` reads `CHANGELOG_ENTRIES[0].version` - the newest entry in the file that already had to be edited to describe the release - and `package.json`'s `version` is set to `0.0.0` and is no longer the product version; nothing in CI or the workflows ever read it. One file to edit per release instead of two, and the displayed version can no longer disagree with the "What's new in v..." entry beside it.
- **A duplicate or out-of-order version now fails the build.** `changelogData.test.ts` checks that every version is unique, that releases are listed newest first, that versions are numeric - the newest one is now the build version - and that `CHANGELOG.md` and `changelogData.ts` agree on what the newest release is. Two branches choosing the same number is still possible, because both read the same main; it is no longer silent. This is the check that would have caught both duplicates that shipped.

## [1.5.126] - 2026-09-06

- **Fleet numbers and driver names are backfilled onto earlier on-demand departures.** Migrations 099 and 100 added the label columns, but the poll's working set only revisits today's, yesterday's and still-undeparted duties, so every row stored before them kept its ids. `onDemandDeparturesPoll` now ends each run with a bounded backfill: the newest 300 rows of the last 60 days that carry a vehicle id without a fleet number or a driver id without a name or identifier are labelled through the same once-a-day-per-id resolvers, touching only the label columns. It runs after the feed's health is recorded, so a backfill failure is logged and never reads as a failed departures feed. At MVTA's volumes the whole window is labelled within a few runs. No migration.

## [1.5.125] - 2026-09-06

- **The Subscribers admin page no longer crashes on an empty table.** `GET /manage/subscribers/summary` computes four of its five figures with `SUM(CASE ...)`, and SQL Server returns NULL for a SUM over zero rows, so with no subscribers on dev the API sent `sms_confirmed: null` (and friends) against a contract that promises numbers. The page's stat cards called `toLocaleString()` on the first null and the route fell into the console's "This view needs to be tried again" screen. The query now coalesces each figure to 0, the handler normalises the row through `lib/subscribersSummary.ts` so the contract holds whatever the table contains, and the cards default a missing value to 0 so an unexpected null can never take the route down again. Found in the same post-#178 smoke test as the Audit Log fix: the endpoint had never returned a real response before. No API shape or schema changes.

## [1.5.124] - 2026-09-06

- **Driver names in the On-Demand departures view, and no more empty Duty column.** The Operator column showed Spare's opaque driver id while the fixed-route view names its operators, and the Duty column showed a fallback id on every row because MVTA's duties carry no identifier in Spare. `onDemandDeparturesPoll` now resolves each driver once through `GET /v1/drivers/{id}`, the way it resolves fleet numbers, and records the name in the fixed-route feed's "Last, First" order plus Spare's driver identifier when the agency keeps one, in `OnDemandDepartures.driver_name` and `driver_identifier` (migration 100). This reverses the ids-only stance of v1.5.108 for drivers, on the reasoning that reviewing garage departures is reviewing an operator's departures and the fixed-route view already names them; contact details are never read. `GET /on-demand-departures` returns both, and the view shows the name with the identifier beside it as a badge and the Spare id on hover, grouping by driver under the name; a driver the poll has not resolved yet still shows as the short reference. The Duty column is left out when no duty in view has a Spare identifier, and every row carries its Spare duty id on hover for lookup. Requires migration 100 on dev; until then departures are recorded without names and the poll says so.

## [1.5.123] - 2026-09-05

- **The Decision Matrix admin workspace says which migration it is waiting on, per surface.** Administration › Decision Matrix read four endpoints through one `Promise.all` with one `catch`, so any single problem printed "Decision Matrix governance data could not be loaded." and blanked all four sections. That message was wrong in both directions: it called an unmigrated database an outage, and it hid three working surfaces when one failed. The four surfaces are backed by four different migrations — governance queue and authoring by 076, audit history by 078, legacy candidates by 079 (with 051's rows), Match Rules by 080 — so "not connected" was never one condition here. `GET manage/decision-matrix/governance-queue`, `/audit`, `/match-rules` and `/legacy-candidates` now probe for their own tables and answer 200 with `diagnostics.table_ready` and `diagnostics.required_migration`, the migration number coming from the server because that is where the table lists live. The console reads them independently: a header banner distinguishes **not connected** (nothing has run) from **partly connected**, naming only the migrations actually missing, and each section reports its own state in place. A surface that genuinely fails now says so as a fault worth investigating, and no longer takes its neighbours down with it. The Create Draft and Add rule forms are withheld rather than offered when their tables are absent, since submitting either could only 500. No migration; no change to any surface once its tables exist.
- **Recorded that migration 079 has in fact run on dev.** A table listing shows `DecisionMatrixLegacyMigrations`, which only 079 creates — so the HANDOFF note claiming all four Decision Matrix migrations were unrun was wrong, and the missing run records prove nothing either way. The note is corrected; 076, 078 and 080 remain genuinely unconfirmed.


## [1.5.122] - 2026-09-06

- **Integrations & Data Health rebuilt around the two questions it answers.** The page opened on eight identical blue banners followed by a card whose KPI trust rows packed every dependency's delivery, coverage, contract, and last failure into one run-on sentence, and whose Check feeds control was an unstyled browser-default button (`.button-secondary` never had a rule). It now opens on a summary strip - KPI streams current, feed connections reachable, oldest required ingestion, and Check feeds - then a board of one card per KPI trust stream, each naming the console module it gates. A degraded stream lays its dependencies out as rows (required or supporting, contract, when it last landed, in the tone of its own state) with the last failure reason called out; a current stream collapses to chips. Attention-first ordering keeps unavailable and stale streams at the top, with a By module switch. Feed checks are a real table (feed, last success, records, status) with a failed check's reason under its row, and reachability counts configured sources only. Trust loads as the page opens; the vendor checks stay an explicit action, and running them refreshes trust so both halves describe one moment. `KpiTrustSummary` and `FeedHealth` are replaced by `IntegrationsHealth`; the state labels, tones, and stream names move to `kpiTrustPresentation.ts`. No API changes.

## [1.5.121] - 2026-09-06

- **Garage Departures, On-Demand: the same reading and the same judgement as Fixed Route.** The On-Demand view still printed the stored service date, repeated the date in every time cell in the browser's zone, marked a schedule taken from the duty's requested start with an asterisk and a footnote, and showed the driver and any unidentified duty as 36-character Spare ids. `GET /on-demand-departures` now judges each row with `lib/onDemandDepartureOutcome.ts`, which mirrors the on-demand half of the candidate rule (v1.5.113: settled service day, a scheduled start, the duty not cancelled, and either no departure or one past the allowance) and returns an `outcome` (`late`, `no_departure`, `departed`, `cancelled`, `no_schedule`, `not_settled`) plus `judged_count` and `settled_before` in diagnostics; the late and no-departure counts and the average are taken over judged duties only, so a cancelled duty or today's still-moving ones no longer dilute them. The console groups duties under a band per service day, driver or vehicle (by fleet number where Spare gave one, else by Spare reference, with a Repeat flag), formats the day and Central times as the fixed-route view does with the scheduled and actual source printed under each time instead of the asterisk, shows the driver and an unidentified duty as an eight-character reference with the full id on hover, says "No driver on duty" instead of a dash, adds a Flagged-only filter and a per-day strip, and marks today's duties Not settled. Late is red here as in the fixed-route view, since both now raise candidates. The per-day strip and the Group by control moved into the shared module code both views use. No migration.

## [1.5.120] - 2026-09-06

- **Garage Departures, Fixed Route: read as a reviewer, judged as the contract does.** The view printed the stored service date (`20260904`), repeated the month and day in every Scheduled and Actual cell in the browser's own time zone, showed Avail's operator string as sent (`HAWTHORNE, PORSCHE -144`), and coloured only two statuses - one of them `Late Relief`, a mid-shift changeover the feed has never emitted, which is also what the "Late pullouts" card counted, so it read 0 forever while `Missed Pullout`, `Missed Login` and `Late Pullout` rendered as neutral grey. Its counts applied neither the ten-minute allowance nor the settled-day guard the compliance candidate poll applies, so the module could disagree with what reached the assessment queue. Now `GET /fixed-route-departures` judges every row with the poll's own rule, moved into `lib/fixedRouteDepartureOutcome.ts` so both read one implementation, and returns an `outcome` per row (`late`, `no_departure`, `departed`, `unresolved`, `no_schedule`, `not_settled`) plus diagnostics counted by it - `settled_count`, `late_count`, `no_departure_count`, the `variance_seconds` and `settled_before` they used; `expired_count` is gone. The console groups rows under a band per service day (newest first, the runs needing attention first within a day), or per operator or vehicle with the most reviewable runs first and a Repeat flag, formats the day as "Fri, Sep 4, 2026" and pullout times as time-only in Central, splits the operator into a cased name and a badge reference, sets the fleet number in tabular numerals, says "No operator on record" instead of a dash, shows the delta signed with a real minus and red only over the allowance, keeps Avail's status as evidence beside a new Outcome column, adds a Reviewable-only filter and a per-day strip of reviewable departures, and states the allowance in the toolbar and the cards. Today's runs are labelled Not settled rather than looking clean. No migration; the On-Demand view is unchanged.
## [1.5.119] - 2026-09-06

- **The Audit Log's message search no longer fails on a legacy row.** `GET /manage/messages` answered 500 on dev the first day its route was reachable: one Messages row stores `channels` as `web,sms` rather than the JSON array every current writer produces, and `JSON.parse` on it threw inside the row map, taking the whole result with it. The same parse sat in the public active-messages feed and the suggested-alerts list, so a legacy row could have blanked rider-facing alerts too. All list-valued Messages columns (channels, tags, routes_affected, stops_affected, zones_affected) are now read through one lenient parser (`lib/stringList.ts`): a JSON array is parsed as before, anything else is split on commas, and nothing throws. No schema or API shape changes.

## [1.5.118] - 2026-09-06

- **Fleet numbers in the On-Demand departures view.** The Vehicle column showed Spare's opaque vehicle id while the fixed-route view shows Avail's fleet label. `onDemandDeparturesPoll` now resolves each vehicle's identifier - Spare's name for the fleet number, the spec's Vehicle Report Label - through `GET /v1/vehicles/{id}`, once per vehicle per day with a failed read remembered for an hour, and records it in `OnDemandDepartures.vehicle_identifier` (migration 099). `GET /on-demand-departures` returns it, and the view shows the number with Spare's id on hover, falling back to the id until the number is known. Not personal data: it names the bus, not the driver. Requires migration 099 on dev; until then departures are recorded without the label and the poll says so.

## [1.5.117] - 2026-09-05

- **Say when the Decision Matrix is not connected instead of calling it an outage.** `GET /decision-matrix` checked nothing before querying, so a database without migration 076's Procedure tables produced the same `500 "Decision Matrix content is temporarily unavailable."` as a genuine failure - the one message that sends a controller looking for an incident that isn't happening, and the diagnostic the pre-governance endpoint used to give. It now probes for the five tables the reader joins and answers 200 with `diagnostics.table_ready`, matching what Fixed Route Departures, the Dispatch Log and OTP already do. The console splits the four ways the Matrix can come up empty: **not connected** (no Procedure tables - the message names migration 076, and 078, 079 and 080 for governance, legacy migration and recommendations), **unavailable** (the request failed), **nothing approved yet** (connected, but no Admin has published a revision - which is where dev stands today), and no match for the current search. The Procedure count in the controls bar reads *Not connected* or *Unavailable* rather than a misleading "0 approved Procedures". No migration; no change to what the reader shows once content exists.
- **Turn on the Decision Matrix severity rail.** The module's stylesheet has carried a severity indicator since the reader was built - a red left rail on a list row and a red top rail on a grid card for `Stop service`, orange for `Restrict service`, green for `Routine / no escalation` - and nothing ever set the class, so every Procedure rendered with the neutral rail and severity reached the controller as text buried in the expanded detail. The reader and the Grid now set it from the record. A severity outside the three the database constrains keeps the neutral rail rather than borrowing a colour it has not earned, and each row and card carries a screen-reader-only "Severity: …" so the cue is not colour-only for assistive tech. Sighted colour-only distinction in the collapsed row and the Grid card is left for the controller validation pass, which has to judge it against the real reader layout. The same stylesheet's `.dochead`, `.docfoot` and `.dmx-context` rules are deleted: they styled a printed-document header, footer and callout that no component has rendered since the governed reader replaced the static Matrix.

## [1.5.116] - 2026-09-06

- **KPI trust banners moved to Admin > Integrations & Data Health.** The seven module-top trust banners (Fixed Route Service Risk, On-Demand Service Quality, Garage Departures on both sides, Missed Trips, OTP, Event Monitoring) are gone from the modules and now appear together at the top of the Integrations & Data Health page, above Feed health, loading as the page opens rather than after Check feeds. One banner when every stream is current; otherwise one per stream, each named for its module (the two streams previously both labelled "On-demand" now read "On-demand wait times" and "On-demand missed trips"). The action guards are unchanged: a stale stream still blocks automatic Suggested Alert preparation and still asks for a stale-data acknowledgement inside its module. No API or data changes.

## [1.5.115] - 2026-09-06

- **The on-demand zone monitor can run for the first time.** The GTFS-Flex parser, the point-in-polygon resolver and the versioned zone schema have existed and been covered by tests since migration 074, but nothing ever called them outside a test file: there was no fetch, no writer, and no activation path, so `OnDemandOperationalZoneVersions` was empty and `loadActiveOperationalZones` - which joins zones to an *active* version - returned nothing. Every on-demand pickup therefore resolved against an empty snapshot; the hourly reconciliation and the Spare webhook both threw `No active on-demand operational zones are available`, and #130 had already had to decouple missed-trip ingestion from that failure so it would stop taking a pipeline down with it. A new `onDemandZonesSync` timer (daily at 09:30, after the static GTFS sync, gated by `ON_DEMAND_ZONE_FLEX_URL`) fetches the GTFS-Flex archive, hashes the raw bytes, and imports the version. Import is idempotent on `(feed_version, source_sha256)` - the natural key the schema already declared - so a daily poll of unchanged geometry is a recorded no-op rather than a new version row every morning, and a republished `feed_version` whose contents moved is still recognised as a change. A new `on_demand_zones` feed joins the On-Demand KPI trust contract as a *supporting* dependency: a service area that has not changed in a year is correct rather than stale, so it carries no freshness deadline and only a never-imported feed reads as a fault. Being supporting, it does not put the On-Demand stream back into `contract_pending`.
- **Zone activation is a deliberate act, except for the first one.** `GET /api/on-demand-zone-versions` lists every imported version with its zone count, hash and active flag; `POST` with a `version_id` activates one, admin-only. Imported versions arrive inactive, because activating swaps the boundaries a live monitor resolves pickups against and changes which requests are judged in-zone - the schema says as much, with `is_active` defaulting to `0` and a filtered unique index permitting exactly one active row. The one exception is an import made while *nothing* is active: there is no live geometry to protect, and holding the very first import for a manual step would only keep the monitor down longer. The swap clears the previous active row before setting the new one, in one serializable transaction, because the filtered index rejects the naive ordering. Activating a version with no zones is refused rather than reported as success - it would take the monitor down exactly as having no active version does.
- **The expected zone set moved out of code.** `loadOperationalZones` fails closed when the feed does not contain exactly the expected Operational zones, which is the right guard - a feed that silently lost a zone would shrink the monitored service area with nobody noticing - but the two MVTA Connect location ids were pinned in the source, so adding a third zone or absorbing an upstream location-id rename meant a code change and a deploy, with every import failing until it landed. `ON_DEMAND_OPERATIONAL_ZONE_IDS` now supplies that set, defaulting to the two-zone pilot when unset, so behaviour is unchanged where the variable is absent. Both new settings are declared in Bicep rather than left to the Portal, for the reason #156 established: the app-settings list is the complete desired state, so a hand-set value survives only until the next infra deploy.
- **A manual seed, because no feed URL is known.** The GTFS-Flex source is documented nowhere in this repository, so `ON_DEMAND_ZONE_FLEX_URL` is empty and the daily importer skips and warns. `node dist/src/scripts/importOnDemandZones.js <archive.zip>` seeds the zones from an archive on disk instead, sharing every code path with the timer - same parser, same hash, same transactional write, same first-import activation - so a version seeded by hand is indistinguishable from a polled one, and a later poll of the same bytes is recognised as already imported rather than duplicated. It parses before touching the database, so a malformed archive or one missing an expected zone fails before a transaction is opened. Setting the URL later needs no code change.
- **Activation is attributed (migration 098).** `OnDemandOperationalZoneVersions` recorded `imported_by`, but importing is the harmless half; activating is what changes which requests are judged in-zone, and it left no trace in the database - only a line in the Function App's logs, which is not where anyone reviewing a disputed zone assignment will look. `activated_by` and `activated_at` are now written by both the endpoint and the first-import activation, and returned by `GET`. Both are nullable: versions activated before this migration record NULL rather than a fabricated actor. The columns are read only once they exist, so activation and the listing both work on a database the migration has not reached yet.

## [1.5.114] - 2026-09-06

- **OTP Compliance administration moves into the Administration workspace.** The OTP module's own **Administration** and **Threshold Tuner** pages are gone from the Compliance tab; both now live at **Administration › OTP Compliance**, behind the same `OCC.Admin` gate as every other configuration surface. They were reachable by anyone with plain `OCC.Compliance` access even though the writes behind them are Admin-only server-side, so the pages offered edits that would 403 - and the settings they change (reason codes shown in Review Queue, the Weather page and Missed Trips; the early/late bias detection threshold) apply to every reviewer, not just the person editing. The new page carries all three reason-code tables, the historical feed backfill, and the threshold tuner with its preview-then-apply slider, which fetches the current month's stop rows itself and seeds from the saved threshold rather than the built-in 15% fallback. The OTP module keeps its six reviewer pages and still reads the threshold and reason codes this page maintains. No API changes.

## [1.5.113] - 2026-09-06

- **Garage-departure compliance candidates from both service types, with the source discriminator ADR 0028 required first.** `complianceCandidatesPoll` now writes `FixedRouteDepartures:avail_pullout:{date}|{block}|{run}` for the Avail side and `OnDemandDepartures:spare_duties:{duty_id}` for the Spare side, so one physical departure can never be raised twice against `GARAGE_DEPARTURE`; migration 097 rewrites every pre-existing fixed-route reference into the new shape, whatever its review status, because the MERGE deduplicates on it. The on-demand rule mirrors the fixed-route one on timestamps alone, since Spare has no status ladder: a settled service day, a scheduled start, a duty that was not cancelled, and either no departure from either source or a departure more than `GARAGE_DEPARTURE_VARIANCE_MINUTES` late. Its description names the duty and which source measured the departure. Each departure feed is now gated on its KPI trust stream, current or current-but-empty (the poll runs at 01:20 agency-local, when a departures feed has legitimately been quiet for hours), and a missing `OnDemandDepartures` table simply means the Spare half is absent. Requires migration 097 on dev before the next 06:20 UTC run.

## [1.5.112] - 2026-09-05

- **The console's admin API endpoints are reachable on Azure for the first time.** Nineteen HTTP functions - Decision Matrix authoring, governance, match rules, legacy-candidate migration, and the retired sync stub; expiration defaults; admin message search; the subscriber summary - declared routes under `admin/`. Azure Functions reserves that prefix for its own runtime endpoints, so at every host start the runtime logged "The specified route conflicts with one or more built in routes" for each of them and never registered them; on `func-mvta-restapi-dev` they have answered 404 since they were added (the local emulator is more lenient, which is why this was not caught). Every one of those routes now lives under `manage/` (`/api/manage/decision-matrix/...`, `/api/manage/expiration-defaults`, `/api/manage/messages`, `/api/manage/subscribers/summary`), and the shared API client, tests, and docs follow. Authorization is unchanged: the role checks live in each handler via `requireRole`, not in the path. The Decision Matrix admin pages, the expiration-defaults editor, and the audit log's message search should be smoke-tested on dev after deploy, since this is the first deploy on which they can succeed.

## [1.5.111] - 2026-09-05

- **Service Operations shows each role only what it can use.** The communications side - Dashboard, Overview, Compose, Active Service Alerts, Suggested Alerts - reads the API's staff roles, so users outside them (the SST desk's `OCC.TripStartVerify`, Compliance-only readers) used to see links and tabs that answered 403. Per ADR 0015 those links and tabs are now hidden for such roles, the group header stays only while at least one child is reachable, the Service Operations header reads "Monitoring workspace" for them, the communications routes are role-gated like every other, and "/" lands them on the Dispatch Log (or Compliance, or Detours) instead of a Dashboard built from data they cannot read. No API changes.

## [1.5.110] - 2026-09-05

- **The Spare webhook receiver can no longer take the app down.** On 2026-09-05 it did: Spare delivers about 5,000 events an hour through a service day, nine in ten of them vehicle locations, and once an operational zone was active every delivery re-read the zones and ran a MERGE. On the single B1 core, sharing a ten-connection pool with every poller, deliveries queued for minutes each, hundreds sat in flight, and the worker pinned at 100% CPU until not even `/api/health` answered; a restart bought minutes. The receiver now puts every database touch through an intake gate (`lib/spareWebhookIntake.ts`): at most four deliveries inside at once, an eight-second budget each, and fifteen seconds of immediate 503s (with `Retry-After`) after a timeout or failure, so a wedged pool is refused rather than queued on. Vehicle-location deliveries for the same duty and vehicle are coalesced to one write a minute, since a second sighting seconds later carries no new fact; a vehicle change is always written. The active zones are cached for a minute and the last good set is served through a failed refresh. The contract diagnostic logs a payload's field names only the first time that set is seen per event type. No API or data changes; timers keep reading zones directly.

## [1.5.109] - 2026-09-05

- **Detour Reports rebuilt around status, with an export you can read before you download it.** Status is now a tab bar with per-status counts and opens on **Active** — the question the page is opened with is almost always "what is out there right now". That tab bar replaces a status dropdown *and* a separate Show/Hide history toggle which between them decided the same thing twice; each tab's count describes what the other filters already allow, so an empty tab says which other status still has matches instead of going blank. Search is now the full-width control; source, reason, severity and the two date bounds moved into a Filters drawer that carries a count badge, and every applied filter shows as a chip you can drop individually. Clear filters deliberately keeps the status tab. The table went from fifteen columns to seven plus a disclosure control — Avail number, path, workflow, reason, severity, source and provenance moved into the expanded record, which is now a labelled definition grid rather than a stack of dim sentences; rows disclose through a real button with `aria-expanded`, so the record is reachable from the keyboard for the first time. The export now opens a preview first: the exact file name, the row and column counts, the filters it was taken under, and the rows themselves, with **Download CSV** and **Open in browser** (the same export rendered as a standalone HTML page in a new tab) side by side. The preview and the file are generated from one table, so they cannot drift apart. No API or data changes.
- **Removed: the Legacy spreadsheet history panel.** The imported-rows table, its Show/Hide toggle and the CSV/JSON upload inside it are gone from Detour Reports. Note that the upload was the console's only path for importing retired-tracker rows — `POST /detours/historical-imports` and every row already imported are untouched, but there is no longer a screen that reaches them.

## [1.5.108] - 2026-09-05

- **Garage Departures gains its On-Demand half.** ADR 0028 made garage departure one concept with one source per service type, and until now only the Avail half existed. A new `onDemandDeparturesPoll` timer (every fifteen minutes, gated by `ON_DEMAND_DEPARTURES_ENABLED`) measures each on-demand duty from Spare: the duty's start-location slot gives the scheduled and started times when Spare has one, else the duty's requested start and its first sighting in the service area stand in, and each side records which source it was. Which duties to measure is learned from the requests the missed-trips ingest already stores, so the on-demand service scope is inherited and fixed-route duties can never enter this path. Rows land in `OnDemandDepartures` (migration 096), one per duty, ids only - no driver names, rider data, or raw payloads. `GET /on-demand-departures?days=` serves the window with the same diagnostics shape as the fixed-route endpoint plus the variance allowance its counts use, and a `spare_duties` feed backs a new `on_demand_departures` KPI trust stream. In the console the Compliance tab's Fixed Route Departures module becomes **Garage Departures** with a Fixed Route / On-Demand switch; each view keeps its own fetch and summary so a source that is not connected cannot borrow the other's numbers. No compliance candidates are raised from on-demand departures yet; that step needs the source discriminator on the garage-departure MERGE first. Requires migration 096 on dev and the new app setting.

## [1.5.107] - 2026-09-05

- **Dispatch Log, step 6: the SST OCS desk records verifications.** Decision §7.1 landed - SST OCS staff record them - so the buttons that have sat disabled in the Grid, Watch, and inspector now work for holders of a new additive Entra role, `OCC.TripStartVerify` (plus Admin for corrections). `POST /trip-start-log/verify` records observed on time, observed left late, or not observed (or clears the cell), upserting the current observation and appending every change to a new `TripStartVerificationEvents` audit table (migration 096). In the console the Grid's Verified cell is the workbook's one-click cycle - blank, on time, left late, blank - showing the signed-in user's initials; the Watch's rotation items carry On time / Left late; and Record disposition (Watch and inspector) asks for a note and records not observed, the workbook's "leave blank and follow late-route procedures" made explicit. The auto-computed status stays beside the observation, never instead of it, and pollers never touch it. Read-only roles see the same buttons disabled with the reason. The role must be registered on the app registration and assigned to SST OCS staff before anyone can record (runbook updated). Requires migration 096.

## [1.5.106] - 2026-09-05

- **Dispatch Log, step 7: CSV export.** `GET /trip-start-log/export?date=YYYYMMDD` returns one service date as a UTF-8 CSV (byte-order mark and CRLF so Excel opens it cleanly) with the workbook's columns first, in the workbook's order - Verified, Day of Week, Start Time, Block, Route, Origin Stop Name, Direction - followed by what OnBoard adds: rotation membership, the observation and when it was recorded, scheduled and actual instants, the actual's source, the delta in minutes, start status, service date and trip id. Same readers as the JSON endpoint, and both now read the day through one shared loader so they cannot disagree. The Dispatch Log's controls bar gains an Export CSV button that downloads the whole day (the workbook was the whole day, not a filtered view), enabled once the day's log exists, with a plain message if the export fails. No migration.

## [1.5.105] - 2026-09-05

- **Stop listing garage-departure statuses MVTA's configuration cannot produce.** Avail confirmed that MVTA has no operator scheduling package, so it never ingests the data that raises `Missing Operator Assignment`, `Missing Vehicle Assignment`, `Invalid Vehicle Assignment`, `Duplicate Vehicle Assignment` or `Missed Check-in`. They are not rare here, they are unreachable, and since none has ever reached the feed there is no spelling to match on - Avail's guidance was to use the spelling the feed sends. They were listed on the reasoning that an allowlist which omits a status fails by going silent; that reasoning holds, but five strings that can never match read as coverage while providing none. They are removed from the compliance rule and from the poll's known-status set, so if MVTA later adopts a scheduling package and they begin arriving, the poll reports them with their real spellings instead of passing over them.

## [1.5.104] - 2026-09-05

- **Detour Intake redesigned.** The form is now five numbered section cards (Situation, Map, Affected service, Instructions and communications, Evidence), each with a status pill, beside a sticky readiness rail that shows progress, links to every missing required field, and holds Submit. Every field shares one anatomy - label, required mark, control, always-present helper line - so validation never shifts the layout, and error styling appears only after a submit attempt. The operating window is one fieldset with a segmented status control; service impact is a two-card choice; route segments are a small table; affected stops and required audiences are removable tokens (each audience is one exact string, which is what communication status matches on); required channels are toggle chips over a known set with an Other escape; supporting files use a drop zone with per-file tiles. No API or data changes.

## [1.5.103] - 2026-09-05

- **Dispatch Log, step 5: actual start times from GTFS-RT (backend only).** The feed check the spec required was done first: MVTA's TripUpdate feed keeps a passed stop in a trip's list for about fifteen minutes with a realised time, revises it occasionally, then drops it, and its stop sequences are not contiguous. A new `tripStartActualsPoll` timer reads the feed every minute and, for today's and yesterday's `TripStartLog` rows, records each trip's first-stop departure once it is behind the feed clock (source `trip_update`), keeping it current while it lingers; remembers the departure prediction beforehand (migration 095 adds `predicted_start_at` and `actuals_updated_at`) so the last prediction can stand in if the realised window was missed; falls back to vehicle-position evidence after the window, named `vehicle_position`; and marks `missed` from the missed-trip detector and `canceled` from the feed. Under a minute late reads on time; a minute or more is late, which the console already splits at five minutes. The poll fetches the feed directly so its cadence never rewrites the shared feed-health row. `GET /trip-start-log` now also returns `predicted_start_at`. Requires migration 095 on dev.

## [1.5.102] - 2026-09-05

- **Dispatch Log, step 4: the Watch and Timeline views.** Watch is the live monitoring the desk does: *Up next* lists every trip due in the next 90 minutes, rotation trips flagged with inline verify actions (disabled until verification recording lands) and the rest marked tracked, because the rotation alone is too sparse to drive a queue; *Needs disposition* lists missed trips, trips late beyond five minutes, and trips past due with no realtime evidence, ordered by severity then by how long they have waited, each with a disposition action instead of a blank cell. Timeline shows how lateness moves along a block: one lane per block, a hairline tick at the scheduled minute, the chip at the actual start with a slip bar spanning the gap, a hollow chip where there is no actual, and a *now* marker when the day on screen is today. Both views read the shell's filtered rows and shared selection, so narrowing to a route collapses the timeline to the blocks that serve it and a chip picked there is the row highlighted in the Grid. The Watch queue follows the live clock and says so on any other date. No API changes.

## [1.5.101] - 2026-09-05

- **Say so when Avail sends a pullout status nothing accounts for.** The garage-departure rule matches an allowlist of statuses, and a value missing from that list raises nothing without erroring - which is how it once ignored 408 runs that never left the garage while matching a status the feed has never sent. The Pullout poll now warns when a delivery contains a `PulloutStatus` this repo does not recognise, naming the values once per run. That covers a status Avail adds later, and the likelier case: five statuses were added from the vendor's document without ever being observed, and that document already spells one concept differently from the feed. Comparison ignores case, since the rule matches in SQL where case does not matter, and a blank status is treated as a run still being resolved rather than an unknown one.
- **Record that `Missed Check-in` cannot fire yet.** It is defined against the scheduled check-in time and no source feeds operators' scheduled check-in times into OnBoard, so its absence is a data gap rather than evidence the status list works.

## [1.5.100] - 2026-09-05

- **Dispatch Log, step 3: the Grid view, on the console's first shared sortable table.** `SortableTable` (`components/SortableTable.tsx`) is a controlled-sort table with a sticky header inside its own scroll region, an optionally pinned first column, `aria-sort` on every header, click-to-sort that cycles ascending then descending, row selection, and keyboard row navigation (arrow keys, Home/End, Enter or Space to select) - the pieces every table in the console used to roll on its own. The Dispatch Log's Grid puts the workbook's columns on it with Verified pinned first, every column sortable including Verified (initialed rows, then rotation rows still owing initials, then the rest), default order scheduled start ascending, and rows outside today's rotation dimmed but present. Sort state lives in the module shell, so the order carries into the Watch and Timeline slots, which show the Grid until their own views are built. The interim row list is gone. No API changes.

## [1.5.99] - 2026-09-05

- **Dispatch Log, step 2: the console module shell.** A new Dispatch Log tab under Service Operations (`/service-operations/dispatch-log`, staff roles plus Compliance) reads `GET /trip-start-log` for a chosen service date and refreshes on the fixed-route cadence. The shell is everything the three planned views share: a query bar (search, route, start status, All trips ⇄ Today's rotation, Clear only while a filter is set), a summary strip computed over the filtered rows (On time, Left late ≤5, Late over 5, Missed, No actual, Canceled, Start OTP, Awaiting initials - withheld until the day's log actually exists), a Grid / Watch / Timeline switcher, one shared selection, and a persistent inspector below the view with the verify affordance present but disabled until verification recording lands. Until the dedicated views are built every mode shows the same interim row list, so a trip can be selected from any of them. Real empty states for not connected (migration 094 missing), no log for the date, a failed request, and a filter that matches nothing. No API changes.

## [1.5.98] - 2026-09-05

- **Catch the Red conditions that stop a garage departure happening at all.** The `GARAGE_DEPARTURE` rule matched only the four statuses describing how a departure ended. Avail's table documents five more that prevent one: `Missing Operator Assignment`, `Missing Vehicle Assignment`, `Invalid Vehicle Assignment`, `Duplicate Vehicle Assignment` and `Missed Check-in`. None has appeared in 22 days - the first two are suppressed by their own parameters until an administrator enables them, and the rest are rare exceptions - so this changes nothing today. It is added because an allowlist that omits a status fails by going silent, which is how the rule previously ignored 408 runs that never left the garage while looking for a status the feed has never sent. The existing guards apply unchanged: the service day must be over, a pullout must have been scheduled, and the timestamps must show the run never departed or departed beyond the variance. That last point matters for `Invalid Vehicle Assignment`, which the vendor says "holds precedence even after pullout" and so can sit on a run that departed perfectly well.

## [1.5.97] - 2026-09-05

- **Dispatch Log, step 1 of the build (backend only).** Migration 094 adds `TripStartLog` (one row per service date and revenue trip, a growing history that is never truncated) and `TripStartVerifications` (the human layer, empty until a later step), plus the `trip_start_log/rotation_anchor_date` setting. A new `tripStartLogMaterialize` timer at 09:30 UTC, after the 09:00 UTC schedule sync, writes today's and tomorrow's rows from the schedule tables: block, route sign, origin stop, direction, the resolved start instant, and the weekly verification rotation (fixed pool per rotation week, dealt in start-time order with a trip-id tie-break, shifted one day each week). It skips a day the imported schedule does not cover rather than write an empty one, seeds the anchor once from the schedule's earliest date when blank, and excludes routes classified SpecialEvent for the date. `GET /trip-start-log?date=YYYYMMDD` returns the day's rows joined to verifications for the same staff roles that read Fixed Route Departures. `activeServiceIdsToday` moved from the missed-trip poller to `gtfsScheduleHorizon.ts` so both share it. No actuals yet - every trip reads as `unknown` until spec §5 lands. No console changes.

## [1.5.96] - 2026-09-05

- **Judge a garage departure only once its service day is over.** Avail's status table shows `PulloutStatus` is a precedence-ordered ladder whose value moves as a run progresses: `Missed Login` can become `Waiting for Pullout` or `Late Login`, and `Missed Pullout` stops applying once the vehicle is detected on route. Both are intermediate, not verdicts. Because the candidate MERGE only inserts, an occurrence raised against a run that was merely mid-sequence would never be withdrawn once that run departed. The rule now only considers rows whose service day has ended - the poll runs at 01:20 agency-local, three hours after service closes, so the previous day's statuses have settled while the current day's are left alone. The vendor's precedence table is recorded alongside the status list, including why `On Route No Pullout` stays out of it: that status means the vehicle is running and the driver simply did not log on, so it is a missing pullout record rather than a missing departure.

## [1.5.95] - 2026-09-04

- **Stop-ID matching for duplicates and conflicts.** Each record's GTFS stops are derived from its drawn shape (stops within 100 m) and from `#stop_id` markers in its affected-stops text - which is what the map's "add selected stops" writes - so two records that touch the same stop match even when their shapes are far apart or one was never drawn. Shared stops are named in the warning and rank between map matches and route matches. One `GtfsStops` read per list call; no migration.

## [1.5.94] - 2026-09-04

- **Map-based matching for duplicates and conflicts.** When both records carry a drawn shape (migration 091), the likely-duplicate and conflict matcher now treats two shapes within 75 m of each other as the same place - shape-to-shape distance, zero when they touch or one contains the other - independent of how the closure was worded or which routes were listed. Map matches rank above route matches and report "n m apart on the map". Lexical route and place matching remains for records without a drawing. No migration.

## [1.5.93] - 2026-09-04

- **Delivery receipts for emailed Detour communications.** Migration 093 adds per-recipient receipts: the dispatcher records each recipient as accepted with its ACS message id, and a new function-key-protected `POST /api/acs-email-events` endpoint on the dispatch app receives Azure Communication Services `EmailDeliveryReportReceived` events from Event Grid (handshake included), updates the matching receipt (delivered, bounced, suppressed, quarantined, filtered as spam, failed), and recomputes the communication: `delivered` only when every recipient's receipt is Delivered, partial or failed with the offending addresses named otherwise. "Accepted by provider" and "Delivered" are now distinct in the console, and the Sent copy on Detour Reports and Detours & Closures lists each recipient's receipt. Requires an Event Grid subscription from the ACS resource to the endpoint (portal step; the URL carries the function key).

## [1.5.92] - 2026-09-04

- **Delivery view on Detour Reports.** Each expanded Detour lists its communications - audience, channel, recipients, who published and when, and delivery state - with a collapsed Sent copy showing the exact subject, recipients, body, and provider reference the server sent. Detours & Closures shows the same Sent copy beside its composer, and both pages render delivery state through one set of labels.

## [1.5.91] - 2026-09-04

- **Teams delivery for Detour communications.** A communication whose channel is Teams can be posted from the server: publish with `send` freezes the snapshot, posts an Adaptive Card (subject as heading, draft as body) to `TEAMS_DETOUR_WEBHOOK_URL` - its own Key Vault secret beside the event webhook, declared in `functionapp.bicep` - and records sent, failed (retryable, with transient classification), or skipped when no webhook is configured. Inline rather than queued: one webhook call, and the reviewer is waiting on the result. Detours & Closures shows Post to Teams beside Mark published.

## [1.5.90] - 2026-09-04

- **Server-side email delivery for Detour communications.** Publishing with `send: true` freezes the subject, body, and recipients on the row (migration 092 - the immutable sent snapshot), marks delivery queued, and publishes `detour-communication-requested` to Service Bus; the dispatch app's new `dispatchDetourCommunication` trigger sends through Azure Communication Services per recipient and writes back sent / partially_sent / failed / skipped with the provider id or the failing addresses. A failed or skipped delivery returns the communication to a retryable state, and "published" for communication status now requires delivery to have succeeded or a human to have recorded a send. Detours & Closures gains Send email and Retry send beside Open in email and Mark published (sent elsewhere), with live delivery state on each communication. Guarded end to end: without the migration the endpoint refuses; without Service Bus the row reads "delivery not available"; without ACS the dispatcher reports skipped. The queue is declared in `infra-phase1/modules/servicebus.bicep`.

## [1.5.89] - 2026-09-04

- **Map drawing and nearby-stop suggestions for Detour Intake.** The intake form gains a map (Azure Maps, same token path as Event authoring) where the reporter draws a point, line, or area; the GeoJSON is stored on the intake (migration 091) and carried onto the Detour at acceptance. **Find nearby stops** calls `POST /gtfs-stops/near`, which returns GTFS stops within a chosen radius of the shape - exact point-to-shape distance over a bounding-box prefilter - with the routes serving each, from the new `GtfsStopRoutes` index the static GTFS sync now builds from `stop_times.txt`. Selected stops are appended to Affected stops and their routes become segments. The review dialog, Detours & Closures, and Detour Reports show the drawn shape read-only.

## [1.5.88] - 2026-09-04

- **Conflict override on the authoritative Detour.** `GET /detours` now reports, for every open Detour, the other open Detours that share a route number or place word inside an overlapping window (`conflicts`) and a `conflict_status` of none / unresolved / overridden. Migration 090 adds the override columns; `POST /detours/{id}/conflict-override` records a required reason, the actor, and the conflicting ids, and writes a `manual_correction` history row so the warning and the decision stay together. The override covers exactly the conflicts known when it was recorded - a new conflict reopens the question. Confirming an Avail entry (`result: entered`) is refused with 409 while a conflict is unresolved; recording a failed or deferred attempt is always allowed. Detours & Closures shows the conflict with what it shares and an Override-with-reason action; Detour Reports shows it in the Readiness column and the expanded row and exports a Conflicts column.

## [1.5.87] - 2026-09-04

- **Contractor notification (design B15).** Migration 089 seeds two admin settings, `detour/contractor_name` and `detour/contractor_recipients`, editable under Administration → Service Configuration. Once a name is set, every fixed-route Detour (not mobility) requires a published communication to that audience: `GET /detours` returns `required_audiences` (the record's list plus the contractor) and measures `communication_status` against it, and reports the contractor settings alongside. On Detours & Closures the contractor appears in the required checklist as email-to-recipients, Draft prefills the addresses, and an **Open in email** link opens the staff member's mail client with recipients, subject, and body; marking the draft published records "Sent by email to …" as the outcome. There is deliberately no server-side sender - publishing records a human action.

## [1.5.86] - 2026-09-04

- **Drive detour communications from the record's required audiences.** The composer took free-text audience and channel, while the server clears "needs communication" only when every audience the intake named has a published communication under exactly that string - so the status could only be cleared by guessing. The Communications section now shows a checklist of required audiences with their progress (nothing / draft / published) and channels, a Draft button per unmet audience that prefills audience, channel, and a message assembled from the operational record (reference, closure, location, window, routes, instructions, riders, impacts, turn-by-turn, contact), audience and channel selects limited to the record's list with an Other escape, and who published each communication and when. Pure prefill logic in `lib/detourCommunicationDraft.ts` with tests.

## [1.5.85] - 2026-09-04

- **Render detour attachments by type.** Detour Intake accepts PDFs and Office documents as evidence and acceptance re-parents them onto the Detour, but Detours & Closures rendered every attachment through `<img>`, so an accepted PDF showed as a broken tile and the attach control accepted images only. One `DetourAttachmentsSection` now shows images as thumbnails and documents as a labelled tile (type, size) that opens the file, accepts the same file types as intake, and also appears read-only on Detour Reports so the document that went out with a detour is part of the record. Intake's supporting-file list shows a thumbnail beside image links.

## [1.5.84] - 2026-09-04

- **Make the intake list's schema guard actually degrade.** `GET /detour-intake` guarded its optional column groups (migrations 056, 057, 069) with inline template fragments that left a bare comma behind, so on any environment missing one of them the query read `i.created_at , , i.updated_by` and returned 500 instead of omitting the columns. The column list is now built by a pure function tested across all eight readiness combinations. No behavior change where every migration is present.

## [1.5.83] - 2026-09-04

- **Detect likely duplicate intake (spec item 11).** `GET /detour-intake` now returns `likely_duplicates` for every open intake: non-closed Detours and other open intakes whose route numbers or place words overlap and whose operating windows overlap (open-ended windows overlap everything after their start). `lib/detourDuplicates.ts` is pure and tested - route identity is the number without direction suffix; place matching drops road-type, direction, and closure words, and a numbered street alone is not enough. The intake queue flags the count per row, the review dialog lists each match with the shared routes or words, and "Mark duplicate of this" sets the target - replacing the hand-pasted GUID. Detection warns; it never merges or rejects.

## [1.5.82] - 2026-09-04

- **Parse the legacy import like a spreadsheet, not a split on commas.** The importer split each line on `,` and assumed a fixed column order, so any closure containing a comma - most of them - shifted every following cell, and re-importing this page's own export corrupted it. `lib/legacyDetourImport.ts` parses CSV per RFC 4180 (quoted commas, doubled quotes, embedded line breaks, BOM, CRLF) and maps columns by header name with aliases covering the tracker's headings, the JSON field names, and the Reports export. Rows without closure text are skipped and reported by sheet row; unrecognised columns are kept on the row and named. Covered by 12 tests including an export round-trip.

## [1.5.81] - 2026-09-04

- **Show what the legacy import actually imported.** `GET /detours/historical-imports` existed but nothing read it, so uploaded tracker rows were unreachable. Detour Reports now lists them under Legacy spreadsheet history, grouped by source file with the importer and date, and the page search covers them. The uploader is shown only to detour write roles, matching the server, rather than offering read-only users a control that 403s. The list endpoint returns named columns instead of `SELECT *`, keeping `raw_row_json` server-side.

## [1.5.80] - 2026-09-04

- **Stop filing the closure location as "Riders directed".** Promotion wrote the intake's location - where the closure is - into `riders_directed`, whose meaning is where riders should go instead, so every accepted Detour read "Riders directed: 5th St closed…". Migration 088 adds `Detours.location`, moves the copied value across for every promoted Detour, and clears `riders_directed` only where it still equals the intake location. Promotion now writes `location` and leaves `riders_directed` for staff to record; the operational record and the Reports CSV show Location.

## [1.5.79] - 2026-09-03

- **Retire the API client methods that had no server.** The shared client carried ten methods for `detour-attachments` (scanning, versions, report sharing) and `detour-intake-options` that no Azure Function ever implemented, plus an operations-report view and a generic workflow PATCH nothing called. They are removed, and `DetourImage` now describes exactly what `GET /detours/{id}/images` returns.
- **Surface the two detour backends that had no UI.** Detours & Closures and Detour Reports gain a Show history control on each expanded row, reading the append-only `DetourWorkflowHistory` (creation, transitions, Avail observations, corrections, fulfillment confirmation). Administration gains a Detour reason categories section for adding, relabeling, reordering, and retiring the codes that the Reporting fields and Reports filters use.

## [1.5.78] - 2026-09-03

- **Make the Detour Reports CSV match the table.** The export was missing eight of the fifteen on-screen columns - fulfillment path, readiness, next owner, communications, workflow state, closure reason, Avail entry/ID/last-seen - and its column order followed the retired spreadsheet rather than the page. Columns now follow the table, then the expanded-row detail, then the operational record, and the table and CSV render every label through one shared function so they cannot drift. The expanded row also shows the closure reason.

## [1.5.77] - 2026-09-03

- **Give "Needs OCC re-review" a way to clear.** Every material edit to a Detour raised the re-review flag and nothing could lower it. `POST /detours/{id}/review-complete` sets the record back to current and writes a `manual_correction` row to the workflow history with the reason the flag was raised and any reviewer notes. Detours & Closures offers "Mark review complete" beside the warning; Detour Reports shows the flag in the Readiness column and exports it in the CSV.

## [1.5.76] - 2026-09-03

- **Stop "Needs information" from being a dead end.** An intake returned for information now stays open: Detour Intake shows it under its own tab with the reviewer's request, `PUT /detour-intake/{id}` updates the record and returns it to the OCC queue, and a reviewer can still withdraw, reject, or mark it duplicate. Open pending intakes can be edited in place; decided intakes are listed read-only with their decision, reviewer, and linked Detour or duplicate target. Review decisions on a record that has already been decided are refused with 409 instead of reporting "not found".

## [1.5.75] - 2026-09-03

- **Show the operational record an accepted intake carries.** GET /detours now returns the fields acceptance writes onto the Detour — operating window times and status, service impact and area, affected stops, action instructions, operational impacts, required audiences and channels, confirmation contact, and evidence — instead of leaving them write-only. Detours & Closures and Detour Reports render them in the expanded row, search reaches them, and the Reports CSV exports them. TIME columns are serialized as HH:MM on both the detour and intake lists.

## [1.5.74] - 2026-09-04

- **Match the garage-departure statuses the feed actually emits.** The `GARAGE_DEPARTURE` rule looked for `Late Relief` and `Expired Pullout`. Across 22 service days the feed emitted eleven statuses and `Late Relief` was not among them - it came from the single sample payload the fixtures were built from. Meanwhile `Missed Pullout` (282 rows) and `Missed Login` (126), 408 runs that provably never left the garage, matched nothing, and `Late Pullout` (91, averaging nine minutes late) matched nothing either. The rule was wrong in both directions at once: raising occurrences for buses that departed on time while missing the ones that never departed. It now lists the four statuses that describe how a departure ended, and still requires the timestamps to show a missed or late departure. Pull-in statuses, which describe a run's return to the garage after it departed, can no longer reach a departure standard. A run Avail has not yet classified is left alone rather than penalised before it has been judged.

## [1.5.73] - 2026-09-04

- **Raise a garage-departure occurrence only when the departure was actually missed.** `complianceCandidatesPoll` created a `GARAGE_DEPARTURE` candidate for every row carrying Avail's `Expired Pullout` or `Late Relief` status. That status is a timing state, not an outcome: it says the scheduled pullout window elapsed, not that the bus never left, and most of those runs do leave a couple of minutes late. About one pullout in seven became a reviewable occurrence, and because an assessment period cannot be finalized while any candidate is unreviewed, assessment sat behind a queue that was mostly dismissals. A candidate now needs a scheduled pullout that either never happened or was more than `GARAGE_DEPARTURE_VARIANCE_MINUTES` late (default 10, per the integration spec). A run with no scheduled pullout is a gap in the source, not a breach, so it raises nothing. Each candidate's description now names which case it was, so a reviewer can triage without opening the record. Migration 088 clears the backlog the old rule already raised, dismissing only auto-raised candidates whose own evidence shows an acceptable departure, recording why on each one; candidates a human has already decided, manual entries, finalized periods, and rows whose source record is gone are left untouched.

## [1.5.72] - 2026-09-04

- **Report feed health from what each poll stored, not what it fetched.** Every poller recorded the number of records the source returned, so a run could fetch cleanly, fail every write, and still advance `last_success_at` at full volume - and because recording health also clears `last_failure_at` and `last_failure_reason`, it erased the previous run's recorded failure on the way past. The ledger backs KPI trust, so its count now describes what each KPI's table holds. Storing nothing from a non-empty fetch is recorded as a failure so a total ingestion loss names itself; a partial loss stays a successful run, counted honestly and warned about. An empty fetch is unchanged - per ADR 0027 a successful run with no records is Current-but-empty, not a fault. Covers Avail Pullout, OTP Daily, OTP Monthly, Avail Missed Trips, Event AVL, and GTFS-RT VehiclePositions.
- **Do not let a VehiclePosition run with no recorded evidence prove no-show coverage.** Feed health was recorded before the evidence writes ran, from the entity count, so a poll whose evidence writes all failed still left coverage proven and the silent-no-show detector would read missing evidence as real no-shows. Coverage now fails closed and those trips wait as `unknown_data_gap`.
- **Stop an unmappable Avail Missed Trips fetch from erasing the months it reloads.** The reload deletes its target months before inserting, so a fetch whose reports all failed to map wiped months of retained evidence and reported a clean run. The retained rows are now held and the run is recorded as a failure.
- **Give the shared GTFS-RT TripUpdate trust row a single writer.** The delay and missed-trip pollers read the same feed on the same five-minute schedule and each wrote the `gtfs_trip_updates` row itself, so whichever ran last silently won. Both now read through one shared reader that records the delivery once. That row describes delivery rather than what either poller stored, because the two write different tables and no single stored count could describe both.

## [1.5.71] - 2026-09-04

- **Key Fixed Route Departures to the agency service day, not the UTC poll clock.** The Avail Pullout endpoint carries no date, so the service date is derived - and it is part of the `(service_date, block, run)` key the poller MERGEs on. Deriving it in UTC re-keyed runs mid-service (the UTC day rolls over at 6/7pm local, while service runs to 10pm), inserting a duplicate row that double-counted the run in the late and expired pullout totals and raised two `GARAGE_DEPARTURE` compliance candidates for one departure. Each row's service date now comes from that run's own scheduled garage times in America/Chicago, so every poll across the day lands on one key. The read window's cutoff is agency-local for the same reason.
- **Stop reporting zero late pullouts from a source that was never switched on.** `GET /fixed-route-departures` answers 200 with an empty list whether the feed is unconfigured, its `FixedRouteDepartures` table is missing, or the window is genuinely quiet. The console read all three the same way and rendered "Live data" over a zeroed summary, so a module that had never recorded a departure claimed there were no late or expired pullouts. It now names the four states apart - not configured, not connected, unavailable, and live - and withholds the counts until the feed and its table are both live, per the Not-connected monitoring definition. A failed request no longer reads as a configuration problem.

## [1.5.70] - 2026-08-28

- **Rename the feed-health ledger to match what it holds.** Migration 086 renames `MissedTripFeedHealth` to `KpiFeedHealth`; it backs every KPI trust stream, not only missed trips. The application resolves the table name per call and accepts either, so the migration and the deployment can land in either order.

## [1.5.69] - 2026-08-28

- **Stop calling a healthy On-Demand request a Watch condition.** A request that is neither overdue nor forecast past its standard now reads "Within standard", so the Watch label carries one meaning.
- **Share the risk workspace contract.** The Fixed Route and On-Demand workspaces now use one implementation of the training-scenario toggle and notice, the confidence styling, the actions-unavailable rule, and the stale-data acknowledgement prompt. KPI trust states read identically in the workspaces and the Admin feed-health view.

## [1.5.68] - 2026-08-28

- **Name On-Demand records as requests, not trips.** The On-Demand risk contract now returns `request_id` and `external_request_id`, the resolve endpoint reports `request_id`, and the workspace reads "Connect Request" throughout, matching the glossary definition of an Active on-demand request. Stored column names and the Suggested Alert detail linking key are unchanged.

## [1.5.67] - 2026-08-27

- **Stop reporting a healthy empty poll as unavailable.** A feed run that completed successfully with no qualifying records now counts as covered, using its delivery time as the freshness signal, instead of reading as unavailable and blocking alert preparation. A non-empty delivery whose source vintage is unknown still reads as unavailable.

## [1.5.66] - 2026-08-27

- **Drop the console-wide live-data claim.** The application shell no longer states a single data status in its top bar. Each workspace reports its own health where the data is used, so an alert-feed connection cannot imply that risk monitoring is current.
- **Show Avail Missed Trips evidence on the missed-trip KPIs.** Both the fixed-route and Spare missed-trip streams now declare Avail Missed Trips as supporting retrospective evidence; its state is visible without gating either stream.

## [1.5.65] - 2026-08-27

- **Record the stale-data acknowledgement when the update is prepared.** The acknowledgement is now written as the staff member prepares a communication from stale KPI data, naming that person, rather than at approval under the reviewer's name. A prepared-then-discarded draft still leaves evidence.
- **Keep an observed overdue On-Demand request visible.** A request whose pickup commitment has passed now reads as Overdue even when its forecast also qualifies as a Watch, so a projection cannot hide an observation.

## [1.5.64] - 2026-08-27

- **Base On-Demand KPI trust on the authoritative reconciliation.** The hourly On-Demand reconciliation now records its own feed health, so On-Demand trust no longer depends on the separately gated Spare missed-trip ingestion. The Spare Requests and Slots feeds remain supporting evidence.
- **Stop asking for a stale-data reason on a healthy empty result.** Fixed Route and On-Demand risk workspaces treat a Current-but-empty KPI stream as current, matching the Suggested Alert endpoint, which previously rejected the prepared alert.

## [1.5.63] - 2026-08-27

- **Prevent concurrent Event AVL Teams deliveries.** Notification delivery now uses a short-lived claim, so an operator action and queue retry cannot post the same Status queue item twice. The queue shows an in-progress delivery and recovers an abandoned claim safely.
- **Keep delivery status visible in Event AVL health.** Pending, acknowledged, in-progress, and failed status items remain in the operational count until they reach a terminal outcome.

## [1.5.62] - 2026-08-24

- **Put every Monitoring Area crossing in the Status queue.** Enter and exit crossings now create operator-visible work even when no direction rule matches; unmatched crossings remain manual-review items and cannot auto-send to Teams.
- **Lead Event AVL vehicle identity with the display label.** Vehicle details, lists, map popups, crossing history, and new queue messages use `State Fair Shuttle: Route 444 (Vehicle 4522)`, with a route-only fallback when no display label exists.

## [1.5.61] - 2026-08-24

- **Identify Event AVL vehicles by route color.** Route Classification now provides a native color picker and hex value for each route; live bus markers use that route color with MVTA evergreen as the safe default.
- **Use route display labels throughout Event AVL.** Vehicle lists, selected details, map accessibility labels, popups, search, and newly created status-queue messages include the configured display label.
- **Keep the status queue independent from Teams.** The critical in-app queue is now explicitly labeled **Status queue** and retains pending, acknowledged, and failed work. Turning automatic Teams delivery off prevents automatic external delivery without disabling or hiding queue items.

## [1.5.60] - 2026-08-24

- **Keep Event AVL visible while navigating OnBoard.** “Open field window” now launches the focused Event AVL view in a separate 1600×1000 browser window with the selected Event and operating period preserved, leaving the original console free for other work.

## [1.5.59] - 2026-08-24

- **Keep Event AVL context in the larger map.** The larger map now expands inside OnBoard instead of opening a separate Bing map, preserving vehicles, the selected vehicle, Monitoring Areas, locations, traffic, map style, zoom, and compass controls.
- **Make vehicle identity and location easier to scan.** Selected vehicles now lead with a labeled route and vehicle pair such as `Route 5555 (Vehicle 4834)`, show Monitoring Area context once, and label report freshness instead of repeating “Outside monitored zones.”
- **Name the Event AVL field view correctly.** The focused field route now retains the Event AVL page title instead of falling back to Dashboard.

## [1.5.58] - 2026-08-22

- **Replace browser dialogs with OnBoard dialogs.** Confirmations and short text requests now use a consistent, accessible in-app dialog with clear consequence copy, keyboard dismissal, inline required-field validation, and explicitly styled destructive actions. This covers Event Administration and Event Planning as well as messages, access, route classification, detours, and assessment workflows.

## [1.5.57] - 2026-08-22

- **Manage Monitoring Areas directly.** Event Administration now offers a Rename action alongside the existing purpose, boundary-editing, and audited deactivation controls. Deactivation keeps the record for audit rather than hard-deleting operational history.
- **Make Event Administration easier to scan.** Event AVL settings, route classification, Monitoring Area authoring, reference locations, and direction rules now use compact collapsible sections with clearer titles, descriptions, and live counts.
- **Make direction rules readable and message templates extensible.** Rules can now carry an optional operator-facing name; standard Event AVL message templates accept an appended instruction, and both editing and the saved-rule table use that plain-language framing.
- **Manage Area purposes as data.** Administrators can add, rename, and delete unused custom purposes from Event Administration. The built-in Staging, Corridor, Venue, and Other purposes are protected, and custom purposes safely fall back to the generic live-area status.
- **Use friendly location categories.** Reference locations now display “Park & ride” and other operator-facing labels instead of stored codes such as `park_and_ride`.
- **Find and inspect map resources faster.** The authoring map now filters Monitoring Areas and locations by name or category, and selecting a row focuses and highlights that resource on the map.

## [1.5.55] - 2026-08-22

- **Resolve two parallel Event AVL designs in favour of the notification badge.** `main` released 1.5.47 with the open notification queue leading above the vehicle map; this branch had since reframed it as a count badge in the context bar that opens a queue drawer, so that notifications stop competing with the map for the first viewport without becoming less visible. The badge wins as the later, documented decision, and the queue-first arrangement described in 1.5.47 no longer applies.
- **Queue-first semantics are kept in full.** Pending, acknowledged, and failed notifications all remain in the open queue - a failed delivery stays retryable rather than terminal - which both designs had implemented identically.
- **Remove the superseded queue-first styles.** The `evmon-primary-queue` and variant-B grid rules had no consumer left after the reframing, so they are deleted rather than merged forward as dead selectors.

## [1.5.54] - 2026-08-22

- **Polish the in-app release notes.** The Changelog now has a clearer hierarchy, a prominent current-build indicator, and refined expandable release cards that are easier to scan across desktop and mobile.

## [1.5.53] - 2026-08-18

- **Geofences with the same name can be told apart and removed.** Two "Eagan Bus Garage" boundaries exist in real data, and the Event Administration table rendered only the name, so identical rows could not be distinguished and neither could be removed with any confidence about which was going. Rows that share a name now show the identifier that separates them, alongside the Event Plans using each one and when it was last updated.
- **The geofence and location tables moved above the map.** Removing or auditing a boundary previously sat below a 420px canvas and its drawing toolbar, which is why the control went unfound.
- **Deactivating a geofence says what it affects.** The confirmation now names the Event Plans holding it in scope, and states that governed plans keep running from their published scope snapshot until a reviewed revision removes it.
- **Duplicate linked resources are distinguishable in Event Planning too.** Removing the wrong one needs another revision to undo, so colliding labels now carry their identifier in the visible text and the accessible name.

## [1.5.52] - 2026-08-18

- **The scope map now shows that it is a control, not a picture.** Hovering a boundary or point changes the cursor and opens a popup naming the resource and what selecting it will do - add it, remove it, or that the Event Plan is read-only at its current status. Previously nothing distinguished a clickable boundary from a drawn one.
- **The scope map opens on the scope.** It used a fixed centre and zoom, so geometry outside that view rendered as an apparently empty map; it now fits once to the boundaries and points it has, and gained a zoom control.
- **An Event Plan with no authored geometry explains itself.** A console with no geofences or transit locations rendered a blank basemap that reads as broken. It now states that boundaries are drawn in Event Administration and links there.
- **The list is named as the equivalent path.** The map is pointer-driven, so its help text now states that the list view does the same thing without one.

## [1.5.51] - 2026-08-18

- **The Event Plan scope map reports a failed map instead of hanging.** Fetching the Azure Maps token can succeed while the map itself still fails to authenticate or initialise, and the panel sat on "Loading the scope map…" indefinitely - which reads as a hang rather than a failure. Confirmed against a running console; it now surfaces the failure as an alert.

## [1.5.50] - 2026-08-18

- **Choose an Event Plan's geographic scope on a map.** Geofences and transit locations can now be added and removed by selecting them on a map beside the list, with in-scope boundaries filled and available ones dashed. Routes stay list-only - special service is absent from the GTFS schedule, so routes have no geometry to draw - and the list remains a complete alternative for every resource type.
- **Copy an Event Plan to its next run.** Recurring Events reuse their routes, geofences, and locations almost unchanged while the dates always differ, so `Copy to a new Event Plan` carries the scope and deliberately leaves the operating period unset - landing the new draft on the dates as its first outstanding readiness item.
- **The workspace stages stopped pretending to be destinations.** Plan, Review, and Activate all pointed at the same `/events/planning`, so choosing one reloaded the page you were already on. They now render as status; only Configure, which genuinely navigates to Event Administration, remains a link.

- **The Event Planning next action now performs the step instead of scrolling to it.** Its button previously called `scrollIntoView` in every state, so the most prominent control on the page moved the viewport rather than advancing the work. It now submits for review, approves, and activates directly; an incomplete draft jumps to the resource selector that resolves the first missing readiness item, with that resource tab already chosen.
- **Advancing an Event Plan no longer requires scrolling to a duplicate button.** The lifecycle panel repeated the same primary transition at the bottom of the page; the Next action panel is now the single control, and the panel points to it. Completion stays with the other deliberate active-plan controls, where suspend and modify already live.
- **The conflict override reason moved into the panel that activates.** The one field standing between an operator and a live scope is no longer somewhere further down the page.
- **Event AVL histories are readable.** Message history, geofence crossings, and audit entries rendered as single muted paragraphs with every field run together by dots; each entry now carries its timestamp, label, and detail as distinct elements, with real empty states and a scroll region per panel.
- **Event Planning links to Event AVL directly.** The activation handoff pointed at the legacy `/event-monitoring` redirect rather than `/events/avl`.

## [1.5.47] - 2026-08-17

- **Show the activation checklist while the Event Plan is still a draft.** The itemized readiness list and its repair links previously appeared only once the plan reached `approved` - after every item was already satisfied. Draft is the longest phase and the one where items are actually outstanding, so the list now renders from draft onward beside the activation readiness gate.
- **Send the "complete the checklist" next action to the right panel.** The action that asks for a missing operational resource scrolled to *Plan details* (the Event picker and dates) instead of *Scope resources*, which is where routes, geofences, and locations are actually linked.
- **Restore the staff console typecheck.** `@mvta/shared`'s build output had drifted behind its source, so the console typechecked against declarations missing `route_conflict`, `EventServicePlanRevision.links`, and the conflict-override argument. Rebuilding the shared package clears all 13 errors in Event Planning and the remaining Detour errors across the package. The affected behavior worked correctly at runtime; only the build was broken.

## [1.5.48] - 2026-08-17

- **Keep Event Planning context across resource administration.** Missing geofence links now preserve the selected Event Plan and revision, and Event Administration always offers an explicit return to Planning.
- **Clarify Event Plan terminology and review evidence.** User-facing labels now consistently call the workflow object an Event Plan, lifecycle completion is labeled Completed, and review evidence lists the selected resource names.
- **Improve Event Planning recovery and accessibility.** Empty consoles offer a first-Event action, resource selectors retain independent searches and failed bulk links, selected panels announce their changes, and remove actions identify their resource.

## [1.5.50] - 2026-08-18

- **Choose an Event Plan's geographic scope on a map.** Geofences and transit locations can now be added and removed by selecting them on a map beside the list, with in-scope boundaries filled and available ones dashed. Routes stay list-only - special service is absent from the GTFS schedule, so routes have no geometry to draw - and the list remains a complete alternative for every resource type.
- **Copy an Event Plan to its next run.** Recurring Events reuse their routes, geofences, and locations almost unchanged while the dates always differ, so `Copy to a new Event Plan` carries the scope and deliberately leaves the operating period unset - landing the new draft on the dates as its first outstanding readiness item.
- **The workspace stages stopped pretending to be destinations.** Plan, Review, and Activate all pointed at the same `/events/planning`, so choosing one reloaded the page you were already on. They now render as status; only Configure, which genuinely navigates to Event Administration, remains a link.

- **The Event Planning next action now performs the step instead of scrolling to it.** Its button previously called `scrollIntoView` in every state, so the most prominent control on the page moved the viewport rather than advancing the work. It now submits for review, approves, and activates directly; an incomplete draft jumps to the resource selector that resolves the first missing readiness item, with that resource tab already chosen.
- **Advancing an Event Plan no longer requires scrolling to a duplicate button.** The lifecycle panel repeated the same primary transition at the bottom of the page; the Next action panel is now the single control, and the panel points to it. Completion stays with the other deliberate active-plan controls, where suspend and modify already live.
- **The conflict override reason moved into the panel that activates.** The one field standing between an operator and a live scope is no longer somewhere further down the page.
- **Event AVL histories are readable.** Message history, geofence crossings, and audit entries rendered as single muted paragraphs with every field run together by dots; each entry now carries its timestamp, label, and detail as distinct elements, with real empty states and a scroll region per panel.
- **Event Planning links to Event AVL directly.** The activation handoff pointed at the legacy `/event-monitoring` redirect rather than `/events/avl`.

## [1.5.49] - 2026-08-18

- **Align fixed-route service-risk counts.** Overview, diagnostics, the exception list, and summary tiles now use the same raw-seconds threshold predicate, preserving missing-prediction telemetry instead of rounding before filtering.
## [1.5.49] - 2026-08-22

- **Restore the missing in-app release notes.** The console's Changelog page and "What's new" popover were missing 1.5.46 and 1.5.47 entirely - `changelogData.ts` had not been hand-synced when those releases were cut, so the popover reported "not available yet" for the deployed build. Both versions are now present.

## [1.5.48] - 2026-08-22

- **Collapse and expand the side navigation.** The primary navigation rail now has a collapse control in its brand row that shrinks it to a 64px icon-only rail, giving map- and table-heavy pages (Event AVL, Detour Reports) the extra width. Every destination stays reachable while collapsed - group headings hide but their links remain, and each icon carries its label as a tooltip. The choice persists across reloads, and below 860px the existing off-canvas drawer still governs, so the collapsed rail is desktop-only.

## [1.5.47] - 2026-08-20

- **Lead Event AVL with the open notification queue.** Open Event notifications now appear above the vehicle map as the page's primary action, rather than below it; the map is retitled "Vehicle map" to match. Open-queue membership (pending, acknowledged, failed) is now a single named predicate covered by a test.

## [1.5.46] - 2026-08-16

- **Organize administration into a management workspace.** Administration now has modular navigation for access, Event resources, service configuration, integrations, governance, and subscribers. Event Planning and Event AVL are grouped under a dedicated Events workspace, with legacy links preserved.
- **Remove the duplicate Administration landing page.** `/admin` now opens the operational Service Configuration module directly while the remaining administration modules stay available in the secondary navigation.
- **Remove the duplicate Administration sidebar label.** The operational Administration navigation now appears under one label instead of repeating the section heading and expandable item.

## [1.5.43] - 2026-08-16

- **Recover from invalid geofence rings.** Event Planning now rejects self-intersecting polygons before save, restores the previous boundary when an edit is invalid, and keeps the map available for another attempt.

## [1.5.38] - 2026-08-15

- **Populate the unassigned vehicle queue.** Event AVL now projects every fresh AVL vehicle; active plan and geofence scope continue to control assignments and crossing detection.

## [1.5.39] - 2026-08-15

- **Clarify Event Planning.** Operating periods now use separate local date/time fields, resources use searchable checkbox selection, and activation presents a simpler readiness handoff.
- **Improve direction-rule authoring.** Direction rules are organized into matching, movement, and message steps with compass presets, clearer delivery labels, and an Event AVL message preview.

## [1.5.40] - 2026-08-15

- **Identify buses by route in event messages.** Crossings now retain the AVL route ID alongside the bus number, so multiple buses operating the same event route remain distinguishable in Event AVL and Teams notifications.
- **Allow geofence removal.** Administrators can remove a geofence from the resource list; removal deactivates it and preserves the record for audit. Active-plan geofences remain protected.

## [1.5.41] - 2026-08-15

- **Separate the Event AVL queue from history.** Every crossing in an active operating scope now creates an operational queue item, with matched rules controlling the message and manual or automatic delivery. Completed Teams deliveries remain available in investigative history.

## [1.5.42] - 2026-08-15

- **Add operational Event AVL messaging control.** Planning now defines standard geofence message types for departing, passed, arriving-soon, or custom messages. Event AVL controls automatic Teams delivery for the selected active operating period; the arriving-soon message is triggered by entering its configured approach geofence.

## [1.5.37] - 2026-08-15

- **Make expired Event AVL sessions recoverable.** The monitoring page now identifies an expired sign-in and provides a direct Sign in again action instead of remaining in a misleading loading state.

## [1.5.36] - 2026-08-15

- **Recover from expired AVL sessions.** Authenticated GET requests now refresh the Entra access token once after a 401 response before showing a feed error.

## [1.5.35] - 2026-08-15

- **Show live AVL vehicles before Event selection.** Event AVL now loads the shared active-vehicle feed immediately; selecting an Event continues to add plan membership and geofence scope.

## [1.5.34] - 2026-08-15

- **Improve Route Classification readability.** The table now uses operator-friendly route names, service-type explanations, explicit label guidance, readable update details, route counts, and descriptive actions.

## [1.5.33] - 2026-08-14

- **Make Event messages operationally identifiable.** Geofence notifications
  now include the bus number explicitly.
- **Separate geofence roles in Event Planning.** Operational-only boundaries
  and messaging-enabled boundaries are shown separately while remaining part
  of one integrated operating period.

## [1.5.32] - 2026-08-13

- **Make the running version easy to find.** The sidebar now presents the
  version as a distinct badge with a clearer “What’s new” action.
- **Keep release notes honest and scannable.** The quick view now selects the
  exact running build instead of assuming the first data entry matches it, and
  the full changelog uses expandable releases with the current build open.
- **Bring the in-app history current.** Missing releases 1.5.8 through 1.5.31
  are now included in the staff-facing changelog.

## [1.5.31] - 2026-08-13

- **Adopt Event Planning Variant E's guided scope canvas.** Operators now
  choose Routes, Geofences, or Transit locations as the primary resource
  workflow, edit one selected resource type at a time, and see the resulting
  Event AVL handoff scope before activation.

## [1.5.30] - 2026-08-13

- **Adopt Event Planning Variant B's scope builder.** Plan details and
  resources now share one workspace with resource cards, add/remove controls,
  readiness counts, and a visible activation gate before lifecycle actions.

## [1.5.29] - 2026-08-12

- **Connect the Event workspace workflow.** Event Planning now presents one
  continuous four-step path from Plan through Configure and Activate to Monitor,
  with the progress rail and next action reflecting the selected operating
  period's lifecycle and no duplicate empty-state prompt.

## [1.5.28] - 2026-08-12

- **Make Event Planning action-oriented.** A prominent next-action panel now
  guides the operator to the exact Event, operating period, resource, review,
  approval, activation, or Event AVL step required next.

## [1.5.27] - 2026-08-12

- **Adopt the Event AVL command-center layout.** The live map now keeps the
  operating brief beside the map, showing visible vehicles, plan membership,
  unassigned vehicles, alert readiness, and a direct Event Planning link.

## [1.5.26] - 2026-08-12

- **Show all active vehicles in Event AVL.** The shared AVL projection no longer
  discards vehicles that are not yet assigned to an Event operating plan.
  Plans still control managed classification and geofence alert processing.

## [1.5.25] - 2026-08-12

- **Align Event Map Authoring with Event AVL.** Authoring now uses prominent,
  labeled active/inactive location markers and independent visibility toggles,
  matching the live-map resource experience.

## [1.5.24] - 2026-08-12

- **Keep active vehicles visible before plan assignment.** Event AVL now shows
  all current SpecialEvent vehicles from shared AVL, while identifying vehicles
  assigned to the selected operating plan and separating unassigned vehicles
  for follow-up.

## [1.5.23] - 2026-08-12

- **Clarify Event AVL locations.** Location points now use prominent haloed
  markers, persistent labels, active/inactive colors, and an on-map legend.

## [1.5.22] - 2026-08-12

- **Show the full Event resource catalog on Event AVL.** Active and inactive
  geofences and transit locations are now available as independent map layers,
  while operational vehicle and alert scope remains limited to the active
  published operating period.

## [1.5.21] - 2026-08-12

- **Make Event AVL scope explicit.** Event AVL now defaults to the most relevant
  Event context and clearly directs operators to repair or activate an operating
  period when its published scope is unavailable.
- **Keep Event workspace navigation coherent.** The Configure stage now opens
  Event Configuration in Admin, and readiness text explicitly requires an active
  SpecialEvent route.

## [1.5.20] - 2026-08-12

- **Connected Event Planning workflow.** Planned routes, geofences, and
  transit locations now appear before the review and activation controls, and
  the lifecycle copy makes the draft → review → approval → activation →
  monitoring path explicit. Activation is identified as the point that
  publishes the validated scope to Event AVL.
- **Reliable Event AVL navigation.** Azure Maps resource-layer cleanup now
  tolerates layers that were already removed or a map that has already been
  disposed, preventing navigation away from Event AVL from blanking the
  console. Added regression coverage for both teardown cases.

## [1.5.19] - 2026-08-11

Closes [#18](https://github.com/mvtamn/mvta-onboard/issues/18).

- **Safer Event switching.** The Event selector now confirms before
  discarding unsaved operating-period edits, matching the period selector;
  fixed the underlying reset so switching Events actually clears stale
  fields instead of leaving them displayed against the wrong Event.
- **Accessible status, not just color.** The activation readiness checklist
  and lifecycle stepper now expose a text-based accessible name per state.
- **Remove a linked resource.** Added a "Remove" action per row in Planned
  operating resources, wired to the `unlinkEventServicePlan` API and backend
  endpoint that already existed but nothing in the UI called.
- **Direction-rule deep link.** The "geofence needs a direction rule"
  readiness item now links to Admin's Configure section with that geofence
  pre-selected.
- **Bulk resource linking.** Route/geofence/location pickers are multi-select;
  adding reports per-kind success/failure/already-linked counts.
- **Duplicate this Event.** Pre-fills the create-Event form from the
  currently selected Event, for recurring events.
- **Searchable Event picker**, sorting still-open Events ahead of fully
  completed ones.
- **One empty-state pattern** instead of two near-duplicate banners; all four
  operating-period panels now number consistently (1.–4.).
- Introduced Vitest + React Testing Library for `onboard-console` (no
  frontend test infrastructure existed before this).

## [1.5.18] - 2026-08-11

- **Clearer Operating period lifecycle panel.** The status stepper, the
  primary next action, the revision sub-workflow, and secondary actions
  (Prepare revision, Suspend) previously read as one flat list of
  same-weight buttons with no signal for which one actually advances the
  plan. The primary action is now visually dominant, secondary actions are
  set apart under an "Other actions" label, and a pending revision now
  renders in its own bordered card instead of blending into the plan's own
  action list.
- **"Suspended" is no longer a fake forward step.** There is no backend
  transition back from suspended to active or completed, so it no longer
  appears as a 6th pill in the linear Draft→Completed stepper (which implied
  a path forward that doesn't exist); it now shows as a distinct paused-state
  callout instead.

## [1.5.17] - 2026-08-11

- **Mobile Event Workspace nav is legible again.** The Plan/Configure/Activate/
  Monitor stage labels were rendering as 1-2 truncated characters on phones;
  the stage list now scrolls horizontally at each stage's natural width, and
  scrolls the active stage into view automatically.
- **Sign Out is reachable on mobile.** The top bar's action row had no wrap
  and no responsive collapse, leaving Sign Out entirely outside the phone
  viewport with no way to scroll to it. It now wraps, and the two least
  essential items (refresh countdown, session date) hide below 860px.
- **No more silent data loss switching operating periods.** Switching the
  operating-period dropdown mid-edit now confirms before discarding unsaved
  name/date changes instead of silently overwriting them.
- **Session-expired is no longer a dead end.** A lapsed session now shows
  "Your session has expired" with a real sign-in action, instead of a
  "Try again" that re-fires the same request and fails identically.
- **Fixed a contrast near-miss** on the Event Workspace stage sub-labels
  (4.4:1 → back above 4.5:1) introduced by an incomplete fix in 1.5.16.

## [1.5.16] - 2026-08-11

- **Safer Event Planning actions.** Activating an operating period for Event
  AVL, suspending it, and applying a revision to the active scope now require
  confirmation; linking a resource already on the plan is blocked with an
  explicit message instead of silently duplicating it.
- **Clearer Event Planning feedback.** Action feedback now renders next to the
  panel that triggered it, styled distinctly for success vs. error, instead of
  one shared banner at the top of the page. The operating-period form only
  appears once an Event is selected.
- **Fixed dark-mode contrast bug.** The active Event Workspace stage (and two
  Event Monitoring success states sharing the same token) referenced an
  undefined `--success-bg` CSS variable, leaving text nearly invisible in dark
  mode; the variable is now defined in both themes and paired with the
  correct foreground color.
- **Mobile-usable console shell.** The left nav sidebar now collapses behind a
  toggle below 860px instead of staying permanently expanded and pushing page
  content off-screen on phones.
- **Tablet layout fix.** The Event Planning setup panels now stack at 768px
  (previously 760px), so the operating-period "Ends" field no longer clips at
  common tablet widths.

## [1.5.15] - 2026-08-10

- **Unified Event operating model.** Added durable Events with generated-event
  migration compatibility, one active Service Plan per Event, and lifecycle
  validation for route, geofence, direction-rule, and date coverage.
- **Shared operational scope.** Event projection, AVL visibility, and crossing
  detection now require the same active-plan operating period instead of route
  classification alone.
- **Clear authoring ownership.** Map Authoring manages reusable resources;
  Event Planning owns Service Plan creation, activation, and revisions.

## [1.5.14] - 2026-08-10

- **Event Monitoring reliability.** Added 90-day telemetry retention, diagnostic
  records, component health reporting, and visible operational status for AVL
  ingestion, event projection, crossing detection, and cleanup.
- **Event Monitoring operations.** Live vehicles now expose their active Service
  Plan scope, while crossing, notification, and audit feeds retain their last
  successful data and surface feed failures.
- **Safer event administration.** Route classifications validate local effective
  date ranges, preserve prior versions, and reject stale edits; geofence updates
  validate geometry and reject conflicting edits.

## [1.5.13] - 2026-08-09

- **Event monitoring resources.** Added admin-managed event locations,
  geofences, direction-aware crossings, notification review, audit history,
  and explicit Service Plans with active-plan gating.
- **Event monitoring UI.** Added geofence crossings, notification review,
  audit history, and service-plan/resource controls to the staff console.
- **Database reliability.** Normal infrastructure redeployments no longer
  rewrite the Key Vault SQL connection secret; intentional SQL credential
  rotation is handled as one coordinated operation.

## [1.5.12] - 2026-08-08

- **Contractor Performance Assessment foundation.** A new top-level Performance
  Assessment workspace provides contractor/month setup, Attachment G standards,
  scorecards, KPI detail, manual metrics, governed occurrence review, manager
  review, recomputation, and finalization. CAP and dispute tabs identify the
  future governed workflows without representing placeholder data as live.
- **Verified missed-trip assessment bridge.** The daily candidate poll copies
  confirmed GTFS and Spare missed trips into the assessment occurrence log
  exactly once. They remain candidates until assessment staff explicitly assign
  contractor-error, excusable, or MVTA-directed attribution; only confirmed
  contractor-error occurrences enter a monthly calculation.
- **Auditable assessment engine and reports.** Assessment inputs are revisioned
  and hashed, changed inputs require manager re-review, finalized reports use
  archived hash-verified HTML, and final issuance uses fail-closed MVTA holiday
  coverage for its dispute deadline. Power BI receives read-only scorecard views.
- **Assessment infrastructure.** The REST Function App is configured for a
  private managed-identity-backed compliance-report container. Database objects
  are defined by rerunnable migrations 030 and 031.

## [1.5.11] - 2026-08-08

- **Missed Trips review queue pagination.** The queue now shows 10 trips by
  default instead of rendering the entire fetched set. Reviewers can choose 10,
  25, 50, or 100 trips per page and move through the results with Previous and
  Next controls in either List or Table layout.
- **Selected-trip context stays usable while reviewing.** The investigation
  panel remains within the viewport, scrolls independently when its evidence is
  taller than the screen, and returns to the top when a different trip is
  selected. Aging and overdue candidates remain visible without automatically
  becoming compliance findings.

## [1.5.10] - 2026-08-08

- **Missed Trips false-positive containment and evidence rebuild.** Schedule-based
  GTFS no-show escalation now defaults paused behind
  `GTFS_SILENT_NO_SHOW_ENABLED`; explicit cancellations remain active. Static
  GTFS service times are converted from `America/Chicago` correctly, including
  past-midnight times, and TripUpdate presence is no longer treated as a trip
  start. TripUpdate/VehiclePosition evidence is retained independently and only
  progress beyond the first scheduled stop establishes underway evidence.
- **Safer Missed Trips review workflow.** Existing detector rows are retained as
  legacy/unverified, reviews require a reason and write append-only history, and
  monthly summaries use agency service date plus source-verified rows. The API
  now separates queue/history, paginates, and reports detector/feed health.
- **Missed Trips console cleanup.** Production API failures no longer fall back
  to plausible sample trips. Review Queue, History, and Monthly views now show
  paused/stale-feed warnings, evidence quality/version, readable dates, review
  history, and load-more controls.
- **Avail/Spare Missed Trips foundations.** Avail time-only start values are
  parsed with their CalendarDate in agency time. A disabled-by-default Spare
  evaluator implements only the three missed-trip conditions from Ridership
  Export + Slots; unattributed cancellations and missing supersession evidence
  remain unknown instead of becoming false candidates. Broader Spare metrics
  are intentionally out of scope.
- **Spare Missed Trips is now a real source pipeline.** A bounded incremental
  job ingests only recently updated Spare Requests and Slots, strips rider PII,
  evaluates completed/cancelled requests with versioned evidence, and projects
  qualified candidates into the shared review queue with a visible Spare source
  and condition breakdown. Rider/no-fault or otherwise unapproved cancellations
  remain data-gap evaluations and never become automatic contractor findings.

## [1.5.9] - 2026-08-07

- **AVL Reports was querying a window five hours in the future, so it returned
  no vehicles at all — the third and final root cause of this feed reporting
  nothing.** The poller built its `{Start DateTime}`/`{End DateTime}` segments
  from UTC components, but Avail360 interprets them in agency-local time.
  Proven from the feed's own response body: a poll sending
  `[2026-08-07 20:45:00 -> 20:55:00]` came back `success: true` with an empty
  array and `RefreshTime: 2026-08-07T15:55:00` — Avail's own "now", exactly
  UTC-5 (CDT) behind what we asked for. An out-of-range window is reported as
  an empty result rather than an error, which is how this survived the two
  earlier fixes (the 404 URL shape in 1.4.x and the `%3A`-escaped colons on
  2026-08-06). The window is now formatted in `America/Chicago`, which handles
  the CDT/CST switch without a hardcoded offset; new tests pin both offsets
  against the same UTC instant so neither a UTC revert nor a fixed `-5` passes.
- Consequence for the console: **Event Monitoring and Admin > Route
  Classification's `(AVL)` list should start populating** once the next poll
  runs — both were empty for want of vehicle data, not because of a bug in
  either page. Note the discovery list still reflects only what is running at
  that moment (positions are stored latest-only per vehicle), so classify
  special service while it is actually out.

## [1.5.8] - 2026-08-07

- **Admin > Route Classification's Route ID picker no longer lists only GTFS
  routes.** The picker was built solely from the GTFS schedule, which by
  definition cannot contain a special-service RouteID — so the routes this
  editor exists to classify were the exact ones it would not offer. The list
  now merges in RouteIDs seen in live AVL data, marked `(AVL)` and carrying
  their best-effort label (e.g. "1111 · Vikings Game Shuttle"); a RouteID
  appearing in both lists is shown once.
- **A RouteID in neither list can now be entered at all.** The free-text
  RouteID input was only reachable when the GTFS route registry came back
  empty, so in practice it never appeared — making a brand-new event RouteID
  that has not run yet (in neither GTFS nor AVL data) impossible to classify.
  It is now always available alongside the picker.

## [1.5.7] - 2026-08-07

Not yet deployed — stacked on 1.5.1-1.5.6, all still awaiting a deploy.

- **Missed Trips' new Trip/Route/Direction table (1.5.5) is now an addition
  to the flagged-trip list, not a replacement of it.** 1.5.5 converted the
  whole list to a table; that took away the original card-row list (Service/
  Detection/Review) some staff were already using. There's now a "List /
  Table" toggle next to "Flagged trips" — List is the original card layout,
  unchanged, driving the detail pane beside it; Table is the new full-width
  Trip/Route/Direction/Detection/Review view from 1.5.5, for scanning many
  rows at once. Picking a row in Table mode switches to List mode with that
  trip already selected, so it's a shortcut into investigation, not a dead end.

## [1.5.6] - 2026-08-07

Not yet deployed — stacked on 1.5.1-1.5.5, all still awaiting a deploy.

- **Event Monitoring now names event buses instead of showing a bare route
  number.** The map popups and the event-bus table resolved route names from
  the GTFS static schedule, which by definition cannot contain a special-event
  RouteID — so every event bus read "Route 1111" even when an admin had
  entered a name like "Vikings Game Shuttle" under Admin > Route
  Classification. Route identity now comes from Route Classification (the
  `route_label` an admin actually typed), with GTFS kept only as a fallback
  for a regular fixed route temporarily classified as SpecialEvent.
  `GET /event-vehicle-positions` returns `route_label`/`route_category`
  alongside the position fields to make this possible.
- `plans/route-classification-explained.md` documents the full
  AVL Reports → classification filter → position tables → map chain, and why
  position alone is insufficient: an event map of unlabeled dots can't tell
  an operator which shuttle is which.

## [1.5.5] - 2026-08-07

Not yet deployed — stacked on 1.5.1-1.5.4, all still awaiting a deploy.

- **Missed Trips' flagged-trip list is now a real table, led by a
  Trip/Route/Direction identifier instead of the raw GTFS trip_id.** Staff
  read Avail's own reports by scheduled-time + direction (e.g. "1245-SB"),
  not by an opaque static-feed key like `t52C-b2E-sl2B-v62` — the list (and
  the detail panel's header) now show that same time+direction code, with a
  new Direction column (NB/SB/EB/WB, sourced from `GtfsTripDirections` via
  a join added to `GET /missed-trips`) alongside Trip/Route/Detection/Review.
  The raw trip_id is still shown as a de-emphasized "Ref" in the detail
  panel for support/debugging. A Block column is deferred — `trips.txt`'s
  `block_id` isn't parsed or stored anywhere in this system yet, which needs
  its own migration and static-sync change before it can show up here.

## [1.5.4] - 2026-08-07

Not yet deployed — stacked on 1.5.1-1.5.3, all still awaiting a deploy.

- **Missed Trips investigation queue no longer shows resolved trips.**
  Rows where the vehicle eventually departed within the grace window
  (`status: "resolved"`) were piling up in "Flagged trips" alongside the
  small number of rows actually needing staff attention — nothing about a
  resolved row needs investigation, so it's noise. The list, its route/date
  filters, and the summary counts (Unreviewed/Confirmed/False
  positives/Routes affected) now all read from the non-resolved subset;
  resolved history remains visible on the Monthly Assessments tab.
- **"Missed" badge renamed to "Potential missed" until a reviewer
  confirms it.** A detection hit is a candidate, not a certainty — showing
  a flat red "Missed" badge before any human review overstated confidence.
  The badge now reads "Potential missed" (amber) while `validation_status`
  is `unreviewed`, and only escalates to "Missed" (red) once a reviewer
  records it as `confirmed`.
- **Relative-time labels now switch to hours once past 60 minutes** (e.g.
  "4h 10m ago" instead of "250 min ago") in the Missed Trips list.

### Detour date handling — three bugs, one root cause

Surfaced immediately by real Avail-synced detour data.
`Detours.start_date`/`end_date` are SQL `DATE` columns, and the mssql driver
returns those as JS `Date` objects — which JSON-serialize to a full ISO
timestamp (`2026-08-08T00:00:00.000Z`), not the plain `YYYY-MM-DD` string
every consumer assumed. `detourStatus.ts`'s own header comment asserted the
opposite ("SQL DATE columns serialize this way"), which is how it went
unnoticed, and every existing test fed it hand-written `YYYY-MM-DD` strings,
so none of them could catch it.

- **No detour ever showed as Active.** `computeDetourStatus` compared a
  `YYYY-MM-DD` string against a `Date`, which coerces to `NaN` — false in
  *both* directions, so `today < start_date` and `today <= end_date` were
  both false for every row, and every detour fell through to "Recently
  finished" regardless of its dates. A closure running Jul 6 → Oct 31 was
  reported as finished on Aug 7. The status tabs, the reports page and any
  future "active detours only" query were all wrong together — exactly the
  single-source-of-truth property that function exists to provide.
- **Editing a detour would have silently wiped its dates.** `<input
  type="date">` accepts `YYYY-MM-DD` and nothing else; handed an ISO
  timestamp it reads back as the empty string and renders blank. Opening
  Edit on a detour with dates and pressing Save wrote `null` over both.
  This one predates the reporting work — it has been live since B2.
- **Date columns rendered raw ISO timestamps** in both detour tables.
- Fixed at the boundary: `toDateOnly()` in `detourStatus.ts` normalizes
  whatever the driver produced, `computeDetourStatus` normalizes before
  comparing, and `GET /detours` now emits `start_date`/`end_date` as plain
  `YYYY-MM-DD` so the contract the rest of the app assumed is finally true.
  The console keeps its own defensive parsing (`lib/detourDates.ts`) rather
  than trusting that. New tests pin the shapes the driver actually returns —
  `Date` objects and ISO strings — instead of only the hand-written strings
  that hid this.
- Detour dates are now formatted in **UTC**. They are service days, not
  instants; building them at local midnight shifted them a day earlier for
  anyone west of Greenwich.

### Detour reporting polish

- **The reporting line no longer renders as a row of dashes.** "Reported by
  — (—) · Approved by — (—)" appeared on every detour with no reporting
  detail recorded — which is all of them so far — and pushed the useful
  provenance down the panel. Reported and Approved now each render only when
  something was actually recorded.
- **Who created a detour is now visible**: a "Created by" column on Detour
  Reports, and a clearer created/last-edited line in both detail panels.
  Avail-synced rows read "Avail sync" rather than showing staff a service
  identity they'd have to decode.

## [1.5.3] - 2026-08-07

Not yet deployed. The deployed console is still on 1.5.0 — 1.5.1, 1.5.2 and
1.5.3 are all awaiting a deploy.

**`migration-025-detour-reporting-fields.sql` has been run against the dev
DB (2026-08-07); the code is not yet deployed.** Unlike migration-024 there
is no backfill gap — every new column is optional, so detours created
through the currently-deployed build are simply uncategorized and can be
filled in afterwards. Every surface below degrades gracefully anyway: the API
guards on `COL_LENGTH('dbo.Detours', 'reason_code')` and drops the new
fields rather than failing, `GET /detour-reason-codes` returns an empty list
rather than 500ing, and the console hides the whole reporting section rather
than letting staff type into fields whose data would be silently discarded.

- **Detour reporting fields (Part B6).**
  `migration-025-detour-reporting-fields.sql` adds a `DetourReasonCodes`
  table (mirroring `OtpReasonCodes`, minus `applies_to` — it has only one
  consumer) plus ten columns on `Detours`: `reason_code`, `severity`,
  `reported_by`/`reported_at`, `approved_by`/`approved_at`, three more
  notification-channel flags (`radio_notified`, `dispatch_board_notified`,
  `social_media_notified`) and `resolution_notes`. **Every field is a draft
  built from standard transit-ops practice, not from MVTA's real internal
  detour-reporting form, which no document in this repo describes.** They
  were approved as-drafted with that caveat explicit; expect to correct them
  against the real form. Nothing requires any of them, so a wrong column can
  be dropped without breaking existing rows. `reason_code` is a soft
  (non-FK) reference to `DetourReasonCodes.code`, same convention as
  `OtpStopExclusions.reason_code`, so retiring a code can't orphan the
  history citing it — which is also why `code` is deliberately not editable
  via `PATCH /detour-reason-codes/{id}`.
- **New endpoints**: `GET /detour-reason-codes` (any detour-reading role,
  including `OCC.Compliance` and `OCC.Detour`, neither of which is in
  `STAFF_READ_ROLES`), `POST`/`PATCH` (admin only — this is a controlled
  vocabulary, not day-to-day entry).
- **"Clone as new detour"** on the Detours list. A single real notice
  routinely bundles two separately-dated sub-closures — the Aug 2026 ramp
  notice covered the Cliff Rd and Diffley Rd ramps on different dates —
  which is two `Detours` rows sharing everything but their dates. Clone
  copies the shared context and deliberately drops what must not be
  inherited: dates, every notification flag, the approval, and resolution
  notes.
- **New read-only "Detour Reports" page (Part B7)** for compliance and ops
  leadership: free-text search, filters (status, reason category, severity,
  source, start-date range), and a client-side CSV export of whatever is
  currently on screen. It reads the same `GET /detours` payload and the same
  server-computed status as the entry page, so the two can't disagree about
  whether a detour is Active. There are no edit controls anywhere on it,
  even for users who have those rights on the entry page. Search and
  filtering are **client-side** — `GET /detours` returns every non-deleted
  row and there is no pagination; `lib/detourSearch.ts` is the single seam to
  move server-side if real volume ever makes a full scan slow.
- **A plain search box on Detours & Closures**, using that same matcher.
  Terms are ANDed across number, internal reference, closure text, riders
  directed, segment routes and directions, staff names, and the reason
  code's human *label* — so typing "special event" finds rows stored as
  `special_event`.
- **Sidebar: "Detours & Closures" moved into the existing "Tools" group**,
  alongside the new "Detour Reports", OCC Tools and Compliance, rather than
  sitting flat among the rider-message primaries. The group header now
  renders if any child does, so an `OCC.Detour`-only user sees a labelled
  group instead of two orphaned links.

## [1.5.2] - 2026-08-07

Not yet deployed. The deployed console is still on 1.5.0 — both 1.5.1 and
1.5.2 are awaiting a deploy.

- **New `OCC.Detour` role, and a fix for a live 403.** Detour access now has
  four explicit tiers in `auth.ts` (`DETOUR_READ_ROLES`,
  `DETOUR_WRITE_ROLES`, `DETOUR_DELETE_ROLES`,
  `DETOUR_ATTACHMENT_WRITE_ROLES`) instead of inline role spreads, because
  that drift is what caused the bug: `OCC.Compliance` sat in `App.tsx`'s
  detour nav constant but in none of the API's read roles, so Compliance
  users could open the Detours page and then get a 403 from `GET /detours`.
  Compliance now has read access (it needs detour history for reporting) and
  no longer has attachment writes, which it previously had *without* detour
  edit access - contradicting B3's rule that attachments sit at the edit
  tier. The new `OCC.Detour` role can read, create, edit and attach, but
  deliberately **cannot delete**; soft-delete stays at the publisher tier.
  The role is **additive** - existing roles keep the access they had, so
  nothing goes dark at deploy. **`OCC.Detour` does nothing until it is
  registered as an `appRole` on the Entra app registration and assigned per
  user** - the code only teaches both sides to recognize the claim.
- **Internal detour numbering (Part B10)**: every detour created through
  `POST /detours` now gets a system-generated `MVTA-DET-YYYY-####` reference
  (`migration-024-detour-numbering.sql`), separate from the existing
  staff-entered free-text `number` field, which is unchanged. `####` resets
  each year, taken from the detour's `start_date` (falling back to the
  current year for open-ended detours). Allocation is a single atomic
  `MERGE ... WITH (HOLDLOCK)` against a new `DetourNumberSequences` table, so
  bootstrapping a new year and incrementing an existing one are the same
  statement - a `SELECT`-then-`INSERT` bootstrap would have raced on Jan 1,
  and a naive `MAX()+1` would have collided on any concurrent create.
  `internal_number` ships **nullable** with an in-migration backfill of
  existing rows (in `created_at` order per year), seeding the sequence table
  from what the backfill consumed so the first new detour doesn't collide
  with a backfilled number; tightening to `NOT NULL` is deliberately left to
  a later migration. Numbers are never reused or reassigned, including for
  soft-deleted rows. A detour rescheduled into a different year keeps its
  original number - it may already be quoted in a sent email - and the
  console shows an inline warning rather than letting the year read wrong.
  Both `detoursCreate.ts` and `detoursList.ts` guard on the column existing,
  so nothing breaks before migration-024 runs.
- **Fixed a latent 403 that would have broken the first-ever detour image
  upload.** `blobStorage.ts` requested a user-delegation key valid for
  exactly `SAS_EXPIRY_MINUTES`, then minted a SAS for the same duration
  measured from a `now` captured *after* that network round-trip returned -
  so the token always expired slightly after the key that signed it, which
  Azure rejects outright. The key window now deliberately outlives the SAS
  (`DELEGATION_KEY_EXTRA_MINUTES`), and both windows are back-dated
  (`CLOCK_SKEW_MINUTES`) so a few seconds of clock skew can't produce a
  not-yet-valid token either. Both failure modes are invisible until Blob
  Storage is actually provisioned, so the window math is now unit-tested
  (`sasWindow`). `getUploadSasUrl`/`getReadSasUrl` were near-identical and
  now share one `buildSasUrl` helper.
- **Detour image uploads would also have failed CORS.** The upload/read SAS
  URLs point straight at Blob Storage, bypassing the Function App, so the
  storage account needs its own CORS rules - `storage-detour-images.bicep`
  takes `allowedCorsOrigins` for exactly that, but
  `phase1-dev.parameters.json` never set the parameter, leaving it `[]` (no
  cross-origin browser access at all). Now set to the dev Front Door
  endpoint. Note this parameter also feeds the Function App's own CORS.
- **Corrected stale detour documentation.** `HANDOFF.md` still described the
  Avail Detours envelope key as an unverified guess (`result.Detours`) and
  the sync as uncommitted/undeployed; the key was confirmed live as lowercase
  `result.detours` on 2026-08-05 and the sync is committed. It also called
  image attachments "live" when they can't be until Blob Storage exists.
  `availDetoursFeed.ts`'s own fallback diagnostic still named the wrong
  (capital-D) key in its error text.
## [1.5.1] - 2026-08-07

Not yet deployed.

- **Fixed two missed-trip detection logic gaps in `gtfsMissedTripsPoll.ts`.**
  (1) The silent-no-show grace threshold was 15 minutes; ops' definition of
  a missed trip is "never ran, or started more than 30 minutes late" - bumped
  `GRACE_MINUTES` to 30 to match, used consistently for both the no-show
  cutoff and the late-arrival resolve check below. (2) Confirmed boundary
  bug: the no-show cutoff compared against wall-clock seconds-since-midnight
  (always `< 86400`), so any trip scheduled after ~23:45, or using GTFS's
  standard `>24:00:00` past-midnight time notation, could never satisfy the
  cutoff on any poll run and silently fell out of detection scope forever
  once the calendar date rolled over. `detectSilentNoShows` now runs twice
  per poll - once for "today", once for "yesterday" with elapsed time
  uncapped past 86400 - closing the gap without a separate rollover job
  (existing `NOT EXISTS` filters keep the repeat check a no-op once a trip
  is observed or tracked). Also fixed `resolveLateArrivals`, which
  previously flipped a flagged trip straight to `resolved` the instant it
  appeared in `GtfsObservedTrips` at all, with no check on how late - a
  trip starting 90 minutes late was silently reclassified as a non-event.
  Now split into two updates: arrivals within the 30-minute grace period
  resolve normally; arrivals beyond that stay flagged as missed but record
  `detected_late_arrival_at` so staff can see it eventually ran. See
  `plans/missed-trip-detection-logic-gaps.md` for the full writeup,
  including an open, not-yet-root-caused false-positive hypothesis these
  fixes don't address.
- **Fixed AVL Reports returning zero vehicles on every poll since launch.**
  Root cause confirmed live: `fetchAvlReports` built its `{Start
  DateTime}/{End DateTime}` URL segments with `encodeURIComponent`, which
  escapes colons to `%3A` - Avail's API silently no-ops on that (returns a
  clean `success: true` with an always-empty `"AVL Reports"` array,
  no error) instead of rejecting it. 14 days of App Insights traces showed
  every 5-minute poll completing without a single thrown error, which is
  what made this invisible - the request looked entirely healthy. Ty
  confirmed by running the same request via curl with colons left literal
  and got real vehicle data back immediately. Fixed by escaping only the
  space (`%20`), leaving colons literal, matching the confirmed-working
  request exactly. Also added: raw HTTP status/URL/body logging on every
  call (success or failure) for future diagnosis, and tolerance for
  `AVAIL_AVL_REPORTS_URL` having a trailing `/MVTA` segment already baked
  in (matching the other five Avail feed settings' convention) -
  `normalizeBaseUrl()` strips it first so Property is never appended
  twice into `.../MVTA/MVTA/...`.
- **Route Classification had no way to remove a classification.** Confirmed
  live - Ty classified a real fixed route as SpecialEvent for testing and
  had no way to undo it. New `DELETE /route-classification/{routeId}` +
  a "Remove" button next to each row. Hard delete, not this repo's usual
  soft-delete/deactivate convention (Detours, OtpReasonCodes) - this table
  is a pure current-state lookup with no audit-trail history riding on old
  rows, unlike those two, so there's nothing a hard delete would corrupt.
  Also replaced the plain `<select>` route picker with a searchable
  chip-list (matching Compose's existing affected-routes picker) per Ty's
  preference, and fixed a crash (`Cannot read properties of undefined
  (reading 'length')`) from assuming a newly-added backend response field
  was always present - a real risk during any deploy where frontend and
  backend land at slightly different times.
- **Fixed the Historical data backfill panel 504ing on any real range**:
  confirmed live - a 5-month request (Jan-May 2026) hit a gateway timeout,
  since `otp-historical-backfill` was doing every month's OTP Monthly
  fetch plus one Missed Trips fetch across the whole range synchronously
  in a single HTTP request. `POST /otp-historical-backfill` now takes one
  month per request (`{month: "YYYYMM"}`, not `{from, to}`); the
  Administration panel loops one request per month client-side instead,
  showing real per-month progress and staying within any request timeout
  regardless of how wide a range is entered.
- **Event Monitoring's real map overlay** (`event-module-implementation-
  plan.md`, Part A3 - Parts A1/A2, Route Classification and the event-bus
  filtering itself, already shipped). The mock event-shuttle scenario
  (POOL vehicles, the static Lot A/Fairgrounds schematic, swap-in picker,
  Claude-drafted delay-alert cards) is **retired**, not kept alongside real
  data - it modeled a Phase 2+ alerts/publish workflow explicitly out of
  scope for this pass (see the plan's redrafted user story, Part A0).
  "Event bus positions (live)" now renders an actual Azure Maps basemap
  (new `azure-maps-control` dependency) showing only `RouteClassification`
  `SpecialEvent` vehicles, with a companion list alongside it; "Live AVL
  vehicle positions" (every vehicle, unfiltered) stays a table, unchanged.
  Zero-standing-secret: no Maps subscription key is ever shipped to the
  browser - a new `GET /maps/token` endpoint uses the REST API Function
  App's own managed identity (granted Azure Maps Data Reader) to mint a
  short-lived Azure AD token server-side for the SDK's `anonymous` auth
  mode, same identity-based pattern as Blob Storage SAS minting and
  Service Bus.
  **LIVE as of 2026-08-06**: the owner provisioned the Azure Maps account
  directly (`rg-mvta-onboard-dev/mvta-onboard-maps`, Gen2, `westus2` - not
  via `maps.bicep`, same "built outside Bicep first" pattern as Front Door;
  `main-phase1.bicep`'s `mapsAccountName`/`location` updated to match so a
  future deploy manages this resource in place instead of creating a
  second, unused one). `func-mvta-restapi-dev`'s managed identity was
  granted Azure Maps Data Reader on the account, and `AZURE_MAPS_CLIENT_ID`
  is set to its `uniqueId`. **Follow-up, not blocking**: the manually-
  created account still has `disableLocalAuth: false` (subscription-key
  auth technically still possible, though this code never uses it) -
  `maps.bicep` sets `disableLocalAuth: true`; running it against the
  existing resource would tighten this to match every other resource's
  identity-only posture in this project.
- **Fixed the event-bus map hanging forever on "Loading map…"**: confirmed
  live once the account was actually wired up - the console's own
  Content-Security-Policy never allowed the Azure Maps domain at all.
  `img-src`/`connect-src` were `'self'`-only (no `atlas.microsoft.com`),
  and there was no `worker-src` directive, but `azure-maps-control` loads
  map tiles from `atlas.microsoft.com` and spins up Web Workers via
  `blob:` URLs for tile processing - the browser was silently blocking
  every one of those requests, so the map's `'ready'` event never fired
  and the loading overlay never cleared. `staticwebapp.config.json` now
  allows `https://atlas.microsoft.com` in `img-src`/`connect-src` and adds
  `worker-src 'self' blob:`.
- **Route Classification had no way to discover what actually needs
  classifying.** AVL Reports carries only a bare numeric RouteID, never a
  name (confirmed - see `availAvl.ts`'s `AvailAvlReport`), so the Admin
  page's route picker (`GtfsRoutes`, fixed-route-only) never surfaced
  Avail's own special-event/non-revenue naming convention
  (`Special1111`, `Rescue Bus`, `Pivot`, etc.) at all - there was
  genuinely nothing to select. `GET /route-classification` now also
  returns `unclassified`: every RouteID `AvailAvlVehiclePositions` has
  actually seen with no classification row yet, with a best-effort label
  pulled from OTP Monthly/Missed Trips when that route happens to have
  generated schedule-adherence data (null, not a guess, otherwise). Admin
  page shows this as a new "Seen in live AVL data, not yet classified"
  list above the classification table, each row with a one-click
  "Classify as Special Event" action that pre-fills the form instead of
  requiring the admin to already know the RouteID.

## [1.5.0] - 2026-08-06

- **OTP historical backfill** - a new admin-only action (`POST
  /otp-historical-backfill`, plus a "Historical data backfill" panel in
  OTP Compliance's Administration page) fills OTP Monthly + Missed Trips
  months *outside* the daily poller's 3-month trailing window - e.g.
  January-May 2026, before this feed's poller existed. "And beyond" (future
  months) needs nothing new - the trailing window already rolls forward on
  its own; this only backfills the historical gap behind it. Idempotent
  either direction (OTP Monthly upserts by key; Missed Trips deletes+
  reloads whole months), capped at 24 months per request. The per-month
  MERGE and the delete+reload were extracted out of the two daily pollers
  into shared functions (`upsertOtpMonthlyReport`, `replaceMissedTripsForMonths`)
  so the backfill endpoint and the daily pollers share one implementation
  instead of two copies.
- **Missed Trips UX pass** (route/date filters, "why was this flagged",
  friendlier trip labels, no more stray rider-notification action, a
  Monthly Assessments view, and a reason-code dropdown):
  - **Route + date filters** on the Flagged Trips list - previously no way
    to narrow it down to one route or one service date.
  - **"Is there any way to determine why the flag exists?" - not until
    now.** Neither of `gtfsMissedTripsPoll.ts`'s two detection paths
    (explicit GTFS-RT cancellation vs. a scheduled trip that never
    reported at all) ever recorded which one fired - the frontend
    hardcoded `detectionType: "unknown"` because the field genuinely
    didn't exist. `migration-023` adds `MonitoredMissedTrips.detection_type`;
    the detail pane now shows "Explicit cancellation (GTFS-RT)" or
    "Scheduled no-show (never observed)" - rows flagged before the
    migration read back "Unknown - flagged before detection tracking was
    added," shown honestly rather than guessed.
  - **Friendlier trip labels** - the flagged-trip list used to lead with
    the raw GTFS `trip_id` (e.g. "Trip t1F4-b5-sI1C-v62"), which is
    meaningless to a reviewer. It now leads with the route's real name
    (via the existing `GET /routes` registry) and "Scheduled {time}"; the
    raw ID moves to a de-emphasized "Ref" line in the detail pane for
    dispatch/support lookups.
  - **Removed the "Rider notification (optional)" section** (the
    "Prepare rider alert" button and its preview-draft UI) - Missed Trips
    has been an investigation-only tool since the original compliance
    rework ("this is not a customer notification queue"), and this leftover
    action contradicted that framing.
  - **Reason-code dropdown alongside investigation notes** -
    `MonitoredMissedTrips.reason_code` (also `migration-023`) plus a new
    `applies_to='missed_trip'` value on the existing `OtpReasonCodes` table
    (seeded with Vehicle breakdown / Operator no-show / Dispatch error /
    Weather / Detection error / Other) - reused rather than building a
    third parallel reason-code table. Admin-editable from OTP Compliance's
    Administration page alongside the other two reason-code tables.
  - **New Monthly Assessments view** (`GET /missed-trips-monthly-summary`)
    - a per-month, per-route breakdown of cancellations vs. no-shows and
      confirmed vs. false-positive vs. unreviewed counts, mirroring OTP
      Compliance's own Monthly Assessments for the same "how are we
      trending" question.
- **Review Queue: "Copy last month's decisions"** (Option A of
  `plans/otp-exclusion-carryover-enhancement-scope.md`) - a stop/route/
  day-of-week candidate that matches an approved/rejected decision from
  the prior service month now shows "Last month: Approved/Rejected —
  &lt;reason&gt;" plus a one-click "Copy last month" button; a bulk banner
  offers "Copy all N matching last month's decisions" when more than one
  pending candidate matches. Still writes a fresh, real, dated
  `OtpStopExclusions` row via the normal PUT for the *current* month - not
  a silent carry-forward - so compliance semantics (one attributed record
  per stop per month) are unchanged; it only removes the repeat clicking
  for stops whose exclusion reason is genuinely a standing fact, not a
  fresh judgment call.
- **Fixed the "Internal server error" on Review Queue approve/reject**:
  `OtpStopExclusions.day_of_week` had the exact same too-narrow-column bug
  just fixed for `OtpMonthlyRouteStopDay` (`NVARCHAR(3)` → `NVARCHAR(20)`,
  `migration-022`) - approving/rejecting a candidate with a long
  day-of-week value hit the same SQL error, surfaced as a raw error banner
  that then persisted across month switches (nothing cleared it). Also
  fixed: `actionError` now clears when the service-month picker changes,
  and the month-independent fetch (settings/date exclusions/reason codes)
  no longer shares one `Promise.all` - one flaky call used to discard all
  four results, including reason codes that had actually loaded fine,
  which looked like "reason codes are missing" but had nothing to do with
  reason codes themselves.
- **Administration's reason-code management is now real CRUD**: inline
  rename (click a label or "Rename"), up/down reordering (drives dropdown
  order in Review Queue/Weather), and a dedicated "+ Add" per table
  instead of one shared add-form with an easy-to-miss "applies to"
  dropdown. No hard delete - deactivating remains the standing convention
  for retiring a code older records may still reference.
- **Fixed the real bug behind "OTP Monthly/Missed Trips have no data":
  both had the wrong envelope key, not empty data.** Caught the moment
  tonight's first trailing-window backfill actually ran and the dormant
  diagnostic finally fired. `otpMonthlyFeed.ts` guessed `OtpByRouteStopDayAgg`
  (real key: lowercase `otp`); `availMissedTripsFeed.ts` guessed
  `MissedTripsByRouteStopDay` (real key: lowercase `missed`) - both with a
  sibling `results` metadata key, same pattern as Detours
  (`Detours` → `detours`). Every month either feed has ever polled was
  never actually empty. Fixed, tests updated. **Confirmed live** by
  manually re-triggering after deploy: `otpMonthlyFeedPoll` logged
  `414 reports seen, 260 rows upserted for 202608` - real OTP data, in
  the database, for the first time.
- **Fixed a second real bug found while confirming the above**:
  `OtpMonthlyRouteStopDay.day_of_week` was `NVARCHAR(3)` (sized for
  "Mon"/"Tue" per the one sample record ever available), too narrow for
  some of Avail's real values - caused 154 of the 414 real rows above to
  fail with a SQL data-length error instead of saving. New
  `migration-021-otp-monthly-day-of-week-width.sql` widens it to
  `NVARCHAR(20)`. **Re-verified after the migration ran: 100% success,
  all three months** - `414/414` rows for August, `908/908` for July,
  `910/910` for June. **2,232 real OTP records now in the database, zero
  failures.** OTP Monthly is fully live.
- **OTP Compliance cleanup**: removed the dead "Service Week / Metric /
  Imported" stat strip that appeared on every OTP page - a leftover from
  the module's original CSV-import design, hardcoded to a fixed date
  ("Jul 7 – Jul 13, 2026") and a made-up import count with no live meaning
  at all. Monthly Assessments no longer shows Avail Missed Trips incident
  counts alongside OTP % - decluttered to OTP-only per Ty's direction
  (note: this isn't the same data as the separate "Missed Trips"
  Compliance tab, which is GTFS-RT-based real-time detection, not Avail's
  feed - removing this leaves `GET /avail-missed-trips` with no UI
  consumer for now, though the feed keeps collecting data). Every
  service-month display (Monthly Assessments, the live-data banner, Audit
  Stream's "current month" label, the Dashboard trend chart's month
  labels) now formats as `MM/YYYY` instead of raw `YYYYMM`.
- **Fixed a real live bug: Avail Detours sync's envelope key was wrong.**
  Guessed as `Detours` (capital D); the real key is lowercase `detours`.
  Caught by the diagnostic added earlier this session, confirmed against
  live traffic today. Also added the same diagnostic to
  `availMissedTripsFeed.ts` (throws naming the real key instead of
  silently returning zero rows if this guess is ever wrong too - the same
  fix already applied to `otpMonthlyFeed.ts`/`availDetoursFeed.ts`).
  **Separately confirmed and fixed:** `availAvlPoll.ts` (Live AVL vehicle
  positions) had been failing 100% of its runs with HTTP 404 since
  deployment (~1800 consecutive failures) - `availAvl.ts` was sending a
  single date-only URL segment instead of the feed's actual documented
  `/{Property}/{StartDateTime}/{EndDateTime}` shape. Fixed to send all
  three: an explicit `MVTA` Property segment (`AVAIL_AVL_REPORTS_URL` no
  longer bakes Property into the base URL, unlike every other Avail feed
  setting in this app - it must now end at `.../AVLReports/v1`, **update
  the live app setting to match before this deploys**) plus two full,
  URL-encoded datetime segments; now polls a rolling 10-minute window each
  run. **`fixedRouteDeparturesPoll.ts`/Pullout Reports deliberately left
  broken for now** - same 404 pattern, but its real API spec was never
  confirmed, so a fix here would be a second guess stacked on the first;
  needs the actual spec, not another guess.
- **Trailing-window daily backfill for OTP Monthly + Missed Trips**: both
  polls changed from hourly/refresh-current-month-only to daily,
  re-fetching current month + prior 2 every run - a poller that only ever
  asks about "whatever month is current right now" has no way to notice a
  month that was empty on day 1 but populated by Avail days later
  (confirmed live: both August and a fully-closed July came back
  genuinely empty). Also drops the hourly cadence for OTP Monthly, since
  it was polling a month-level aggregate that structurally cannot change
  hour-to-hour.
- **New: sub-monthly OTP trending feed** (`OtpByRouteStopDayHour`,
  promoted from secondary/drill-down per the same investigation) - new
  `OtpDailyRouteStopHour` table (90-day rolling window, not permanent
  history), new daily timer, new `GET /otp-daily`. **Least-confirmed
  integration in this project** - zero sample response exists anywhere for
  this specific feed, unlike every other one built here; the field mapping
  is a best-guess by analogy to sibling feeds, flagged prominently in code.
  No UI reads this yet. **Needs `migration-020-otp-daily.sql` run and
  `AVAIL_OTP_DAILY_URL` set on `func-mvta-restapi-dev` before it goes
  live.** See `otp-compliance-live-data-rethink.md` for the full writeup
  and everything still open (Pullout's real spec, whether Avail has any
  OTP data for MVTA at all, the UI rethink proposal).
- **OTP Compliance service-month selector**: the module always defaulted
  to the current month for its live Avail OTP Monthly/Missed Trips data,
  with no way to view an earlier month - a brand-new month with no Avail
  aggregate yet looked identical to "feed not configured." A new month
  picker in the module's header now drives Route Summary, Review Queue,
  Monthly Assessments, and Audit Stream's "current month" scope from one
  selection, so staff can check whether a past month (which should have
  real accumulated data) loads correctly instead of only ever seeing
  whatever the current month happens to have.
- **Route Classification (Admin)**: the Route ID field is now a selector
  populated from the live route registry (`GET /routes`, the same one
  backing Compose's affected-routes picker) instead of a free-text number
  field - picking a known route beats typing a raw numeric ID blind.
  Falls back to the original number input if the registry can't be
  reached or is empty, same graceful-degradation convention as Compose.
- **Avail Detours sync (Part B4-B5)**: a new 15-minute timer
  (`availDetoursSync.ts`) polls Avail's own Detours feed and keeps
  `source='avail'` records in sync automatically - one real duplicate-entry
  elimination for whatever subset of closures is actually built as a formal
  Avail detour. Avail returns multiple rows per detour (one per direction);
  `availDetoursFeed.ts` groups them by `DetourID` into one `Detours` row +
  N `DetourSegments`. Upserts by `external_detour_id`; never touches a
  `source='manual'` row (operator-message/stop-closure entries that never
  appear in Avail's feed at all). If a synced row has since been hand-
  edited in OnBoard (`last_edited_manually`), the sync now skips
  overwriting it indefinitely but still stamps a new
  `avail_last_seen_at` (migration-019) so staff can tell the sync hasn't
  silently lost track of it - both surfaced in the detail panel. Reuses
  the existing `AVAIL_AVL_REPORTS_API_KEY` - the owner has confirmed
  production does not need a separate subscription key for Detours.
  Migration-019 has been run against the dev DB. **Still needs
  `AVAIL_DETOURS_URL` set on `func-mvta-restapi-dev` and this code
  committed/deployed** before it goes live; same unconfirmed-envelope-key
  caveat as every other Avail feed in this project (guessed as
  `result.Detours`, unverified against a real response).
- **Detour image attachments**: staff can attach photos (signage, hand-
  marked maps, screenshots) to a detour record - a multi-file upload
  control in the entry form, resized client-side before upload, with a
  thumbnail row and click-through to full size in the detail panel. Images
  upload directly to a new Blob Storage account via short-lived SAS tokens
  minted by the Function App's own managed identity - never a storage
  account key, and images never pass through the API's own request body.
  A new daily timer purges images once their detour has been over for 30+
  days (privacy default - a phone photo of a road closure can incidentally
  include plates or bystanders). New `infra-phase1/modules/storage-detour-
  images.bicep` (private container, no public-read) - **a new Azure
  resource with real cost, not deployed until explicitly approved.**
- **OTP Compliance completion**: Audit Stream, Administration, Threshold
  Tuner, and the Dashboard trend chart are now real, replacing their
  "coming soon" placeholders. Review Queue approvals/rejections and Weather
  exclusions are now **persisted** (`OtpStopExclusions`/`OtpDateExclusions`)
  instead of ephemeral browser state that reset on reload - this is also
  what makes the Audit Stream real (it queries these records directly, same
  "the record is the audit trail" approach as the console's top-level Audit
  Log). Reason codes are now admin-editable (`OtpReasonCodes`, seeded with
  the previous hardcoded lists) and managed from the new Administration
  page. The early/late bias detection threshold is now a persisted,
  admin-editable setting (`OtpSettings`) rather than a hardcoded constant -
  the new Threshold Tuner page previews a different value against the
  current month's already-fetched data before applying it. The Dashboard's
  "Power BI" placeholder is now a real, hand-rolled OTP % trend chart
  (`GET /otp-monthly-trend`) - percent only, no penalty-dollar figure, since
  no Attachment G penalty formula exists yet to build one from. Along the
  way, fixed a real bug where an approved exclusion never actually changed a
  route's Official OTP % once that route had a `route_label` (the candidate
  and route-row `route` fields used different conventions and silently
  never matched). New `migration-018-otp-exclusions-and-settings.sql`.
- **Detours & Closures module** - a new top-level console page collapsing the
  hand-tracked mix of Avail (when a detour is actually built there), staff
  email, and an Excel tracker into one place. Manual create/edit/delete with
  route-segment directions, and a computed status (Active/Upcoming/Monitor/
  Recently finished/Expired) shared by the API and UI so they can't drift.
  Read-only for `OCC.Viewer`, full access for `OCC.Publisher`/`OCC.Admin`.
  `Source`/`ExternalDetourId` ship now (both unused until the Avail Detours
  sync is built) so a future sync needs no migration-after-the-fact. Image
  attachments and the Avail sync itself are not part of this pass - see
  `detour-and-event-module-implementation-plan.md`.
- **Route Classification** (Admin page) - no Avail feed (OTP, Missed Trips,
  AVL Reports) distinguishes a fixed-route RouteID from a special-event one,
  so this is the one place MVTA OnBoard itself decides. A light, occasional
  admin step, not a bulk-import workflow.
- **Event bus positions (live)** in Event Monitoring - a third panel showing
  only vehicles classified `SpecialEvent` in Route Classification. Reuses
  the existing 5-minute AVL Reports poll rather than a second fetch against
  the same feed; correctly shows zero vehicles until a real classification
  row exists for an active event.
- Expanded the consolidated manual with application ownership, maintenance
  cadence, change control, database and integration care, incident recovery,
  and safe Claude/Codex collaboration guidance.
- Incorporated all 11 pre-implementation planning `.docx` files into the
  manual: resolved vendor decisions (ACS, FCM, SpareLabs, Avail/DoubleMap),
  the contractor B2B guest-access procedure, and the OTP Compliance /
  Special Event Vehicle Monitoring module designs (both fully specified, both
  still unbuilt). Added a document-inventory section (Manual §23) marking
  every planning document's current status so it's clear which to trust.
- **Known live-environment risk (unverified, not yet confirmed a bug):** the
  `dev` environment's Key Vault and SQL Server were originally built with
  public network access per `MVTA_OnBoard_Portal_Setup_Guide_1.docx`'s
  simplified no-code setup path, which that same document says must be
  hardened to private networking "before real rider data is flowing through
  it" - and `dev` is now effectively production. No one has confirmed in
  this repository whether that hardening was ever done. See Manual §11.
- Confirmation + STOP/HELP subscriber endpoints (blocked on Azure
  Communication Services provisioning).
- **Known live-environment issue:** the Function App's Easy Auth
  `allowedAudiences` setting is not yet applied on `func-mvta-restapi-dev`
  (Bicep has the fix; the live resource doesn't), so real Entra sign-ins
  currently get "Not authenticated" on authenticated reads/writes until an
  infra deploy or a direct `az webapp auth` fix is applied.
- **Compliance** tab, split out of OCC Tools: hosts OTP Compliance and
  Missed Trips under their own console tab, gated by a new dedicated
  `OCC.Compliance` app role (not yet created in the live Entra app
  registration - pending owner action; `OCC.Admin` retains access in the
  meantime) instead of the blanket `OCC.Admin` gate the rest of OCC Tools
  uses.
- **Decision Matrix QRG grid view**: a third view mode alongside List/Grid
  presenting the printed Quick Reference Guide's own section/subsection/
  Trouble-Probable Cause-Remedy-Reference table layout.
- This in-app **Changelog** page, listing released version history for all
  signed-in staff.
- Compose's affected-routes field now pulls a multi-select from the live
  `GtfsRoutes` registry (`GET /routes`) instead of free-typed text, falling
  back to the old comma-separated input if the registry can't be reached.
- **AI-drafted rider-friendly summaries in Compose:** a "Draft rider-friendly
  text" action calls the Claude API directly (new `ANTHROPIC_API_KEY` Key
  Vault secret - not yet provisioned, pending owner action) to turn a staff
  member's internal incident/delay report into a concise, plain-language
  rider alert for the existing `summary` field - always editable, never
  auto-posted. Fills the field's originally-documented purpose (`Messages.summary`'s
  schema comment already called it "Claude's short rider-facing summary,
  distinct from raw_text"); replaces the old Power-Automate-orchestrated
  design, which needed Power Platform setup that was never built.
- Compose's affected-routes multi-select now also includes **MVTA Connect**
  (the on-demand/paratransit service has no `GtfsRoutes` row of its own,
  since it's zone-based rather than a fixed route).
- The rider-facing summary in Compose now **auto-drafts** via Claude a
  moment after staff pause typing the internal report - only while the
  summary is still empty, so it never overwrites something staff already
  wrote or edited. The manual "Draft rider-friendly text" button still works
  for regenerating.
- **Live AVL vehicle positions** in Event Monitoring: a new `availAvlPoll.ts`
  timer ingests Avail's own proprietary AVL Reports API (distinct from the
  GTFS-Realtime feeds already ingested elsewhere - separate vehicle/route/
  block/run/trip keys, no guaranteed join to a GTFS `trip_id`), new
  `AvailAvlVehiclePositions` table, new `GET /avail-avl`, and a new table in
  the console showing every vehicle's latest reported position - added
  alongside the module's existing mock event-shuttle scenario, not replacing
  it. A real map overlay of these positions is a planned follow-up. New
  `AVAIL_AVL_REPORTS_API_KEY` Key Vault secret required (pending owner
  action) plus the `AVAIL_AVL_REPORTS_URL` app setting.
- **Fixed Route Departures**, a new Compliance-tab module tracking whether
  vehicles leave the garage on schedule using Avail's own dispatch-side
  Pullout Reports API (check-in/login/pullout timing, scheduled vs actual,
  plus Avail's own "Late Relief"/"Expired Pullout" classification) - a
  separate, more authoritative signal for garage-side lateness than anything
  inferred from GTFS or AVL data. New `fixedRouteDeparturesPoll.ts` timer
  (reuses the existing `AVAIL_AVL_REPORTS_API_KEY` - no new secret), new
  `FixedRouteDepartures` table that accumulates permanently (never
  overwritten) so late/expired pullouts can be trend-analyzed by operator,
  block, or date, and a new `GET /fixed-route-departures` endpoint with
  summary stats (late/expired counts, average delta). New `AVAIL_PULLOUT_URL`
  app setting required (imperative, pending owner action) plus the not-yet-run
  `migration-013-fixed-route-departures.sql`.
- **Real OTP % and fixed-route missed-trip data in OTP Compliance**, replacing
  that module's mock data with two new Avail360 feeds per
  `OTP-Feed-Evaluation-and-Recommendation.md`: the OTP Monthly By Route/Stop/
  Day of Week feed (real Attachment G departure-adherence numbers) and the
  Missed Trips By Route/Stop/Day feed (vendor-reported fixed-route missed-
  trip incidents, distinct from the existing GTFS-based real-time no-show/
  cancellation detection). Both poll **hourly** rather than only at month
  close-out, so the current month's numbers stay continuously up to date
  through the month rather than only appearing as a locked snapshot after it
  closes. Route Summary and Review Queue now read the live feed when it's
  configured and has data, falling back to the module's existing sample data
  otherwise; Monthly Assessments (previously a static placeholder) is now
  real, showing OTP % and missed-trip counts per route for the selected
  month. New `AVAIL_OTP_MONTHLY_URL`/`AVAIL_MISSED_TRIPS_URL` app settings
  required (imperative, pending owner action, reuse the existing Avail key)
  plus the not-yet-run `migration-014-otp-monthly.sql`/
  `migration-015-avail-missed-trips.sql`. **Known unconfirmed assumption:**
  neither feed's full response envelope was available to verify against -
  see the code comments in `otpMonthlyFeed.ts`/`availMissedTripsFeed.ts` and
  `HANDOFF.md` for what to check once a real response is available.

## [1.3.0] - 2026-07-28

### Added
- Missed-trip detection as a compliance investigation tool: explicit
  GTFS-RT cancellations and schedule-based silent no-shows (cross-
  referencing GTFS `calendar`/`calendar_dates`/`stop_times` against a daily
  log of trips actually observed in the realtime feed) are flagged into a
  new **Missed Trips** module for staff to investigate and validate
  (confirmed / false positive) - deliberately decoupled from the Suggested
  Alerts customer-notification queue, since a flagged trip is a compliance
  record, not an automatic rider alert. A "Prepare rider alert" action
  stays available as a separate, explicit step if an investigation
  determines customers should be notified.
- Suggested Alerts now auto-expire to `expired` after 2 hours unreviewed,
  across every detection source, via a new 15-minute timer.

## [1.2.2] - 2026-07-27

### Added
- **Alert via Teams** Compose option with separate Operations and Customer
  Service targets.
- Affected-route entry in Compose for internal and customer route-impact
  messages.
- Channel visibility in Active Messages and Audit Log.
- Future Teams Adaptive Card and approved-image connector contract in the
  consolidated manual.
- Dispatch channel-selection unit tests.

### Fixed
- Subscriber dispatch now honors explicit SMS and email selections, preventing
  internal or Teams-only messages from being sent to riders.
- The rider application now explicitly requests Website messages, preventing
  internal-only messages from appearing as public service alerts.

## [1.2.1] - 2026-07-26

### Added
- Persistent OCC alert preparation through the existing Suggested Alerts
  human-review queue, with source-qualified deduplication.
- Direct navigation to and highlighting of the prepared review item.
- Non-persistent customer-language previews for local sample scenarios.
- A consolidated operations, product, architecture, deployment, and roadmap
  manual.

### Changed
- Preview banners now explain that mock sign-in cannot access operational data
  and that preview actions are not saved.
- Suggested Alerts can display and focus a previously reviewed item without
  offering invalid approval actions.

## [1.2.0] - 2026-07-26

### Added
- **Fixed Route Service Risk** OCC workspace with exception-first monitoring,
  future departure predictions, first threshold-crossing departure,
  confidence evidence, a stop-by-stop timeline, and access to the existing
  current-telemetry view.
- **On-Demand Service Quality** OCC workspace for the 25-minute wait-time
  standard, including predicted versus actual wait, assignment context,
  confidence evidence, and customer-update workflow actions.
- Vendor-neutral `GET /api/on-demand-risks` contract and
  `MonitoredOnDemandWaits` schema for a future on-demand feed adapter.
- Current-state, suggested-improvements, and feature-implementation handoff
  documents.

### Changed
- GTFS TripUpdate processing now treats departures as MVTA's operational
  measure, retaining predictions for every usable future stop.
- Fixed-route escalation now uses the maximum predicted future departure
  delay across two consecutive polls instead of only the first stop's current
  delay.
- GTFS delay-suggestion deduplication now includes service date so recurring
  scheduled trips can create new exceptions on later service days.

## [1.1.0] - 2026-07-24

### Added
- GTFS-Realtime Alert feed ingestion (Phase 1): bridges MVTA's
  dispatcher-entered CAD detour/service-change notices into the Suggested
  Alerts human-review queue, deduped by feed entity ID.
- GTFS-Realtime TripUpdate delay detection (Phase 2): a 5-minute poll logs
  every monitored trip's live delay (all delays reported, regardless of
  size) and escalates a delay sustained over 15 minutes across 2
  consecutive polls into a Suggested Alerts candidate, with real stop
  names resolved from a daily static-GTFS sync. New **Live Delays** module
  in OCC Tools shows every monitored trip's current status.
- Automatic retry-with-backoff on GET requests in the shared API client,
  to absorb transient Front Door edge-node propagation flakiness.
- Redesigned staff console sign-in screen (centered card, brand gradient
  backdrop) to match MVTA's other internal tools.
- This changelog, and a build-time app version badge wired to
  `package.json` instead of a hand-maintained string.

### Fixed
- Onboard-console blank page when served through Azure Front Door at
  `/console/*` - Front Door forwards requests without stripping the
  `/console` prefix, and the server-side rewrite rule meant to do that
  never reliably applied; the build now nests its own output under a
  literal `console/` folder so the deployed paths match the requested
  URLs directly, with no rewrite dependency.
- Rider-app "Failed to fetch" on Service Alerts, caused by a misconfigured
  `VITE_API_BASE` GitHub Actions variable pointing at the Function App's
  raw hostname (blocked by the app's own CSP) instead of a same-origin
  relative path.
- `created_by` on message creation is now derived from the verified auth
  principal server-side rather than trusted from the request body, except
  for the `System.Ingestion` service-principal fallback.

## [1.0.0] - Initial release

- React + Vite + TypeScript monorepo replacing the original single-file
  HTML mockups: **rider-app** (public Service Alerts + opt-in) and
  **onboard-console** (Entra-gated staff dashboard).
- Full REST API on Azure Functions (TypeScript): messages CRUD/retract,
  subscribers, admin config, Suggested Alerts human-review queue.
- Role-based access control via Entra ID app roles (OCC.Viewer/
  Publisher/Admin, System.Ingestion), enforced both client-side (UI
  gating) and server-side (`requireRole`).
- OCC Tools: Event Monitoring, Decision Matrix, and OTP Compliance
  modules, consolidated into one cohesive design system.
- Security hardening: CSP/security headers, Front Door + WAF, managed-
  identity DB/Storage/Service Bus auth (no standing secrets), GitHub
  Actions CI/CD via OIDC federated identity.
