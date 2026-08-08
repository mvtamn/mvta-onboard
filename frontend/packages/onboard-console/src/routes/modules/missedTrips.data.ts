export type MissedTripAlertStatus = "watching" | "escalated" | "resolved";
export type MissedTripValidationStatus = "unreviewed" | "confirmed" | "false_positive";

// Which of the two independent detection signals fired (gtfsMissedTripsPoll.ts) -
// added by migration-023 (backend column: detection_type). null means a row
// flagged before that migration ran; the console shows that honestly rather
// than guessing which signal it was.
export type MissedTripDetectionType = "explicit_cancellation" | "silent_no_show" | null;
export type MissedTripDataQualityStatus = "legacy_unverified" | "source_verified" | "experimental";

// Missed Trips is a compliance/investigation tool: detection flags a
// candidate (status) and a separate staff review records whether it was
// confirmed or a false positive (validationStatus). The two are independent
// dimensions - a trip can be "resolved" (it did eventually depart late) and
// still be unreviewed, or "escalated" and already confirmed.
export interface MissedTripAlert {
  id: string;
  tripId: string;
  serviceDate: string;
  route: string;
  direction: string | null;
  detectionType: MissedTripDetectionType;
  scheduledDepartureAt: string | null;
  graceDeadlineAt: string | null;
  status: MissedTripAlertStatus;
  detectedLateArrivalAt: string | null;
  firstSeenWatchingAt: string;
  suggestedAlertId: string | null;
  validationStatus: MissedTripValidationStatus;
  reasonCode: string | null;
  validatedBy: string | null;
  validatedAt: string | null;
  notes: string | null;
  detectorVersion: string | null;
  dataQualityStatus: MissedTripDataQualityStatus;
}

// Preview-only fallback shown when the console can't reach the authenticated
// missed-trip service (e.g. local mock sign-in, or a 401/5xx) - same role
// FIXED_ROUTE_RISKS plays for FixedRouteServiceRisk.tsx.
export const MISSED_TRIP_ALERTS: MissedTripAlert[] = [
  {
    id: "preview-497-1",
    tripId: "497-0630-SB",
    serviceDate: "20260727",
    route: "497",
    direction: "SB",
    detectionType: "explicit_cancellation",
    scheduledDepartureAt: new Date(Date.now() - 25 * 60_000).toISOString(),
    graceDeadlineAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    status: "escalated",
    detectedLateArrivalAt: null,
    firstSeenWatchingAt: new Date(Date.now() - 25 * 60_000).toISOString(),
    suggestedAlertId: null,
    validationStatus: "unreviewed",
    reasonCode: null,
    validatedBy: null,
    validatedAt: null,
    notes: null,
    detectorVersion: "preview",
    dataQualityStatus: "experimental",
  },
  {
    id: "preview-440-1",
    tripId: "440-0715-NB",
    serviceDate: "20260727",
    route: "440",
    direction: "NB",
    detectionType: "silent_no_show",
    scheduledDepartureAt: new Date(Date.now() - 40 * 60_000).toISOString(),
    graceDeadlineAt: new Date(Date.now() - 25 * 60_000).toISOString(),
    status: "resolved",
    detectedLateArrivalAt: new Date(Date.now() - 12 * 60_000).toISOString(),
    firstSeenWatchingAt: new Date(Date.now() - 40 * 60_000).toISOString(),
    suggestedAlertId: null,
    validationStatus: "confirmed",
    reasonCode: "VEHICLE_BREAKDOWN",
    validatedBy: "Dev User (mock)",
    validatedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    notes: "Dispatch log confirms the vehicle ran 12 minutes behind and was never flagged internally.",
    detectorVersion: "preview",
    dataQualityStatus: "experimental",
  },
];
