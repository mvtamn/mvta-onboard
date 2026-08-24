import type { EventVehiclePosition } from "@mvta/shared";

// Display formatting shared by the Event AVL vehicle tables and the
// vehicle map's popups. Kept separate from both so neither has to import
// the other just to format a vehicle.

export function minutesAgo(value: string | null): string {
  if (!value) return "—";
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "—";
  return `${Math.max(0, Math.floor((Date.now() - time) / 60_000))} min ago`;
}
export function cardinalHeading(heading: number | null, direction: string | null): string {
  if (heading !== null) {
    const normalized = ((heading % 360) + 360) % 360;
    if (normalized >= 315 || normalized < 45) return "NB";
    if (normalized < 135) return "EB";
    if (normalized < 225) return "SB";
    return "WB";
  }
  const raw = direction?.trim().toUpperCase();
  if (raw === "N" || raw === "NB") return "NB";
  if (raw === "S" || raw === "SB") return "SB";
  if (raw === "E" || raw === "EB" || raw === "O") return "EB";
  if (raw === "W" || raw === "WB" || raw === "I") return "WB";
  return "—";
}

export function displayOperator(value: string | null): string {
  if (!value) return "Operator unavailable";
  const withoutId = value.replace(/\s+-\d+\s*$/, "").trim();
  const [last, first] = withoutId.split(",").map((part) => part.trim());
  return first ? `${first} ${last}` : withoutId;
}

export function routeLabel(vehicle: EventVehiclePosition): string {
  if (vehicle.route === null) return "Route unavailable";
  return vehicle.route_label ? `${vehicle.route} · ${vehicle.route_label}` : String(vehicle.route);
}

export function routeDisplayLabel(vehicle: EventVehiclePosition): string {
  return vehicle.route === null ? "Route unavailable" : `Route ${routeLabel(vehicle)}`;
}

export function routeVehicleLabel(vehicle: EventVehiclePosition): string {
  return `${routeDisplayLabel(vehicle)} (Vehicle ${vehicle.vehicle_id})`;
}

export function monitoringAreaLabel(vehicle: EventVehiclePosition): string {
  return vehicle.zone_name && vehicle.zone_name !== vehicle.zone_status
    ? `${vehicle.zone_status} · ${vehicle.zone_name}`
    : vehicle.zone_status;
}

/** Escapes text interpolated into Atlas HtmlMarker/Popup content strings. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[char] ?? char);
}
