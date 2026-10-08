// The vocabulary a garage-departure rule clause may be written in.
//
// Every clause of the rule has to exist twice: once as something the console
// can evaluate against a row it already holds, and once as something the
// candidate poll can put in a WHERE clause. Writing them separately is what
// this module exists to stop. A clause is declared once as a Condition here;
// evaluate() runs it in TypeScript and render() prints it as SQL.
//
// The vocabulary is CLOSED. There is no raw-SQL escape hatch, deliberately: an
// escape hatch is how the two spellings drift apart, and the six kinds below
// have carried both rules through every change they have had. Adding a seventh
// is a visible change to this file, which is the point.
//
// The clearest argument for all of this is `atAgencyMidnight`. It arrived in
// 1.5.285 and was rewritten in 1.5.286, and in TypeScript it reads
// `agencyMinuteOfDay(d) === 0 && d.getUTCSeconds() === 0` while in SQL it reads
// `CAST(col AT TIME ZONE 'UTC' AT TIME ZONE 'Central Standard Time' AS TIME)`.
// Two unrelated idioms for one idea, in two files, held together by a comment.
// Here it is one kind that knows the agency zone in both languages.
import { agencyMinuteOfDay } from "../missedTripTime";

// The agency zone, under both names it has to be spelled in. IANA for the
// Node side, the Windows name for SQL Server - the same zone, and the only
// place in the rule that either spelling appears.
export const AGENCY_TIME_ZONE_SQL = "Central Standard Time";

// What a rule may look at. A declaration maps these to its own columns, so a
// clause never names `pullout_scheduled` or `departure_scheduled` directly.
export type FieldName = "serviceDate" | "status" | "scheduled" | "actual" | "delta";

export type ColumnMap = Readonly<Record<FieldName, string>>;

// The row a rule is evaluated against, in the rule's own vocabulary. Callers
// hold rows in their source's column names; a declaration's column map is what
// turns one into the other.
export interface JudgementRow {
  serviceDate: string;
  status: string | null;
  scheduled: Date | string | null;
  actual: Date | string | null;
  delta: number | null;
}

// The parameters a rule is judged against. Both are bound by name in the
// candidate poll's SQL, so the names are part of this module's interface and
// not an implementation detail: `raiseCandidates` binds exactly these two.
export interface JudgementParameters {
  settled_before: string;
  variance_seconds: number;
}

export type Condition =
  // The service day has not finished, so nothing about the row is final.
  | { kind: "serviceDateAtOrAfter"; param: "settled_before" }
  // The source recorded nothing here.
  | { kind: "isNull"; field: FieldName }
  // The field is one of a fixed set of source strings.
  | { kind: "valueIn"; field: FieldName; values: readonly string[] }
  // The field equals a literal, compared without case. A missing value is
  // treated as empty rather than as unknown, matching the TypeScript side.
  | { kind: "equalsIgnoringCase"; field: FieldName; value: string }
  // Actual departure is later than scheduled by more than the allowance.
  | { kind: "delayExceeds"; param: "variance_seconds" }
  // The field falls exactly on midnight AGENCY time. Avail publishes "no
  // committed pullout" this way rather than as NULL.
  | { kind: "atAgencyMidnight"; field: FieldName };

// ---------------------------------------------------------------------------
// Evaluation

function valueOf(row: JudgementRow, field: FieldName): unknown {
  return row[field];
}

function asDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function evaluate(condition: Condition, row: JudgementRow, params: JudgementParameters): boolean {
  switch (condition.kind) {
    case "serviceDateAtOrAfter":
      return row.serviceDate >= params[condition.param];
    case "isNull":
      return valueOf(row, condition.field) === null;
    case "valueIn": {
      const value = valueOf(row, condition.field);
      // A null status is not a member of any set, the same way SQL's IN
      // yields UNKNOWN for it and the row is excluded.
      return typeof value === "string" && condition.values.includes(value);
    }
    case "equalsIgnoringCase": {
      const value = valueOf(row, condition.field);
      return (typeof value === "string" ? value : "").toLowerCase() === condition.value.toLowerCase();
    }
    case "delayExceeds":
      return row.delta !== null && row.delta > params[condition.param];
    case "atAgencyMidnight": {
      const date = asDate(row[condition.field] as Date | string | null);
      if (date === null) return false;
      // Seconds are read off the UTC clock deliberately: every US offset is a
      // whole number of minutes, so the second of the minute is the same in
      // either zone and agencyMinuteOfDay does not report it.
      return agencyMinuteOfDay(date) === 0 && date.getUTCSeconds() === 0;
    }
  }
}

// ---------------------------------------------------------------------------
// Rendering

// A table alias reaches SQL as text, so it is checked rather than trusted.
const SAFE_ALIAS = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function assertSafeAlias(alias: string): void {
  if (!SAFE_ALIAS.test(alias)) throw new Error(`Unsafe SQL table alias: ${JSON.stringify(alias)}`);
}

function column(columns: ColumnMap, alias: string, field: FieldName): string {
  return `${alias}.${columns[field]}`;
}

function quoted(values: readonly string[]): string {
  // Source strings, not user input, but a stray apostrophe would still break
  // the statement rather than merely mismatch.
  return values.map((value) => `N'${value.replace(/'/g, "''")}'`).join(",");
}

function agencyTimeOfDay(expression: string): string {
  return `CAST(${expression} AT TIME ZONE 'UTC' AT TIME ZONE '${AGENCY_TIME_ZONE_SQL}' AS TIME)`;
}

// Each kind prints its own negation rather than being wrapped in NOT(...).
// Two reasons: `col < @p` reads better than `NOT (col >= @p)` in a statement a
// person may have to read in a log, and three-valued logic makes the wrapped
// form wrong where the naive reading looks right - NOT(status IN (...)) is
// UNKNOWN for a null status, where the TypeScript side yields true.
export function render(
  condition: Condition,
  columns: ColumnMap,
  alias: string,
  negated = false,
): string {
  assertSafeAlias(alias);
  const col = (field: FieldName) => column(columns, alias, field);
  switch (condition.kind) {
    case "serviceDateAtOrAfter":
      return negated
        ? `${col("serviceDate")} < @${condition.param}`
        : `${col("serviceDate")} >= @${condition.param}`;
    case "isNull":
      return negated ? `${col(condition.field)} IS NOT NULL` : `${col(condition.field)} IS NULL`;
    case "valueIn":
      // The positive form is left bare so it stays sargable against
      // IX_FixedRouteDepartures_Status; the negative form has to spell the
      // null case out, because NOT IN would swallow it.
      return negated
        ? `(${col(condition.field)} IS NULL OR ${col(condition.field)} NOT IN (${quoted(condition.values)}))`
        : `${col(condition.field)} IN (${quoted(condition.values)})`;
    case "equalsIgnoringCase": {
      const lowered = `LOWER(ISNULL(${col(condition.field)}, N''))`;
      const literal = `N'${condition.value.toLowerCase().replace(/'/g, "''")}'`;
      return negated ? `${lowered} <> ${literal}` : `${lowered} = ${literal}`;
    }
    case "delayExceeds": {
      const delta = `DATEDIFF(SECOND, ${col("scheduled")}, ${col("actual")})`;
      // Negated, the null cases have to be named: a row that never departed
      // has no delay to exceed the allowance, and DATEDIFF over a NULL would
      // make the comparison UNKNOWN and drop the row.
      return negated
        ? `(${col("scheduled")} IS NULL OR ${col("actual")} IS NULL OR ${delta} <= @${condition.param})`
        : `${delta} > @${condition.param}`;
    }
    case "atAgencyMidnight": {
      const timeOfDay = agencyTimeOfDay(col(condition.field));
      return negated
        ? `(${col(condition.field)} IS NULL OR ${timeOfDay} <> '00:00:00')`
        : `${timeOfDay} = '00:00:00'`;
    }
  }
}
