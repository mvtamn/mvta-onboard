// Vocabulary of the occurrence intake module (CONTEXT.md "Compliance
// occurrence"). Callers say what was observed or decided; which contractor it
// belongs to, whether it may be written, and what that does to the month are
// the module's business.

export type OccurrenceAttribution = "contractor_error" | "excusable" | "mvta_directed" | "undetermined";
export type OccurrenceReviewStatus = "candidate" | "confirmed" | "dismissed";

// What the intake rule says about an occurrence for a service date and
// standard, before anything is written. Computed in SQL (assignment.ts) so the
// poll judges thousands of rows the way a single write judges one.
export type IntakeState =
  | "accepted"
  // No active Agreement, or several, covers the service date (ADR 0005): an
  // Unassigned Candidate, which contributes nothing.
  | "unassigned"
  // The covering Agreement does not score the standard on that date.
  | "standard_not_scored"
  // That contractor's month is finalized or issued. A correction reopens or
  // supersedes the period; intake never changes it.
  | "period_closed";

export type RecordObservation =
  // Entered by hand in the Assessment module: confirmed and charged. The
  // contractor comes from the Agreement; a caller that names one must name that one.
  | {
      kind: "manual";
      standardId: string;
      serviceDate: string;
      quantity: number;
      durationDays: number | null;
      qualifierCode: string | null;
      description: string;
      contractorId?: string | null;
    }
  // A missed-trip review answered at the Compliance review. Creates the
  // occurrence or restates the one an earlier review or the poll raised.
  | {
      kind: "missed_trip_review";
      tripId: string;
      serviceDate: string;
      reviewStatus: OccurrenceReviewStatus;
      attribution: OccurrenceAttribution;
      note: string | null;
    };

export interface Resolution {
  reviewStatus: OccurrenceReviewStatus;
  attribution: OccurrenceAttribution;
  dismissReason: string | null;
  // undefined leaves the link alone; null removes it.
  reliefId?: string | null;
}

// null clears the figure.
export type AssessedAmount = { amount: number; note: string } | null;

export type IntakeRefusalCode =
  | Exclude<IntakeState, "accepted">
  | "contractor_mismatch"
  | "relief_mismatch"
  | "amount_outside_band"
  | "not_found"
  | "schema_not_ready";

export interface IntakeRefusal {
  code: IntakeRefusalCode;
  sentence: string;
}

export interface Written {
  id: string;
  contractorId: string;
  serviceMonth: string;
}

export type IntakeOutcome = { ok: true; occurrence: Written } | { ok: false; refusal: IntakeRefusal };

// One nightly pass over one source. Every observation not already an
// occurrence is counted once under what the intake rule said about it.
export interface RaiseReport {
  raised: number;
  unassigned: number;
  not_scored: number;
  period_closed: number;
}

export type CandidateSource = "missed_trips" | "fixed_route_departures" | "on_demand_departures";

// Which sources the caller trusts this pass (feed trust, table readiness).
export type RaiseGates = Record<CandidateSource, boolean>;
