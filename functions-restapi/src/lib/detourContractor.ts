// Contractor notification (design B15): the fixed-route contractor is one
// more required audience on every fixed-route Detour, configured once in
// AppSettings (module 'detour') rather than typed into each intake.

export interface ContractorNotification {
  name: string | null;
  recipients: string[];
}

export function parseRecipients(value: string | null | undefined): string[] {
  return (value ?? "").split(/[,;\s]+/).map((item) => item.trim()).filter((item) => item.includes("@"));
}

export function contractorFromSettings(rows: Array<{ setting_key: string; setting_value: string }>): ContractorNotification {
  const name = rows.find((r) => r.setting_key === "contractor_name")?.setting_value.trim() || null;
  const recipients = parseRecipients(rows.find((r) => r.setting_key === "contractor_recipients")?.setting_value);
  return { name, recipients };
}

// The audiences a Detour must reach: what the intake named, plus the
// contractor when one is configured and the Detour touches fixed-route
// service. Mobility Detours never go to the fixed-route contractor. A
// Detour with no recorded service impact (entered directly on the Detours
// page) is treated as fixed-route, which is what that page records.
export function requiredAudiences(
  detour: { notification_audiences: string[]; service_impact?: string | null },
  contractor: ContractorNotification,
): string[] {
  const named = detour.notification_audiences.map((a) => a.trim()).filter(Boolean);
  if (!contractor.name || detour.service_impact === "mobility") return named;
  const already = named.some((a) => a.toLowerCase() === contractor.name!.toLowerCase());
  return already ? named : [...named, contractor.name];
}
