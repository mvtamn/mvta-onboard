// Contractor notification (design B15): the fixed-route contractor is one
// more required audience on every fixed-route Detour, configured once in
// AppSettings (module 'detour') rather than typed into each intake.

export interface ContractorNotification {
  name: string | null;
  recipients: string[];
}

/**
 * The audiences every Detour must reach unless its own record names some.
 *
 * Intake asks whoever types a Detour who must hear about it, which works for
 * the two Detours a month that arrive that way and not at all for the ten that
 * arrive from the Avail sync with no audiences at all - those read "needs
 * communication" for ever with nowhere to send. A default list, configured once
 * beside the contractor, gives a feed Detour the same obligations as a typed
 * one (plans/detour-communications-implementation-plan.md, increment 2).
 */
export function defaultAudiencesFromSettings(rows: Array<{ setting_key: string; setting_value: string }>): string[] {
  return parseAudienceList(rows.find((r) => r.setting_key === "default_audiences")?.setting_value);
}

/** A comma or semicolon separated list, as an administrator types it. */
export function parseAudienceList(value: string | null | undefined): string[] {
  return (value ?? "").split(/[,;\n]/).map((item) => item.trim()).filter(Boolean);
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
  defaults: string[] = [],
): string[] {
  const own = detour.notification_audiences.map((a) => a.trim()).filter(Boolean);
  // A record that names its audiences is taken at its word - a Detour entered
  // for one garage does not acquire the whole default list. The defaults are
  // for the records that name none, which today is every Detour from the feed.
  const named = own.length > 0 ? own : defaults.map((a) => a.trim()).filter(Boolean);
  if (!contractor.name || detour.service_impact === "mobility") return named;
  const already = named.some((a) => a.toLowerCase() === contractor.name!.toLowerCase());
  return already ? named : [...named, contractor.name];
}
