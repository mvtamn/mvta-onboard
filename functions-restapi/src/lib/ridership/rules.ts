// The rules of ridership counting, with no database: which trips need a
// count, when a sheet is late, where it stands, which pull-out run pre-fills
// it, which garage it belongs to, and whether a save is acceptable. The store
// reads rows and the handlers speak HTTP; every judgement is made here, so
// the worklist, the sheet and the save can never disagree about one.
import { agencyMinuteOfDay, serviceDateAndGtfsSecondsToUtc } from "../missedTripTime";
import {
  ADDED_TRIP_REASONS,
  ADDED_TRIP_STATUSES,
  COUNT_STATUSES,
  MAX_BOARDINGS,
  type BlockGarageSave,
  type CountEntry,
  type ExcusedReason,
  type LoggedTrip,
  type PulloutRun,
  type SheetProgress,
  type SheetSave,
  type SheetState,
} from "./types";

const SECONDS_PER_DAY = 24 * 60 * 60;

export function isServiceDate(value: string): boolean {
  if (!/^\d{8}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** The three-digit block printed on the sheet. A scanner or a person may type "24". */
export function normalizeBlock(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  return trimmed.padStart(3, "0");
}

/**
 * The route as MVTA's guide names it (the paper sheet, Access, the totals):
 * its number. GTFS gives some routes a name for a short name - Orange LINK is
 * route 425 - so a short name that is not a number falls back to the route_id
 * when that one is.
 */
export function guideRoute(shortName: string | null, routeId: string | null): string | null {
  const short = shortName?.trim() || null;
  const id = routeId?.trim() || null;
  if (short && /^\d+$/.test(short)) return short;
  if (id && /^\d+$/.test(id)) return id;
  return short ?? id;
}

/**
 * The trip as Avail and dispatch name it: "320-E", the trip number and the
 * direction letter. MVTA's GTFS trip_id carries that number in hexadecimal as
 * its first part - "t140-b1F5-sl1B-v64" is trip 320, and the number is the
 * scheduled start as H:MM (3:20 AM) - as the block part carries the block (1F5
 * is 501). Checked against every Dispatch Log trip on 2026-11-01/02 (847 of
 * 847). Null for an id not in that form, so the sheet falls back to the id.
 */
export function availTripNumber(tripId: string, directionLabel: string | null): string | null {
  const match = tripId.match(/^t([0-9A-Fa-f]{1,4})-b[0-9A-Fa-f]+-/);
  if (!match) return null;
  const number = parseInt(match[1], 16);
  const letter = directionLabel?.trim().toUpperCase().match(/^([NSEW])(B|BOUND)?$/)?.[1];
  return letter ? `${number}-${letter}` : String(number);
}

/** "20261201" -> "2026-12-01", the DATE form RidershipBlockGarages keys on. */
export function isoDate(serviceDate: string): string {
  return `${serviceDate.slice(0, 4)}-${serviceDate.slice(4, 6)}-${serviceDate.slice(6, 8)}`;
}

export function addDays(serviceDate: string, days: number): string {
  const date = new Date(Date.UTC(Number(serviceDate.slice(0, 4)), Number(serviceDate.slice(4, 6)) - 1, Number(serviceDate.slice(6, 8)) + days));
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
}

/** Inclusive day count from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const utc = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8)));
  return Math.round((utc(to) - utc(from)) / (SECONDS_PER_DAY * 1000)) + 1;
}

// ---------------------------------------------------------------- §5 completeness

/**
 * Why a trip needs no count, or null when it needs one (spec §5, ADR 0043).
 * The Dispatch Log calling it missed or canceled excuses it, and so does a
 * missed-trip case a reviewer confirmed. `unknown` is not an excuse: a trip
 * the feed could not see still needs a count.
 */
export function excusedReason(trip: Pick<LoggedTrip, "start_status">, confirmedMissed: boolean): ExcusedReason | null {
  if (trip.start_status === "canceled") return "dispatch_log_canceled";
  if (trip.start_status === "missed") return "dispatch_log_missed";
  if (confirmedMissed) return "missed_trip_confirmed";
  return null;
}

/**
 * The instant a sheet falls late: the end of the calendar day after the
 * service date, Central time - midnight starting the day after that.
 */
export function sheetDeadline(serviceDate: string): Date {
  const deadline = serviceDateAndGtfsSecondsToUtc(serviceDate, 2 * SECONDS_PER_DAY);
  if (!deadline) throw new RangeError(`Not a service date: ${serviceDate}`);
  return deadline;
}

/**
 * Where a sheet stands. Entered means every required trip has an entry NOW
 * and the sheet has been saved; lateness is judged on when it was first
 * complete (`entered_at`), which later corrections never move. A sheet that
 * was entered and then gained a required trip (a trip added to the Dispatch
 * Log, a missed-trip case reversed) is open again until that trip is keyed.
 */
export function sheetState(input: {
  required: number;
  keyed: number;
  entered_at: Date | null;
  deadline: Date;
  now: Date;
}): SheetState {
  const complete = input.keyed >= input.required;
  if (input.entered_at && complete) {
    return input.entered_at.getTime() > input.deadline.getTime() ? "entered_late" : "entered";
  }
  if (input.now.getTime() > input.deadline.getTime()) return "late";
  return input.keyed > 0 || input.entered_at ? "in_progress" : "not_entered";
}

/** The worklist's order: late first, then open sheets oldest first, then the rest. */
export function worklistRank(state: SheetState): number {
  return { late: 0, in_progress: 1, not_entered: 2, entered_late: 3, entered: 4 }[state];
}

export function sheetProgress(
  trips: readonly { required: boolean; entry: Pick<CountEntry, "count_status" | "boardings"> | null }[],
  added: readonly Pick<CountEntry, "count_status" | "boardings">[],
): SheetProgress {
  const progress: SheetProgress = {
    trips: trips.length,
    required: 0,
    keyed: 0,
    counted: 0,
    not_counted: 0,
    did_not_operate: 0,
    added_trips: added.length,
    boardings: 0,
  };
  for (const trip of trips) {
    if (trip.required) {
      progress.required += 1;
      if (trip.entry) progress.keyed += 1;
    }
    if (trip.entry) tally(progress, trip.entry);
  }
  for (const entry of added) tally(progress, entry);
  return progress;
}

function tally(progress: SheetProgress, entry: Pick<CountEntry, "count_status" | "boardings">) {
  if (entry.count_status === "counted") {
    progress.counted += 1;
    progress.boardings += entry.boardings ?? 0;
  } else if (entry.count_status === "not_counted") {
    progress.not_counted += 1;
  } else {
    progress.did_not_operate += 1;
  }
}

// ---------------------------------------------------------------- §4 pre-fill

// Avail publishes a run with no committed pull-out as midnight agency time,
// not as NULL (migration 139). That is a relief run, not the first one out.
function committedPullout(run: PulloutRun): Date | null {
  if (!run.pullout_scheduled) return null;
  return agencyMinuteOfDay(run.pullout_scheduled) === 0 ? null : run.pullout_scheduled;
}

/**
 * The block's runs with the one that pre-fills the header first: the earliest
 * committed pull-out, then by run number. Relief runs follow as the hint for
 * an override (decision 4).
 */
export function orderPulloutRuns(runs: readonly PulloutRun[]): PulloutRun[] {
  return [...runs].sort((a, b) => {
    const pa = committedPullout(a);
    const pb = committedPullout(b);
    if (pa && pb && pa.getTime() !== pb.getTime()) return pa.getTime() - pb.getTime();
    if (pa && !pb) return -1;
    if (!pa && pb) return 1;
    return a.run - b.run;
  });
}

const same = (a: string | null, b: string | null) => (a ?? "").trim().toUpperCase() === (b ?? "").trim().toUpperCase();

/**
 * Whether the saved header names someone or something other than the run it
 * was pre-filled from. The handwritten sheet wins and the difference is
 * recorded (spec §4). With no pull-out at all, anything typed is OCC's own
 * entry rather than an override of Avail.
 */
export function isOperatorOverridden(
  saved: { operator_name: string | null; operator_id: string | null; bus: string | null },
  prefill: PulloutRun | null,
): boolean {
  if (!prefill) return false;
  return !same(saved.operator_name, prefill.operator_name)
    || !same(saved.operator_id, prefill.operator_id)
    || !same(saved.bus, prefill.bus);
}

// ---------------------------------------------------------------- garages

/**
 * The garage in force for a block on a date: the row with the latest
 * effective_from on or before it. No row, or a row naming no garage, is
 * Unassigned (null) - a gap the completeness view shows rather than hides.
 */
export function garageOn(
  rows: readonly { block: string; effective_from: string; garage: string | null }[],
  block: string,
  serviceDate: string,
): string | null {
  const day = isoDate(serviceDate);
  let best: { effective_from: string; garage: string | null } | null = null;
  for (const row of rows) {
    if (row.block !== block || row.effective_from > day) continue;
    if (!best || row.effective_from > best.effective_from) best = row;
  }
  return best?.garage ?? null;
}

// ---------------------------------------------------------------- validation

export interface SaveProblem {
  field: string;
  message: string;
}

const TEXT_LIMITS = { operator_name: 200, operator_id: 20, bus: 20 } as const;

function optionalText(value: unknown, field: keyof typeof TEXT_LIMITS, problems: SaveProblem[]): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    problems.push({ field, message: "must be text" });
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length > TEXT_LIMITS[field]) problems.push({ field, message: `must be at most ${TEXT_LIMITS[field]} characters` });
  return trimmed === "" ? null : trimmed;
}

