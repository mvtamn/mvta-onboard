// Vocabulary of the exclusion review module.
//
// Two kinds of exclusion are reviewed against a service month, and CONTEXT.md
// keeps them distinct because they do different things to the figures:
//
//   A Stop Exclusion is a reviewed decision that one stop, on one route, on
//   one day of the week, does not count toward Official Departure OTP.
//
//   A Weather Day Exclusion is a recorded weather or emergency service date.
//   Once approved it subtracts the departures frozen when it was approved
//   (ADR 0038). This module only reads them, for the timeline.
//
// They share a reviewer, a reason code and a moment, which is why the Audit
// Stream can show them as one timeline - and why they live behind one module.

/** Where a reviewed Stop Exclusion stands. A stop with no row is not here. */
export type StopExclusionStatus = "approved" | "rejected";

export interface StopExclusionRecord {
  id: string;
  service_month: string;
  route_id: number;
  stop_id: number;
  day_of_week: string;
  status: StopExclusionStatus;
  reason_code: string | null;
  reviewed_by: string;
  reviewed_at: Date;
}

export interface WeatherDayRecord {
  id: string;
  scope: "Agency" | "Route";
  /** Null for an agency-wide day. */
  route_id: number | null;
  /** CHAR(8) 'YYYYMMDD'. */
  service_date: string;
  reason_code: string;
  notes: string | null;
  status: "Proposed" | "Approved";
  notified: boolean;
  notified_at: Date | null;
  acknowledged: boolean;
  created_by: string;
  created_at: Date;
}

/** What a reviewer is asking to write down. */
export interface StopExclusionDecision {
  service_month: string;
  route_id: number;
  stop_id: number;
  day_of_week: string;
  status: StopExclusionStatus;
  reason_code: string | null;
}

/**
 * One thing that happened, as data rather than as a sentence.
 *
 * The handler used to build English here - "Route 490 · Stop 13209 · Monday ·
 * RECOVERY · by jane" - and the console rendered the string. That is why the
 * Audit Stream showed a raw reason code where the Review Queue, which resolves
 * the same code against OtpReasonCodes, showed its label. The console words
 * these now (otpAuditEntries.ts), beside the rest of the OTP display code.
 *
 * A discriminated union rather than one shape with nullable fields: a reader
 * has to branch on kind to say anything useful, and this way the compiler
 * makes sure both branches exist.
 */
export type ExclusionAuditEntry =
  | {
      kind: "stop_exclusion";
      at: string;
      actor: string;
      reason_code: string | null;
      route_id: number;
      stop_id: number;
      day_of_week: string;
      status: StopExclusionStatus;
    }
  | {
      kind: "weather_day";
      at: string;
      actor: string;
      reason_code: string;
      scope: "Agency" | "Route";
      route_id: number | null;
      service_date: string;
    };
