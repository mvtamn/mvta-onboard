import type { Detour } from "@mvta/shared";

// The operational record Detour Intake collects and acceptance carries onto
// the authoritative Detour: operating window times, affected service,
// action instructions, required audiences/channels, and evidence. Rendered
// identically on Detours & Closures and Detour Reports so the two views
// never disagree about what the record says. Manual entries made directly
// on the Detours page never had these fields, so a record with nothing in
// any group renders nothing rather than a block of dashes.

const WINDOW_STATUS_LABELS = {
  pending: "Pending confirmation",
  estimated: "Estimated",
  confirmed: "Confirmed",
} as const;

function timeWindow(d: Detour): string | null {
  if (!d.start_time && !d.end_time && !d.time_window_status) return null;
  const clock = d.start_time || d.end_time ? `${d.start_time ?? "—"} → ${d.end_time ?? "—"}` : "Times not recorded";
  const status = d.time_window_status ? WINDOW_STATUS_LABELS[d.time_window_status] : null;
  return status ? `${clock} · ${status}` : clock;
}

export function hasOperationalRecord(d: Detour): boolean {
  return Boolean(
    d.location || d.action_instructions || d.notification_audiences?.length || d.notification_channels?.length ||
    d.service_impact || d.service_area || d.affected_stops_and_stations || d.operational_impacts ||
    d.confirmation_contact || d.evidence_notes || d.evidence_reference || timeWindow(d),
  );
}

export function DetourOperationalRecord({ detour: d }: { detour: Detour }) {
  if (!hasOperationalRecord(d)) return null;
  const window = timeWindow(d);
  return (
    <div className="subcard" style={{ marginTop: 8 }}>
      <b>Operational record</b>
      {d.location ? <p><b>Location:</b> {d.location}</p> : null}
      {d.action_instructions ? <p><b>Action instructions:</b> {d.action_instructions}</p> : null}
      {d.service_impact || d.service_area ? (
        <p className="td-dim">
          <b>Service impact:</b> {d.service_impact === "mobility" ? "On-demand / mobility" : d.service_impact === "fixed_route" ? "Fixed-route" : "—"}
          {d.service_area ? ` · ${d.service_area}` : ""}
        </p>
      ) : null}
      {window ? <p className="td-dim"><b>Operating window:</b> {window}</p> : null}
      {d.affected_stops_and_stations ? <p className="td-dim"><b>Affected stops and stations:</b> {d.affected_stops_and_stations}</p> : null}
      {d.operational_impacts ? <p className="td-dim"><b>Operational impacts:</b> {d.operational_impacts}</p> : null}
      {d.notification_audiences?.length || d.notification_channels?.length ? (
        <p className="td-dim">
          <b>Required communications:</b> {d.notification_audiences?.join(", ") || "audiences not recorded"}
          {" via "}{d.notification_channels?.join(", ") || "channels not recorded"}
        </p>
      ) : null}
      {d.confirmation_contact ? <p className="td-dim"><b>Confirmation contact:</b> {d.confirmation_contact}</p> : null}
      {d.evidence_notes || d.evidence_reference ? (
        <p className="td-dim">
          <b>Evidence:</b> {d.evidence_notes || "—"}
          {d.evidence_reference ? ` · Ref ${d.evidence_reference}` : ""}
        </p>
      ) : null}
    </div>
  );
}