function boardingsFor(status: string, value: unknown, field: string, problems: SaveProblem[]): number | null {
  if (status !== "counted") {
    if (value !== null && value !== undefined) problems.push({ field, message: "carries a number only when counted" });
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_BOARDINGS) {
    problems.push({ field, message: `must be a whole number from 0 to ${MAX_BOARDINGS}` });
    return null;
  }
  return value;
}

/** Shape-checks a PUT body. Whether its trips belong to the sheet is checkSheetSave's job. */
export function parseSheetSave(raw: unknown): { save: SheetSave | null; problems: SaveProblem[] } {
  const problems: SaveProblem[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { save: null, problems: [{ field: "body", message: "must be an object" }] };
  }
  const body = raw as Record<string, unknown>;
  const version = body.version === null || body.version === undefined ? null : body.version;
  if (version !== null && typeof version !== "string") problems.push({ field: "version", message: "must be the version the sheet was loaded at, or null" });
  if (body.reconstructed !== undefined && typeof body.reconstructed !== "boolean") problems.push({ field: "reconstructed", message: "must be true or false" });

  const trips: SheetSave["trips"] = [];
  if (!Array.isArray(body.trips)) {
    problems.push({ field: "trips", message: "must be a list" });
  } else {
    const seen = new Set<string>();
    body.trips.forEach((item, i) => {
      const t = (item ?? {}) as Record<string, unknown>;
      const field = `trips[${i}]`;
      if (typeof t.trip_id !== "string" || t.trip_id === "") {
        problems.push({ field: `${field}.trip_id`, message: "is required" });
        return;
      }
      if (seen.has(t.trip_id)) problems.push({ field: `${field}.trip_id`, message: "appears twice" });
      seen.add(t.trip_id);
      if (!COUNT_STATUSES.includes(t.count_status as never)) {
        problems.push({ field: `${field}.count_status`, message: `must be one of ${COUNT_STATUSES.join(", ")}` });
        return;
      }
      const status = t.count_status as SheetSave["trips"][number]["count_status"];
      trips.push({ trip_id: t.trip_id, count_status: status, boardings: boardingsFor(status, t.boardings, `${field}.boardings`, problems) });
    });
  }

  const added: SheetSave["added_trips"] = [];
  if (body.added_trips !== undefined && !Array.isArray(body.added_trips)) {
    problems.push({ field: "added_trips", message: "must be a list" });
  } else {
    ((body.added_trips as unknown[] | undefined) ?? []).forEach((item, i) => {
      const a = (item ?? {}) as Record<string, unknown>;
      const field = `added_trips[${i}]`;
      const id = a.id === null || a.id === undefined ? null : a.id;
      if (id !== null && (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id))) problems.push({ field: `${field}.id`, message: "must be the saved row's id, or null for a new row" });
      const route = typeof a.route_short_name === "string" ? a.route_short_name.trim() : "";
      if (route === "" || route.length > 100) problems.push({ field: `${field}.route_short_name`, message: "is required" });
      const direction = typeof a.direction_label === "string" ? a.direction_label.trim().toUpperCase() : "";
      if (direction === "" || direction.length > 10) problems.push({ field: `${field}.direction_label`, message: "is required" });
      const start = a.scheduled_start_seconds;
      if (typeof start !== "number" || !Number.isInteger(start) || start < 0 || start >= 2 * SECONDS_PER_DAY) {
        problems.push({ field: `${field}.scheduled_start_seconds`, message: "must be seconds after the service day's midnight" });
      }
      if (!ADDED_TRIP_REASONS.includes(a.reason as never)) problems.push({ field: `${field}.reason`, message: `must be one of ${ADDED_TRIP_REASONS.join(", ")}` });
      if (!ADDED_TRIP_STATUSES.includes(a.count_status as never)) {
        problems.push({ field: `${field}.count_status`, message: `must be one of ${ADDED_TRIP_STATUSES.join(", ")}` });
        return;
      }
      const status = a.count_status as SheetSave["added_trips"][number]["count_status"];
      added.push({
        id: typeof id === "string" ? id.toLowerCase() : null,
        route_short_name: route,
        direction_label: direction,
        scheduled_start_seconds: start as number,
        reason: a.reason as SheetSave["added_trips"][number]["reason"],
        count_status: status,
        boardings: boardingsFor(status, a.boardings, `${field}.boardings`, problems),
      });
    });
  }

  const header = {
    operator_name: optionalText(body.operator_name, "operator_name", problems),
    operator_id: optionalText(body.operator_id, "operator_id", problems),
    bus: optionalText(body.bus, "bus", problems),
  };
  if (problems.length > 0) return { save: null, problems };
  return {
    save: { version: version as string | null, ...header, reconstructed: body.reconstructed === true, trips, added_trips: added },
    problems,
  };
}

