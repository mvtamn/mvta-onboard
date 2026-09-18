// Which missed-trip detectors are running, and the scope they run over.
//
// This is part of the module's interface, not an implementation detail. A
// reader asking "is silent no-show detection on?" is asking the Missed-trip
// case module - but five of them used to answer it themselves by re-typing
// `process.env.X?.trim().toLowerCase() === "true"`, once per call site. That
// is one typo away from the console reporting a detector as paused while the
// poll is running it, and nothing would have failed.
//
// The env is a parameter, the way availClient.ts and gtfsRtReader.ts take it,
// so a test names the settings it wants instead of mutating a global.
//
// Promotion out of Shadow detection is deliberately NOT here:
// promotedDetectors() in classify.ts already has this shape, and it is
// threaded through the classification and its SQL as a parameter, so it stays
// beside the rules it governs.

export interface MissedTripDetectionSettings {
  /**
   * GTFS silent-no-show detection runs. Explicit cancellations are detected
   * either way - only the inference from absence is gated.
   */
  silentNoShowEnabled: boolean;
  /** The Spare missed-trip ingest and its evaluation run. */
  spareEnabled: boolean;
  /**
   * The Spare service ids the ingest is scoped to. Empty means unscoped, and
   * is not the same question as whether Spare is enabled.
   */
  spareServiceIds: ReadonlySet<string>;
  /**
   * The Spare `cancellation_fault` values that mean contractor fault,
   * lowercased for comparison. Empty leaves cancellations unknown rather than
   * auto-flagging them.
   */
  spareContractorFaultValues: ReadonlySet<string>;
}

// A detector is on only when its flag spells "true". Anything else - "1",
// "yes", "TRUE " with a stray space is fine, but "enabled" is not - leaves it
// off. That is the reading every call site has always had, and the safe way
// round: a misspelt flag pauses a detector rather than starting one nobody
// meant to start.
function flag(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

function list(value: string | undefined, lowercase: boolean): ReadonlySet<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((entry) => (lowercase ? entry.trim().toLowerCase() : entry.trim()))
      .filter(Boolean),
  );
}

export function missedTripDetectionSettings(env: NodeJS.ProcessEnv = process.env): MissedTripDetectionSettings {
  return {
    silentNoShowEnabled: flag(env.GTFS_SILENT_NO_SHOW_ENABLED),
    spareEnabled: flag(env.SPARE_MISSED_TRIPS_ENABLED),
    // Service ids are matched as Spare spells them; fault values are compared
    // case-insensitively, as they always have been.
    spareServiceIds: list(env.SPARE_MISSED_TRIP_SERVICE_IDS, false),
    spareContractorFaultValues: list(env.SPARE_CONTRACTOR_FAULT_VALUES, true),
  };
}
