import { useCallback, useEffect, useState } from "react";
import type { ContractorRecord } from "@mvta/shared";
import { api } from "../config.js";
import { useAuth } from "../auth/AuthContext.js";
import "./modules/assessment/assessment.css";
import "./performanceStandards.css";

// Administration > Performance Assessment > Contractors.
//
// A contractor is who MVTA has engaged. It outlives any one contract term, so
// it is edited on its own rather than inside an Agreement or a scorecard - the
// same record carries across a re-procurement, and its identity should not
// depend on which term happens to be open.
//
// This used to be a toggle inside the Performance Assessment module, which put
// the least frequent job in the module used most often, and hid it from anyone
// looking for it under Administration.

const toInputDate = (value: string | null | undefined) => {
  const digits = value?.replace(/\D/g, "") ?? "";
  return digits.length === 8 ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}` : "";
};
const toServiceDate = (value: string) => value.replace(/-/g, "");
const formatDate = (value: string | null | undefined) => toInputDate(value) || "—";

export function PerformanceContractorsAdmin() {
  const { roles } = useAuth();
  const canEdit = roles.includes("OCC.Admin");
  const [contractors, setContractors] = useState<ContractorRecord[]>([]);
  const [selected, setSelected] = useState("new");
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [ready, setReady] = useState(true);

  const load = useCallback(async () => {
    try {
      setError("");
      const result = await api.getContractors();
      setContractors(result.contractors);
      setReady(result.diagnostics.table_ready);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The contractor list is unavailable.");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  function edit(contractor: ContractorRecord | null) {
    setSelected(contractor?.id ?? "new");
    setName(contractor?.name ?? "");
    setStart(toInputDate(contractor?.contract_start_date));
    setEnd(toInputDate(contractor?.contract_end_date));
    setActive(contractor?.is_active ?? true);
  }

  async function save() {
    setBusy(true); setError(""); setNotice("");
    try {
      await api.putContractor(selected === "new" ? crypto.randomUUID() : selected, {
        name: name.trim(),
        contract_start_date: toServiceDate(start),
        contract_end_date: end ? toServiceDate(end) : null,
        is_active: active,
      });
      await load();
      setNotice(`${name.trim()} saved.`);
      edit(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The contractor could not be saved.");
    } finally { setBusy(false); }
  }

  return <>
    <div className="panel-header">Contractors</div>
    <div className="panel-body standards-page">
      <div className="standards-head">
        <div>
          <span className="assessment-eyebrow">Performance assessment · Who is engaged</span>
          <h2>Contractors</h2>
          <p>The operators MVTA has engaged. A contractor outlives any one contract term, so its record is kept here rather than inside an Agreement.</p>
        </div>
        {canEdit && <button className="btn-primary" disabled={busy} onClick={() => edit(null)}>New contractor</button>}
      </div>

      {!canEdit && <div className="assessment-warning">You can read the contractor list. Changing it requires Administrator access.</div>}
      {!ready && <div className="assessment-warning">The contractor table is not present in this database yet.</div>}
      {error && <div className="assessment-error">{error}</div>}
      {notice && <div className="standards-notice">{notice}</div>}

      <div className="standards-workspace">
        <section className="standards-list" aria-label="Contractors">
          <div className="standards-list-meta">{contractors.length} on record</div>
          <ul className="standards-rows">
            {contractors.map((contractor) => (
              <li key={contractor.id}>
                <button
                  type="button"
                  className={`standards-row${contractor.id === selected ? " selected" : ""}`}
                  aria-current={contractor.id === selected}
                  onClick={() => edit(contractor)}
                >
                  <span className="standards-row-name"><strong>{contractor.name}</strong></span>
                  <span className="standards-row-meta">
                    <span className={`standards-state ${contractor.is_active ? "scored" : "unassigned"}`}>
                      {contractor.is_active ? "Current" : "Historical"}
                    </span>
                    <small>{formatDate(contractor.contract_start_date)} – {contractor.contract_end_date ? formatDate(contractor.contract_end_date) : "ongoing"}</small>
                  </span>
                </button>
              </li>
            ))}
            {!contractors.length && <li className="standards-list-empty">
              No contractor is on record. Until one is, no Agreement can be created and no assessment period can be opened.
            </li>}
          </ul>
        </section>

        <aside className="standards-detail" aria-label="Contractor details">
          <div className="standards-detail-head">
            <div><h3>{selected === "new" ? "New contractor" : name || "Contractor"}</h3></div>
          </div>
          <div className="standards-tab-body">
            <div className="standards-grid">
              <label className="standards-wide"><span>Name</span>
                <input value={name} disabled={!canEdit} placeholder="Legal or operating name" onChange={(event) => setName(event.target.value)} />
              </label>
              <label><span>Engaged from</span>
                <input type="date" value={start} disabled={!canEdit} onChange={(event) => setStart(event.target.value)} />
              </label>
              <label><span>Engagement ended</span>
                <input type="date" value={end} disabled={!canEdit} onChange={(event) => setEnd(event.target.value)} />
                <small>Leave empty while the contractor is still engaged.</small>
              </label>
              <label className="contractor-active">
                <input type="checkbox" checked={active} disabled={!canEdit} onChange={(event) => setActive(event.target.checked)} />
                <span>Currently engaged</span>
              </label>
            </div>
            {canEdit && <button className="btn-primary" disabled={busy || !name.trim() || !start} onClick={() => void save()}>
              {selected === "new" ? "Add contractor" : "Save contractor"}
            </button>}
          </div>
        </aside>
      </div>
    </div>
  </>;
}
