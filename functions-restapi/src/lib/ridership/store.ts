// The ridership tables (migration 153) and what they read beside them: the
// Dispatch Log for trips, missed-trip cases for excuses, and Avail's pull-out
// for the operator and bus. Reads return plain rows; rules.ts judges them.
import { sql } from "../db";
import { missedTripCaseSql } from "../missedTripCase/classify";
import { workbookBlock } from "../tripStartLogRead";
import type { TripStartStatus } from "../tripStartTypes";
import type { Executor } from "../otpMonth";
import { availTripNumber, guideRoute, type FieldChange } from "./rules";
import type {
  AddedTrip,
  AddedTripReason,
  AddedTripStatus,
  BlockGarageRow,
  BlockGarageSave,
  CountEntry,
  CountStatus,
  LoggedTrip,
  PulloutRun,
  SheetHeader,
  PrintScope,
  SheetHistoryEntry,
} from "./types";

const request = (executor: Executor) =>
  executor instanceof sql.Transaction ? new sql.Request(executor) : executor.request();

export const RIDERSHIP_TABLES = [
  "RidershipSheets",
  "RidershipCounts",
  "RidershipAddedTrips",
  "RidershipCountHistory",
  "RidershipBlockGarages",
] as const;

/** Whether migration 153 has landed. Without it every ridership endpoint answers 503. */
export async function ridershipTablesReady(executor: Executor): Promise<boolean> {
  const checks = RIDERSHIP_TABLES.map((t) => `OBJECT_ID('dbo.${t}', 'U') IS NOT NULL`).join(" AND ");
  const result = await request(executor).query<{ ok: number }>(`
    SELECT CASE WHEN ${checks} AND OBJECT_ID('dbo.TripStartLog', 'U') IS NOT NULL THEN 1 ELSE 0 END AS ok
  `);
  return result.recordset[0]?.ok === 1;
}

interface Range {
  from: string;
  to: string;
  /** Narrow to one sheet. */
  block?: string;
}

// ---------------------------------------------------------------- Dispatch Log

interface LoggedTripRow {
  service_date: string;
  trip_id: string;
  block_id: string | null;
  route_id: string | null;
  route_short_name: string | null;
  direction_label: string | null;
  scheduled_start_seconds: number;
  scheduled_end_seconds: number | null;
  start_status: string | null;
}

/**
 * The Dispatch Log's trips for the dates, with the block read as the workbook
 * prints it. TripStartLog stores the GTFS form ("1-v64"), so the block filter
 * runs here rather than in SQL. A trip whose block is not three digits cannot
 * be on a Count Sheet; it comes back with `block` null.
 */
export async function loadLoggedTrips(executor: Executor, range: Range): Promise<LoggedTrip[]> {
  // T-SQL binds column names before it evaluates anything, so a database
  // without migration 153's column must not be asked for it.
  const endColumn = await request(executor).query<{ ok: number }>(
    "SELECT CASE WHEN COL_LENGTH('dbo.TripStartLog', 'scheduled_end_seconds') IS NULL THEN 0 ELSE 1 END AS ok",
  );
  const end = endColumn.recordset[0]?.ok === 1 ? "scheduled_end_seconds" : "CAST(NULL AS INT)";
  const req = request(executor);
  req.input("from", sql.Char(8), range.from);
  req.input("to", sql.Char(8), range.to);
  const result = await req.query<LoggedTripRow>(`
    SELECT service_date, trip_id, block_id, route_id, route_short_name, direction_label,
           scheduled_start_seconds, ${end} AS scheduled_end_seconds, start_status
    FROM dbo.TripStartLog
    WHERE service_date BETWEEN @from AND @to
    ORDER BY service_date, scheduled_start_seconds, trip_id
  `);
  const trips = result.recordset.map((row): LoggedTrip => {
    const block = workbookBlock(row.block_id);
    return {
      service_date: row.service_date,
      trip_id: row.trip_id,
      block: block && /^\d{3}$/.test(block) ? block : null,
      route_short_name: row.route_short_name,
      route_label: guideRoute(row.route_short_name, row.route_id),
      trip_number: availTripNumber(row.trip_id, row.direction_label),
      direction_label: row.direction_label,
      scheduled_start_seconds: row.scheduled_start_seconds,
      scheduled_end_seconds: row.scheduled_end_seconds,
      start_status: (row.start_status as TripStartStatus | null) ?? "unknown",
    };
  });
  return range.block ? trips.filter((t) => t.block === range.block) : trips;
}

