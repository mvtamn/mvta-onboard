import { useEffect, useState } from "react";
import { type OnDemandZoneFeedStatus, type OnDemandZoneVersion } from "@mvta/shared";
import { api } from "../config.js";

// Without an active zone version every pickup resolves against nothing, so the
// On-Demand monitor reports no risk however healthy Spare is. Zones are pulled
// daily from the GTFS-Flex feed Spare generates for MVTA (ADR 0031); nothing is
// uploaded here any more. The panel says how that feed is doing, lists the
// versions it has produced, and is where a changed version is put into force.
export function OnDemandZoneGeometryAdmin() {
  const [feed, setFeed] = useState<OnDemandZoneFeedStatus | null>(null);
  const [versions, setVersions] = useState<OnDemandZoneVersion[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function refresh() {
    const result = await api.listOnDemandZoneVersions();
    setFeed(result.feed);
    setVersions(result.versions);
  }

  useEffect(() => {
    void refresh().catch(() => { setFailed(true); setMessage("Imported zone versions are unavailable."); });
  }, []);

  async function run(work: () => Promise<string>, failure: string) {
    setBusy(true);
    setFailed(false);
    setMessage(null);
    try {
      const outcome = await work();
      await refresh();
      setMessage(outcome);
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error && error.message ? error.message : failure);
    } finally {
      setBusy(false);
    }
  }

  const active = versions?.find((version) => version.is_active) ?? null;
  // The version Spare most recently published is the one last seen, active or not.
  const latest = versions
    ? [...versions].sort((a, b) => (b.last_seen_at ?? "").localeCompare(a.last_seen_at ?? ""))[0] ?? null
    : null;
  const unmonitored = latest?.unmonitored_locations ?? [];

  return <section className="service-standard-controls" aria-label="Operational zone geometry">
    <div className="service-standard-head">
      <div><span className="risk-eyebrow">Operational zones</span><h3>Zone geometry</h3></div>
      <small>{versions ? `${versions.length} imported version${versions.length === 1 ? "" : "s"}` : "Loading"}</small>
    </div>

    {feed && <div className="zone-standard-editor" role="group" aria-label="Zone feed">
      <strong>Source</strong>
      <p>Pulled daily from the GTFS-Flex feed Spare generates for MVTA. A changed set of zones is imported here to be activated; unchanged zones are left as they are.</p>
      {!feed.configured
        ? <p className="dmx-state dmx-state-warning">The zone feed address is not configured, so no zones are being pulled.</p>
        : <>
          <small>
            Last checked {feed.last_checked_at
              ? `${new Date(feed.last_checked_at).toLocaleString()} · ${feed.last_check_succeeded ? "succeeded" : `failed: ${feed.last_failure_reason ?? "no reason recorded"}`}`
              : "never"}
          </small>
          {feed.next_check_at && <small>Next check {new Date(feed.next_check_at).toLocaleString()}</small>}
        </>}
      {unmonitored.length > 0 && <small>
        Also published by Spare, not monitored: {unmonitored.map((location) => location.name ?? location.id).join("; ")}
      </small>}
    </div>}

    {versions && !active && <div className="dmx-state dmx-state-warning" role="status">
      <strong>No zone version is active.</strong> On-Demand pickups resolve against no boundary, so Service Risk &amp; Quality reports no risk regardless of what Spare is sending. The first zones pulled from Spare go into force on their own.
    </div>}

    {message && <small className={failed ? "service-standard-message dmx-state-warning" : "service-standard-message"} role="status">{message}</small>}

    {versions && versions.length > 0 && <div className="zone-standard-list">
      {versions.map((version) => <div className="zone-standard-row" key={version.id}>
        <label>
          <span>{version.feed_version} {version.is_active && <strong>· In force</strong>}</span>
          <small>
            {version.zone_count} zone{version.zone_count === 1 ? "" : "s"} · imported {new Date(version.imported_at).toLocaleString()} by {version.imported_by}
            {version.activated_at ? ` · activated ${new Date(version.activated_at).toLocaleString()} by ${version.activated_by ?? "unknown"}` : ""}
            {version.last_seen_at ? ` · last published by Spare ${new Date(version.last_seen_at).toLocaleString()}` : ""}
          </small>
        </label>
        {/* Activation swaps the boundaries a live monitor resolves against, so
            it stays a deliberate act rather than a side effect of a pull. */}
        {!version.is_active && <button
          className="btn-sm"
          disabled={busy || version.zone_count === 0}
          title={version.zone_count === 0 ? "This version has no zones; activating it would leave the monitor without geometry." : undefined}
          onClick={() => void run(async () => {
            const result = await api.activateOnDemandZoneVersion(version.id);
            return result.activated ? `Feed version ${version.feed_version} is now in force.` : result.message ?? "That version is already active.";
          }, "That version could not be activated.")}
        >Activate</button>}
      </div>)}
    </div>}
  </section>;
}
