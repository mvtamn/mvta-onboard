import { useCallback, useEffect, useState } from "react";
import type { ContractorRecord, PerformanceAgreementRecord } from "@mvta/shared";
import { api } from "../config.js";
import { useAuth } from "../auth/AuthContext.js";
import "./modules/assessment/assessment.css";
import "./performanceStandards.css";

// Administration > Performance Assessment > Agreements.
//
// An Agreement is a contract TERM: it binds one contractor to a set of
// standards between two dates, and it is the thing assessment periods and the
// compliance candidate poll both refuse to run without. A contractor can have
// several over the years, so it is edited on its own rather than as a strip
// inside the standards catalog, where only the current one was ever visible.

const toInputDate = (value: string | null | undefined) => {
  const digits = value?.replace(/\D/g, "") ?? "";
  return digits.length === 8 ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}` : "";
};
const toServiceDate = (value: string) => value.replace(/-/g, "");

export function PerformanceAgreementsAdmin() {
  const { roles } = useAuth();
  const canEdit = roles.includes("OCC.Admin");
  const [agreements, setAgreements] = useState<PerformanceAgreementRecord[]>([]);
  const [contractors, setContractors] = useState<ContractorRecord[]>([]);
  const [selected, setSelected] = useState("");
  const [form, setForm] = useState({
    contractor_id: "", starts_on: "", ends_on: "", contract_number: "", exhibit_reference: "",
    validation_business_days: 5, retention_years: 7, is_active: true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [ready, setReady] = useState(true);

  const load = useCallback(async () => {
    try {
      setError("");
      const [agreementList, contractorList] = await Promise.all([api.getPerformanceAgreements(), api.getContractors()]);
      setAgreements(agreementList.agreements);
      setContractors(contractorList.contractors);
      setReady(agreementList.diagnostics.table_ready);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The Agreement list is unavailable.");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  function edit(agreement: PerformanceAgreementRecord | null) {
    setSelected(agreement?.id ?? "new");
    setForm({
      contractor_id: agreement?.contractor_id ?? contractors.find((c) => c.is_active)?.id ?? "",
      starts_on: toInputDate(agreement?.starts_on),
      ends_on: toInputDate(agreement?.ends_on),
      contract_number: agreement?.contract_number ?? "",
      exhibit_reference: agreement?.exhibit_reference ?? "",
      validation_business_days: agreement?.validation_business_days ?? 5,
      retention_years: agreement?.retention_years ?? 7,
      is_active: agreement?.is_active ?? true,
    });
  }
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm({ ...form, [key]: value });

  async function save() {
    setBusy(true); setError(""); setNotice("");
    try {
      await api.putPerformanceAgreement(selected === "new" ? crypto.randomUUID() : selected, {
        contractor_id: form.contractor_id,
        starts_on: toServiceDate(form.starts_on),
        ends_on: toServiceDate(form.ends_on),
        contract_number: form.contract_number.trim() || null,
        exhibit_reference: form.exhibit_reference.trim() || null,
        validation_business_days: form.validation_business_days,
        retention_years: form.retention_years,
        is_active: form.is_active,
      });
      await load();
      setNotice("Agreement saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The Agreement could not be saved.");
    } finally { setBusy(false); }
  }

  const editing = selected !== "";
  return <>
    <div className="panel-header">Agreements</div>
    <div className="panel-body standards-page">
      <div className="standards-head">
        <div>
          <span className="assessment-eyebrow">Performance assessment · Contract terms</span>
          <p>A term binding one contractor to a set of standards between two dates. Assessment periods and the compliance candidate poll both refuse to run without an active one.</p>
        </div>
        {canEdit && <button className="btn-primary" disabled={busy || !contractors.length} onClick={() => edit(null)}>New Agreement</button>}
      </div>

      {!canEdit && <div className="assessment-warning">You can read the Agreements. Changing one requires Administrator access.</div>}
      {!ready && <div className="assessment-warning">Migration 102 has not been applied to this database, so Agreements cannot be edited yet.</div>}
      {!contractors.length && <div className="assessment-warning">No contractor is on record, and an Agreement binds one. Add a contractor first.</div>}
      {error && <div className="assessment-error">{error}</div>}
      {notice && <div className="standards-notice">{notice}</div>}

      <div className="standards-workspace">
        <section className="standards-list" aria-label="Agreements">
          <div className="standards-list-meta"><span>{agreements.length} on record</span><span>{agreements.filter((a) => a.is_active).length} active</span></div>
          <ul className="standards-rows">
            {agreements.map((agreement) => (
              <li key={agreement.id}>
                <button
                  type="button"
                  className={`standards-row${agreement.id === selected ? " selected" : ""}`}
                  aria-current={agreement.id === selected}
                  onClick={() => edit(agreement)}
                >
                  <span className="standards-row-name">
                    <strong>{agreement.contractor_name ?? "Contractor"}</strong>
                    <small className="standards-row-description">
                      {toInputDate(agreement.starts_on)} to {toInputDate(agreement.ends_on)}
                      {agreement.exhibit_reference ? ` · ${agreement.exhibit_reference}` : ""}
                    </small>
                  </span>
                  <span className="standards-row-meta">
                    <span className={`standards-state ${agreement.is_active ? "scored" : "unassigned"}`}>
                      {agreement.is_active ? "Active" : "Ended"}
                    </span>
                    <small>{agreement.scored_standard_count ?? 0} standards scored</small>
                  </span>
                </button>
              </li>
            ))}
            {!agreements.length && <li className="standards-list-empty">
              No Agreement exists. Until one does, no assessment period can be opened and the compliance candidate poll fails on every run.
            </li>}
          </ul>
        </section>

        <aside className="standards-detail" aria-label="Agreement details">
          {!editing ? (
            <div className="standards-detail-empty">
              <strong>No Agreement selected</strong>
              <span>Pick one from the list, or create a new term.</span>
            </div>
          ) : <>
            <div className="standards-detail-head">
              <div><h3>{selected === "new" ? "New Agreement" : agreements.find((a) => a.id === selected)?.contractor_name ?? "Agreement"}</h3></div>
            </div>
            <div className="standards-tab-body">
              {/* Three groups: the term itself, what the contract calls things,
                  and the windows the process runs on. */}
              <fieldset className="standards-fieldset"><legend>Term</legend><div className="standards-grid">
                <label className="standards-wide"><span>Contractor</span>
                  <select value={form.contractor_id} disabled={!canEdit} onChange={(event) => set("contractor_id", event.target.value)}>
                    <option value="">Select a contractor</option>
                    {contractors.map((contractor) => <option key={contractor.id} value={contractor.id}>{contractor.name}</option>)}
                  </select>
                </label>
                <label><span>Term start</span>
                  <input type="date" value={form.starts_on} disabled={!canEdit} onChange={(event) => set("starts_on", event.target.value)} />
                </label>
                <label><span>Term end</span>
                  <input type="date" value={form.ends_on} disabled={!canEdit} onChange={(event) => set("ends_on", event.target.value)} />
                </label>
              </div></fieldset>
              <fieldset className="standards-fieldset"><legend>Contract references</legend><div className="standards-grid">
                <label><span>Contract number</span>
                  <input value={form.contract_number} disabled={!canEdit} placeholder="e.g. RFP 2025-07" onChange={(event) => set("contract_number", event.target.value)} />
                </label>
                <label><span>Standards exhibit</span>
                  <input value={form.exhibit_reference} disabled={!canEdit} placeholder="e.g. Attachment G v2" onChange={(event) => set("exhibit_reference", event.target.value)} />
                  <small>What this contract calls the document the standards come from. Cited wherever the console refers to it.</small>
                </label>
              </div></fieldset>
              <fieldset className="standards-fieldset"><legend>Process</legend><div className="standards-grid">
                <label><span>Validation window</span>
                  <span className="standards-measure"><input type="number" min={1} max={30} value={form.validation_business_days} disabled={!canEdit}
                    onChange={(event) => set("validation_business_days", Number(event.target.value))} /><span>business days</span></span>
                  <small>How long the contractor has to validate a shared draft.</small>
                </label>
                <label><span>Record retention</span>
                  <span className="standards-measure"><input type="number" min={1} max={25} value={form.retention_years} disabled={!canEdit}
                    onChange={(event) => set("retention_years", Number(event.target.value))} /><span>years</span></span>
                  <small>How long issued assessments and their evidence are kept.</small>
                </label>
                <label className="contractor-active standards-wide">
                  <input type="checkbox" checked={form.is_active} disabled={!canEdit} onChange={(event) => set("is_active", event.target.checked)} />
                  <span>Current Agreement for this contractor</span>
                </label>
              </div></fieldset>
              {selected === "new" && <div className="standards-hint">
                A new Agreement inherits every standard in the catalog, scored as the catalog scores it. Adjust the assignments afterwards under Standards.
              </div>}
              {canEdit && <button
                className="btn-primary"
                disabled={busy || !ready || !form.contractor_id || !form.starts_on || !form.ends_on}
                onClick={() => void save()}
              >{selected === "new" ? "Create Agreement" : "Save Agreement"}</button>}
            </div>
          </>}
        </aside>
      </div>
    </div>
  </>;
}
