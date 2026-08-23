export type EventGeofencePurpose = string;
export type EventZoneDerivedVehicleStatus = "At venue" | "Staged" | "In corridor" | "In zone" | "Outside monitored zones";

export interface VehicleZonePosition { latitude: number; longitude: number; }
export interface VehicleZoneFence { id: string; name: string; purpose?: EventGeofencePurpose; polygon: string; is_active: boolean; }
export interface VehicleZoneResult { zone_id: string | null; zone_name: string | null; zone_purpose: EventGeofencePurpose | null; zone_status: EventZoneDerivedVehicleStatus; }

const PRECEDENCE = ["venue", "staging", "corridor", "other"];
const STATUS: Record<string, EventZoneDerivedVehicleStatus> = { venue: "At venue", staging: "Staged", corridor: "In corridor", other: "In zone" };

export function classifyVehicleZone(position: VehicleZonePosition, fences: VehicleZoneFence[], contains: (polygon: string, point: [number, number]) => boolean): VehicleZoneResult {
  const matches = fences.filter((fence) => fence.is_active && (() => { try { return contains(fence.polygon, [position.longitude, position.latitude]); } catch { return false; } })());
  const precedenceFor = (purpose: string) => { const rank = PRECEDENCE.indexOf(purpose); return rank === -1 ? PRECEDENCE.length : rank; };
  const winner = matches.sort((a, b) => precedenceFor(a.purpose ?? "other") - precedenceFor(b.purpose ?? "other"))[0];
  if (!winner) return { zone_id: null, zone_name: null, zone_purpose: null, zone_status: "Outside monitored zones" };
  const purpose = winner.purpose ?? "other";
  return { zone_id: winner.id, zone_name: winner.name, zone_purpose: purpose, zone_status: STATUS[purpose] ?? "In zone" };
}
