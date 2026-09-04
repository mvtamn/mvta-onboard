// Column list for GET /detour-intake, assembled from schema-readiness
// flags. Kept pure so every combination of flags can be checked for SQL
// validity without a database: the previous inline template put a bare
// comma after each optional fragment, which parsed only when every
// migration had run and produced "i.created_at , , i.updated_by" otherwise.

export interface DetourIntakeSchemaFlags {
  duplicateLinksReady: boolean;   // migration 057
  completeFieldsReady: boolean;   // migration 056
  operationalFieldsReady: boolean; // migration 069
}

const BASE = [
  "i.id", "i.detection_source", "i.description", "i.location",
  "i.proposed_start_date", "i.proposed_end_date", "i.status",
  "i.decision_notes", "i.reviewed_by", "i.reviewed_at", "i.promoted_detour_id",
  "i.created_by", "i.created_at", "i.updated_by", "i.updated_at",
];
const DUPLICATE_LINKS = ["i.duplicate_of_intake_id", "i.duplicate_of_detour_id"];
const COMPLETE_FIELDS = [
  "i.service_impact", "i.service_area", "i.action_instructions", "i.proposed_fulfillment_mode",
  "i.notification_audiences", "i.notification_channels", "i.evidence_notes", "i.evidence_reference",
];
const OPERATIONAL_FIELDS = [
  "i.proposed_start_time", "i.proposed_end_time", "i.time_window_status",
  "i.affected_stops_and_stations", "i.operational_impacts", "i.confirmation_contact",
];

export function detourIntakeSelectColumns(flags: DetourIntakeSchemaFlags): string {
  return [
    ...BASE,
    ...(flags.duplicateLinksReady ? DUPLICATE_LINKS : []),
    ...(flags.completeFieldsReady ? COMPLETE_FIELDS : []),
    ...(flags.operationalFieldsReady ? OPERATIONAL_FIELDS : []),
  ].join(", ");
}
