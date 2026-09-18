import type { AppSettingRow } from "@mvta/shared";

// Which detour settings this environment actually has, and which of them a
// person has changed.
//
// The panel used to render nothing at all unless `contractor_name` existed,
// which meant one missing seed row hid every other field - on dev, migration
// 089 was never applied, so the default audiences field added in 1.5.255 could
// not be reached even though its own row (migration 133) was there. A field
// belongs to its own setting: show the ones that exist, say which are missing.
export const DETOUR_SETTING_KEYS = ["contractor_name", "contractor_recipients", "default_audiences"] as const;

export type DetourSettingKey = (typeof DETOUR_SETTING_KEYS)[number];

export const DETOUR_SETTING_MIGRATIONS: Record<DetourSettingKey, string> = {
  contractor_name: "089",
  contractor_recipients: "089",
  default_audiences: "133",
};

export function settingExists(settings: AppSettingRow[] | null, key: DetourSettingKey): boolean {
  return (settings ?? []).some((row) => row.setting_key === key);
}

export function settingValue(settings: AppSettingRow[] | null, key: DetourSettingKey): string {
  return (settings ?? []).find((row) => row.setting_key === key)?.setting_value ?? "";
}

/**
 * The keys whose value a person has changed, restricted to those this
 * environment holds. Saving a key with no row does nothing, so it is never
 * attempted.
 */
export function changedSettings(settings: AppSettingRow[] | null, edited: Record<DetourSettingKey, string>): DetourSettingKey[] {
  return DETOUR_SETTING_KEYS.filter((key) => settingExists(settings, key) && edited[key].trim() !== settingValue(settings, key));
}

/** The migrations this environment is missing, for a note naming them. */
export function missingSettingMigrations(settings: AppSettingRow[] | null): string[] {
  const missing = DETOUR_SETTING_KEYS.filter((key) => !settingExists(settings, key))
    .map((key) => DETOUR_SETTING_MIGRATIONS[key]);
  return [...new Set(missing)].sort();
}
