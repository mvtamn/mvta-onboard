// The vocabulary of ridership counting (ADR 0043, plans/ridership-counting-spec.md).
// The console's mirror reads these names, so they change together.
import type { TripStartStatus } from "../tripStartTypes";

/** How a trip was keyed. Not counted is a gap, never a zero (decision 1). */
export type CountStatus = "counted" | "not_counted" | "did_not_operate";
/** An unscheduled trip ran by definition, so it cannot be "did not operate". */
export type AddedTripStatus = Exclude<CountStatus, "did_not_operate">;
export type AddedTripReason = "tripper" | "extra_service" | "occ_directed" | "other";
/** What one print covered: a garage's whole stack, or a reprint of some of its blocks. */
export type PrintScope = "garage" | "blocks";

export const COUNT_STATUSES: readonly CountStatus[] = ["counted", "not_counted", "did_not_operate"];
export const ADDED_TRIP_STATUSES: readonly AddedTripStatus[] = ["counted", "not_counted"];
export const ADDED_TRIP_REASONS: readonly AddedTripReason[] = ["tripper", "extra_service", "occ_directed", "other"];

/** The sheet's total is three one-digit boxes (spec §3). */
export const MAX_BOARDINGS = 999;

/**
 * Where a sheet stands (spec §5). `late` and `entered_late` are judged on the
 * deadline: the end of the calendar day after the service date, Central time.
 */
export type SheetState = "entered" | "entered_late" | "in_progress" | "not_entered" | "late";

/** Why a trip needs no count. Null means it needs one. */
export type ExcusedReason = "dispatch_log_missed" | "dispatch_log_canceled" | "missed_trip_confirmed";

/** One Dispatch Log trip, as much of it as ridership reads. */
export interface LoggedTrip {
  service_date: string;
  trip_id: string;
  /** The workbook block ("001"), or null when the Dispatch Log has none. */
  block: string | null;
  route_short_name: string | null;
  /** The route as the guide prints it: 425, not "Orange LINK" (guideRoute). */
  route_label: string | null;
  direction_label: string | null;
  scheduled_start_seconds: number;
  scheduled_end_seconds: number | null;
  start_status: TripStartStatus;
}

export interface CountEntry {
  trip_id: string;
  count_status: CountStatus;
  boardings: number | null;
}

/** One run of the block in Avail's pull-out (FixedRouteDepartures). */
export interface PulloutRun {
  run: number;
  operator_name: string | null;
  operator_id: string | null;
  bus: string | null;
  pullout_scheduled: Date | null;
}

export interface SheetHeader {
  operator_name: string | null;
  operator_id: string | null;
  bus: string | null;
  prefill_run: number | null;
  operator_overridden: boolean;
  reconstructed: boolean;
  entered_at: Date | null;
  entered_by: string | null;
  updated_at: Date | null;
  updated_by: string | null;
  created_at: Date;
}

export interface AddedTrip {
  id: string;
  route_short_name: string;
  direction_label: string;
  scheduled_start_seconds: number;
  reason: AddedTripReason;
  count_status: AddedTripStatus;
  boardings: number | null;
}

export interface BlockGarageRow {
  block: string;
  /** YYYY-MM-DD, the first service date the row applies to. */
  effective_from: string;
  /** Null: deliberately Unassigned from this date. */
  garage: string | null;
  updated_at: string;
  updated_by: string;
}

// ---------------------------------------------------------------- responses

export interface SheetProgress {
  trips: number;
  required: number;
  /** Required trips with an entry of any kind. */
  keyed: number;
  counted: number;
  not_counted: number;
  did_not_operate: number;
  added_trips: number;
  /** Counted boardings, scheduled and unscheduled. Not-counted trips add nothing. */
  boardings: number;
}

export interface WorklistSheet {
  service_date: string;
  block: string;
  garage: string | null;
  state: SheetState;
  /** ISO instant the sheet falls late. */
  due_at: string;
  first_start_seconds: number;
  entered_at: string | null;
  entered_by: string | null;
  reconstructed: boolean;
  progress: SheetProgress;
}

export interface GarageCompleteness {
  /** Null is Unassigned. */
  garage: string | null;
  sheets: number;
  entered: number;
  entered_late: number;
  late: number;
  open: number;
  required_trips: number;
  /** Required trips with no entry at all. */
  missing_trips: number;
  not_counted_trips: number;
}

export interface Worklist {
  from: string;
  to: string;
  generated_at: string;
  sheets: WorklistSheet[];
  garages: GarageCompleteness[];
}

export interface SheetTrip {
  trip_id: string;
  route_short_name: string | null;
  /** The route as the guide prints it: 425, not "Orange LINK". */
  route_label: string | null;
  direction_label: string | null;
  scheduled_start_seconds: number;
  scheduled_end_seconds: number | null;
  start_status: TripStartStatus;
  required: boolean;
  excused_reason: ExcusedReason | null;
  entry: { count_status: CountStatus; boardings: number | null } | null;
}

export interface SheetHistoryEntry {
  subject: "sheet" | "trip" | "added_trip";
  subject_ref: string | null;
  field: string;
  previous_value: string | null;
  new_value: string | null;
  changed_at: string;
  changed_by: string;
}

export interface SheetDetail {
  service_date: string;
  block: string;
  garage: string | null;
  state: SheetState;
  due_at: string;
  /** Avail's pull-out for the block: the first run pre-fills, the rest are a relief hint. */
  pullout: {
    prefill: PulloutRunView | null;
    other_runs: PulloutRunView[];
  };
  /** Null until the sheet is first saved. */
  header: {
    operator_name: string | null;
    operator_id: string | null;
    bus: string | null;
    prefill_run: number | null;
    operator_overridden: boolean;
    reconstructed: boolean;
    entered_at: string | null;
    entered_by: string | null;
    updated_at: string | null;
    updated_by: string | null;
  } | null;
  /** Pass back on PUT; a sheet changed since is refused rather than overwritten. */
  version: string | null;
  trips: SheetTrip[];
  added_trips: AddedTrip[];
  progress: SheetProgress;
  history: SheetHistoryEntry[];
}

export interface PulloutRunView {
  run: number;
  operator_name: string | null;
  operator_id: string | null;
  bus: string | null;
}

// ---------------------------------------------------------------- the save

export interface SheetSave {
  /** The `version` the editor loaded; null for a sheet never saved. */
  version: string | null;
  operator_name: string | null;
  operator_id: string | null;
  bus: string | null;
  reconstructed: boolean;
  trips: { trip_id: string; count_status: CountStatus; boardings: number | null }[];
  /** The whole list. A saved row whose id is missing here is removed. */
  added_trips: {
    id: string | null;
    route_short_name: string;
    direction_label: string;
    scheduled_start_seconds: number;
    reason: AddedTripReason;
    count_status: AddedTripStatus;
    boardings: number | null;
  }[];
}

export interface BlockGarageSave {
  /** YYYY-MM-DD: the service change the rows apply from. */
  effective_from: string;
  rows: { block: string; garage: string | null }[];
}
