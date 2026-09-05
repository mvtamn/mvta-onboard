// The Dispatch Log as a workbook again (plans/dispatch-log-spec.md §4.2,
// GET /trip-start-log/export): the columns the OCS desk kept by hand, in
// their order, followed by what OnBoard adds. Excel-friendly on purpose - a
// UTF-8 byte-order mark so stop names survive, CRLF line ends, and every
// cell quoted when it needs to be.
import type { TripStartLogTrip } from "./tripStartLogRead";

export const TRIP_START_LOG_CSV_HEADERS = [
  // The workbook's columns, in the workbook's order.
  "Verified",
  "Day of Week",
  "Start Time",
  "Block",
  "Route",
  "Origin Stop Name",
  "Direction",
  // What OnBoard adds.
  "On Rotation",
  "Observation",
  "Verified At (UTC)",
  "Scheduled At (UTC)",
  "Actual At (UTC)",
  "Actual Source",
  "Delta (min)",
  "Start Status",
  "Service Date",
  "Trip Id",
] as const;

const DAY_LABEL: Record<string, string> = {
  monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday", thursday: "Thursday",
  friday: "Friday", saturday: "Saturday", sunday: "Sunday",
};

/** GTFS seconds as the clock the schedule prints; past-midnight trips keep "25:10". */
export function gtfsClock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function tripStartLogCsvRow(trip: TripStartLogTrip): string[] {
  return [
    trip.verification?.verified_initials ?? "",
    trip.rotation_day ? DAY_LABEL[trip.rotation_day] ?? trip.rotation_day : "",
    gtfsClock(trip.scheduled_start_seconds),
    trip.block_id ?? "",
    trip.route_short_name?.trim() || trip.route_id,
    trip.origin_stop_name ?? trip.origin_stop_id ?? "",
    trip.direction_label ?? "",
    trip.in_rotation ? "Yes" : "No",
    trip.verification?.observation ?? "",
    trip.verification?.verified_at ?? "",
    trip.scheduled_start_at,
    trip.actual_start_at ?? "",
    trip.actual_start_source ?? "",
    trip.start_delay_seconds === null ? "" : String(Math.round(trip.start_delay_seconds / 60)),
    trip.start_status,
    trip.service_date,
    trip.trip_id,
  ];
}

export function tripStartLogToCsv(trips: readonly TripStartLogTrip[]): string {
  const lines = [
    TRIP_START_LOG_CSV_HEADERS.map(csvCell).join(","),
    ...trips.map((trip) => tripStartLogCsvRow(trip).map(csvCell).join(",")),
  ];
  return `﻿${lines.join("\r\n")}\r\n`;
}

export function tripStartLogCsvFilename(serviceDate: string): string {
  return `dispatch-log-${serviceDate}.csv`;
}
