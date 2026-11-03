// The measurement standard fixed-route OTP is polled under, and the provenance
// of every figure polled under it (ADR 0042).
//
// OnBoard does not compute OTP. It asks Avail, and Avail takes the standard
// itself as URL segments - early threshold, late threshold, early outlier, late
// outlier, show missed stops, include outliers, show detours. Those seven
// numbers decide what counts as on time, so they decide a performance tier, so
// they decide what the contractor owes.
//
// They were a compiled constant until 1.6.39, when they were corrected from
// 1/5/15/30/0/1/1 to 2/5/10/60/0/1/1 - MVTA's BI configuration, as confirmed by
// Avail on 2026-10-27. Avail also said those thresholds are configurable on
// their backend, so a compiled copy diverges silently by default. And nothing
// beside a stored figure said what it had been measured under, which is why
// after the correction both OTP tables held figures measured two different ways
// with no way to tell them apart.
//
// So this module does two things, and the second is the one that matters.
//
// It reads the DECLARED set - a row in an append-only register, with an
// effective-from date, a stated source and a named declarer - falling back to
// the compiled constant, and saying which of the two it gave you. A missing
// setting must never stop a figure being produced (the same contract as
// `thresholdOrDefault`), but a fallback must not pass itself off as a
// declaration either.
//
// And it turns the stamp on stored rows into an answer to "which of these
// figures are comparable?". A month needs re-pulling when any of its rows was
// polled under a set other than the one in force. That is DERIVED from the
// stamps, not tracked in a queue: re-pull a month and it leaves the list, with
// nothing to mark resolved and forget.
//
// What this module deliberately does not do is re-pull anything. A declaration
// says what the standard is and from when; a human runs the backfill for the
// months they mean to restate. A form that silently restated years of
// contractual performance on save is the hazard, not the feature.
import { sql } from "./db";
import type { Executor } from "./otpMonth";

/** The seven numbers Avail's OTP operations take, in the order they are sent. */
export interface OtpMeasurementParameterSet {
  early_threshold_minutes: number;
  late_threshold_minutes: number;
  early_outlier_minutes: number;
  late_outlier_minutes: number;
  show_missed_stops: 0 | 1;
  include_outliers: 0 | 1;
  show_detours: 0 | 1;
}

/**
 * MVTA's standard as confirmed by Avail on 2026-10-27, compiled in as the
 * fallback for a database that has not had migration 151 applied, or has it but
 * holds no usable row.
 *
 * This is not the authority - the register is. It is what keeps the pollers
 * running when the register cannot be read, and it is reported as
 * `source: "code"` so nothing mistakes it for a declaration.
 */
export const DEFAULT_OTP_MEASUREMENT_PARAMETERS: OtpMeasurementParameterSet = {
  early_threshold_minutes: 2,
  late_threshold_minutes: 5,
  early_outlier_minutes: 10,
  late_outlier_minutes: 60,
  show_missed_stops: 0,
  // Stays 1 pending Avail's answer on whether the BI report drops outlying
  // departures from its denominator - the likeliest explanation of our 4,271
  // departures on route 465 against the report's 4,045 (+5.6%).
  include_outliers: 1,
  show_detours: 1,
};

/**
 * The parameter set as Avail's URL takes it, and as the stamp records it.
 *
 * One function for both on purpose. The stamp has to be the string that was
 * actually sent, or it is not evidence of anything; a second formatter would be
 * a second thing to keep in step. Migration 151's computed column
 * builds the same string in SQL, and the db contract test fails if they drift.
 */
export function parameterSegments(set: OtpMeasurementParameterSet): string {
  return [
    set.early_threshold_minutes,
    set.late_threshold_minutes,
    set.early_outlier_minutes,
    set.late_outlier_minutes,
    set.show_missed_stops,
    set.include_outliers,
    set.show_detours,
  ].join("/");
}

/** Where the set in force came from. A fallback is never reported as declared. */
export type OtpParameterSource = "register" | "code";

export interface OtpParameterSetRow extends OtpMeasurementParameterSet {
  id: string;
  effective_from: Date | string;
  source: string;
  notes: string | null;
  declared_by: string;
  declared_at: Date;
}

/** The set a poll runs under, with enough provenance to explain a figure. */
export interface OtpParametersInForce {
  set: OtpMeasurementParameterSet;
  /** Exactly what goes in the URL and in the stamp. */
  segments: string;
  origin: OtpParameterSource;
  /** Null when the compiled default answered. */
  declaration: {
    id: string;
    effective_from: string;
    source: string;
    notes: string | null;
    declared_by: string;
    declared_at: string;
  } | null;
}

