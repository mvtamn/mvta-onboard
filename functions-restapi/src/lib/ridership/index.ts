// Ridership counting (ADR 0043, plans/ridership-build-plan.md PR 2): the one
// module that owns which trips need a count, where each Count Sheet stands,
// the pull-out pre-fill, and saving a sheet with its history. The handlers in
// functions/ridership.ts only speak HTTP.
//
// A sheet is a block on a service date. It exists for the worklist as soon as
// the Dispatch Log has trips for it, before anyone has saved anything; a
// RidershipSheets row is written by the first save.
import { sql } from "../db";
import type { Executor } from "../otpMonth";
import {
  changesBetween,
  checkSheetSave,
  excusedReason,
  garageOn,
  isOperatorOverridden,
  orderPulloutRuns,
  parseBlockGarageSave,
  parseSheetSave,
  sheetDeadline,
  sheetProgress,
  sheetState,
  worklistRank,
  type FieldChange,
  type SaveProblem,
} from "./rules";
import {
  addedTripFields,
  loadAddedTrips,
  loadBlockGarages,
  loadConfirmedMissed,
  loadCounts,
  loadHistory,
  loadLoggedTrips,
  loadPulloutRuns,
  loadSheets,
  writeBlockGarages,
  writeSheet,
  type StoredSheet,
} from "./store";
import type {
  BlockGarageRow,
  CountEntry,
  GarageCompleteness,
  LoggedTrip,
  PulloutRun,
  PulloutRunView,
  SheetDetail,
  SheetTrip,
  Worklist,
  WorklistSheet,
} from "./types";

export * from "./types";
export { addDays, daysBetween, isServiceDate, normalizeBlock, sheetDeadline, type SaveProblem } from "./rules";
export { printLogReady, ridershipTablesReady } from "./store";
export { linkBaseFor, loadPrintStatus, printCountSheets, type GarageChoice, type PrintRequest, type PrintResult, type PrintStatus } from "./print";

const sheetKey = (serviceDate: string, block: string) => `${serviceDate}|${block}`;

/** A sheet's optimistic-concurrency token: when it was last written. */
const versionOf = (sheet: StoredSheet | undefined) => (sheet ? (sheet.updated_at ?? sheet.created_at).toISOString() : null);

function sheetTrips(trips: readonly LoggedTrip[], confirmed: ReadonlySet<string>, counts: ReadonlyMap<string, CountEntry>): SheetTrip[] {
  return trips.map((trip) => {
    const excused = excusedReason(trip, confirmed.has(`${trip.service_date}|${trip.trip_id}`));
    const entry = counts.get(trip.trip_id);
    return {
      trip_id: trip.trip_id,
      route_short_name: trip.route_short_name,
      route_label: trip.route_label,
      direction_label: trip.direction_label,
      scheduled_start_seconds: trip.scheduled_start_seconds,
      scheduled_end_seconds: trip.scheduled_end_seconds,
      start_status: trip.start_status,
      required: excused === null,
      excused_reason: excused,
      entry: entry ? { count_status: entry.count_status, boardings: entry.boardings } : null,
    };
  });
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = groups.get(k);
    if (list) list.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}

// ---------------------------------------------------------------- worklist

/**
 * Every sheet with trips between the two service dates, late first, with
 * completeness by garage (spec §4/§5). Trips with no workbook block are
 * reported as a count, because they belong on no sheet and would otherwise
 * vanish.
 */