/**
 * `${service_date}|${trip_id}` for every fixed-route trip a reviewer
 * confirmed missed - the one missed-trip classification, not a WHERE clause
 * of ridership's own. No table, no excuses.
 */
export async function loadConfirmedMissed(executor: Executor, range: Range): Promise<Set<string>> {
  const exists = await request(executor).query<{ ok: number }>(
    "SELECT CASE WHEN OBJECT_ID('dbo.MonitoredMissedTrips', 'U') IS NULL THEN 0 ELSE 1 END AS ok",
  );
  if (exists.recordset[0]?.ok !== 1) return new Set();
  const req = request(executor);
  req.input("from", sql.NVarChar(20), range.from);
  req.input("to", sql.NVarChar(20), range.to);
  const result = await req.query<{ service_date: string; trip_id: string }>(`
    SELECT m.service_date, m.trip_id
    FROM dbo.MonitoredMissedTrips m
    ${missedTripCaseSql("m")}
    WHERE m.service_date BETWEEN @from AND @to
      AND ISNULL(m.source_system, N'gtfs') <> N'spare'
      AND mtc.counts_as_missed = 1
  `);
  return new Set(result.recordset.map((r) => `${r.service_date}|${r.trip_id}`));
}

/** Avail's pull-out runs for one block on one date (FixedRouteDepartures keys block as INT). */
export async function loadPulloutRuns(executor: Executor, serviceDate: string, block: string): Promise<PulloutRun[]> {
  const exists = await request(executor).query<{ ok: number }>(
    "SELECT CASE WHEN OBJECT_ID('dbo.FixedRouteDepartures', 'U') IS NULL THEN 0 ELSE 1 END AS ok",
  );
  if (exists.recordset[0]?.ok !== 1) return [];
  const req = request(executor);
  req.input("service_date", sql.Char(8), serviceDate);
  req.input("block", sql.Int, Number(block));
  const result = await req.query<{ run: number; operator_name: string | null; logon_id: number | null; vehicle_label: string | null; pullout_scheduled: Date | null }>(`
    SELECT run, operator_name, logon_id, vehicle_label, pullout_scheduled
    FROM dbo.FixedRouteDepartures
    WHERE service_date = @service_date AND block = @block
  `);
  return result.recordset.map((r) => ({
    run: r.run,
    operator_name: r.operator_name?.trim() || null,
    operator_id: r.logon_id === null ? null : String(r.logon_id),
    bus: r.vehicle_label?.trim() || null,
    pullout_scheduled: r.pullout_scheduled,
  }));
}

// ---------------------------------------------------------------- ridership rows

export interface StoredSheet extends SheetHeader {
  service_date: string;
  block: string;
}

function rangeFilter(req: sql.Request, range: Range, alias = ""): string {
  req.input("from", sql.Char(8), range.from);
  req.input("to", sql.Char(8), range.to);
  const p = alias ? `${alias}.` : "";
  if (range.block) {
    req.input("block", sql.Char(3), range.block);
    return `${p}service_date BETWEEN @from AND @to AND ${p}block = @block`;
  }
  return `${p}service_date BETWEEN @from AND @to`;
}

export async function loadSheets(executor: Executor, range: Range, lock = false): Promise<StoredSheet[]> {
  const req = request(executor);
  const where = rangeFilter(req, range);
  const result = await req.query<StoredSheet>(`
    SELECT service_date, block, operator_name, operator_id, bus, prefill_run,
           operator_overridden, reconstructed, entered_at, entered_by,
           created_at, updated_at, updated_by
    FROM dbo.RidershipSheets ${lock ? "WITH (UPDLOCK, HOLDLOCK)" : ""}
    WHERE ${where}
  `);
  return result.recordset.map((r) => ({ ...r, operator_overridden: Boolean(r.operator_overridden), reconstructed: Boolean(r.reconstructed) }));
}

export interface StoredCount extends CountEntry {
  service_date: string;
  block: string;
}

