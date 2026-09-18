// Reading the configured fixed-route contractor, in one place: the list
// endpoint and the publish handler both need it to know which audiences a
// Detour must reach, and an absent table means no contractor is configured -
// which changes nothing rather than failing.
import { sql } from "../db";
import { contractorFromSettings, defaultAudiencesFromSettings, type ContractorNotification } from "../detourContractor";

/** The configured contractor and the default audience list, read together. */
export interface DetourNotificationSettings {
  contractor: ContractorNotification;
  defaultAudiences: string[];
}

const SETTING_KEYS = "'contractor_name', 'contractor_recipients', 'default_audiences'";

export async function readDetourNotificationSettings(pool: sql.ConnectionPool): Promise<DetourNotificationSettings> {
  try {
    const settings = await pool.request().query<{ setting_key: string; setting_value: string }>(
      `SELECT setting_key, setting_value FROM AppSettings WHERE module = 'detour' AND setting_key IN (${SETTING_KEYS})`,
    );
    return {
      contractor: contractorFromSettings(settings.recordset),
      defaultAudiences: defaultAudiencesFromSettings(settings.recordset),
    };
  } catch {
    return { contractor: { name: null, recipients: [] }, defaultAudiences: [] };
  }
}

export async function readContractorNotification(pool: sql.ConnectionPool): Promise<ContractorNotification> {
  return (await readDetourNotificationSettings(pool)).contractor;
}
