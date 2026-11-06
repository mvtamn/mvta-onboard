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
  // Entered by hand in the Assessment module. The contractor comes from the
  // Agreement; a caller that names one must name that one. Someone holding
  // attribution authority enters it confirmed as contractor error; anyone else
  // enters a candidate that waits for a manager's attribution (plan step 0.8).
  | {
      kind: "manual";
      attributed: boolean;
      standardId: string;
      serviceDate: string;
      quantity: number;
      durationDays: number | null;
      qualifierCode: string | null;
      description: string;
      contractorId?: string | null;
    }
  // A missed-trip review outcome. Creates the occurrence or restates the one an
  // earlier review or the poll raised. It carries the outcome only: Service
  // attribution is a manager's separate decision (attributeOccurrence), so a
  // confirmed trip waits as a candidate until one is made.
  | {
      kind: "missed_trip_review";
      tripId: string;
      serviceDate: string;
      confirmed: boolean;
      note: string | null;
    };

// A reviewer's act on an occurrence: whether it happened, and its relief link.
// Dismissing (it did not happen) or reopening clears any attribution, since
// there is nothing left to attribute; whose fault it was is attributeOccurrence.
export interface Resolution {
  // undefined leaves the status alone.
  reviewStatus?: "candidate" | "dismissed";
  dismissReason: string | null;
  // undefined leaves the link alone; null removes it.
  reliefId?: string | null;
}

// Which attribution authorities the person acting holds. The endpoint reads
// them from the caller's access; the module decides which one a change needs.
export interface AttributionAuthority {
  attribute: boolean;
  excuse: boolean;
}

// null clears the figure.
export type AssessedAmount = { amount: number; note: string } | null;

export type IntakeRefusalCode =
  | Exclude<IntakeState, "accepted">
  | "contractor_mismatch"
  | "relief_mismatch"
  | "amount_outside_band"
  | "not_found"
  | "schema_not_ready"
  // The attribution change needs an authority the person does not hold:
  // excusable is the COO's alone, everything else a manager's.
  | "attribution_authority"
  // Reviewed as not having happened: there is nothing to attribute.
  | "not_attributable";

export interface IntakeRefusal {
  code: IntakeRefusalCode;
  sentence: string;
}

export interface Written {
  id: string;
  contractorId: string;
  serviceMonth: string;
  // Set by the missed-trip review hand-off, which decides it.
  reviewStatus?: OccurrenceReviewStatus;
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