export async function buildWorklist(executor: Executor, from: string, to: string, now: Date = new Date()): Promise<Worklist & { trips_without_block: number }> {
  const range = { from, to };
  const [trips, confirmed, sheets, counts, added, garages] = await Promise.all([
    loadLoggedTrips(executor, range),
    loadConfirmedMissed(executor, range),
    loadSheets(executor, range),
    loadCounts(executor, range),
    loadAddedTrips(executor, range),
    loadBlockGarages(executor),
  ]);
  const sheetRows = new Map(sheets.map((s) => [sheetKey(s.service_date, s.block), s]));
  const countsBySheet = groupBy(counts, (c) => sheetKey(c.service_date, c.block));
  const addedBySheet = groupBy(added, (a) => sheetKey(a.service_date, a.block));
  const tripsBySheet = groupBy(trips.filter((t) => t.block), (t) => sheetKey(t.service_date, t.block!));

  const result: WorklistSheet[] = [];
  for (const [key, blockTrips] of tripsBySheet) {
    const { service_date, block } = { service_date: blockTrips[0].service_date, block: blockTrips[0].block! };
    const stored = sheetRows.get(key);
    const entries = new Map((countsBySheet.get(key) ?? []).map((c) => [c.trip_id, c]));
    const shaped = sheetTrips(blockTrips, confirmed, entries);
    const progress = sheetProgress(shaped, addedBySheet.get(key) ?? []);
    const deadline = sheetDeadline(service_date);
    result.push({
      service_date,
      block,
      garage: garageOn(garages, block, service_date),
      state: sheetState({ required: progress.required, keyed: progress.keyed, entered_at: stored?.entered_at ?? null, deadline, now }),
      due_at: deadline.toISOString(),
      first_start_seconds: blockTrips[0].scheduled_start_seconds,
      entered_at: stored?.entered_at?.toISOString() ?? null,
      entered_by: stored?.entered_by ?? null,
      reconstructed: stored?.reconstructed ?? false,
      progress,
    });
  }
  result.sort((a, b) =>
    worklistRank(a.state) - worklistRank(b.state)
    || a.service_date.localeCompare(b.service_date)
    || a.first_start_seconds - b.first_start_seconds
    || a.block.localeCompare(b.block));

  return {
    from,
    to,
    generated_at: now.toISOString(),
    sheets: result,
    garages: completenessByGarage(result),
    trips_without_block: trips.filter((t) => !t.block).length,
  };
}

/** Unassigned sorts last so the named garages read first; it is never left out. */
export function completenessByGarage(sheets: readonly WorklistSheet[]): GarageCompleteness[] {
  const byGarage = new Map<string | null, GarageCompleteness>();
  for (const sheet of sheets) {
    let row = byGarage.get(sheet.garage);
    if (!row) {
      row = { garage: sheet.garage, sheets: 0, entered: 0, entered_late: 0, late: 0, open: 0, required_trips: 0, missing_trips: 0, not_counted_trips: 0 };
      byGarage.set(sheet.garage, row);
    }
    row.sheets += 1;
    if (sheet.state === "entered") row.entered += 1;
    else if (sheet.state === "entered_late") row.entered_late += 1;
    else if (sheet.state === "late") row.late += 1;
    else row.open += 1;
    row.required_trips += sheet.progress.required;
    row.missing_trips += sheet.progress.required - sheet.progress.keyed;
    row.not_counted_trips += sheet.progress.not_counted;
  }
  return [...byGarage.values()].sort((a, b) =>
    a.garage === null ? 1 : b.garage === null ? -1 : a.garage.localeCompare(b.garage));
}

// ---------------------------------------------------------------- one sheet

const runView = (run: PulloutRun): PulloutRunView => ({
  run: run.run, operator_name: run.operator_name, operator_id: run.operator_id, bus: run.bus,
});

