import { useEffect, useState } from "react";
import { type OnDemandZoneVersion } from "@mvta/shared";
import { api } from "../config.js";

// Without an active zone version every pickup resolves against nothing, so the
// On-Demand monitor reports no risk however healthy Spare is. No GTFS-Flex URL
// is published for MVTA Connect, so the archive is downloaded from Spare by
// hand; this is where it goes in. The daily poller remains the preferred path
// the moment a URL exists.
export function OnDemandZoneGeometryAdmin() {
  const [versions, setVersions] = useState<OnDemandZoneVersion[] | null>(null);
  const [archive, setArchive] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function refresh() {
    setVersions((await api.listOnDemandZoneVersions()).versions);
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
      // The endpoint names the missing file or zone; a generic failure would
      // leave the operator guessing at an archive they can actually fix.
      setMessage(error instanceof Error && error.message ? error.message : failure);
    } finally {
      setBusy(false);
    }
  }

  const active = versions?.find((version) => version.is_active) ?? null;

  return <section className="service-standard-controls" aria-label="Operational zone geometry">
    <div className="service-standard-head">
      <div><span className="risk-eyebrow">Operational zones</span><h3>Zone geometry</h3></div>
      <small>{versions ? `${versions.length} imported version${versions.length === 1 ? "" : "s"}` : "Loading"}</small>
    </div>

    {versions && !active && <div className="dmx-state dmx-state-warning" role="status">
      <strong>No zone version is active.</strong> On-Demand pickups resolve against no boundary, so Service Risk &amp; Quality reports no risk regardless of what Spare is sending. Upload a GTFS-Flex archive to put geometry into force.
    </div>}

    <div className="zone-standard-editor">
      <strong>Upload a GTFS-Flex archive</strong>
      <p>
        Export the GTFS-Flex feed from Spare and upload the <code>.zip</code> here. It must contain
        {" "}<code>locations.geojson</code> and a <code>feed_info.txt</code> carrying <code>feed_version</code>, and must
        include every expected operational zone — an archive that has silently lost a zone is refused rather than
        shrinking the monitored service area. MVTA's fixed-route <code>google_transit.zip</code> is a different feed and
        will be rejected.
      </p>
      <label>
        Archive
        <input
          aria-label="GTFS-Flex archive"
          type="file"
          accept=".zip,application/zip"
          onChange={(event) => { setArchive(event.target.files?.[0] ?? null); setMessage(null); setFailed(false); }}
        />
      </label>
      <button
        className="btn-sm"
        disabled={busy || !archive}
        onClick={() => void run(async () => {
          const result = await api.uploadOnDemandZoneArchive(archive!);
          return `${result.message} Feed version ${result.feedVersion}, ${result.zoneCount} zone${result.zoneCount === 1 ? "" : "s"}: ${result.zones.join("; ")}.`;
        }, "That archive could not be imported.")}
      >{busy ? "Importing…" : "Upload and import"}</button>
    </div>

    {message && <small className={failed ? "service-standard-message dmx-state-warning" : "service-standard-message"} role="status">{message}</small>}

    {versions && versions.length > 0 && <div className="zone-standard-list">
      {versions.map((version) => <div className="zone-standard-row" key={version.id}>
        <label>
          <span>{version.feed_version} {version.is_active && <strong>· In force</strong>}</span>
          <small>
            {version.zone_count} zone{version.zone_count === 1 ? "" : "s"} · imported {new Date(version.imported_at).toLocaleString()} by {version.imported_by}
            {version.activated_at ? ` · activated ${new Date(version.activated_at).toLocaleString()} by ${version.activated_by ?? "unknown"}` : ""}
          </small>
        </label>
        {/* Activation swaps the boundaries a live monitor resolves against, so
            it stays a deliberate act rather than a side effect of uploading. */}
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
