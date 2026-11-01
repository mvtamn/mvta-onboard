// The console's side of ridership counting (ADR 0043, spec §4): how a Count
// Sheet is keyed, and what the worklist and the sheet form say about it. The
// rules that decide anything (which trips need a count, late, overrides) are
// the API's; this module only shapes what OCC types into what the API reads.
import {
  RIDERSHIP_MAX_BOARDINGS,
  type RidershipAddedTripReason,
  type RidershipCountStatus,
  type RidershipExcusedReason,
  type RidershipGarageCompleteness,
  type RidershipPrintState,
  type RidershipPrintStatusSheet,
  type RidershipPulloutRun,
  type RidershipSheet,
  type RidershipSheetSave,
  type RidershipSheetState,
  type TripStartStatus,
} from "@mvta/shared";

// ---------------------------------------------------------------- words

export const STATE_LABEL: Record<RidershipSheetState, string> = {
  entered: "Entered",
  entered_late: "Entered late",
  in_progress: "In progress",
  not_entered: "Not entered",
  late: "Late",
};

export const STATE_TONE: Record<RidershipSheetState, "ok" | "warn" | "bad" | "muted"> = {
  entered: "ok",
  entered_late: "warn",
  in_progress: "warn",
  not_entered: "muted",
  late: "bad",
};

export const START_STATUS_LABEL: Record<TripStartStatus, string> = {
  on_time: "On time",
  late: "Late",
  missed: "Missed",
  canceled: "Canceled",
  unknown: "Feed unsure",
};

export const EXCUSED_LABEL: Record<RidershipExcusedReason, string> = {
  dispatch_log_missed: "Missed in the Dispatch Log",
  dispatch_log_canceled: "Canceled in the Dispatch Log",
  missed_trip_confirmed: "Missed (confirmed case)",
};

export const REASON_LABEL: Record<RidershipAddedTripReason, string> = {
  tripper: "Tripper",
  extra_service: "Extra service",
  occ_directed: "OCC-directed",
  other: "Other",
};

export const DIRECTIONS = ["N", "S", "E", "W"] as const;

/** A sheet still to key: the worklist's rows, and what Save moves on to. */
export function isOpenState(state: RidershipSheetState): boolean {
  return state !== "entered" && state !== "entered_late";
}

// ---------------------------------------------------------------- dates and times

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

function serviceDateUtc(serviceDate: string): Date {
  return new Date(Date.UTC(Number(serviceDate.slice(0, 4)), Number(serviceDate.slice(4, 6)) - 1, Number(serviceDate.slice(6, 8))));
}

/** "20261201" -> "Tue, Dec 1". */
export function formatServiceDate(serviceDate: string): string {
  return DATE_FORMAT.format(serviceDateUtc(serviceDate));
}

/** A sheet falls late at the end of the calendar day after service (spec §5). */
export function dueLabel(serviceDate: string): string {
  const next = serviceDateUtc(serviceDate);
  next.setUTCDate(next.getUTCDate() + 1);
  return `end of ${DATE_FORMAT.format(next)}`;
}

