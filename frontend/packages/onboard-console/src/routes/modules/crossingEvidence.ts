import type { EventGeofenceCrossing } from "@mvta/shared";

export function crossingEvidenceLabel(crossing: Pick<EventGeofenceCrossing, "detection_method" | "source_report_from_at" | "source_report_to_at" | "source_displacement_meters">): string {
  const from = crossing.source_report_from_at ? new Date(crossing.source_report_from_at).getTime() : Number.NaN;
  const to = crossing.source_report_to_at ? new Date(crossing.source_report_to_at).getTime() : Number.NaN;
  const seconds = Math.round((to - from) / 1_000);
  const parts = [crossing.detection_method === "path_interpolated" ? "GPS path detected" : "Confirmed by two GPS reports"];
  if (Number.isFinite(seconds) && seconds >= 0) parts.push(`${seconds} sec between reports`);
  if (crossing.source_displacement_meters !== null && crossing.source_displacement_meters !== undefined) parts.push(`${Math.round(crossing.source_displacement_meters)} m moved`);
  return parts.join(" · ");
}
