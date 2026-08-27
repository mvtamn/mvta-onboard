# Table usage audit — 2026-08-24

## Result

The SQL files under `functions-restapi/sql` define **106 current tables**. Static analysis found direct backend runtime references for **105**. No table is ready to be dropped based on source code alone.

`SystemOutageWindows` is the sole **retirement candidate**: no runtime reference was found in either Function App. It is nevertheless referenced by the nullable `PenaltyDisputes.references_outage_id` foreign key, so its removal needs a migration that first handles that dependency and any existing data.

`SubscriberConfirmations` is **active**, but only on the creation path. The public subscription handler inserts a confirmation record and queues a send ([`subscribersCreate.ts:80`](../../functions-restapi/src/functions/subscribersCreate.ts#L80)); the dispatcher sends the token ([`dispatchConfirmation.ts:17`](../../functions-dispatch/src/functions/dispatchConfirmation.ts#L17)). This audit found no consumption endpoint that reads, confirms, expires, or deletes the record. That is an incomplete double-opt-in workflow—not a table that is safe to remove independently.

## Scope and method

- Extracted every `CREATE TABLE` definition in `functions-restapi/sql/**/*.sql`, de-duplicated by table name.
- Searched the runtime Function App sources: `functions-restapi/src` and `functions-dispatch/src`. An **Active** classification means a direct source reference in those paths.
- **Candidate** means no direct runtime source reference. **Legacy but retained** would mean only migration/FK/history retention; **Test-only** would mean tests only. Neither occurred in the current-table inventory.
- The three former `EventDepotDepartureTest*` names are not additional current tables: migration 072 conditionally renames them to the active `EventMonitoringAreaTest*` tables ([`migration-072-rename-depot-test-tables.sql:1`](../../functions-restapi/sql/migration-072-rename-depot-test-tables.sql#L1)).

This is a source-code audit, not a production database inventory. It cannot prove table row counts, database-level dependencies not represented in these migrations (views, procedures, FKs, jobs), BI/reporting use, ad-hoc queries, or use by another Azure consumer. Before retiring any table, capture those dependencies from the target database, check retention obligations, back up the data, and deploy an additive migration before a later drop.

## Classification summary

| Classification | Count | Recommendation |
|---|---:|---|
| Active | 105 | Retain. Runtime code references the table. |
| Legacy but retained | 0 | None found in this schema inventory. |
| Test-only | 0 | None found in this schema inventory. |
| Candidate | 1 | Investigate `SystemOutageWindows`; do not drop until the FK/data/external-consumer checks pass. |

## Inventory

| Table | Classification | Schema definition | Runtime source evidence |
|---|---|---|---|
| `AccessManagementAudit` | Active | `functions-restapi/sql/migration-052-access-management.sql:40` | `functions-restapi/src/functions/accessManagement.ts:83`; `functions-restapi/src/lib/accessManagementStore.ts:210` |
| `AccessManagementChanges` | Active | `functions-restapi/sql/migration-052-access-management.sql:6` | `functions-restapi/src/functions/accessManagement.ts:78`; `functions-restapi/src/lib/accessManagementStore.ts:76` |
| `AccessManagementGuestInvitations` | Active | `functions-restapi/sql/migration-052-access-management.sql:102` | `functions-restapi/src/lib/accessManagementStore.ts:473` |
| `AccessManagementMetadata` | Active | `functions-restapi/sql/migration-052-access-management.sql:76` | `functions-restapi/src/lib/accessManagementStore.ts:329` |
| `AccessManagementOperations` | Active | `functions-restapi/sql/migration-052-access-management.sql:60` | `functions-restapi/src/lib/accessManagementStore.ts:252` |
| `AppPollState` | Active | `functions-restapi/sql/migration-032-app-settings.sql:29` | `functions-restapi/src/functions/availAvlPoll.ts:60` |
| `AppSettings` | Active | `functions-restapi/sql/migration-032-app-settings.sql:3` | `functions-restapi/src/functions/appSettings.ts:19`; `functions-restapi/src/functions/availAvlPoll.ts:56` |
| `AssessmentCorrectionImpacts` | Active | `functions-restapi/sql/migration-032-governed-performance-assessment.sql:158` | `functions-restapi/src/functions/assessmentPeriods.ts:124` |
| `AssessmentCredits` | Active | `functions-restapi/sql/migration-032-governed-performance-assessment.sql:137` | `functions-restapi/src/functions/assessmentGovernance.ts:42` |
| `AssessmentDisputeItems` | Active | `functions-restapi/sql/migration-032-governed-performance-assessment.sql:148` | `functions-restapi/src/functions/assessmentGovernance.ts:30` |
| `AssessmentExceptions` | Active | `functions-restapi/sql/migration-032-governed-performance-assessment.sql:105` | `functions-restapi/src/functions/assessmentGovernance.ts:12`; `functions-restapi/src/functions/assessmentPeriods.ts:81` |
| `AssessmentPeriods` | Active | `functions-restapi/sql/migration-030-contractor-performance-assessment.sql:177` | `functions-restapi/src/functions/assessmentEvidence.ts:12`; `functions-restapi/src/functions/assessmentGovernance.ts:20` |
| `AssessmentPeriodStandards` | Active | `functions-restapi/sql/migration-032-governed-performance-assessment.sql:73` | `functions-restapi/src/functions/assessmentPeriods.ts:41`; `functions-restapi/src/functions/assessmentReports.ts:14` |
| `AssessmentPeriodTiers` | Active | `functions-restapi/sql/migration-032-governed-performance-assessment.sql:74` | `functions-restapi/src/functions/assessmentPeriods.ts:44`; `functions-restapi/src/lib/assessment/assess.ts:74` |
| `AvailAvlVehiclePositions` | Active | `functions-restapi/sql/migration-012-avail-avl-reports.sql:20` | `functions-restapi/src/functions/availAvl.ts:38`; `functions-restapi/src/functions/availAvlPoll.ts:6` |
| `AvailMissedTripsRouteStopDay` | Active | `functions-restapi/sql/migration-015-avail-missed-trips.sql:13` | `functions-restapi/src/functions/availMissedTrips.ts:62`; `functions-restapi/src/functions/availMissedTripsPoll.ts:67` |
| `ComplianceAssessmentAudit` | Active | `functions-restapi/sql/migration-030-contractor-performance-assessment.sql:281` | `functions-restapi/src/functions/assessmentEvidence.ts:12`; `functions-restapi/src/functions/assessmentGovernance.ts:12` |
| `ComplianceEvidence` | Active | `functions-restapi/sql/migration-030-contractor-performance-assessment.sql:240` | `functions-restapi/src/functions/assessmentEvidence.ts:8`; `functions-restapi/src/functions/assessmentReports.ts:15` |
| `ComplianceOccurrences` | Active | `functions-restapi/sql/migration-030-contractor-performance-assessment.sql:105` | `functions-restapi/src/functions/assessmentPeriods.ts:82`; `functions-restapi/src/functions/complianceCandidatesPoll.ts:13` |
| `ComplianceReports` | Active | `functions-restapi/sql/migration-030-contractor-performance-assessment.sql:328` | `functions-restapi/src/functions/assessmentGovernance.ts:20`; `functions-restapi/src/functions/assessmentReports.ts:22` |
| `ContractorPerformanceStandards` | Active | `functions-restapi/sql/migration-030-contractor-performance-assessment.sql:26` | `functions-restapi/src/functions/assessmentGovernance.ts:25`; `functions-restapi/src/functions/assessmentPeriods.ts:43` |
| `Contractors` | Active | `functions-restapi/sql/migration-030-contractor-performance-assessment.sql:10` | `functions-restapi/src/functions/assessmentPeriods.ts:16`; `functions-restapi/src/functions/assessmentReports.ts:12` |
| `ContractorStandardTiers` | Active | `functions-restapi/sql/migration-030-contractor-performance-assessment.sql:58` | `functions-restapi/src/functions/assessmentPeriods.ts:44`; `functions-restapi/src/functions/otpMonthly.ts:114` |
| `CorrectiveActionPlans` | Active | `functions-restapi/sql/migration-030-contractor-performance-assessment.sql:299` | `functions-restapi/src/functions/assessmentGovernance.ts:25`; `functions-restapi/src/functions/assessmentReports.ts:61` |
| `DecisionMatrixProcedures` | Active | `functions-restapi/sql/migration-051-decision-matrix-procedures.sql:5` | `functions-restapi/src/functions/decisionMatrix.ts:102`; `functions-restapi/src/functions/decisionMatrixGovernance.ts:24` |
| `DetourCommunications` | Active | `functions-restapi/sql/migration-059-detour-communications.sql:3` | `functions-restapi/src/functions/detourCommunications.ts:18`; `functions-restapi/src/functions/detoursList.ts:130` |
| `DetourHistoricalImports` | Active | `functions-restapi/sql/migration-060-detour-historical-import.sql:3` | `functions-restapi/src/functions/detourHistoricalImports.ts:25` |
| `DetourImages` | Active | `functions-restapi/sql/migration-017-detours.sql:72` | `functions-restapi/src/functions/detourImages.ts:5`; `functions-restapi/src/functions/detourImagesPurge.ts:8` |
| `DetourIntake` | Active | `functions-restapi/sql/migration-041-detour-workflow.sql:28` | `functions-restapi/src/functions/detourIntake.ts:41` |
| `DetourIntakeSegments` | Active | `functions-restapi/sql/migration-041-detour-workflow.sql:54` | `functions-restapi/src/functions/detourIntake.ts:64` |
| `DetourNumberSequences` | Active | `functions-restapi/sql/migration-024-detour-numbering.sql:23` | `functions-restapi/src/functions/detoursCreate.ts:58`; `functions-restapi/src/lib/detourNumberAllocator.ts:12` |
| `DetourReasonCodes` | Active | `functions-restapi/sql/migration-025-detour-reporting-fields.sql:22` | `functions-restapi/src/functions/detourReasonCodes.ts:59`; `functions-restapi/src/lib/validation.ts:376` |
| `Detours` | Active | `functions-restapi/sql/migration-017-detours.sql:23` | `functions-restapi/src/functions/availDetoursSync.ts:1`; `functions-restapi/src/functions/detourCommunications.ts:9` |
| `DetourSegments` | Active | `functions-restapi/sql/migration-017-detours.sql:56` | `functions-restapi/src/functions/availDetoursSync.ts:2`; `functions-restapi/src/functions/detourIntake.ts:274` |
| `DetourWorkflowHistory` | Active | `functions-restapi/sql/migration-046-detour-orthogonal-state.sql:13` | `functions-restapi/src/functions/availDetoursSync.ts:120`; `functions-restapi/src/functions/detourIntake.ts:285` |
| `EmailDeliveryLog` | Active | `functions-restapi/sql/phase1-schema.sql:103` | `functions-dispatch/src/functions/dispatchMessageCreated.ts:3` |
| `EventGeofenceCrossings` | Active | `functions-restapi/sql/migration-033-event-geofences.sql:43` | `functions-restapi/src/functions/eventGeofenceCrossings.ts:5`; `functions-restapi/src/functions/eventGeofenceNotifications.ts:57` |
| `EventGeofenceDirectionRules` | Active | `functions-restapi/sql/migration-033-event-geofences.sql:22` | `functions-restapi/src/functions/eventGeofences.ts:33`; `functions-restapi/src/functions/eventServicePlans.ts:18` |
| `EventGeofenceNotificationCooldowns` | Active | `functions-restapi/sql/migration-069-event-geofence-notification-cooldowns.sql:4` | `functions-restapi/src/functions/eventGeofenceNotify.ts:64` |
| `EventGeofenceNotifications` | Active | `functions-restapi/sql/migration-033-event-geofences.sql:54` | `functions-restapi/src/functions/eventGeofenceNotifications.ts:10`; `functions-restapi/src/functions/eventGeofenceNotify.ts:11` |
| `EventGeofencePurposes` | Active | `functions-restapi/sql/migration-067-event-geofence-purpose-catalog.sql:9` | `functions-restapi/src/functions/eventGeofences.ts:15` |
| `EventGeofences` | Active | `functions-restapi/sql/migration-033-event-geofences.sql:2` | `functions-restapi/src/functions/eventGeofenceCrossings.ts:19`; `functions-restapi/src/functions/eventGeofenceNotify.ts:41` |
| `EventGeofenceVehicleState` | Active | `functions-restapi/sql/migration-033-event-geofences.sql:36` | `functions-restapi/src/lib/eventGeofenceDetection.ts:89` |
| `EventLocations` | Active | `functions-restapi/sql/migration-033-event-geofences.sql:10` | `functions-restapi/src/functions/eventGeofenceNotify.ts:41`; `functions-restapi/src/functions/eventGeofences.ts:27` |
| `EventModuleHealth` | Active | `functions-restapi/sql/migration-038-event-telemetry-health.sql:3` | `functions-restapi/src/functions/eventMonitoringHealth.ts:11`; `functions-restapi/src/lib/eventHealth.ts:19` |
| `EventMonitoringAreaTestMessages` | Active | `functions-restapi/sql/migration-071-depot-departure-test-mode.sql:37` | `functions-restapi/src/functions/monitoringAreaTests.ts:17`; `functions-restapi/src/lib/monitoringAreaTest.ts:47` |
| `EventMonitoringAreaTests` | Active | `functions-restapi/sql/migration-071-depot-departure-test-mode.sql:4` | `functions-restapi/src/functions/monitoringAreaTests.ts:15`; `functions-restapi/src/lib/monitoringAreaTest.ts:64` |
| `EventMonitoringAreaTestVehicleState` | Active | `functions-restapi/sql/migration-071-depot-departure-test-mode.sql:21` | `functions-restapi/src/functions/monitoringAreaTests.ts:51`; `functions-restapi/src/lib/monitoringAreaTest.ts:43` |
| `EventOperationalMessaging` | Active | `functions-restapi/sql/migration-062-event-operational-messaging.sql:32` | `functions-restapi/src/functions/eventGeofenceNotify.ts:37`; `functions-restapi/src/functions/eventOperationalMessaging.ts:16` |
| `Events` | Active | `functions-restapi/sql/migration-040-event-operating-context.sql:6` | `functions-restapi/src/functions/eventModuleAuditStream.ts:11`; `functions-restapi/src/functions/eventServicePlans.ts:99` |
| `EventServicePlanConflictOverrides` | Active | `functions-restapi/sql/migration-063-event-plan-conflict-overrides.sql:3` | `functions-restapi/src/functions/eventModuleAuditStream.ts:17`; `functions-restapi/src/functions/eventServicePlans.ts:180` |
| `EventServicePlanGeofences` | Active | `functions-restapi/sql/migration-034-event-service-plans.sql:14` | `functions-restapi/src/functions/eventGeofenceCrossings.ts:21`; `functions-restapi/src/functions/eventGeofenceNotifications.ts:58` |
| `EventServicePlanLocations` | Active | `functions-restapi/sql/migration-034-event-service-plans.sql:15` | `functions-restapi/src/functions/eventServicePlans.ts:10`; `functions-restapi/src/functions/eventVehicleAssignments.ts:78` |
| `EventServicePlanRevisionGeofences` | Active | `functions-restapi/sql/migration-037-event-plan-revisions.sql:14` | `functions-restapi/src/functions/eventServicePlans.ts:9`; `functions-restapi/src/functions/eventVehicleAssignments.ts:78` |
| `EventServicePlanRevisionLocations` | Active | `functions-restapi/sql/migration-037-event-plan-revisions.sql:15` | `functions-restapi/src/functions/eventServicePlans.ts:10`; `functions-restapi/src/functions/eventVehicleAssignments.ts:78` |
| `EventServicePlanRevisionRoutes` | Active | `functions-restapi/sql/migration-037-event-plan-revisions.sql:13` | `functions-restapi/src/functions/eventServicePlans.ts:8`; `functions-restapi/src/functions/eventVehicleAssignments.ts:78` |
| `EventServicePlanRevisions` | Active | `functions-restapi/sql/migration-037-event-plan-revisions.sql:3` | `functions-restapi/src/functions/eventModuleAuditStream.ts:13`; `functions-restapi/src/functions/eventServicePlans.ts:61` |
| `EventServicePlanRoutes` | Active | `functions-restapi/sql/migration-034-event-service-plans.sql:13` | `functions-restapi/src/functions/eventModuleAuditStream.ts:10`; `functions-restapi/src/functions/eventMonitoringHealth.ts:19` |
| `EventServicePlans` | Active | `functions-restapi/sql/migration-034-event-service-plans.sql:1` | `functions-restapi/src/functions/eventGeofenceCrossings.ts:21`; `functions-restapi/src/functions/eventGeofenceNotifications.ts:58` |
| `EventServicePlanScopeSnapshots` | Active | `functions-restapi/sql/migration-043-event-operating-period-snapshots.sql:18` | `functions-restapi/src/functions/eventServicePlans.ts:27`; `functions-restapi/src/functions/eventVehiclePositions.ts:94` |
| `EventTelemetryDiagnostics` | Active | `functions-restapi/sql/migration-038-event-telemetry-health.sql:13` | `functions-restapi/src/functions/eventMonitoringHealth.ts:17`; `functions-restapi/src/functions/eventTelemetryMaintenance.ts:21` |
| `EventTelemetryMaintenance` | Active | `functions-restapi/sql/migration-038-event-telemetry-health.sql:24` | `functions-restapi/src/functions/eventMonitoringHealth.ts:12`; `functions-restapi/src/functions/eventTelemetryMaintenance.ts:5` |
| `EventVehicleAssignments` | Active | `functions-restapi/sql/migration-045-event-vehicle-assignments.sql:5` | `functions-restapi/src/functions/eventModuleAuditStream.ts:16`; `functions-restapi/src/functions/eventMonitoringHealth.ts:21` |
| `EventVehicleCurrentPosition` | Active | `functions-restapi/sql/migration-016-route-classification.sql:36` | `functions-restapi/src/functions/availAvlPoll.ts:91`; `functions-restapi/src/functions/eventMonitoringHealth.ts:19` |
| `EventVehiclePositionHistory` | Active | `functions-restapi/sql/migration-016-route-classification.sql:47` | `functions-restapi/src/functions/availAvlPoll.ts:105`; `functions-restapi/src/functions/eventMonitoringHealth.ts:16` |
| `ExcusableDelayClaims` | Active | `functions-restapi/sql/migration-030-contractor-performance-assessment.sql:84` | `functions-restapi/src/lib/assessment/assess.ts:100` |
| `ExpirationDefaults` | Active | `functions-restapi/sql/phase1-schema.sql:40` | `functions-restapi/src/functions/adminExpirationDefaults.ts:4`; `functions-restapi/src/functions/otpSettings.ts:4` |
| `FinalIssuanceRecords` | Active | `functions-restapi/sql/migration-032-governed-performance-assessment.sql:127` | `functions-restapi/src/functions/assessmentReports.ts:61` |
| `FixedRouteDepartures` | Active | `functions-restapi/sql/migration-013-fixed-route-departures.sql:21` | `functions-restapi/src/functions/availAvl.ts:60`; `functions-restapi/src/functions/complianceCandidatesPoll.ts:15` |
| `GtfsCalendar` | Active | `functions-restapi/sql/migration-011-missed-trips.sql:46` | `functions-restapi/src/functions/gtfsMissedTripsPoll.ts:9`; `functions-restapi/src/functions/gtfsStopsSync.ts:6` |
| `GtfsCalendarDates` | Active | `functions-restapi/sql/migration-011-missed-trips.sql:63` | `functions-restapi/src/functions/gtfsMissedTripsPoll.ts:10`; `functions-restapi/src/functions/gtfsStopsSync.ts:6` |
| `GtfsObservedTrips` | Active | `functions-restapi/sql/migration-011-missed-trips.sql:99` | `functions-restapi/src/functions/gtfsDelaysPoll.ts:144`; `functions-restapi/src/functions/gtfsMissedTripsPoll.ts:11` |
| `GtfsRoutes` | Active | `functions-restapi/sql/migration-010-gtfs-routes.sql:10` | `functions-restapi/src/functions/eventVehiclePositions.ts:13`; `functions-restapi/src/functions/gtfsStopsSync.ts:2` |
| `GtfsScheduledTrips` | Active | `functions-restapi/sql/migration-011-missed-trips.sql:80` | `functions-restapi/src/functions/gtfsDelaysPoll.ts:132`; `functions-restapi/src/functions/gtfsMissedTripsPoll.ts:10` |
| `GtfsStops` | Active | `functions-restapi/sql/migration-005-trip-delays.sql:35` | `functions-restapi/src/functions/gtfsDelaysPoll.ts:199`; `functions-restapi/src/functions/gtfsStopsSync.ts:1` |
| `GtfsTripDirections` | Active | `functions-restapi/sql/migration-007-trip-directions-and-previous-stop.sql:21` | `functions-restapi/src/functions/gtfsStopsSync.ts:3`; `functions-restapi/src/functions/missedTrips.ts:36` |
| `GtfsTripOperationalEvidence` | Active | `functions-restapi/sql/migration-027-missed-trip-operational-evidence.sql:80` | `functions-restapi/src/functions/gtfsDelaysPoll.ts:168`; `functions-restapi/src/functions/gtfsMissedTripsPoll.ts:171` |
| `ManualMetricEntries` | Active | `functions-restapi/sql/migration-030-contractor-performance-assessment.sql:139` | `functions-restapi/src/functions/manualMetrics.ts:6`; `functions-restapi/src/lib/assessment/assess.ts:50` |
| `Messages` | Active | `functions-restapi/sql/phase1-schema.sql:5` | `functions-restapi/src/functions/adminMessages.ts:1`; `functions-restapi/src/functions/messagesActive.ts:1` |
| `MissedTripFeedHealth` | Active | `functions-restapi/sql/migration-027-missed-trip-operational-evidence.sql:113` | `functions-restapi/src/functions/gtfsMissedTripsPoll.ts:43`; `functions-restapi/src/functions/gtfsVehiclePositionsPoll.ts:16` |
| `MissedTripReviewHistory` | Active | `functions-restapi/sql/migration-026-missed-trip-safety-and-audit.sql:17` | `functions-restapi/src/functions/missedTripReviews.ts:23`; `functions-restapi/src/functions/missedTripsValidate.ts:82` |
| `MonitoredMissedTrips` | Active | `functions-restapi/sql/migration-011-missed-trips.sql:117` | `functions-restapi/src/functions/complianceCandidatesPoll.ts:14`; `functions-restapi/src/functions/gtfsMissedTripsPoll.ts:15` |
| `MonitoredOnDemandWaits` | Active | `functions-restapi/sql/migration-009-on-demand-wait-risks.sql:12` | `functions-restapi/src/functions/onDemandRisks.ts:4`; `functions-restapi/src/functions/suggestedAlerts.ts:71` |
| `MonitoredTripDelays` | Active | `functions-restapi/sql/migration-005-trip-delays.sql:19` | `functions-restapi/src/functions/availAvl.ts:67`; `functions-restapi/src/functions/eventVehiclePositions.ts:173` |
| `MvtaHolidayCalendarCoverage` | Active | `functions-restapi/sql/migration-030-contractor-performance-assessment.sql:269` | `functions-restapi/src/functions/assessmentGovernance.ts:20`; `functions-restapi/src/functions/assessmentReports.ts:58` |
| `MvtaHolidays` | Active | `functions-restapi/sql/migration-030-contractor-performance-assessment.sql:258` | `functions-restapi/src/functions/assessmentGovernance.ts:20`; `functions-restapi/src/functions/assessmentReports.ts:58` |
| `OtpDailyRouteStopHour` | Active | `functions-restapi/sql/migration-020-otp-daily.sql:30` | `functions-restapi/src/functions/otpDaily.ts:1`; `functions-restapi/src/functions/otpDailyFeedPoll.ts:56` |
| `OtpDateExclusions` | Active | `functions-restapi/sql/migration-018-otp-exclusions-and-settings.sql:66` | `functions-restapi/src/functions/otpAuditStream.ts:4`; `functions-restapi/src/functions/otpDateExclusions.ts:40` |
| `OtpMonthlyRouteStopDay` | Active | `functions-restapi/sql/migration-014-otp-monthly.sql:9` | `functions-restapi/src/functions/otpMonthly.ts:66`; `functions-restapi/src/functions/otpMonthlyTrend.ts:36` |
| `OtpReasonCodes` | Active | `functions-restapi/sql/migration-018-otp-exclusions-and-settings.sql:13` | `functions-restapi/src/functions/detourReasonCodes.ts:2`; `functions-restapi/src/functions/otpReasonCodes.ts:52` |
| `OtpSettings` | Active | `functions-restapi/sql/migration-018-otp-exclusions-and-settings.sql:87` | `functions-restapi/src/functions/otpSettings.ts:36` |
| `OtpStopExclusions` | Active | `functions-restapi/sql/migration-018-otp-exclusions-and-settings.sql:50` | `functions-restapi/src/functions/otpAuditStream.ts:4`; `functions-restapi/src/functions/otpStopExclusions.ts:47` |
| `PenaltyDisputes` | Active | `functions-restapi/sql/migration-030-contractor-performance-assessment.sql:314` | `functions-restapi/src/functions/assessmentGovernance.ts:30`; `functions-restapi/src/functions/assessmentReports.ts:61` |
| `PerformanceAgreements` | Active | `functions-restapi/sql/migration-032-governed-performance-assessment.sql:12` | `functions-restapi/src/functions/assessmentPeriods.ts:33`; `functions-restapi/src/functions/complianceCandidatesPoll.ts:22` |
| `PeriodKpiAssessments` | Active | `functions-restapi/sql/migration-030-contractor-performance-assessment.sql:201` | `functions-restapi/src/functions/assessmentEvidence.ts:12`; `functions-restapi/src/functions/assessmentGovernance.ts:12` |
| `RouteClassification` | Active | `functions-restapi/sql/migration-016-route-classification.sql:16` | `functions-restapi/src/functions/eventGeofenceCrossings.ts:20`; `functions-restapi/src/functions/eventGeofenceNotify.ts:41` |
| `RouteClassificationHistory` | Active | `functions-restapi/sql/migration-039-admin-concurrency-and-classification-history.sql:3` | `functions-restapi/src/functions/routeClassification.ts:192` |
| `SmsDeliveryLog` | Active | `functions-restapi/sql/phase1-schema.sql:90` | `functions-dispatch/src/functions/dispatchMessageCreated.ts:3` |
| `SpareMissedTripEvaluations` | Active | `functions-restapi/sql/migration-028-spare-missed-trip-foundation.sql:67` | `functions-restapi/src/functions/missedTrips.ts:96`; `functions-restapi/src/functions/spareMissedTripsEvaluate.ts:149` |
| `SpareMissedTripSlots` | Active | `functions-restapi/sql/migration-028-spare-missed-trip-foundation.sql:41` | `functions-restapi/src/functions/spareMissedTripsEvaluate.ts:148`; `functions-restapi/src/functions/spareMissedTripsIngest.ts:224` |
| `SpareMissedTripSource` | Active | `functions-restapi/sql/migration-028-spare-missed-trip-foundation.sql:6` | `functions-restapi/src/functions/spareMissedTripsEvaluate.ts:147`; `functions-restapi/src/functions/spareMissedTripsIngest.ts:159` |
| `SubscriberConfirmations` | Active | `functions-restapi/sql/migration-002-subscriber-confirmations.sql:13` | `functions-restapi/src/functions/subscribersCreate.ts:93` |
| `Subscribers` | Active | `functions-restapi/sql/phase1-schema.sql:60` | `functions-restapi/src/functions/adminSubscribers.ts:1`; `functions-restapi/src/functions/subscribersCreate.ts:1` |
| `SuggestedAlerts` | Active | `functions-restapi/sql/migration-003-suggested-alerts.sql:11` | `functions-restapi/src/functions/availAvlPoll.ts:5`; `functions-restapi/src/functions/gtfsAlertsPoll.ts:2` |
| `SystemOutageWindows` | Candidate | `functions-restapi/sql/migration-030-contractor-performance-assessment.sql:161` | — |
| `ValidationDraftShares` | Active | `functions-restapi/sql/migration-032-governed-performance-assessment.sql:116` | `functions-restapi/src/functions/assessmentEvidence.ts:12`; `functions-restapi/src/functions/assessmentGovernance.ts:20` |