/**
 * Checks a parsed save against the sheet as it stands: every trip must be on
 * the block that day, and every trip that needs a count must have an entry
 * (build plan PR 2). Excused trips may still be keyed - a bus the feed missed
 * can still have carried people.
 */
export function checkSheetSave(
  save: SheetSave,
  sheetTrips: readonly { trip_id: string; required: boolean }[],
  savedAddedIds: ReadonlySet<string>,
): SaveProblem[] {
  const problems: SaveProblem[] = [];
  const onSheet = new Set(sheetTrips.map((t) => t.trip_id));
  const keyed = new Set(save.trips.map((t) => t.trip_id));
  for (const trip of save.trips) {
    if (!onSheet.has(trip.trip_id)) problems.push({ field: "trips", message: `${trip.trip_id} is not on this sheet` });
  }
  for (const trip of sheetTrips) {
    if (trip.required && !keyed.has(trip.trip_id)) problems.push({ field: "trips", message: `${trip.trip_id} needs a count, Not counted or Did not operate` });
  }
  for (const added of save.added_trips) {
    if (added.id && !savedAddedIds.has(added.id)) problems.push({ field: "added_trips", message: `${added.id} is not an unscheduled trip on this sheet` });
  }
  return problems;
}

export function parseBlockGarageSave(raw: unknown): { save: BlockGarageSave | null; problems: SaveProblem[] } {
  const problems: SaveProblem[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { save: null, problems: [{ field: "body", message: "must be an object" }] };
  const body = raw as Record<string, unknown>;
  const effective = typeof body.effective_from === "string" ? body.effective_from : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effective) || !isServiceDate(effective.replaceAll("-", ""))) {
    problems.push({ field: "effective_from", message: "must be a date as YYYY-MM-DD" });
  }
  const rows: BlockGarageSave["rows"] = [];
  if (!Array.isArray(body.rows) || body.rows.length === 0) {
    problems.push({ field: "rows", message: "must list at least one block" });
  } else {
    const seen = new Set<string>();
    body.rows.forEach((item, i) => {
      const r = (item ?? {}) as Record<string, unknown>;
      const block = typeof r.block === "string" ? normalizeBlock(r.block) : null;
      if (!block) {
        problems.push({ field: `rows[${i}].block`, message: "must be a block number of up to three digits" });
        return;
      }
      if (seen.has(block)) problems.push({ field: `rows[${i}].block`, message: `${block} appears twice` });
      seen.add(block);
      let garage: string | null = null;
      if (r.garage !== null && r.garage !== undefined) {
        if (typeof r.garage !== "string") problems.push({ field: `rows[${i}].garage`, message: "must be text, or null for Unassigned" });
        else garage = r.garage.trim() || null;
        if (garage && garage.length > 50) problems.push({ field: `rows[${i}].garage`, message: "must be at most 50 characters" });
      }
      rows.push({ block, garage });
    });
  }
  if (problems.length > 0) return { save: null, problems };
  return { save: { effective_from: effective, rows }, problems };
}

// ---------------------------------------------------------------- history

export interface FieldChange {
  subject: "sheet" | "trip" | "added_trip";
  subject_ref: string | null;
  field: string;
  previous_value: string | null;
  new_value: string | null;
}

const text = (value: string | number | boolean | null | undefined): string | null =>
  value === null || value === undefined ? null : String(value);

/** One history row per field that actually changed (P6). A first save records every field it sets. */
export function changesBetween(
  subject: FieldChange["subject"],
  subjectRef: string | null,
  before: Record<string, string | number | boolean | null> | null,
  after: Record<string, string | number | boolean | null> | null,
): FieldChange[] {
  const fields = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const changes: FieldChange[] = [];
  for (const field of fields) {
    const previous = text(before?.[field]);
    const next = text(after?.[field]);
    if (previous !== next) changes.push({ subject, subject_ref: subjectRef, field, previous_value: previous, new_value: next });
  }
  return changes;
}
