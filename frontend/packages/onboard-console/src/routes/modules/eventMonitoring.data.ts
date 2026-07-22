// Mock vehicle pool for the Event Vehicle Monitoring module.
// TODO: replace with live GTFS-RT + MN 511 data; delay alerts should come from
// the SuggestedAlerts human-review queue (never auto-published).
export type VehicleStatus = "live" | "stale" | "offline";

export interface Vehicle {
  id: string;
  lot: string;
  status: VehicleStatus;
  delay: number | null;
  x: number | null;
  y: number | null;
  conf: "high" | "medium" | null;
  reason: string | null;
}

export const POOL: Vehicle[] = [
  { id: "MV-118", lot: "Lot A", status: "live", delay: 0, x: 260, y: 130, conf: null, reason: null },
  { id: "MV-142", lot: "Lot A", status: "live", delay: 14, x: 190, y: 70, conf: "high", reason: "Heavy congestion on the Lot A connector ramp" },
  { id: "MV-207", lot: "Lot C", status: "live", delay: 0, x: 660, y: 120, conf: null, reason: null },
  { id: "MV-233", lot: "Lot C", status: "stale", delay: 6, x: 700, y: 60, conf: "medium", reason: "Speed 20% below normal for this segment" },
  { id: "MV-119", lot: "Lot A", status: "offline", delay: null, x: null, y: null, conf: null, reason: null },
  { id: "MV-260", lot: "Lot C", status: "live", delay: 0, x: 540, y: 165, conf: null, reason: null },
];

export const INITIAL_MONITORED = ["MV-118", "MV-142", "MV-207", "MV-233"];

export function statusColor(v: Vehicle): string {
  if (v.status === "offline") return "#8a8a86";
  if (v.delay && v.delay >= 10) return "#b5442a";
  if (v.status === "stale") return "#a86a10";
  return "#2e7d4f";
}

export function statusLabel(v: Vehicle): string {
  if (v.status === "offline") return "Offline";
  if (v.delay && v.delay >= 10) return `Delayed ${v.delay} min`;
  if (v.status === "stale") return "Stale signal";
  return "On time";
}
