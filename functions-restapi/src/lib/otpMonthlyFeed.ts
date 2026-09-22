import sql from "mssql";

// Avail360 OTP Monthly By Route/Stop/Day of Week - the recommended primary
// OTP feed per OTP-Feed-Evaluation-and-Recommendation.md (repo root).
// Auto-aggregates to the whole month containing whatever service date is
// passed - no date-range math, no risk of a partial month. Records carry
// DayOfWeek but no month/date field of their own, so the caller stamps the
// request's own service_month onto each mapped row.
//
// CONFIRMED live 2026-08-06 (see plans/otp-compliance-live-data-rethink.md):
// the guessed PascalCase key was wrong the whole time - the diagnostic
// below caught it firing across three real months (202608/07/06) once the
// trailing-window backfill actually ran. Real key is lowercase "otp", with
// a sibling "results" metadata array - same pattern as Detours
// ("Detours" -> "detours") and Missed Trips ("MissedTripsByRouteStopDay"
// -> "missed"). Every month this feed has ever polled was genuinely never
// empty - it's been misread since day one, not lacking data.
export interface OtpMonthlyReport {
  DayOfWeek: string;
  StopID: number;
  StopInternetName: string | null;
  RouteReportLabel: string | null;
  RouteID: number;
  PercentEarly: number;
  PercentOntime: number;
  PercentLate: number;
  PercentNotOntime: number;
  PercentMissed: number;
  Early: number;
  Ontime: number;
  Late: number;
  Missed: number;
  ActualDepartures: number;
  Total: number;
}

