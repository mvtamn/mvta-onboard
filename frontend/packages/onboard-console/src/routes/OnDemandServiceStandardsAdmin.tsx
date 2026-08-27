import { useEffect, useState } from "react";
import { type OnDemandServiceStandardAudit, type OnDemandServiceStandardPolicy } from "@mvta/shared";
import { api } from "../config.js";
import "./modules/serviceRisk.css";

export function OnDemandServiceStandardsAdmin() {
  const [policy, setPolicy] = useState<OnDemandServiceStandardPolicy | null>(null);
  const [audit, setAudit] = useState<OnDemandServiceStandardAudit[]>([]);
  const [defaultMinutes, setDefaultMinutes] = useState(25);
  const [zoneId, setZoneId] = useState("");
  const [minutes, setMinutes] = useState(25);
  const [reason, setReason] = useState("");
  const [effectiveAt, setEffectiveAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    const [nextPolicy, nextAudit] = await Promise.all([
      api.getOnDemandServiceStandards(),
      api.getOnDemandServiceStandardAudit(),
    ]);
    setPolicy(nextPolicy);
    setAudit(nextAudit.audit);
    setDefaultMinutes(nextPolicy.default_minutes);
    setZoneId((current) => current || nextPolicy.zones[0]?.zone_id || "");
    setMessage(null);
  }

  useEffect(() => { void refresh().catch(() => setMessage("The saved service standard is unavailable.")); }, []);

  async function save(work: () => Promise<unknown>, failure: string) {
    setSaving(true);
    try { await work(); await refresh(); } catch { setMessage(failure); } finally { setSaving(false); }
  }

  return <div className="risk-module">
    <div className="risk-module-head">
      <div><span className="risk-eyebrow">Administration · MVTA Connect</span><h2>Service Standards</h2><p>Set the all-zones pickup standard and time-bounded operational-zone exceptions.</p></div>
      <div className="standard-chip"><span>All-zones default</span><strong>{defaultMinutes} min</strong></div>
    </div>
    <section className="service-standard-controls" aria-label="Service standard controls">
      <div className="service-standard-head"><div><span className="risk-eyebrow">Current policy</span><h3>Service standard</h3></div><small>{policy ? "Saved policy" : "Loading"}</small></div>
      <label className="service-standard-default" htmlFor="all-zones-standard"><span>All-zones default</span><strong>{defaultMinutes} min</strong></label>
      <input id="all-zones-standard" aria-label="All-zones service standard" type="range" min={10} max={60} step={1} value={defaultMinutes} onChange={(event) => setDefaultMinutes(Number(event.target.value))} />
      <button className="btn-sm" disabled={saving} onClick={() => void save(() => api.updateOnDemandServiceStandard(defaultMinutes), "The all-zones standard could not be saved.")}>Save all-zones default</button>
      <div className="zone-standard-list">
        {(policy?.zones ?? []).map((zone) => <div className="zone-standard-row" key={zone.zone_id}>
          <label><span>{zone.name}</span><small>{zone.override_active ? `${zone.minutes} min until ${new Date(zone.expires_at!).toLocaleString()}` : "Uses all-zones default"}</small></label>
          <strong>{zone.override_active ? `${zone.minutes} min` : `${defaultMinutes} min`}</strong>
          {zone.override_active && <button className="btn-sm" disabled={saving} onClick={() => void save(() => api.removeOnDemandZoneServiceStandard(zone.zone_id), "The Zone override could not be removed.")}>Use default</button>}
        </div>)}
      </div>
      {policy && <div className="zone-standard-editor">
        <strong>Zone override</strong>
        <select aria-label="Operational Zone" value={zoneId} onChange={(event) => setZoneId(event.target.value)}>{policy.zones.map((zone) => <option key={zone.zone_id} value={zone.zone_id}>{zone.name}</option>)}</select>
        <label>Minutes <input aria-label="Zone override minutes" type="number" min={10} max={60} value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} /></label>
        <label>Reason <input aria-label="Zone override reason" value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        <label>Effective <input aria-label="Zone override effective time" type="datetime-local" value={effectiveAt} onChange={(event) => setEffectiveAt(event.target.value)} /></label>
        <label>Expires <input aria-label="Zone override expiry time" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label>
        <button className="btn-sm" disabled={saving || !zoneId} onClick={() => void save(async () => {
          await api.updateOnDemandZoneServiceStandard(zoneId, { minutes, reason, effective_at: new Date(effectiveAt).toISOString(), expires_at: new Date(expiresAt).toISOString() });
          setReason("");
        }, "The Zone override could not be saved. Include a reason and a valid effective period.")}>Save Zone override</button>
      </div>}
      {message && <small className="service-standard-message">{message}</small>}
      {audit.length > 0 && <div className="service-standard-audit"><strong>Recent policy history</strong>{audit.slice(0, 5).map((entry) => <small key={`${entry.occurred_at}-${entry.action}`}>{entry.action.replaceAll("_", " ")} · {new Date(entry.occurred_at).toLocaleString()} · {entry.occurred_by ?? "system"}</small>)}</div>}
    </section>
  </div>;
}
