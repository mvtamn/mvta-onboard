// Internal detour numbering - Part B10 of detour-module-consolidated-plan.md.
// Format: MVTA-DET-YYYY-#### (e.g. MVTA-DET-2026-0001), #### resetting each
// year. The sequence allocation itself lives in detoursCreate.ts (it has to
// run inside that endpoint's existing transaction); everything pure and
// testable lives here.

export const DETOUR_NUMBER_PREFIX = "MVTA-DET";

// Zero-padded to 4 digits, but deliberately NOT truncated past 9999 - a
// fifth digit widens the string rather than silently wrapping to 0001 and
// colliding with an already-issued number. NVARCHAR(20) has the headroom.
export function formatDetourNumber(year: number, sequence: number): string {
  return `${DETOUR_NUMBER_PREFIX}-${year}-${String(sequence).padStart(4, "0")}`;
}

// The year a new detour's number is issued under: the year its start_date
// falls in, falling back to the current year for open-ended/undated detours
// (start_date is nullable in migration-017). Mirrors the backfill logic in
// migration-024 so a backfilled row and a newly created one agree.
export function detourNumberYear(startDate: string | null | undefined, now: Date): number {
  if (startDate) {
    // start_date is a DATE column - parse the YYYY prefix directly rather
    // than via new Date(), which would shift a bare "2026-01-01" into the
    // previous year for anyone behind UTC.
    const year = Number(startDate.slice(0, 4));
    if (Number.isInteger(year) && year > 1900) return year;
  }
  return now.getUTCFullYear();
}

// Parses the year back out of an issued number, for the mismatch warning
// below. Returns null for anything not in the expected shape (including the
// NULLs that exist on rows created before migration-024).
export function parseDetourNumberYear(internalNumber: string | null | undefined): number | null {
  if (!internalNumber) return null;
  const match = /^MVTA-DET-(\d{4})-\d{4,}$/.exec(internalNumber);
  if (!match) return null;
  return Number(match[1]);
}

// A number is never reassigned once issued - it may already be sitting in a
// sent notification email. So when a detour is rescheduled into a different
// year, the number stays as-issued and the console shows a warning instead,
// per B10's reschedule edge case. True means "show the warning".
export function hasDetourNumberYearMismatch(
  internalNumber: string | null | undefined,
  startDate: string | null | undefined,
): boolean {
  const issuedYear = parseDetourNumberYear(internalNumber);
  if (issuedYear === null || !startDate) return false;
  const currentYear = Number(startDate.slice(0, 4));
  if (!Number.isInteger(currentYear)) return false;
  return issuedYear !== currentYear;
}
