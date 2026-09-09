import { useCallback, useEffect, useState } from "react";
import type { ReferenceValue } from "@mvta/shared";
import { api } from "../config.js";
import { useAuth } from "../auth/AuthContext.js";
import "./modules/assessment/assessment.css";
import "./performanceStandards.css";

// Administration > Performance Assessment > Lists.
//
// The vocabulary behind every picker in the configurator. It was a toggle on
// the standards page, which put a cross-cutting concern inside one of the
// things it cuts across: units and conditions belong to the whole catalog, not
// to whichever standard happened to be selected.

const DOMAIN_TITLES: { domain: string; title: string; blurb: string }[] = [
  { domain: "unit", title: "Units", blurb: "What a standard is measured in." },
  { domain: "category", title: "Categories", blurb: "Which part of the contract a standard belongs to. Groups the catalog and a scorecard; never read when a month is scored." },
  { domain: "priority", title: "Priorities", blurb: "How a standard is ranked for attention." },
  { domain: "condition_code", title: "Conditions", blurb: "Markers that narrow a penalty band to some occurrences." },
  { domain: "source_system", title: "Source systems", blurb: "Where a transcribed figure is read from." },
  { domain: "responsible_team", title: "Responsible teams", blurb: "The team accountable for a standard." },
  { domain: "assigned_to", title: "Assigned owners", blurb: "The person who owns a standard month to month, and who is chased when a figure is missing." },
  { domain: "tier_label", title: "Tier labels", blurb: "What each band of the ladder is called, and which outranks which." },
  { domain: "penalty_basis", title: "Charge bases", blurb: "What a penalty amount is multiplied by." },
  { domain: "measurement_source", title: "Measurement sources", blurb: "The four ways a month's figure arrives." },
  { domain: "standard_type", title: "Standard types", blurb: "Counted events, or a monthly value." },
  { domain: "direction", title: "Directions", blurb: "Which way is good performance." },
];

