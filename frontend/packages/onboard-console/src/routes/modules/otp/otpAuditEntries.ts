// Putting exclusion review's timeline into words.
//
// The server used to word these and send the sentences. It has no access to
// the reason-code labels, so the Audit Stream printed a raw "SCHED_RECOVERY"
// where the Review Queue, reading the same OtpReasonCodes rows, printed
// "Recovery point" for the same decision. The facts cross the wire now
// (functions-restapi/src/lib/otpExclusionReview) and the wording lives here,
// beside otpFigures.ts, with the labels it needs.
import type { OtpAuditEntry, OtpReasonCode } from "@mvta/shared";

export interface AuditLine {
  title: string;
  detail: string;
  at: string;
}

/** Resolve a reason code to the label staff chose for it. */
export function reasonLabeller(reasonCodes: readonly OtpReasonCode[]): (code: string | null) => string {
  const byCode = new Map(reasonCodes.map((r) => [r.code, r.label]));
  return (code) => (code === null || code === "" ? "no reason given" : byCode.get(code) ?? code);
}

/** "20260908" -> "8 Sep 2026", the way a service date reads to a reviewer. */
export function serviceDateLabel(yyyymmdd: string): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = months[Number(yyyymmdd.slice(4, 6)) - 1];
  if (!month) return yyyymmdd;
  return `${Number(yyyymmdd.slice(6, 8))} ${month} ${yyyymmdd.slice(0, 4)}`;
}

/**
 * One entry as a heading and a line of detail.
 *
 * A stop exclusion says what was decided; a weather day says what was
 * recorded. Both name who did it - the timeline is an audit trail, and an
 * action without an actor is not one.
 */
export function auditLine(entry: OtpAuditEntry, label: (code: string | null) => string): AuditLine {
  if (entry.kind === "stop_exclusion") {
    return {
      title: entry.status === "approved" ? "Stop excluded" : "Stop kept in the figure",
      detail: `Route ${entry.route_id} · Stop ${entry.stop_id} · ${entry.day_of_week} · ${label(entry.reason_code)} · by ${entry.actor}`,
      at: entry.at,
    };
  }
  const where = entry.scope === "Agency" ? "All routes" : `Route ${entry.route_id}`;
  return {
    title: "Weather day recorded",
    detail: `${serviceDateLabel(entry.service_date)} · ${where} · ${label(entry.reason_code)} · by ${entry.actor}`,
    at: entry.at,
  };
}

export function auditLines(
  entries: readonly OtpAuditEntry[],
  reasonCodes: readonly OtpReasonCode[],
): AuditLine[] {
  const label = reasonLabeller(reasonCodes);
  return entries.map((entry) => auditLine(entry, label));
}