/** The sheet, or null when the block ran no trips that day and nothing was ever saved for it. */
export async function loadSheet(executor: Executor, serviceDate: string, block: string, now: Date = new Date()): Promise<SheetDetail | null> {
  const range = { from: serviceDate, to: serviceDate, block };
  const [trips, confirmed, sheets, counts, added, garages, runs, history] = await Promise.all([
    loadLoggedTrips(executor, range),
    loadConfirmedMissed(executor, range),
    loadSheets(executor, range),
    loadCounts(executor, range),
    loadAddedTrips(executor, range),
    loadBlockGarages(executor),
    loadPulloutRuns(executor, serviceDate, block),
    loadHistory(executor, serviceDate, block),
  ]);
  const stored = sheets[0];
  if (trips.length === 0 && !stored) return null;

  const shaped = sheetTrips(trips, confirmed, new Map(counts.map((c) => [c.trip_id, c])));
  const progress = sheetProgress(shaped, added);
  const ordered = orderPulloutRuns(runs);
  const deadline = sheetDeadline(serviceDate);
  return {
    service_date: serviceDate,
    block,
    garage: garageOn(garages, block, serviceDate),
    state: sheetState({ required: progress.required, keyed: progress.keyed, entered_at: stored?.entered_at ?? null, deadline, now }),
    due_at: deadline.toISOString(),
    pullout: {
      prefill: ordered[0] ? runView(ordered[0]) : null,
      other_runs: ordered.slice(1).map(runView),
    },
    header: stored
      ? {
          operator_name: stored.operator_name,
          operator_id: stored.operator_id,
          bus: stored.bus,
          prefill_run: stored.prefill_run,
          operator_overridden: stored.operator_overridden,
          reconstructed: stored.reconstructed,
          entered_at: stored.entered_at?.toISOString() ?? null,
          entered_by: stored.entered_by,
          updated_at: stored.updated_at?.toISOString() ?? null,
          updated_by: stored.updated_by,
        }
      : null,
    version: versionOf(stored),
    trips: shaped,
    added_trips: added.map(({ service_date: _d, block: _b, ...trip }) => trip),
    progress,
    history,
  };
}

// ---------------------------------------------------------------- the save

export type SaveSheetResult =
  | { kind: "saved"; sheet: SheetDetail; changes: number }
  | { kind: "invalid"; problems: SaveProblem[] }
  | { kind: "not_found" }
  | { kind: "conflict"; version: string | null };

const headerFields = (h: { operator_name: string | null; operator_id: string | null; bus: string | null; prefill_run: number | null; operator_overridden: boolean; reconstructed: boolean }) => ({
  operator_name: h.operator_name,
  operator_id: h.operator_id,
  bus: h.bus,
  prefill_run: h.prefill_run,
  operator_overridden: h.operator_overridden,
  reconstructed: h.reconstructed,
});

const countFields = (c: Pick<CountEntry, "count_status" | "boardings">) => ({ count_status: c.count_status, boardings: c.boardings });

/**
 * Saves the whole sheet as OCC keyed it, in one transaction. The body is the
 * complete sheet: a trip or unscheduled row it leaves out is cleared (and the
 * clearing is history like any other change). Refused, rather than merged,
 * when someone else saved the sheet after the editor loaded it.
 */