// The lists behind every picker.
//
// Two classes, and the difference is visible rather than mysterious: an owned
// list takes new values; a system list is what the scoring engine branches on,
// so its labels and order are MVTA's and its values are not. computePenalty
// switches exhaustively over the charge bases - one invented here would have no
// arithmetic and the month would fail to compute. The server refuses it too;
// this only makes the refusal predictable.
function ReferenceValuesPanel({ values, busy, canEdit, onSave, onDelete }: {
  values: ReferenceValue[]; busy: boolean; canEdit: boolean;
  onSave: (id: string, input: { domain: string; value: string; label: string; description?: string | null; sort_order?: number; severity_order?: number | null; is_active?: boolean; principal_upn?: string | null }) => void;
  onDelete: (value: ReferenceValue) => void;
}) {
  const [domain, setDomain] = useState("unit");
  const [newValue, setNewValue] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const rows = values.filter((row) => row.domain === domain)
    .slice().sort((left, right) => left.sort_order - right.sort_order || left.label.localeCompare(right.label));
  const meta = DOMAIN_TITLES.find((entry) => entry.domain === domain);
  const systemList = rows.some((row) => row.is_system);

  if (!values.length) {
    return <div className="assessment-warning">Migration 105 has not been applied to this database, so the pickers are using their built-in lists and there is nothing to edit yet.</div>;
  }

  const isSystem = (entry: string) => values.some((row) => row.domain === entry && row.is_system);
  // The same master-detail workspace as Contractors, Agreements and Standards:
  // the lists down the left, the one being edited on the right.
  return <div className="standards-workspace lists-workspace">
    <section className="standards-list" aria-label="Lists">
      <div className="standards-list-meta"><span>{DOMAIN_TITLES.length} lists</span><span>{DOMAIN_TITLES.filter((entry) => isSystem(entry.domain)).length} system</span></div>
      <ul className="standards-rows lists-rows">
        {DOMAIN_TITLES.map((entry) => (
          <li key={entry.domain}>
            <button type="button" className={`standards-row${entry.domain === domain ? " selected" : ""}`} aria-current={entry.domain === domain} onClick={() => setDomain(entry.domain)}>
              <span><strong>{entry.title}</strong>{isSystem(entry.domain) && <small>System list</small>}</span>
              <span className="count">{values.filter((row) => row.domain === entry.domain).length}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
    <aside className="standards-detail" aria-label={meta?.title}>
    <div className="standards-detail-head">
      <div>
        <h3>{meta?.title}</h3>
        <small className="standards-hint">{meta?.blurb}</small>
      </div>
      <span className={`standards-state ${systemList ? "dormant" : "scored"}`}>{systemList ? "System list" : "Owned list"}</span>
    </div>
    <div className="standards-tab-body">
    {systemList && <div className="standards-hint">
      The scoring engine branches on these values, so they can be renamed, reordered and retired but not added to or deleted. The label is what the console shows; the value is what the code matches on.
    </div>}

    <div className="assessment-table-wrap">
      <table className="data lists-table">
        <thead><tr>
          <th>Label</th><th>Value</th><th>Order</th>
          {domain === "assigned_to" && <th>Account</th>}
            {domain === "tier_label" && <th>Outranks</th>}
          <th>In use</th><th />
        </tr></thead>
        <tbody>
          {rows.map((row) => <tr key={row.id}>
            <td>
              <input
                aria-label={`Label for ${row.value}`} defaultValue={row.label} disabled={!canEdit || busy}
                onBlur={(event) => {
                  const label = event.target.value.trim();
                  if (label && label !== row.label) onSave(row.id, { ...row, label });
                }}
              />
              {row.description && <small>{row.description}</small>}
            </td>
            <td><code className="mono-ref">{row.value}</code></td>
            <td>
              <input
                type="number" min={0} aria-label={`Order for ${row.value}`} defaultValue={row.sort_order}
                disabled={!canEdit || busy}
                onBlur={(event) => {
                  const sort = Number(event.target.value);
                  if (Number.isInteger(sort) && sort !== row.sort_order) onSave(row.id, { ...row, sort_order: sort });
                }}
              />
            </td>
            {domain === "assigned_to" && <td>
              {/* The account behind the name, so the month-end open-inputs list
                  can be shown to the person it belongs to. Empty for a team. */}
              <input
                type="email" aria-label={`Account for ${row.value}`} defaultValue={row.principal_upn ?? ""} placeholder="name@mvta.us"
                disabled={!canEdit || busy}
                onBlur={(event) => {
                  const upn = event.target.value.trim().toLowerCase();
                  if (upn !== (row.principal_upn ?? "")) onSave(row.id, { ...row, principal_upn: upn || null });
                }}
              />
            </td>}
            {domain === "tier_label" && <td>
              {/* Ranking, not money: which band wins when several match one
                  observation. Safe to edit, and snapshotted per period so a
                  reordering cannot restate a finalized month. */}
              <input
                type="number" min={0} aria-label={`Rank for ${row.value}`} defaultValue={row.severity_order ?? 0}
                disabled={!canEdit || busy}
                onBlur={(event) => {
                  const severity = Number(event.target.value);
                  if (Number.isInteger(severity) && severity !== row.severity_order) onSave(row.id, { ...row, severity_order: severity });
                }}
              />
            </td>}
            <td>
              <label className="standards-toggle">
                <input
                  type="checkbox" checked={row.is_active} disabled={!canEdit || busy}
                  onChange={(event) => onSave(row.id, { ...row, is_active: event.target.checked })}
                />
                <span>{row.is_active ? "Offered" : "Retired"}</span>
              </label>
            </td>
            <td>
              {canEdit && !row.is_system && <button className="assessment-link-button" disabled={busy} onClick={() => onDelete(row)}>Delete</button>}
            </td>
          </tr>)}
        </tbody>
      </table>
    </div>

    {canEdit && !systemList && <div className="standards-new-value">
      <label><span>New value</span>
        <input value={newValue} placeholder="stored value" onChange={(event) => setNewValue(event.target.value)} />
      </label>
      <label><span>Label</span>
        <input value={newLabel} placeholder="what the console shows" onChange={(event) => setNewLabel(event.target.value)} />
      </label>
      <button
        className="btn-primary"
        disabled={busy || !newValue.trim() || !newLabel.trim()}
        onClick={() => {
          onSave(crypto.randomUUID(), {
            domain, value: newValue.trim(), label: newLabel.trim(),
            sort_order: rows.length + 1, is_active: true,
          });
          setNewValue(""); setNewLabel("");
        }}
      >Add to {meta?.title.toLowerCase()}</button>
    </div>}
    <p className="standards-hint">A label change shows everywhere the value appears from the next load. Retiring a value hides it from pickers without touching the standards already using it.</p>
    </div>
    </aside>
  </div>;
}


export function PerformanceListsAdmin() {
  const { roles } = useAuth();
  const canEdit = roles.includes("OCC.Admin");
  const [values, setValues] = useState<ReferenceValue[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      setError("");
      const result = await api.getReferenceValues();
      setValues(result.values);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The lists are unavailable.");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function run(work: () => Promise<unknown>, success: string) {
    setBusy(true); setError(""); setNotice("");
    try { await work(); await load(); setNotice(success); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "The change could not be saved."); }
    finally { setBusy(false); }
  }

  return <>
    <div className="panel-header">Lists</div>
    <div className="panel-body standards-page">
      <div className="standards-head">
        <div>
          <span className="assessment-eyebrow">Performance assessment · Vocabulary</span>
          <p>Units, priorities, conditions, source systems and the rest. Rename them in the contract’s own words, reorder them, and hide the ones MVTA does not use.</p>
        </div>
      </div>

      {!canEdit && <div className="assessment-warning">You can read the lists. Changing one requires Administrator access.</div>}
      {error && <div className="assessment-error">{error}</div>}
      {notice && <div className="standards-notice">{notice}</div>}

      <ReferenceValuesPanel
        values={values} busy={busy} canEdit={canEdit}
        onSave={(id, input) => void run(() => api.putReferenceValue(id, input), `${input.label} saved.`)}
        onDelete={(value) => void run(() => api.deleteReferenceValue(value.id), `${value.label} deleted.`)}
      />
    </div>
  </>;
}