const FLAGS = ["show_missed_stops", "include_outliers", "show_detours"] as const;
const MINUTES = [
  "early_threshold_minutes",
  "late_threshold_minutes",
  "early_outlier_minutes",
  "late_outlier_minutes",
] as const;

function isFlag(value: unknown): value is 0 | 1 {
  return value === 0 || value === 1;
}

/**
 * The set a register row yields, or the compiled default when there is no row
 * or the row holds something validation would have refused.
 *
 * Never returns null, and never returns a half-trusted set: a row that fails
 * any rule is discarded whole rather than patched field by field, because a
 * set with one substituted number is a standard nobody declared.
 */
export function parametersOrDefault(
  row: Partial<OtpMeasurementParameterSet> | undefined | null,
): { set: OtpMeasurementParameterSet; origin: OtpParameterSource } {
  if (!row) return { set: DEFAULT_OTP_MEASUREMENT_PARAMETERS, origin: "code" };
  const candidate: Record<string, unknown> = {};
  for (const key of MINUTES) candidate[key] = row[key];
  for (const key of FLAGS) candidate[key] = row[key];
  if (validateParameterSet(candidate).length > 0) {
    return { set: DEFAULT_OTP_MEASUREMENT_PARAMETERS, origin: "code" };
  }
  return { set: candidate as unknown as OtpMeasurementParameterSet, origin: "register" };
}

/**
 * Why a proposed set is not a measurement standard, or an empty list.
 *
 * The bounds are not taste. An outlier threshold at or below its own threshold
 * makes the band it bounds empty, which is a set that measures nothing; a
 * non-integer minute is not something Avail's URL can carry; and a threshold
 * over an hour is a typo rather than a standard, because a departure an hour
 * early is a different trip.
 */
export function validateParameterSet(body: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const minutes: Partial<Record<(typeof MINUTES)[number], number>> = {};
  for (const key of MINUTES) {
    const value = body[key];
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0 || value > 720) {
      errors.push(`${key} is required and must be a whole number of minutes between 1 and 720`);
      continue;
    }
    minutes[key] = value;
  }
  for (const key of FLAGS) {
    if (!isFlag(body[key])) errors.push(`${key} is required and must be 0 or 1`);
  }
  const { early_threshold_minutes: early, late_threshold_minutes: late } = minutes;
  const { early_outlier_minutes: earlyOutlier, late_outlier_minutes: lateOutlier } = minutes;
  if (early !== undefined && early > 60) errors.push("early_threshold_minutes must be 60 or less");
  if (late !== undefined && late > 60) errors.push("late_threshold_minutes must be 60 or less");
  if (early !== undefined && earlyOutlier !== undefined && earlyOutlier <= early) {
    errors.push("early_outlier_minutes must be greater than early_threshold_minutes");
  }
  if (late !== undefined && lateOutlier !== undefined && lateOutlier <= late) {
    errors.push("late_outlier_minutes must be greater than late_threshold_minutes");
  }
  return errors;
}

const request = (executor: Executor) =>
  executor instanceof sql.Transaction ? new sql.Request(executor) : executor.request();

/** Whether migration 151's register exists. */
async function registerReady(executor: Executor): Promise<boolean> {
  const probe = await request(executor).query<{ ready: number }>(`
    SELECT CASE WHEN OBJECT_ID('dbo.OtpMeasurementParameters','U') IS NULL THEN 0 ELSE 1 END ready
  `);
  return probe.recordset[0]?.ready === 1;
}

function asIsoDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

const SELECT_COLUMNS = `
  CONVERT(NVARCHAR(36), id) id, effective_from,
  early_threshold_minutes, late_threshold_minutes,
  early_outlier_minutes, late_outlier_minutes,
  CONVERT(INT, show_missed_stops) show_missed_stops,
  CONVERT(INT, include_outliers) include_outliers,
  CONVERT(INT, show_detours) show_detours,
  source, notes, declared_by, declared_at`;

/**
 * The declared set in force, or the compiled default.
 *
 * "In force" is the newest declaration whose effective_from has arrived, so a
 * standard change Avail announces ahead of time can be declared ahead of time
 * without taking effect early. Read ONCE PER POLL RUN and passed down, not
 * re-read per row: a run that spans a declaration must stamp all of its rows
 * with the set it actually sent.
 */
