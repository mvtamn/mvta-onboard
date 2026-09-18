import { describe, expect, it } from "vitest";
import type { AppSettingRow } from "@mvta/shared";
import { changedSettings, missingSettingMigrations, settingExists, settingValue } from "./detourSettings.js";

const row = (setting_key: string, setting_value: string): AppSettingRow =>
  ({ module: "detour", setting_key, setting_value } as AppSettingRow);

const edited = { contractor_name: "SST", contractor_recipients: "ops@example.com", default_audiences: "Operators" };

describe("detour settings", () => {
  it("reports each setting on its own, not on another's behalf", () => {
    // Dev on 2026-09-18: migration 133 applied, migration 089 never was.
    const dev = [row("default_audiences", "")];
    expect(settingExists(dev, "default_audiences")).toBe(true);
    expect(settingExists(dev, "contractor_name")).toBe(false);
    expect(settingValue(dev, "default_audiences")).toBe("");
  });

  it("saves only the keys this environment holds", () => {
    // Saving a key with no row updates nothing, so it is never attempted.
    expect(changedSettings([row("default_audiences", "")], edited)).toEqual(["default_audiences"]);
    expect(changedSettings(null, edited)).toEqual([]);
  });

  it("counts a value as changed only when it differs, ignoring surrounding space", () => {
    const settings = [row("contractor_name", "SST"), row("default_audiences", "Operators")];
    expect(changedSettings(settings, edited)).toEqual([]);
    expect(changedSettings(settings, { ...edited, default_audiences: " Operators " })).toEqual([]);
    expect(changedSettings(settings, { ...edited, default_audiences: "Operators, Dispatch" })).toEqual(["default_audiences"]);
  });

  it("names the migrations an environment is missing, once each", () => {
    expect(missingSettingMigrations([row("default_audiences", "")])).toEqual(["089"]);
    expect(missingSettingMigrations([])).toEqual(["089", "133"]);
    expect(missingSettingMigrations([row("contractor_name", ""), row("contractor_recipients", ""), row("default_audiences", "")])).toEqual([]);
  });
});