export function serviceMonthOf(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}${m}`;
}

// Returns the 1st of the month `months` before `date`'s month - sufficient
// for feeds that "auto-aggregate to whichever month contains the passed
// date," where any date within the target month works. Used by the
// trailing-window backfill (otpMonthlyFeedPoll.ts/availMissedTripsPoll.ts)
// added per OTP-Feed-Evaluation-and-Recommendation (3).md's finding that a
// poll which only ever asks about "the current month" has no way to notice
// a month that was empty on day 1 but populated by Avail days later.
export function subtractMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - months, 1));
}

export interface MappedOtpMonthlyReport {
  service_month: string;
  route_id: number;
  stop_id: number;
  day_of_week: string;
  stop_name: string | null;
  route_label: string | null;
  pct_early: number | null;
  pct_ontime: number | null;
  pct_late: number | null;
  pct_not_ontime: number | null;
  pct_missed: number | null;
  early: number | null;
  ontime: number | null;
  late: number | null;
  missed: number | null;
  actual_departures: number | null;
  total: number | null;
}

// Guard clause, not a throw - a single malformed report shouldn't abort the
// whole poll (same convention as mapAvlReport/mapPulloutReport).
export function mapOtpMonthlyReport(
  report: OtpMonthlyReport,
  serviceMonth: string,
): MappedOtpMonthlyReport | null {
  if (typeof report.RouteID !== "number" || typeof report.StopID !== "number" || !report.DayOfWeek) {
    return null;
  }

  return {
    service_month: serviceMonth,
    route_id: report.RouteID,
    stop_id: report.StopID,
    day_of_week: report.DayOfWeek,
    stop_name: report.StopInternetName ?? null,
    route_label: report.RouteReportLabel ?? null,
    pct_early: report.PercentEarly ?? null,
    pct_ontime: report.PercentOntime ?? null,
    pct_late: report.PercentLate ?? null,
    pct_not_ontime: report.PercentNotOntime ?? null,
    pct_missed: report.PercentMissed ?? null,
    early: report.Early ?? null,
    ontime: report.Ontime ?? null,
    late: report.Late ?? null,
    missed: report.Missed ?? null,
    actual_departures: report.ActualDepartures ?? null,
    total: report.Total ?? null,
  };
}

// Shared MERGE, extracted from otpMonthlyFeedPoll.ts so otpHistoricalBackfill.ts
// (arbitrary past months, admin-triggered) can reuse the identical upsert
// instead of duplicating it - same table, same idempotency guarantee either
// way (re-running for a month already ingested just updates in place).
//
// The UPDATE is conditional, and that is the whole point of migration 141. It
// used to fire on every match and stamp updated_at whether or not one value
// had changed, so after every nightly poll every row in the trailing window
// carried today's timestamp and updated_at meant only "the poller ran". A
// restatement of a closed month was indistinguishable from a no-op re-poll.
// Now updated_at moves only when the row actually says something different,
// and a change to a month that is already over is recorded as a restatement.
//
// One statement, not three: the MERGE feeds its own OUTPUT into the ledger, so
// a poll that changes nothing costs exactly what it used to, and there is no
// window in which the row has moved but its history has not been written.

/** The columns whose value a change to makes this row a different row. */
const COMPARED = [
  "stop_name", "route_label",
  "pct_early", "pct_ontime", "pct_late", "pct_not_ontime", "pct_missed",
  "early", "ontime", "late", "missed", "actual_departures", "total",
] as const;

/**
 * NULL-safe "this row differs from what Avail just sent", via EXCEPT.
 *
 * `<>` is not usable here: a column going from NULL to a number, or back, is
 * exactly the kind of change worth catching, and every `<>` comparison against
 * NULL is unknown. EXCEPT treats two NULLs as equal, which is what is wanted.
 */
export function otpRowDiffersSql(target = "target"): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(target)) throw new TypeError("a MERGE alias must be a plain identifier");
  const columns = COMPARED.map((column) => `${target}.${column}`).join(", ");
  const parameters = COMPARED.map((column) => `@${column}`).join(", ");
  return `EXISTS (SELECT ${columns} EXCEPT SELECT ${parameters})`;
}

/**
 * Whether migration 141's ledger exists. Read once per run by the caller, not
 * per row: this is called about 2,700 times a night, and probing each time
 * would double the poll's round trips to answer a question that cannot change
 * mid-run.
 */
export async function restatementLedgerReady(pool: sql.ConnectionPool): Promise<boolean> {
  const probe = await pool.request().query<{ ready: number }>(`
    SELECT CASE WHEN OBJECT_ID('dbo.OtpMonthlyRestatements','U') IS NULL THEN 0 ELSE 1 END ready
  `);
  return probe.recordset[0]?.ready === 1;
}

export interface UpsertOtpMonthlyOptions {
  /**
   * Whether to record a restatement, from `restatementLedgerReady`. Required
   * rather than defaulted: defaulting it false would silently stop recording
   * if a new caller forgot it, and that failure looks exactly like "Avail
   * never restates anything".
   */
  ledgerReady: boolean;
  /**
   * The month a change has to predate to count as a restatement. Passed rather
   * than read from the clock per row so every row in one run uses the same
   * answer, including a run that spans midnight on the 1st.
   */
  currentServiceMonth?: string;
}

export async function upsertOtpMonthlyReport(
  pool: sql.ConnectionPool,
  mapped: MappedOtpMonthlyReport,
  options: UpsertOtpMonthlyOptions,
): Promise<void> {
  const currentServiceMonth = options.currentServiceMonth ?? serviceMonthOf(new Date());
  const request = pool.request();
  request.input("service_month", sql.Char(6), mapped.service_month);
  request.input("route_id", sql.Int, mapped.route_id);
  request.input("stop_id", sql.Int, mapped.stop_id);
  // NVarChar(20), not (3) - migration-021: some real Avail values
  // overflowed the original "Mon"/"Tue"-sized column.
  request.input("day_of_week", sql.NVarChar(20), mapped.day_of_week);
  request.input("stop_name", sql.NVarChar, mapped.stop_name);
  request.input("route_label", sql.NVarChar, mapped.route_label);
  request.input("pct_early", sql.Float, mapped.pct_early);
  request.input("pct_ontime", sql.Float, mapped.pct_ontime);
  request.input("pct_late", sql.Float, mapped.pct_late);
  request.input("pct_not_ontime", sql.Float, mapped.pct_not_ontime);
  request.input("pct_missed", sql.Float, mapped.pct_missed);
  request.input("early", sql.Int, mapped.early);
  request.input("ontime", sql.Int, mapped.ontime);
  request.input("late", sql.Int, mapped.late);
  request.input("missed", sql.Int, mapped.missed);
  request.input("actual_departures", sql.Int, mapped.actual_departures);
  request.input("total", sql.Int, mapped.total);
  request.input("current_month", sql.Char(6), currentServiceMonth);

  const merge = `
    MERGE OtpMonthlyRouteStopDay WITH (HOLDLOCK) AS target
    USING (
      SELECT @service_month AS service_month, @route_id AS route_id,
             @stop_id AS stop_id, @day_of_week AS day_of_week
    ) AS src
    ON target.service_month = src.service_month AND target.route_id = src.route_id
       AND target.stop_id = src.stop_id AND target.day_of_week = src.day_of_week
    WHEN MATCHED AND ${otpRowDiffersSql()} THEN
      UPDATE SET
        stop_name = @stop_name, route_label = @route_label,
        pct_early = @pct_early, pct_ontime = @pct_ontime, pct_late = @pct_late,
        pct_not_ontime = @pct_not_ontime, pct_missed = @pct_missed,
        early = @early, ontime = @ontime, late = @late, missed = @missed,
        actual_departures = @actual_departures, total = @total,
        updated_at = SYSUTCDATETIME()
    WHEN NOT MATCHED THEN
      INSERT (
        service_month, route_id, stop_id, day_of_week, stop_name, route_label,
        pct_early, pct_ontime, pct_late, pct_not_ontime, pct_missed,
        early, ontime, late, missed, actual_departures, total
      )
      VALUES (
        @service_month, @route_id, @stop_id, @day_of_week, @stop_name, @route_label,
        @pct_early, @pct_ontime, @pct_late, @pct_not_ontime, @pct_missed,
        @early, @ontime, @late, @missed, @actual_departures, @total
      )`;

  // Without migration 141 there is nowhere to record a restatement. The
  // conditional UPDATE still applies - updated_at is worth being honest about
  // on its own - so the statement degrades to the MERGE alone.
  if (!options.ledgerReady) {
    await request.query(`${merge};`);
    return;
  }

  // Composable DML: the MERGE's OUTPUT is the source the ledger selects from,
  // so the filter lives outside the MERGE and one round trip does both.
  //
  // A first INSERT is not a restatement - there was nothing to restate - so
  // only $action = 'UPDATE' is kept. Neither is a change inside the month's own
  // run: the month is still filling, and every poll would otherwise write a
  // row per stop per day. And a change that moved only a label or a percentage
  // is not what the contractor is assessed on, so the counts have to differ.
  await request.query(`
    INSERT INTO dbo.OtpMonthlyRestatements
      (service_month, route_id, stop_id, day_of_week, previous_total, previous_ontime, new_total, new_ontime)
    SELECT service_month, route_id, stop_id, day_of_week, previous_total, previous_ontime, new_total, new_ontime
    FROM (
      ${merge}
      OUTPUT $action AS act,
        inserted.service_month, inserted.route_id, inserted.stop_id, inserted.day_of_week,
        deleted.total AS previous_total, deleted.ontime AS previous_ontime,
        inserted.total AS new_total, inserted.ontime AS new_ontime
    ) AS changed
    WHERE changed.act = 'UPDATE'
      AND changed.service_month < @current_month
      AND (ISNULL(changed.previous_total, -1) <> ISNULL(changed.new_total, -1)
        OR ISNULL(changed.previous_ontime, -1) <> ISNULL(changed.new_ontime, -1));
  `);
}

// Inclusive list of "YYYYMM" service months between from/to (chronological
// order). Used by otpHistoricalBackfill.ts to turn an admin-supplied
// from/to range into concrete months to fetch - capped by the caller so a
// typo'd range can't spin through years of empty requests.
export function monthsBetween(fromYyyymm: string, toYyyymm: string): string[] {
  const fromDate = new Date(Date.UTC(Number(fromYyyymm.slice(0, 4)), Number(fromYyyymm.slice(4, 6)) - 1, 1));
  const toDate = new Date(Date.UTC(Number(toYyyymm.slice(0, 4)), Number(toYyyymm.slice(4, 6)) - 1, 1));
  const months: string[] = [];
  const cursor = new Date(fromDate);
  while (cursor.getTime() <= toDate.getTime()) {
    months.push(serviceMonthOf(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}