export async function loadCounts(executor: Executor, range: Range): Promise<StoredCount[]> {
  const req = request(executor);
  const where = rangeFilter(req, range);
  const result = await req.query<{ service_date: string; block: string; trip_id: string; count_status: string; boardings: number | null }>(`
    SELECT service_date, block, trip_id, count_status, boardings
    FROM dbo.RidershipCounts
    WHERE ${where}
  `);
  return result.recordset.map((r) => ({ ...r, count_status: r.count_status as CountStatus }));
}

export interface StoredAddedTrip extends AddedTrip {
  service_date: string;
  block: string;
}

/** Unscheduled trips still on their sheets; removed rows are kept but not returned. */
export async function loadAddedTrips(executor: Executor, range: Range): Promise<StoredAddedTrip[]> {
  const req = request(executor);
  const where = rangeFilter(req, range);
  const result = await req.query<{
    id: string; service_date: string; block: string; route_short_name: string; direction_label: string;
    scheduled_start_seconds: number; reason: string; count_status: string; boardings: number | null;
  }>(`
    SELECT CAST(id AS NVARCHAR(36)) AS id, service_date, block, route_short_name, direction_label,
           scheduled_start_seconds, reason, count_status, boardings
    FROM dbo.RidershipAddedTrips
    WHERE ${where} AND removed_at IS NULL
    ORDER BY service_date, block, scheduled_start_seconds, created_at
  `);
  return result.recordset.map((r) => ({
    ...r,
    id: r.id.toLowerCase(),
    reason: r.reason as AddedTripReason,
    count_status: r.count_status as AddedTripStatus,
  }));
}

export async function loadHistory(executor: Executor, serviceDate: string, block: string): Promise<SheetHistoryEntry[]> {
  const req = request(executor);
  req.input("service_date", sql.Char(8), serviceDate);
  req.input("block", sql.Char(3), block);
  const result = await req.query<Omit<SheetHistoryEntry, "changed_at"> & { changed_at: Date }>(`
    SELECT subject, subject_ref, field, previous_value, new_value, changed_at, changed_by
    FROM dbo.RidershipCountHistory
    WHERE service_date = @service_date AND block = @block
    ORDER BY changed_at DESC, id DESC
  `);
  return result.recordset.map((r) => ({ ...r, changed_at: r.changed_at.toISOString() }));
}

export async function loadBlockGarages(executor: Executor): Promise<BlockGarageRow[]> {
  const result = await request(executor).query<{ block: string; effective_from: Date; garage: string | null; updated_at: Date; updated_by: string }>(`
    SELECT block, effective_from, garage, updated_at, updated_by
    FROM dbo.RidershipBlockGarages
    ORDER BY block, effective_from
  `);
  return result.recordset.map((r) => ({
    block: r.block,
    // DATE comes back as midnight UTC; the calendar day is what it means.
    effective_from: r.effective_from.toISOString().slice(0, 10),
    garage: r.garage,
    updated_at: r.updated_at.toISOString(),
    updated_by: r.updated_by,
  }));
}

// ---------------------------------------------------------------- writes

export interface SheetWrite {
  service_date: string;
  block: string;
  header: {
    operator_name: string | null;
    operator_id: string | null;
    bus: string | null;
    prefill_run: number | null;
    operator_overridden: boolean;
    reconstructed: boolean;
  };
  /** Set only on the save that first completes the sheet. */
  entered: boolean;
  /** Whether the sheet row exists yet. */
  exists: boolean;
  upsertCounts: CountEntry[];
  deleteCounts: string[];
  insertAdded: Omit<AddedTrip, "id">[];
  updateAdded: AddedTrip[];
  removeAdded: string[];
  changes: FieldChange[];
}

