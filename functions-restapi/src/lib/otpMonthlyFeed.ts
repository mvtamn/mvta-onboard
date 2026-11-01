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
 * NULL-safe "this row was polled under a different standard", for the same
 * reason `otpRowDiffersSql` uses EXCEPT: the stamp starts out NULL on every row
 * stored before migration 151, and NULL -> '2/5/10/60/0/1/1' is precisely the
 * change worth catching.
 */
export function otpParametersDifferSql(target = "target"): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(target)) throw new TypeError("a MERGE alias must be a plain identifier");
  return `EXISTS (SELECT ${target}.measurement_parameters EXCEPT SELECT @measurement_parameters)`;
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

/**
 * Whether migration 151's stamp column exists. Read once per run, for the same
 * reason as the ledger probe, and answered honestly rather than optimistically:
 * a poll that cannot stamp its rows must still store the figures.
 */
export async function measurementStampReady(pool: sql.ConnectionPool): Promise<boolean> {
  const probe = await pool.request().query<{ ready: number }>(`
    SELECT CASE WHEN COL_LENGTH('dbo.OtpMonthlyRouteStopDay','measurement_parameters') IS NULL
      THEN 0 ELSE 1 END ready
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
  /**
   * The measurement standard this poll asked Avail for, as URL segments -
   * `parameterSegments` of the set in force (ADR 0042). Stamped onto the row so
   * a later reader can tell which stored figures are comparable with each
   * other; without it, a correction to the parameters leaves two standards
   * mixed in one table with nothing to separate them.
   *
   * Required, like `ledgerReady`, and for the same reason: a default would be
   * indistinguishable from the truth right up to the moment it was wrong.
   */
  measurementParameters: string;
  /**
   * Whether migration 151's stamp column exists, from
   * `measurementStampReady`. A merge can ship ahead of the migration being
   * applied, and writing a column that is not there would fail every upsert in
   * the run - so the statement drops the stamp instead and the rows read as
   * "not recorded", which is what they are.
   */
  stampReady: boolean;
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
  if (options.stampReady) {
    request.input("measurement_parameters", sql.NVarChar(40), options.measurementParameters);
  }

  const stamp = options.stampReady;
  const merge = `
    MERGE OtpMonthlyRouteStopDay WITH (HOLDLOCK) AS target
    USING (
      SELECT @service_month AS service_month, @route_id AS route_id,
             @stop_id AS stop_id, @day_of_week AS day_of_week
    ) AS src
    ON target.service_month = src.service_month AND target.route_id = src.route_id
       AND target.stop_id = src.stop_id AND target.day_of_week = src.day_of_week
    WHEN MATCHED AND (${otpRowDiffersSql()}${stamp ? ` OR ${otpParametersDifferSql()}` : ""}) THEN
      UPDATE SET
        stop_name = @stop_name, route_label = @route_label,
        pct_early = @pct_early, pct_ontime = @pct_ontime, pct_late = @pct_late,
        pct_not_ontime = @pct_not_ontime, pct_missed = @pct_missed,
        early = @early, ontime = @ontime, late = @late, missed = @missed,
        actual_departures = @actual_departures, total = @total,
        ${stamp ? "measurement_parameters = @measurement_parameters," : ""}
        -- A re-poll under a different measurement standard that happens to
        -- return the same numbers still has to record the standard, or the
        -- month never leaves the re-pull list and provenance says the opposite
        -- of the truth. But migration 141 made updated_at mean "the number
        -- moved", so a stamp-only write must not touch it.
        --
        -- The CASE does that inside the one clause rather than a second
        -- WHEN MATCHED, because SQL Server refuses two WHEN MATCHED clauses
        -- that both UPDATE ("An action of type 'WHEN MATCHED' cannot appear
        -- more than once in a 'UPDATE' clause of a MERGE statement") - which
        -- the restatement contract test caught in CI.
        updated_at = ${stamp ? `CASE WHEN ${otpRowDiffersSql()} THEN SYSUTCDATETIME() ELSE target.updated_at END` : "SYSUTCDATETIME()"}
    WHEN NOT MATCHED THEN
      INSERT (
        service_month, route_id, stop_id, day_of_week, stop_name, route_label,
        pct_early, pct_ontime, pct_late, pct_not_ontime, pct_missed,
        early, ontime, late, missed, actual_departures, total
        ${stamp ? ", measurement_parameters" : ""}
      )
      VALUES (
        @service_month, @route_id, @stop_id, @day_of_week, @stop_name, @route_label,
        @pct_early, @pct_ontime, @pct_late, @pct_not_ontime, @pct_missed,
        @early, @ontime, @late, @missed, @actual_departures, @total
        ${stamp ? ", @measurement_parameters" : ""}
      )`;

  // Without migration 141 there is nowhere to record a restatement. The
  // conditional UPDATE and the updated_at CASE still apply - updated_at is
  // worth being honest about on its own - so the statement degrades to the
  // MERGE alone.
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

// ---------------------------------------------------------------------------
// Two records, one key
// ---------------------------------------------------------------------------
//
// The MERGE above is keyed on (service_month, route_id, stop_id, day_of_week),
// and Avail does not guarantee one record per key. For 2026-03 it sent 1,108
// records carrying 1,081 distinct keys: 27 keys arrived twice, each write
// overwrote the other, and the poll still reported "1108 reports seen, 1108
// rows upserted" because every overwrite is a successful upsert. 855 departures
// and 805 on-time departures were dropped on the floor, and nothing said so.
//
// What the pairs are, established on dev 2026-10-30: they partition the month.
// Route 425 at stop 30435 came back as 28 and 41 Monday departures; the same
// route's other side of that intersection (stop 30451, one record) reports 70.
// Route 497 at stop 31768 came back as 30 and 48; the terminal every one of
// those trips passes (31723) reports 78. Across all 27 keys the two values sum
// to the neighbouring stop's own total, day by day, and the split follows the
// count of each weekday before and after about 18 March - three Mondays and two
// Mondays, two Wednesdays and two Wednesdays - which is what a mid-month
// schedule change looks like when the month is aggregated per day of week.
//
// So the month's figure is the SUM of the records sharing a key, and that is
// what is stored. Keying on a discriminator instead would be preferable, except
// that the operation's published record shape (OTP-Feed-Evaluation-and-
// Recommendation.md) carries nothing to key on - no direction, no pattern, no
// effective date - which is why `describeOtpMonthlyCollision` names the raw
// fields that actually differ between the records. If a future collision turns
// out to differ by a field we do not map, that log line says so, and widening
// the key the way migration 123 widened the daily table's becomes the better
// fix.
//
// Two records identical in their counts are not summed. Identical records carry
// no new information, and summing them would double a figure to describe a
// delivery artefact; one is kept and the collision is still reported.

const COUNT_FIELDS = ["early", "ontime", "late", "missed", "actual_departures", "total"] as const;
const PERCENT_FIELDS = ["pct_early", "pct_ontime", "pct_late", "pct_not_ontime", "pct_missed"] as const;

export type OtpMonthlyCollisionResolution = "summed" | "deduplicated";

export interface OtpMonthlyCollision {
  service_month: string;
  route_id: number;
  stop_id: number;
  day_of_week: string;
  resolution: OtpMonthlyCollisionResolution;
  /** The records that shared the key, in delivery order. */
  records: MappedOtpMonthlyReport[];
  /** The raw reports they were mapped from, where the caller supplied them. */
  sources: OtpMonthlyReport[];
}

export interface OtpMonthlyCandidate {
  mapped: MappedOtpMonthlyReport;
  /**
   * The record as Avail sent it. Optional only so a caller that has already
   * discarded it can still collapse; supplying it is what lets a collision
   * report name an unmapped discriminator.
   */
  source?: OtpMonthlyReport;
}

export interface OtpMonthlyCollapsedRow {
  row: MappedOtpMonthlyReport;
  /**
   * How many delivered records this row accounts for. The caller adds these up
   * rather than counting rows, so feed health compares what Avail sent with
   * what is represented in the table - otherwise a collapsed pair reads as a
   * record that went missing (`feedHealthOutcome`).
   */
  recordCount: number;
}

function keyOf(row: MappedOtpMonthlyReport): string {
  return `${row.service_month}|${row.route_id}|${row.stop_id}|${row.day_of_week}`;
}

/** Sum of the present values, or null when every record left it null. */
function sumOrNull(values: (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : present.reduce((a, b) => a + b, 0);
}

/**
 * The aggregate of a percentage over records of different sizes: each one
 * weighted by its own Total.
 *
 * Avail's percentages are all ratios over Total (`PercentOntime` 47/172 in the
 * specification's own example), so weighting by Total reproduces
 * (c1 + c2) / (t1 + t2) exactly - without this file having to assert what each
 * numerator is. `PercentNotOntime` in particular is not early + late, and
 * guessing its identity to recompute it would be a guess stored as a figure.
 */
function weightedPercent(records: MappedOtpMonthlyReport[], field: (typeof PERCENT_FIELDS)[number]): number | null {
  let weight = 0;
  let weighted = 0;
  for (const record of records) {
    const value = record[field];
    if (value === null || record.total === null || record.total <= 0) continue;
    weight += record.total;
    weighted += value * record.total;
  }
  if (weight > 0) return weighted / weight;
  // No record had a total to weight by. There is nothing to average, so the
  // first stated percentage stands rather than becoming a 0 nobody sent.
  return records.find((record) => record[field] !== null)?.[field] ?? null;
}

function sameCounts(a: MappedOtpMonthlyReport, b: MappedOtpMonthlyReport): boolean {
  return COUNT_FIELDS.every((field) => a[field] === b[field]);
}

function combine(records: MappedOtpMonthlyReport[]): MappedOtpMonthlyReport {
  const [first] = records;
  const combined: MappedOtpMonthlyReport = {
    ...first,
    // The label and the name are properties of the route and the stop, not of
    // the half-month: the first record that states one states it for the key.
    stop_name: records.find((record) => record.stop_name !== null)?.stop_name ?? null,
    route_label: records.find((record) => record.route_label !== null)?.route_label ?? null,
  };
  for (const field of COUNT_FIELDS) combined[field] = sumOrNull(records.map((record) => record[field]));
  for (const field of PERCENT_FIELDS) combined[field] = weightedPercent(records, field);
  return combined;
}

/**
 * One row per key, with the records that shared a key summed, and a report of
 * every key that had more than one.
 *
 * Delivery order is preserved, so a month's rows go to the database in the
 * order Avail sent them.
 */
export function collapseOtpMonthlyReports(
  candidates: OtpMonthlyCandidate[],
): { rows: OtpMonthlyCollapsedRow[]; collisions: OtpMonthlyCollision[] } {
  const order: string[] = [];
  const grouped = new Map<string, OtpMonthlyCandidate[]>();
  for (const candidate of candidates) {
    const key = keyOf(candidate.mapped);
    const group = grouped.get(key);
    if (group) {
      group.push(candidate);
      continue;
    }
    grouped.set(key, [candidate]);
    order.push(key);
  }

  const rows: OtpMonthlyCollapsedRow[] = [];
  const collisions: OtpMonthlyCollision[] = [];
  for (const key of order) {
    const group = grouped.get(key)!;
    const records = group.map((candidate) => candidate.mapped);
    if (records.length === 1) {
      rows.push({ row: records[0], recordCount: 1 });
      continue;
    }
    // Identical counts are a repeat of one figure, not two halves of a month.
    const distinct = records.filter(
      (record, index) => records.findIndex((other) => sameCounts(record, other)) === index,
    );
    const resolution: OtpMonthlyCollisionResolution = distinct.length === 1 ? "deduplicated" : "summed";
    rows.push({
      row: resolution === "deduplicated" ? records[0] : combine(records),
      recordCount: records.length,
    });
    collisions.push({
      service_month: records[0].service_month,
      route_id: records[0].route_id,
      stop_id: records[0].stop_id,
      day_of_week: records[0].day_of_week,
      resolution,
      records,
      sources: group.map((candidate) => candidate.source).filter((source): source is OtpMonthlyReport => !!source),
    });
  }
  return { rows, collisions };
}

/**
 * A collision as one log line: what shared the key, what each record said, and
 * which raw fields differ between them.
 *
 * The differing fields are the point. Avail's own record shape has nothing to
 * key on, so this is the only way to find out whether a future collision is
 * distinguishable without shipping another build to look - if a field we do not
 * map ever turns up here, widening the key becomes possible. Route ids, stop
 * ids and departure counts only: no PII to leak into App Insights.
 */
export function describeOtpMonthlyCollision(collision: OtpMonthlyCollision): string {
  const { service_month, route_id, stop_id, day_of_week, records, resolution, sources } = collision;
  const said = records
    .map((record) => `total=${record.total ?? "null"}/ontime=${record.ontime ?? "null"}`)
    .join(" vs ");
  // Read as a bag of fields, not as OtpMonthlyReport: a field nobody mapped is
  // precisely the one worth naming here.
  const raw = sources as unknown as Record<string, unknown>[];
  // "absent" rather than an empty string: JSON.stringify(undefined) is not a
  // string at all, and a field one record carries and the other does not is the
  // most interesting difference there is.
  const shown = (source: Record<string, unknown>, field: string) =>
    field in source && source[field] !== undefined ? JSON.stringify(source[field]) : "absent";
  const fields = new Set(raw.flatMap((source) => Object.keys(source)));
  const differing = [...fields]
    .map((field) => ({ field, values: raw.map((source) => shown(source, field)) }))
    .filter(({ values }) => values.some((value) => value !== values[0]))
    .map(({ field, values }) => `${field}=${values.join("|")}`);
  const discriminator = sources.length === 0
    ? "raw records not retained"
    : differing.length === 0
      ? "no field differs"
      : `differing fields: ${differing.join(", ")}`;
  return (
    `${service_month} route ${route_id} stop ${stop_id} ${day_of_week}: ` +
    `${records.length} records on one key (${said}), ${resolution}; ${discriminator}`
  );
}
