import { useMemo } from "react";
import type { TripStartLogTrip, TripStartVerificationAction } from "@mvta/shared";
import { SortableTable, type SortableColumn } from "../../../components/SortableTable.js";
import {
  bucketLabel,
  deltaLabel,
  gtfsClock,
  nextVerifyAction,
  routeLabel,
  startBucket,
  timeLabel,
  verifyActionLabel,
  type SortDir,
  type SortKey,
  type StartBucket,
} from "./tripStartLogState.js";

interface Props {
  trips: TripStartLogTrip[];
  sortKey: SortKey;
  sortDir: SortDir;
  onSortChange: (key: SortKey, dir: SortDir) => void;
  selectedTripId: string | null;
  onSelect: (tripId: string) => void;
  canVerify: boolean;
  onVerify: (tripId: string, action: TripStartVerificationAction) => void;
}

const PILL: Record<StartBucket, string> = {
  on_time: "pill-success",
  left_late: "pill-warning",
  late_over_5: "pill-danger",
  missed: "pill-danger",
  no_actual: "pill-muted",
  canceled: "pill-muted",
};

function verifiedContent(trip: TripStartLogTrip) {
  return trip.verification ? (
    <span className="tsl-initials" title={trip.verification.verified_by}>{trip.verification.verified_initials}</span>
  ) : trip.in_rotation ? (
    <span className="tsl-needs">Needs initials</span>
  ) : (
    <span className="td-dim">—</span>
  );
}

// The spreadsheet reading of the day and the default view (spec §4.3): the
// workbook's columns in the workbook's order, Verified pinned first, every
// column sortable, rows outside today's rotation dimmed but present. For a
// verifier the Verified cell is the workbook's one-click cycle - blank, on
// time, left late, blank - showing the signed-in user's initials.
function columns(canVerify: boolean, onVerify: (tripId: string, action: TripStartVerificationAction) => void): SortableColumn<TripStartLogTrip>[] {
  return [
  {
    key: "verified",
    header: "Verified",
    sticky: true,
    render: (trip) => {
      if (!canVerify) return verifiedContent(trip);
      const action = nextVerifyAction(trip);
      return (
        <button
          type="button"
          className="tsl-verify-cell"
          title={verifyActionLabel(action)}
          aria-label={`${verifyActionLabel(action)} for route ${routeLabel(trip)} at ${gtfsClock(trip.scheduled_start_seconds)}`}
          onClick={(event) => {
            event.stopPropagation();
            onVerify(trip.trip_id, action);
          }}
        >
          {verifiedContent(trip)}
        </button>
      );
    },
  },
  { key: "scheduled", header: "Scheduled", cellClassName: "tsl-clock", render: (trip) => gtfsClock(trip.scheduled_start_seconds) },
  { key: "actual", header: "Actual", cellClassName: "tsl-clock td-dim", render: (trip) => timeLabel(trip.actual_start_at) },
  { key: "delta", header: "Δ", label: "Delta", cellClassName: "tsl-clock", render: (trip) => deltaLabel(trip.start_delay_seconds) },
  {
    key: "status",
    header: "Status",
    render: (trip) => {
      const bucket = startBucket(trip);
      return <span className={`pill-sm ${PILL[bucket]}`}>{bucketLabel(bucket)}</span>;
    },
  },
  { key: "block", header: "Block", render: (trip) => trip.block_id ?? "—" },
  { key: "route", header: "Route", render: (trip) => routeLabel(trip) },
  { key: "origin", header: "Origin stop", render: (trip) => trip.origin_stop_name ?? trip.origin_stop_id ?? "—" },
  { key: "direction", header: "Direction", render: (trip) => trip.direction_label ?? "—" },
  ];
}

export function TripStartLogGrid({ trips, sortKey, sortDir, onSortChange, selectedTripId, onSelect, canVerify, onVerify }: Props) {
  const cols = useMemo(() => columns(canVerify, onVerify), [canVerify, onVerify]);
  return (
    <SortableTable
      ariaLabel="Dispatch log trips"
      className="tsl-table"
      columns={cols}
      rows={trips}
      rowKey={(trip) => trip.trip_id}
      sortKey={sortKey}
      sortDir={sortDir}
      onSortChange={(key, dir) => onSortChange(key as SortKey, dir)}
      selectedKey={selectedTripId}
      onSelect={(tripId) => onSelect(tripId)}
      rowClassName={(trip) => (trip.in_rotation ? undefined : "dim")}
    />
  );
}