/** Applies one save inside the caller's transaction, history included. */
export async function writeSheet(tx: sql.Transaction, write: SheetWrite, actor: string, at: Date): Promise<FieldChange[]> {
  const key = (req: sql.Request) => {
    req.input("service_date", sql.Char(8), write.service_date);
    req.input("block", sql.Char(3), write.block);
    req.input("actor", sql.NVarChar(200), actor);
    req.input("at", sql.DateTime2, at);
    return req;
  };
  const header = (req: sql.Request) => {
    req.input("operator_name", sql.NVarChar(200), write.header.operator_name);
    req.input("operator_id", sql.NVarChar(20), write.header.operator_id);
    req.input("bus", sql.NVarChar(20), write.header.bus);
    req.input("prefill_run", sql.Int, write.header.prefill_run);
    req.input("operator_overridden", sql.Bit, write.header.operator_overridden);
    req.input("reconstructed", sql.Bit, write.header.reconstructed);
    return req;
  };

  if (!write.exists) {
    await header(key(new sql.Request(tx))).query(`
      INSERT dbo.RidershipSheets (service_date, block, operator_name, operator_id, bus, prefill_run,
        operator_overridden, reconstructed, entered_at, entered_by, created_at, created_by, updated_at, updated_by)
      VALUES (@service_date, @block, @operator_name, @operator_id, @bus, @prefill_run,
        @operator_overridden, @reconstructed, ${write.entered ? "@at, @actor" : "NULL, NULL"}, @at, @actor, @at, @actor)
    `);
  } else {
    await header(key(new sql.Request(tx))).query(`
      UPDATE dbo.RidershipSheets
      SET operator_name = @operator_name, operator_id = @operator_id, bus = @bus, prefill_run = @prefill_run,
          operator_overridden = @operator_overridden, reconstructed = @reconstructed,
          ${write.entered ? "entered_at = @at, entered_by = @actor," : ""}
          updated_at = @at, updated_by = @actor
      WHERE service_date = @service_date AND block = @block
    `);
  }

  for (const count of write.upsertCounts) {
    const req = key(new sql.Request(tx));
    req.input("trip_id", sql.NVarChar(100), count.trip_id);
    req.input("count_status", sql.NVarChar(20), count.count_status);
    req.input("boardings", sql.Int, count.boardings);
    await req.query(`
      UPDATE dbo.RidershipCounts
      SET block = @block, count_status = @count_status, boardings = @boardings, updated_at = @at, updated_by = @actor
      WHERE service_date = @service_date AND trip_id = @trip_id;
      IF @@ROWCOUNT = 0
        INSERT dbo.RidershipCounts (service_date, trip_id, block, count_status, boardings, created_at, created_by)
        VALUES (@service_date, @trip_id, @block, @count_status, @boardings, @at, @actor);
    `);
  }
  for (const tripId of write.deleteCounts) {
    const req = key(new sql.Request(tx));
    req.input("trip_id", sql.NVarChar(100), tripId);
    await req.query("DELETE dbo.RidershipCounts WHERE service_date = @service_date AND trip_id = @trip_id AND block = @block");
  }

  const changes = [...write.changes];
  const addedFields = (req: sql.Request, trip: Omit<AddedTrip, "id">) => {
    req.input("route_short_name", sql.NVarChar(100), trip.route_short_name);
    req.input("direction_label", sql.NVarChar(10), trip.direction_label);
    req.input("scheduled_start_seconds", sql.Int, trip.scheduled_start_seconds);
    req.input("reason", sql.NVarChar(20), trip.reason);
    req.input("count_status", sql.NVarChar(20), trip.count_status);
    req.input("boardings", sql.Int, trip.boardings);
    return req;
  };
  for (const trip of write.insertAdded) {
    const result = await addedFields(key(new sql.Request(tx)), trip).query<{ id: string }>(`
      INSERT dbo.RidershipAddedTrips (service_date, block, route_short_name, direction_label, scheduled_start_seconds,
        reason, count_status, boardings, created_at, created_by)
      OUTPUT CAST(inserted.id AS NVARCHAR(36)) AS id
      VALUES (@service_date, @block, @route_short_name, @direction_label, @scheduled_start_seconds,
        @reason, @count_status, @boardings, @at, @actor)
    `);
    // A new row's id exists only once it is inserted, so its history is written here.
    const id = result.recordset[0].id.toLowerCase();
    for (const [field, value] of Object.entries(addedTripFields(trip))) {
      if (value !== null) changes.push({ subject: "added_trip", subject_ref: id, field, previous_value: null, new_value: String(value) });
    }
  }
  for (const trip of write.updateAdded) {
    const req = addedFields(key(new sql.Request(tx)), trip);
    req.input("id", sql.UniqueIdentifier, trip.id);
    await req.query(`
      UPDATE dbo.RidershipAddedTrips
      SET route_short_name = @route_short_name, direction_label = @direction_label,
          scheduled_start_seconds = @scheduled_start_seconds, reason = @reason,
          count_status = @count_status, boardings = @boardings, updated_at = @at, updated_by = @actor
      WHERE id = @id AND service_date = @service_date AND block = @block AND removed_at IS NULL
    `);
  }
  for (const id of write.removeAdded) {
    const req = key(new sql.Request(tx));
    req.input("id", sql.UniqueIdentifier, id);
    await req.query(`
      UPDATE dbo.RidershipAddedTrips SET removed_at = @at, removed_by = @actor
      WHERE id = @id AND service_date = @service_date AND block = @block AND removed_at IS NULL
    `);
  }

  for (const change of changes) {
    const req = key(new sql.Request(tx));
    req.input("subject", sql.NVarChar(20), change.subject);
    req.input("subject_ref", sql.NVarChar(100), change.subject_ref);
    req.input("field", sql.NVarChar(40), change.field);
    req.input("previous_value", sql.NVarChar(400), change.previous_value);
    req.input("new_value", sql.NVarChar(400), change.new_value);
    await req.query(`
      INSERT dbo.RidershipCountHistory (service_date, block, subject, subject_ref, field, previous_value, new_value, changed_at, changed_by)
      VALUES (@service_date, @block, @subject, @subject_ref, @field, @previous_value, @new_value, @at, @actor)
    `);
  }
  return changes;
}

