// Reading the configured fixed-route contractor, in one place: the list
// endpoint and the publish handler both need it to know which audiences a
// Detour must reach, and an absent table means no contractor is configured -
// which changes nothing rather than failing.
import { sql } from "../db";
import { contractorFromSettings, type ContractorNotification } from "../detourContractor";

export async function readContractorNotification(pool: sql.ConnectionPool): Promise<ContractorNotification> {
  try {
    const settings = await pool.request().query<{ setting_key: string; setting_value: string }>(
      "SELECT setting_key, setting_value FROM AppSettings WHERE module = 'detour' AND setting_key IN ('contractor_name', 'contractor_recipients')",
    );
    return contractorFromSettings(settings.recordset);
  } catch {
    return { name: null, recipients: [] };
  }
}