export async function saveSheet(
  pool: sql.ConnectionPool,
  serviceDate: string,
  block: string,
  raw: unknown,
  actor: string,
  now: Date = new Date(),
): Promise<SaveSheetResult> {
  const parsed = parseSheetSave(raw);
  if (!parsed.save) return { kind: "invalid", problems: parsed.problems };
  const save = parsed.save;

  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
  try {
    const range = { from: serviceDate, to: serviceDate, block };
    // The sheet row is locked first so two saves of one sheet queue up and
    // the second sees the first's version.
    const [stored] = await loadSheets(tx, range, true);
    const trips = await loadLoggedTrips(tx, range);
    if (trips.length === 0 && !stored) {
      await tx.rollback();
      return { kind: "not_found" };
    }
    if (versionOf(stored) !== save.version) {
      await tx.rollback();
      return { kind: "conflict", version: versionOf(stored) };
    }
    const confirmed = await loadConfirmedMissed(tx, range);
    const existingCounts = new Map((await loadCounts(tx, range)).map((c) => [c.trip_id, c]));
    const existingAdded = new Map((await loadAddedTrips(tx, range)).map((a) => [a.id, a]));
    const shaped = sheetTrips(trips, confirmed, existingCounts);

    const problems = checkSheetSave(save, shaped, new Set(existingAdded.keys()));
    if (problems.length > 0) {
      await tx.rollback();
      return { kind: "invalid", problems };
    }

    const prefill = orderPulloutRuns(await loadPulloutRuns(tx, serviceDate, block))[0] ?? null;
    const header = {
      operator_name: save.operator_name,
      operator_id: save.operator_id,
      bus: save.bus,
      prefill_run: prefill?.run ?? null,
      operator_overridden: isOperatorOverridden(save, prefill),
      reconstructed: save.reconstructed,
    };
    const changes: FieldChange[] = changesBetween("sheet", null, stored ? headerFields(stored) : null, headerFields(header));

    const upsertCounts: CountEntry[] = [];
    const keyed = new Set<string>();
    for (const entry of save.trips) {
      keyed.add(entry.trip_id);
      const before = existingCounts.get(entry.trip_id);
      const tripChanges = changesBetween("trip", entry.trip_id, before ? countFields(before) : null, countFields(entry));
      if (tripChanges.length > 0) {
        upsertCounts.push(entry);
        changes.push(...tripChanges);
      }
    }
    const deleteCounts = [...existingCounts.keys()].filter((id) => !keyed.has(id));
    for (const id of deleteCounts) changes.push(...changesBetween("trip", id, countFields(existingCounts.get(id)!), null));

    const insertAdded: Parameters<typeof writeSheet>[1]["insertAdded"] = [];
    const updateAdded: Parameters<typeof writeSheet>[1]["updateAdded"] = [];
    const keptAdded = new Set<string>();
    for (const { id, ...trip } of save.added_trips) {
      if (!id) {
        insertAdded.push(trip);
        continue;
      }
      keptAdded.add(id);
      const tripChanges = changesBetween("added_trip", id, addedTripFields(existingAdded.get(id)!), addedTripFields(trip));
      if (tripChanges.length > 0) {
        updateAdded.push({ id, ...trip });
        changes.push(...tripChanges);
      }
    }
    const removeAdded = [...existingAdded.keys()].filter((id) => !keptAdded.has(id));
    for (const id of removeAdded) changes.push({ subject: "added_trip", subject_ref: id, field: "removed", previous_value: null, new_value: "true" });

    // Every required trip has an entry (checkSheetSave), so this save
    // completes the sheet; entered_at is set the first time only.
    const entered = !stored?.entered_at;
    if (entered) changes.push({ subject: "sheet", subject_ref: null, field: "entered", previous_value: null, new_value: "true" });

    let written = 0;
    if (changes.length > 0 || insertAdded.length > 0) {
      written = (await writeSheet(tx, {
        service_date: serviceDate, block, header, entered, exists: Boolean(stored),
        upsertCounts, deleteCounts, insertAdded, updateAdded, removeAdded, changes,
      }, actor, now)).length;
    }
    await tx.commit();
    const sheet = await loadSheet(pool, serviceDate, block, now);
    return { kind: "saved", sheet: sheet!, changes: written };
  } catch (err) {
    await tx.rollback().catch(() => undefined);
    throw err;
  }
}

// ---------------------------------------------------------------- block garages

export interface BlockGarageList {
  rows: BlockGarageRow[];
  /** Garage names already in use, for the setup page to offer. */
  garages: string[];
  /** Blocks the Dispatch Log has run recently or will run tomorrow, for the setup page to list. */
  recent_blocks: string[];
}

export async function listBlockGarages(executor: Executor, recent: { from: string; to: string }): Promise<BlockGarageList> {
  const [rows, trips] = await Promise.all([loadBlockGarages(executor), loadLoggedTrips(executor, recent)]);
  const garages = [...new Set(rows.map((r) => r.garage).filter((g): g is string => g !== null))].sort();
  const blocks = [...new Set(trips.map((t) => t.block).filter((b): b is string => b !== null))].sort();
  return { rows, garages, recent_blocks: blocks };
}

export type SaveBlockGaragesResult = { kind: "saved"; list: BlockGarageList } | { kind: "invalid"; problems: SaveProblem[] };

export async function saveBlockGarages(
  pool: sql.ConnectionPool,
  raw: unknown,
  actor: string,
  recent: { from: string; to: string },
  now: Date = new Date(),
): Promise<SaveBlockGaragesResult> {
  const parsed = parseBlockGarageSave(raw);
  if (!parsed.save) return { kind: "invalid", problems: parsed.problems };
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    await writeBlockGarages(tx, parsed.save, actor, now);
    await tx.commit();
  } catch (err) {
    await tx.rollback().catch(() => undefined);
    throw err;
  }
  return { kind: "saved", list: await listBlockGarages(pool, recent) };
}