/** GTFS seconds past the service day's midnight, as the sheet's clock prints them. */
export function clock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const h = Math.floor(minutes / 60) % 24;
  return `${String(h).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/**
 * A start time typed from the sheet: "7:30", "0730" or "730". After midnight
 * the service day runs on, so 00:40 that night is typed 24:40.
 */
export function parseClock(text: string): number | null {
  const match = text.trim().match(/^(\d{1,2}):?(\d{2})$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 29 || m > 59) return null;
  return h * 3600 + m * 60;
}

// ---------------------------------------------------------------- a trip's cell

/**
 * What OCC types in a trip's box: a number of boardings, N for Not counted, or
 * D for Did not operate. Empty is not yet keyed. Not counted is a gap, never a
 * zero, so it has its own letter rather than a blank or a 0.
 */
export type Cell = string;

/**
 * Typing a letter replaces the box, and a digit after a letter starts a number,
 * so the box always holds one of the three answers. D is refused for an
 * unscheduled trip, which ran by definition.
 */
export function cellFromInput(raw: string, allowDidNotOperate = true): Cell {
  const last = raw.slice(-1).toUpperCase();
  if (last === "N") return "N";
  if (last === "D" && allowDidNotOperate) return "D";
  const digits = raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  return digits.slice(0, String(RIDERSHIP_MAX_BOARDINGS).length);
}

export function cellFromEntry(entry: { count_status: RidershipCountStatus; boardings: number | null } | null): Cell {
  if (!entry) return "";
  if (entry.count_status === "not_counted") return "N";
  if (entry.count_status === "did_not_operate") return "D";
  return String(entry.boardings ?? 0);
}

export function entryFromCell(cell: Cell): { count_status: RidershipCountStatus; boardings: number | null } | null {
  if (cell === "") return null;
  if (cell === "N") return { count_status: "not_counted", boardings: null };
  if (cell === "D") return { count_status: "did_not_operate", boardings: null };
  return { count_status: "counted", boardings: Number(cell) };
}

export function cellMeaning(cell: Cell): string | null {
  if (cell === "N") return "Not counted";
  if (cell === "D") return "Did not operate";
  return null;
}

// ---------------------------------------------------------------- the draft

export interface AddedDraft {
  /** Stable for React; the saved id, or a local one for a new row. */
  key: string;
  id: string | null;
  route: string;
  direction: string;
  start: string;
  reason: RidershipAddedTripReason;
  cell: Cell;
}

export interface SheetDraft {
  operator_name: string;
  operator_id: string;
  bus: string;
  reconstructed: boolean;
  cells: Record<string, Cell>;
  added: AddedDraft[];
}

/** What the form opens with: the saved sheet, or Avail's first pull-out for a new one. */
export function draftFromSheet(sheet: RidershipSheet): SheetDraft {
  const who = sheet.header ?? sheet.pullout.prefill;
  return {
    operator_name: who?.operator_name ?? "",
    operator_id: who?.operator_id ?? "",
    bus: who?.bus ?? "",
    reconstructed: sheet.header?.reconstructed ?? false,
    cells: Object.fromEntries(sheet.trips.map((trip) => [trip.trip_id, cellFromEntry(trip.entry)])),
    added: sheet.added_trips.map((trip) => ({
      key: trip.id,
      id: trip.id,
      route: trip.route_short_name,
      direction: trip.direction_label,
      start: clock(trip.scheduled_start_seconds),
      reason: trip.reason,
      cell: cellFromEntry(trip),
    })),
  };
}

export function isDirty(sheet: RidershipSheet, draft: SheetDraft): boolean {
  return JSON.stringify(draftFromSheet(sheet)) !== JSON.stringify(draft);
}

const sameText = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? "").trim().replace(/\s+/g, " ").toLowerCase() === (b ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/** The sheet's operator or bus differs from Avail's pull-out. The API records the same judgement. */
export function isOverridden(draft: Pick<SheetDraft, "operator_name" | "operator_id" | "bus">, prefill: RidershipPulloutRun | null): boolean {
  if (!prefill) return false;
  return !sameText(draft.operator_name, prefill.operator_name)
    || !sameText(draft.operator_id, prefill.operator_id)
    || !sameText(draft.bus, prefill.bus);
}

/** Trips that need a count and have nothing yet, in sheet order. */
export function blankRequiredTrips(sheet: RidershipSheet, draft: SheetDraft): string[] {
  return sheet.trips.filter((trip) => trip.required && (draft.cells[trip.trip_id] ?? "") === "").map((trip) => trip.trip_id);
}

export interface DraftProblem {
  /** A trip id, or `added:<key>` for an unscheduled row. */
  target: string;
  message: string;
}

const blankToNull = (text: string) => (text.trim() === "" ? null : text.trim());

/** The PUT body, or what stops it. Every required trip needs one of the three answers. */
export function saveFromDraft(sheet: RidershipSheet, draft: SheetDraft): { save: RidershipSheetSave | null; problems: DraftProblem[] } {
  const problems: DraftProblem[] = [];
  const blanks = blankRequiredTrips(sheet, draft);
  if (blanks.length > 0) {
    problems.push({
      target: blanks[0],
      message: `${blanks.length} trip${blanks.length === 1 ? "" : "s"} still blank. Every trip that needs a count takes a number, N (not counted) or D (did not operate).`,
    });
  }
  const trips = sheet.trips.flatMap((trip) => {
    const entry = entryFromCell(draft.cells[trip.trip_id] ?? "");
    return entry ? [{ trip_id: trip.trip_id, ...entry }] : [];
  });
  const added: RidershipSheetSave["added_trips"] = [];
  for (const row of draft.added) {
    const target = `added:${row.key}`;
    const start = parseClock(row.start);
    const entry = entryFromCell(row.cell);
    if (!row.route.trim()) problems.push({ target, message: "An unscheduled trip needs its route." });
    if (start === null) problems.push({ target, message: "An unscheduled trip's start time is HH:MM (after midnight, 24:40)." });
    if (!entry || entry.count_status === "did_not_operate") problems.push({ target, message: "An unscheduled trip takes a number or N (not counted)." });
    if (start !== null && entry && entry.count_status !== "did_not_operate" && row.route.trim()) {
      added.push({
        id: row.id,
        route_short_name: row.route.trim(),
        direction_label: row.direction,
        scheduled_start_seconds: start,
        reason: row.reason,
        count_status: entry.count_status,
        boardings: entry.boardings,
      });
    }
  }
  if (problems.length > 0) return { save: null, problems };
  return {
    save: {
      version: sheet.version,
      operator_name: blankToNull(draft.operator_name),
      operator_id: blankToNull(draft.operator_id),
      bus: blankToNull(draft.bus),
      reconstructed: draft.reconstructed,
      trips,
      added_trips: added,
    },
    problems: [],
  };
}

// ---------------------------------------------------------------- worklist

export const sheetKey = (serviceDate: string, block: string) => `${serviceDate}|${block}`;

/** "7" -> "007": a block as the sheet prints it, or null when it is not up to three digits. */
export function normalizeBlock(value: string): string | null {
  const trimmed = value.trim();
  return /^\d{1,3}$/.test(trimmed) ? trimmed.padStart(3, "0") : null;
}

export function splitSheetKey(key: string): { serviceDate: string; block: string } {
  const [serviceDate, block] = key.split("|");
  return { serviceDate, block };
}

/** Required trips with any answer, as a whole percent; a garage with nothing required is complete. */
export function garagePercent(garage: RidershipGarageCompleteness): number {
  if (garage.required_trips === 0) return 100;
  return Math.floor((100 * (garage.required_trips - garage.missing_trips)) / garage.required_trips);
}

export const garageName = (garage: string | null) => garage ?? "Unassigned";

/**
 * A scanned Count Sheet QR code (a link to the operator app ending
 * /r/<YYYYMMDD>/<block>, with ?p=N on an overflow page), or a block number
 * typed with no date.
 */
export function parseSheetScan(raw: string): { serviceDate: string | null; block: string } | null {
  const text = raw.trim();
  const link = text.match(/\/r\/(\d{8})\/(\d{1,3})(?:[?#].*)?$/i);
  if (link) return { serviceDate: link[1], block: link[2].padStart(3, "0") };
  if (/^\d{1,3}$/.test(text)) return { serviceDate: null, block: text.padStart(3, "0") };
  return null;
}

// ---------------------------------------------------------------- block -> garage

type GarageRow = { block: string; effective_from: string; garage: string | null };

/** The row in force for a block on a day (YYYY-MM-DD): the latest on or before it. None is Unassigned. */
export function rowInForce<T extends GarageRow>(rows: readonly T[], block: string, day: string): T | null {
  let best: T | null = null;
  for (const row of rows) {
    if (row.block !== block || row.effective_from > day) continue;
    if (!best || row.effective_from > best.effective_from) best = row;
  }
  return best;
}

/**
 * The rows a setup save sends: only blocks whose garage differs from what is
 * already in force on the service change's first day, so saving a service
 * change does not restate every block it leaves alone.
 */
export function garageChanges(
  rows: readonly GarageRow[],
  draft: Record<string, string>,
  day: string,
): { block: string; garage: string | null }[] {
  return Object.entries(draft)
    .map(([block, text]) => ({ block, garage: text.trim() === "" ? null : text.trim() }))
    .filter(({ block, garage }) => (rowInForce(rows, block, day)?.garage ?? null) !== garage)
    .sort((a, b) => a.block.localeCompare(b.block));
}

// ---------------------------------------------------------------- printing

/** A Central calendar day as YYYY-MM-DD, `offset` days from today; tomorrow is the sheets the desk prints tonight. */
export function centralDay(offset: number, now: Date = new Date()): string {
  return new Date(now.getTime() + offset * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

export const PRINT_STATE_LABEL: Record<RidershipPrintState, string> = {
  not_printed: "Not printed",
  printed: "Printed",
  changed: "Changed since printed",
};

export const PRINT_STATE_TONE: Record<RidershipPrintState, "ok" | "warn" | "muted"> = {
  not_printed: "muted",
  printed: "ok",
  changed: "warn",
};

/** When a sheet was printed, in Central: "Tue, Dec 1 21:05". */
export function printedTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).replace(/,(?= \d{2}:)/, "");
}

/** The blocks a desk still needs to print: never printed, or changed since. */
export function blocksToReprint(sheets: readonly RidershipPrintStatusSheet[]): string[] {
  return sheets.filter((s) => s.state !== "printed").map((s) => s.block);
}

/**
 * Where the printed QR link points until the operator app has an address of
 * its own (spec §15): this console, whose /r/<date>/<block> route opens the
 * sheet after sign-in. The API swaps in RIDERSHIP_SHEET_LINK_BASE when it is set.
 */
export function sheetLinkBase(origin: string, basePath: string): string {
  return new URL(basePath, origin).href.replace(/\/+$/, "");
}

/** Select values for a garage, where null (Unassigned) needs a string of its own. */
export const UNASSIGNED_VALUE = "\u0000unassigned";
export const garageValue = (garage: string | null) => garage ?? UNASSIGNED_VALUE;
export const garageFromValue = (value: string) => (value === UNASSIGNED_VALUE ? null : value);