export async function readParametersInForce(executor: Executor): Promise<OtpParametersInForce> {
  if (!(await registerReady(executor))) {
    return {
      set: DEFAULT_OTP_MEASUREMENT_PARAMETERS,
      segments: parameterSegments(DEFAULT_OTP_MEASUREMENT_PARAMETERS),
      origin: "code",
      declaration: null,
    };
  }
  const result = await request(executor).query<OtpParameterSetRow>(`
    SELECT TOP (1) ${SELECT_COLUMNS}
    FROM dbo.OtpMeasurementParameters
    WHERE effective_from <= CONVERT(date, SYSUTCDATETIME())
    ORDER BY effective_from DESC, declared_at DESC
  `);
  const row = result.recordset[0];
  const { set, origin } = parametersOrDefault(row);
  // A row that failed validation is not a declaration we can cite, so the
  // provenance goes with the set rather than with the row that was rejected.
  if (origin === "code" || !row) {
    return { set, segments: parameterSegments(set), origin: "code", declaration: null };
  }
  return {
    set,
    segments: parameterSegments(set),
    origin: "register",
    declaration: {
      id: row.id,
      effective_from: asIsoDate(row.effective_from),
      source: row.source,
      notes: row.notes,
      declared_by: row.declared_by,
      declared_at: new Date(row.declared_at).toISOString(),
    },
  };
}

/**
 * One register row as it crosses the wire.
 *
 * `segments` is recomputed here rather than taken from the row, even though
 * migration 151 computes the same string: `parameterSegments` is what the URL
 * and the stamp are built from, so publishing anything else would let a reader
 * see a set OnBoard never sent. The two agreeing is what the db contract test
 * exists to prove.
 */
function toDeclaration(row: OtpParameterSetRow): OtpParameterDeclaration {
  const set: OtpMeasurementParameterSet = {
    early_threshold_minutes: row.early_threshold_minutes,
    late_threshold_minutes: row.late_threshold_minutes,
    early_outlier_minutes: row.early_outlier_minutes,
    late_outlier_minutes: row.late_outlier_minutes,
    show_missed_stops: row.show_missed_stops,
    include_outliers: row.include_outliers,
    show_detours: row.show_detours,
  };
  return {
    ...set,
    id: row.id,
    effective_from: asIsoDate(row.effective_from),
    segments: parameterSegments(set),
    source: row.source,
    notes: row.notes,
    declared_by: row.declared_by,
    declared_at: new Date(row.declared_at).toISOString(),
  };
}

/** Every declaration, newest effective date first. Empty without the register. */
export async function readDeclarationHistory(executor: Executor): Promise<OtpParameterDeclaration[]> {
  if (!(await registerReady(executor))) return [];
  const result = await request(executor).query<OtpParameterSetRow>(`
    SELECT ${SELECT_COLUMNS}
    FROM dbo.OtpMeasurementParameters
    ORDER BY effective_from DESC, declared_at DESC
  `);
  return result.recordset.map(toDeclaration);
}

export interface OtpParameterDeclaration extends OtpMeasurementParameterSet {
  id: string;
  effective_from: string;
  segments: string;
  source: string;
  notes: string | null;
  declared_by: string;
  declared_at: string;
}

/** What one service month's stored rows were polled under. */
export interface MonthProvenanceRow {
  service_month: string;
  /** Null for rows stored before stamping existed - "not recorded", not "current". */
  segments: string | null;
  rows: number;
  first_stored_at: string;
  last_stored_at: string;
}

/** A service month holding figures that are not comparable with today's. */
export interface MonthNeedingRepull {
  service_month: string;
  /** Every set the month's rows were polled under, other than the one in force. */
  stale: MonthProvenanceRow[];
  /** Rows already polled under the set in force, if any. */
  rows_in_force: number;
  /** Rows whose set was never recorded. The subset of `stale` with null segments. */
  rows_unrecorded: number;
}

/**
 * What each service month was measured under, newest month first.
 *
 * Read from the stamps themselves, like the Audit Stream's timeline, so a
 * re-pull corrects its own history and the two can never disagree.
 */
export async function readMonthProvenance(executor: Executor): Promise<MonthProvenanceRow[]> {
  const probe = await request(executor).query<{ ready: number }>(`
    SELECT CASE WHEN COL_LENGTH('dbo.OtpMonthlyRouteStopDay','measurement_parameters') IS NULL
      THEN 0 ELSE 1 END ready
  `);
  if (probe.recordset[0]?.ready !== 1) return [];
  const result = await request(executor).query<{
    service_month: string;
    segments: string | null;
    rows: number;
    first_stored_at: Date;
    last_stored_at: Date;
  }>(`
    SELECT service_month, measurement_parameters segments, COUNT(*) rows,
           MIN(updated_at) first_stored_at, MAX(updated_at) last_stored_at
    FROM dbo.OtpMonthlyRouteStopDay
    GROUP BY service_month, measurement_parameters
    ORDER BY service_month DESC, measurement_parameters
  `);
  return result.recordset.map((row) => ({
    service_month: row.service_month,
    segments: row.segments,
    rows: row.rows,
    first_stored_at: new Date(row.first_stored_at).toISOString(),
    last_stored_at: new Date(row.last_stored_at).toISOString(),
  }));
}

