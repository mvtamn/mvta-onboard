import type { TripStartLogTrip } from "@mvta/shared";
import { SortableTable, type SortableColumn } from "../../../components/SortableTable.js";
import {
  bucketLabel,
  deltaLabel,
  gtfsClock,
  routeLabel,
  startBucket,
  timeLabel,
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
}

const PILL: Record<StartBucket, string> = {
  on_time: "pill-success",
  left_late: "pill-warning",
  late_over_5: "pill-danger",
  missed: "pill-danger",
  no_actual: "pill-muted",
  canceled: "pill-muted",
};

// The spreadsheet reading of the day and the default view (spec §4.3): the
// workbook's columns in the workbook's order, Verified pinned first, every
// column sortable, rows outside today's rotation dimmed but present. The
// Verified cell is read-only here; the one-click cycle through initials is
// step 6, once who records verifications is decided.
const COLUMNS: SortableColumn<TripStartLogTrip>[] = [
  {
    key: "verified",
    header: "Verified",
    sticky: true,
    render: (trip) =>
      trip.verification ? (
        <span className="tsl-initials" title={trip.verification.verified_by}>{trip.verification.verified_initials}</span>
      ) : trip.in_rotation ? (
        <span className="tsl-needs">Needs initials</span>
      ) : (
        <span className="td-dim">—</span>
      ),
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

export function TripStartLogGrid({ trips, sortKey, sortDir, onSortChange, selectedTripId, onSelect }: Props) {
  return (
    <SortableTable
      ariaLabel="Dispatch log trips"
      className="tsl-table"
      columns={COLUMNS}
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