/** The fields of an unscheduled trip that history tracks. */
export function addedTripFields(trip: Omit<AddedTrip, "id">): Record<string, string | number | null> {
  return {
    route_short_name: trip.route_short_name,
    direction_label: trip.direction_label,
    scheduled_start_seconds: trip.scheduled_start_seconds,
    reason: trip.reason,
    count_status: trip.count_status,
    boardings: trip.boardings,
  };
}

/** Upserts one service change's rows. Earlier service changes are left as they were. */
export async function writeBlockGarages(tx: sql.Transaction, save: BlockGarageSave, actor: string, at: Date): Promise<void> {
  for (const row of save.rows) {
    const req = new sql.Request(tx);
    req.input("block", sql.Char(3), row.block);
    // Midnight UTC is the calendar day itself; the driver writes DATE in UTC.
    req.input("effective_from", sql.Date, new Date(`${save.effective_from}T00:00:00Z`));
    req.input("garage", sql.NVarChar(50), row.garage);
    req.input("actor", sql.NVarChar(200), actor);
    req.input("at", sql.DateTime2, at);
    await req.query(`
      UPDATE dbo.RidershipBlockGarages WITH (UPDLOCK, HOLDLOCK)
      SET garage = @garage, updated_at = @at, updated_by = @actor
      WHERE block = @block AND effective_from = @effective_from;
      IF @@ROWCOUNT = 0
        INSERT dbo.RidershipBlockGarages (block, effective_from, garage, updated_at, updated_by)
        VALUES (@block, @effective_from, @garage, @at, @actor);
    `);
  }
}

// ---------------------------------------------------------------- print log (migration 157)

export const PRINT_LOG_TABLES = ["RidershipPrintRuns", "RidershipPrintedSheets"] as const;

/** Whether migration 157 has landed. Without it printing answers 503. */
export async function printLogReady(executor: Executor): Promise<boolean> {
  const checks = PRINT_LOG_TABLES.map((t) => `OBJECT_ID('dbo.${t}', 'U') IS NOT NULL`).join(" AND ");
  const result = await request(executor).query<{ ok: number }>(`SELECT CASE WHEN ${checks} THEN 1 ELSE 0 END AS ok`);
  return result.recordset[0]?.ok === 1;
}

export interface StoredPrintRun {
  print_id: string;
  garage: string | null;
  scope: PrintScope;
  blank_backs: boolean;
  sheet_count: number;
  page_count: number;
  printed_at: Date;
  printed_by: string;
}

export interface StoredPrintedSheet {
  print_id: string;
  /** The garage the print was for; null is Unassigned. */
  garage: string | null;
  block: string;
  fingerprint: string;
  printed_at: Date;
  printed_by: string;
}