/**
 * The months whose figures were not polled under `inForceSegments`, worst first.
 *
 * Pure, so the rule is testable without a database and the console cannot
 * disagree with the API about what "needs re-pull" means. A month appears when
 * ANY of its rows carries a different stamp, including none at all: a month
 * polled across a declaration is partly comparable and partly not, which is
 * itself the finding, so both halves travel with it.
 */
export function monthsNeedingRepull(
  provenance: readonly MonthProvenanceRow[],
  inForceSegments: string,
): MonthNeedingRepull[] {
  const byMonth = new Map<string, MonthProvenanceRow[]>();
  for (const row of provenance) {
    const existing = byMonth.get(row.service_month);
    if (existing) existing.push(row);
    else byMonth.set(row.service_month, [row]);
  }
  const months: MonthNeedingRepull[] = [];
  for (const [service_month, rows] of byMonth) {
    const stale = rows.filter((row) => row.segments !== inForceSegments);
    if (stale.length === 0) continue;
    months.push({
      service_month,
      stale: [...stale].sort((a, b) => b.rows - a.rows),
      rows_in_force: rows.filter((row) => row.segments === inForceSegments).reduce((n, row) => n + row.rows, 0),
      rows_unrecorded: stale.filter((row) => row.segments === null).reduce((n, row) => n + row.rows, 0),
    });
  }
  return months.sort((a, b) => b.service_month.localeCompare(a.service_month));
}

export interface DeclareParametersInput extends OtpMeasurementParameterSet {
  /** 'YYYY-MM-DD'. */
  effective_from: string;
  source: string;
  notes?: string | null;
}

/**
 * Append a declaration. Never updates one: a past row is what figures were
 * polled under, and editing it would rewrite what they mean.
 *
 * The caller decides whether anything is re-pulled afterwards. This returns the
 * declaration and nothing else happens to a stored figure.
 */
export async function declareParameters(
  executor: Executor,
  input: DeclareParametersInput,
  declaredBy: string,
): Promise<OtpParameterDeclaration> {
  const req = request(executor);
  // A Date rather than the string, so the driver sends a date instead of
  // leaving the parse to the server's own language settings.
  req.input("effective_from", sql.Date, new Date(`${input.effective_from}T00:00:00Z`));
  req.input("early_threshold_minutes", sql.Int, input.early_threshold_minutes);
  req.input("late_threshold_minutes", sql.Int, input.late_threshold_minutes);
  req.input("early_outlier_minutes", sql.Int, input.early_outlier_minutes);
  req.input("late_outlier_minutes", sql.Int, input.late_outlier_minutes);
  req.input("show_missed_stops", sql.Bit, input.show_missed_stops);
  req.input("include_outliers", sql.Bit, input.include_outliers);
  req.input("show_detours", sql.Bit, input.show_detours);
  req.input("source", sql.NVarChar(200), input.source);
  req.input("notes", sql.NVarChar(1000), input.notes ?? null);
  req.input("declared_by", sql.NVarChar(200), declaredBy);
  const result = await req.query<OtpParameterSetRow>(`
    INSERT INTO dbo.OtpMeasurementParameters (
      effective_from, early_threshold_minutes, late_threshold_minutes,
      early_outlier_minutes, late_outlier_minutes,
      show_missed_stops, include_outliers, show_detours,
      source, notes, declared_by
    )
    OUTPUT
      CONVERT(NVARCHAR(36), INSERTED.id) id, INSERTED.effective_from,
      INSERTED.early_threshold_minutes, INSERTED.late_threshold_minutes,
      INSERTED.early_outlier_minutes, INSERTED.late_outlier_minutes,
      CONVERT(INT, INSERTED.show_missed_stops) show_missed_stops,
      CONVERT(INT, INSERTED.include_outliers) include_outliers,
      CONVERT(INT, INSERTED.show_detours) show_detours,
      INSERTED.source, INSERTED.notes, INSERTED.declared_by, INSERTED.declared_at
    VALUES (
      @effective_from, @early_threshold_minutes, @late_threshold_minutes,
      @early_outlier_minutes, @late_outlier_minutes,
      @show_missed_stops, @include_outliers, @show_detours,
      @source, @notes, @declared_by
    );
  `);
  // `segments` is left out of the OUTPUT clause: SQL Server refuses a computed
  // column there, and toDeclaration rebuilds it from the set anyway.
  return toDeclaration(result.recordset[0]!);
}
