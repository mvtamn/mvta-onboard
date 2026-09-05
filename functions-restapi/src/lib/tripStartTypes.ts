// Vocabulary of the Dispatch Log's trip-start columns (migration 094). Kept
// apart from the poll and the endpoint so both, and the console's mirror in
// @mvta/shared, name the same values.
export type TripStartStatus = "on_time" | "late" | "missed" | "canceled" | "unknown";
export type TripStartActualSource = "trip_update" | "vehicle_position" | "avail";