/** Every print of the service date, newest first, with the blocks each one carried. */
export async function loadPrintLog(executor: Executor, serviceDate: string): Promise<{ runs: StoredPrintRun[]; sheets: StoredPrintedSheet[] }> {
  const runsReq = request(executor);
  runsReq.input("service_date", sql.Char(8), serviceDate);
  const runs = await runsReq.query<StoredPrintRun>(`
    SELECT CONVERT(NVARCHAR(36), print_id) AS print_id, garage, scope, blank_backs, sheet_count, page_count, printed_at, printed_by
    FROM dbo.RidershipPrintRuns
    WHERE service_date = @service_date
    ORDER BY printed_at DESC
  `);
  const sheetsReq = request(executor);
  sheetsReq.input("service_date", sql.Char(8), serviceDate);
  const sheets = await sheetsReq.query<StoredPrintedSheet>(`
    SELECT CONVERT(NVARCHAR(36), s.print_id) AS print_id, r.garage, s.block, s.fingerprint, r.printed_at, r.printed_by
    FROM dbo.RidershipPrintedSheets s
    JOIN dbo.RidershipPrintRuns r ON r.print_id = s.print_id
    WHERE s.service_date = @service_date
    ORDER BY r.printed_at DESC
  `);
  return {
    runs: runs.recordset.map((r) => ({ ...r, print_id: r.print_id.toLowerCase(), blank_backs: Boolean(r.blank_backs) })),
    sheets: sheets.recordset.map((s) => ({ ...s, print_id: s.print_id.toLowerCase() })),
  };
}

export interface PrintWrite {
  service_date: string;
  garage: string | null;
  scope: PrintScope;
  blank_backs: boolean;
  page_count: number;
  /** trip_ids: the trips printed on the sheet, row 1 first (migration 161). */
  sheets: { block: string; fingerprint: string; pages: number; trip_ids: string[] }[];
}

/**
 * Records one PDF and the blocks in it, with each block's printed trips once
 * migration 161 has added the column; before that, printing still works.
 */
export async function writePrintRun(tx: sql.Transaction, write: PrintWrite, actor: string, at: Date): Promise<void> {
  const run = new sql.Request(tx);
  run.input("service_date", sql.Char(8), write.service_date);
  run.input("garage", sql.NVarChar(50), write.garage);
  run.input("scope", sql.NVarChar(10), write.scope);
  run.input("blank_backs", sql.Bit, write.blank_backs);
  run.input("sheet_count", sql.Int, write.sheets.length);
  run.input("page_count", sql.Int, write.page_count);
  run.input("printed_at", sql.DateTime2, at);
  run.input("printed_by", sql.NVarChar(200), actor);
  const inserted = await run.query<{ print_id: string }>(`
    DECLARE @ids TABLE (print_id UNIQUEIDENTIFIER);
    INSERT INTO dbo.RidershipPrintRuns (service_date, garage, scope, blank_backs, sheet_count, page_count, printed_at, printed_by)
    OUTPUT INSERTED.print_id INTO @ids
    VALUES (@service_date, @garage, @scope, @blank_backs, @sheet_count, @page_count, @printed_at, @printed_by);
    SELECT CONVERT(NVARCHAR(36), print_id) AS print_id FROM @ids;
  `);
  const printId = inserted.recordset[0].print_id;
  const column = await new sql.Request(tx).query<{ ok: number }>(
    "SELECT CASE WHEN COL_LENGTH('dbo.RidershipPrintedSheets', 'trip_ids') IS NULL THEN 0 ELSE 1 END AS ok",
  );
  const withTripIds = column.recordset[0]?.ok === 1;
  for (const sheet of write.sheets) {
    const req = new sql.Request(tx);
    req.input("print_id", sql.UniqueIdentifier, printId);
    req.input("service_date", sql.Char(8), write.service_date);
    req.input("block", sql.Char(3), sheet.block);
    req.input("fingerprint", sql.Char(64), sheet.fingerprint);
    req.input("pages", sql.Int, sheet.pages);
    if (withTripIds) {
      req.input("trip_ids", sql.NVarChar(sql.MAX), JSON.stringify(sheet.trip_ids));
      await req.query(`
        INSERT INTO dbo.RidershipPrintedSheets (print_id, service_date, block, fingerprint, pages, trip_ids)
        VALUES (@print_id, @service_date, @block, @fingerprint, @pages, @trip_ids)
      `);
    } else {
      await req.query(`
        INSERT INTO dbo.RidershipPrintedSheets (print_id, service_date, block, fingerprint, pages)
        VALUES (@print_id, @service_date, @block, @fingerprint, @pages)
      `);
    }
  }
}
