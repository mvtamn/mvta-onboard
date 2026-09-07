import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AgreementStandardAssignment, AgreementStandardInput, ContractorPerformanceStandard, ContractorRecord,
  ContractorStandardTier, PerformanceAgreementRecord, PerformanceStandardInput,
  StandardTierInput,
} from "@mvta/shared";
import {
  BAND_RANGES, bandRangeOf, boundsForRange, boundToInput, CATALOG_UNITS, describeBand,
  inputToBound, isRatioUnit, ladderWarnings, PENALTY_BASES, qualifierLabel,
  TIER_LABELS, unitNoun, type BandRange,
} from "./performanceStandardsVocabulary.js";
import { api } from "../config.js";
import { useAuth } from "../auth/AuthContext.js";
import "./modules/assessment/assessment.css";
import "./performanceStandards.css";

// Administration > Performance Standards.
//
// The Attachment G catalog and its tier ladders, and which of them each
// contract term actually holds a contractor to. This lives in Administration
// rather than inside the Performance Assessment module because it is contract
// governance - rare, audited, admin-only - while the assessment module is the
// monthly operational workspace that consumes what is set here. The module
// keeps a read-only view of the same catalog.
//
// Attachment G reserves the right to amend a threshold by amendment, so every
// band on this page is data. Editing one writes a new date-effective ladder
// version; periods already opened scored against their own snapshot and do not
// move.

const toInputDate = (value: string | null | undefined) => {
  const digits = value?.replace(/\D/g, "") ?? "";
  return digits.length === 8 ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}` : "";
};
const toServiceDate = (value: string) => value.replace(/-/g, "");
const today = () => toServiceDate(new Date().toISOString().slice(0, 10));

const EMPTY_STANDARD: PerformanceStandardInput = {
  code: "", name: "", description: "", standard_type: "occurrence", priority: "Medium",
  is_scored: true, is_safety_critical: false, direction: "lower_is_better", unit_label: "occurrences",
  measurement_source: "manual", resolver_key: "", data_source_note: "", responsible_team: "",
  assigned_to: "", cap_rule_note: "", sort_order: 0, effective_start_date: today(), effective_end_date: null,
};

function standardToInput(standard: ContractorPerformanceStandard): PerformanceStandardInput {
  return {
    code: standard.code, name: standard.name, description: standard.description ?? "",
    standard_type: standard.standard_type, priority: standard.priority,
    is_scored: standard.is_scored, is_safety_critical: standard.is_safety_critical ?? false,
    direction: standard.direction ?? "lower_is_better", unit_label: standard.unit_label,
    measurement_source: standard.measurement_source ?? "manual", resolver_key: standard.resolver_key ?? "",
    data_source_note: standard.data_source_note ?? "", responsible_team: standard.responsible_team ?? "",
    assigned_to: standard.assigned_to ?? "", cap_rule_note: standard.cap_rule_note ?? "",
    sort_order: standard.sort_order ?? 0, effective_start_date: standard.effective_start_date ?? today(),
    effective_end_date: standard.effective_end_date ?? null,
  };
}

export function PerformanceStandardsAdmin() {
  const { roles } = useAuth();
  const isAdmin = roles.includes("OCC.Admin");

  const [standards, setStandards] = useState<ContractorPerformanceStandard[]>([]);
  const [tiers, setTiers] = useState<ContractorStandardTier[]>([]);
  const [agreements, setAgreements] = useState<PerformanceAgreementRecord[]>([]);
  const [assignments, setAssignments] = useState<AgreementStandardAssignment[]>([]);
  const [contractors, setContractors] = useState<ContractorRecord[]>([]);
  const [agreementId, setAgreementId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<PerformanceStandardInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [ready, setReady] = useState(true);

  const load = useCallback(async () => {
    try {
      setError("");
      const [catalog, contractorList] = await Promise.all([api.getPerformanceStandards(), api.getContractors()]);
      setStandards(catalog.standards);
      setTiers(catalog.tiers);
      setAgreements(catalog.agreements);
      setAssignments(catalog.assignments);
      setContractors(contractorList.contractors);
      setReady(catalog.diagnostics.table_ready && catalog.diagnostics.assignments_ready);
      setAgreementId((current) => current || catalog.agreements.find((a) => a.is_active)?.id || catalog.agreements[0]?.id || "");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The performance standards catalog is unavailable.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selected = standards.find((standard) => standard.id === selectedId) ?? null;
  const agreement = agreements.find((record) => record.id === agreementId) ?? null;
  // Condition codes are a small, contract-derived vocabulary (LAST_TRIP_OF_DAY,
  // REPORTING_LATE). Offering the ones in use as a picker keeps a new band
  // matching occurrences that already carry the marker, instead of a typo that
  // silently matches nothing.
  const knownQualifiers = useMemo(
    () => [...new Set(tiers.map((tier) => tier.qualifier_code).filter((code): code is string => Boolean(code)))].sort(),
    [tiers],
  );
  const assignmentFor = useMemo(() => {
    const index = new Map<string, AgreementStandardAssignment>();
    for (const row of assignments) if (row.agreement_id === agreementId) index.set(row.standard_id, row);
    return index;
  }, [assignments, agreementId]);

  async function run(work: () => Promise<unknown>, success: string) {
    setBusy(true); setError(""); setNotice("");
    try { await work(); await load(); setNotice(success); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "The change could not be saved."); }
    finally { setBusy(false); }
  }

  function edit(standard: ContractorPerformanceStandard) {
    setSelectedId(standard.id);
    setDraft(standardToInput(standard));
  }

  function addStandard() {
    setSelectedId("new");
    setDraft({ ...EMPTY_STANDARD, sort_order: Math.max(0, ...standards.map((s) => s.sort_order ?? 0)) + 1 });
  }

  return <>
    <div className="panel-header">Performance Standards</div>
    <div className="panel-body assessment-page-shell">
      <div className="assessment-module">
        <div className="assessment-toolbar">
          <div>
            <span className="assessment-eyebrow">Administration · Contract governance</span>
            <h2>Performance Standards</h2>
            <p>The Attachment G standards catalog, its tier bands, and which standards each Agreement holds the contractor to.</p>
          </div>
          {isAdmin && <button className="assessment-manage" disabled={busy} onClick={addStandard}>Add standard</button>}
        </div>

        {!isAdmin && <div className="assessment-warning">You can read the catalog. Changing a standard, a tier band, or an Agreement assignment requires Administrator access.</div>}
        {!ready && <div className="assessment-warning">Migration 102 has not been applied to this database. The catalog reads correctly, but Agreement assignment is unavailable until it runs.</div>}
        {error && <div className="assessment-error">{error}</div>}
        {notice && <div className="standards-notice">{notice}</div>}

        <AgreementPanel
          agreements={agreements} contractors={contractors} agreementId={agreementId} busy={busy} canEdit={isAdmin}
          onSelect={setAgreementId}
          onSave={(id, input) => void run(() => api.putPerformanceAgreement(id, input), "Agreement saved.")}
        />

        <section className="assessment-card">
          <div className="assessment-section-head">
            <div>
              <h3>Standards catalog</h3>
              <p>{agreement ? `Assignment shown for ${agreement.contractor_name ?? "the selected Agreement"}, ${toInputDate(agreement.starts_on)} to ${toInputDate(agreement.ends_on)}.` : "Select an Agreement to see and edit its assignments."}</p>
            </div>
            <span>{standards.length} standards · {standards.filter((s) => assignmentFor.get(s.id)?.is_scored).length} scored on this Agreement</span>
          </div>
          <div className="assessment-table-wrap">
            <table className="data">
              <thead><tr>
                <th>Standard</th><th>Measures</th><th>Priority</th><th>Source</th>
                <th>Penalty bands</th><th>Scored here</th>
              </tr></thead>
              <tbody>
                {standards.map((standard) => {
                  const assignment = assignmentFor.get(standard.id);
                  return <tr key={standard.id} className={`assessment-clickable${standard.id === selectedId ? " standards-selected" : ""}`} onClick={() => edit(standard)}>
                    <td>
                      <strong>{standard.name}</strong>
                      <small className="mono-ref">{standard.code}</small>
                    </td>
                    <td>
                      {standard.standard_type === "occurrence" ? "Counted events" : "Monthly value"}
                      <small>{standard.unit_label}{standard.direction === "higher_is_better" ? " · higher is better" : " · lower is better"}</small>
                    </td>
                    <td>{standard.priority}</td>
                    <td>
                      {standard.measurement_source ?? "manual"}
                      {standard.measurement_source === "auto" && !standard.resolver_key && <small className="standards-flag">no resolver</small>}
                    </td>
                    <td><TierSummary standard={standard} tiers={tiers} agreementId={agreementId} /></td>
                    <td onClick={(event) => event.stopPropagation()}>
                      <label className="standards-toggle">
                        <input
                          type="checkbox" disabled={!isAdmin || busy || !agreement}
                          checked={Boolean(assignment?.is_scored)}
                          onChange={(event) => {
                            if (!agreement) return;
                            const next: AgreementStandardInput = {
                              standard_id: standard.id,
                              is_scored: event.target.checked,
                              effective_start_date: assignment?.effective_start_date ?? agreement.starts_on.replace(/\D/g, "").slice(0, 8),
                              effective_end_date: assignment?.effective_end_date ?? null,
                              assignment_note: assignment?.assignment_note ?? null,
                            };
                            void run(() => api.putAgreementStandards(agreement.id, [next]),
                              `${standard.name} is ${event.target.checked ? "now scored" : "no longer scored"} on this Agreement.`);
                          }}
                        />
                        <span>{assignment ? (assignment.is_scored ? "Scored" : "Dormant") : "Unassigned"}</span>
                      </label>
                    </td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        </section>

        {draft && <StandardEditor
          key={selectedId}
          draft={draft} setDraft={setDraft} standardId={selectedId} canEdit={isAdmin} busy={busy}
          onCancel={() => { setDraft(null); setSelectedId(""); }}
          onSave={(id, input) => void run(() => api.putPerformanceStandard(id, input), `${input.code} saved.`)}
        />}

        {selected && <TierEditor
          key={`tiers-${selected.id}-${agreementId}`}
          standard={selected} tiers={tiers} agreement={agreement} canEdit={isAdmin && ready} busy={busy}
          knownQualifiers={knownQualifiers}
          onSave={(input) => void run(() => api.putStandardTiers(selected.id, input), `${selected.code} tier bands saved.`)}
        />}
      </div>
    </div>
  </>;
}

// Which ladder actually governs, spelled out. An agreement override replaces
// the catalog ladder whole, so showing both would misrepresent what scores.
function resolveLadder(standard: ContractorPerformanceStandard, tiers: ContractorStandardTier[], agreementId: string) {
  const forStandard = tiers.filter((tier) => tier.standard_id === standard.id && !tier.effective_end_date);
  const override = forStandard.filter((tier) => tier.agreement_id === agreementId);
  const source: "agreement" | "catalog" = override.length ? "agreement" : "catalog";
  const ladder = (override.length ? override : forStandard.filter((tier) => !tier.agreement_id)).slice()
    .sort((left, right) => left.tier_order - right.tier_order);
  return { ladder, source };
}

function TierSummary({ standard, tiers, agreementId }: { standard: ContractorPerformanceStandard; tiers: ContractorStandardTier[]; agreementId: string }) {
  const { ladder, source } = resolveLadder(standard, tiers, agreementId);
  if (!ladder.length) return <small className="standards-flag">No bands configured</small>;
  return <>
    {source === "agreement" && <small className="standards-override">Agreement override</small>}
    <ul className="standards-band-list">
      {ladder.map((tier) => <li key={tier.id}>
        <span className={`assessment-tier ${tier.tier_label}`}>{TIER_LABELS.find((t) => t.value === tier.tier_label)?.label ?? tier.tier_label}</span>
        <small>{describeBand(tier, standard)}</small>
      </li>)}
    </ul>
  </>;
}

function AgreementPanel({ agreements, contractors, agreementId, busy, canEdit, onSelect, onSave }: {
  agreements: PerformanceAgreementRecord[]; contractors: ContractorRecord[]; agreementId: string; busy: boolean; canEdit: boolean;
  onSelect: (id: string) => void;
  onSave: (id: string, input: { contractor_id: string; starts_on: string; ends_on: string; validation_business_days: number; retention_years: number; is_active: boolean }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState("");
  const current = agreements.find((record) => record.id === agreementId) ?? null;
  const [contractorId, setContractorId] = useState("");
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [validationDays, setValidationDays] = useState(5);
  const [retention, setRetention] = useState(7);
  const [active, setActive] = useState(true);

  function beginEdit(record: PerformanceAgreementRecord | null) {
    setEditing(record?.id ?? "new");
    setContractorId(record?.contractor_id ?? contractors.find((c) => c.is_active)?.id ?? "");
    setStarts(toInputDate(record?.starts_on) || toInputDate(today()));
    setEnds(toInputDate(record?.ends_on));
    setValidationDays(record?.validation_business_days ?? 5);
    setRetention(record?.retention_years ?? 7);
    setActive(record?.is_active ?? true);
    setOpen(true);
  }

  return <section className="contractor-setup">
    <div className="assessment-section-head">
      <div>
        <span className="assessment-eyebrow">Contract term</span>
        <h3>Performance Agreement</h3>
        <p>An Agreement is what binds a contractor to a set of standards for a term. Assessment periods and the candidate poll both refuse to run without an active one.</p>
      </div>
      {canEdit && <button className="assessment-manage" disabled={busy} onClick={() => (open ? setOpen(false) : beginEdit(current))}>{open ? "Close" : current ? "Edit Agreement" : "Create Agreement"}</button>}
    </div>

    {agreements.length === 0
      ? <div className="assessment-warning">No Performance Agreement exists. Until one does, no assessment period can be opened and the compliance candidate poll fails on every run. {canEdit ? "Create one below." : "Ask an Administrator to create one."}</div>
      : <label className="standards-agreement-select">
          <span>Agreement</span>
          <select value={agreementId} onChange={(event) => onSelect(event.target.value)}>
            {agreements.map((record) => <option key={record.id} value={record.id}>
              {record.contractor_name ?? "Contractor"} · {toInputDate(record.starts_on)} to {toInputDate(record.ends_on)}{record.is_active ? "" : " (inactive)"}
            </option>)}
          </select>
        </label>}

    {open && canEdit && <div className="contractor-form">
      <label><span>Contractor</span>
        <select value={contractorId} onChange={(event) => setContractorId(event.target.value)}>
          <option value="">Select a contractor</option>
          {contractors.map((contractor) => <option key={contractor.id} value={contractor.id}>{contractor.name}</option>)}
        </select>
        {!contractors.length && <small>No contractor records exist. Add one under Performance Assessment &gt; Manage contractors first.</small>}
      </label>
      <label><span>Term start</span><input type="date" value={starts} onChange={(event) => setStarts(event.target.value)} /></label>
      <label><span>Term end</span><input type="date" value={ends} onChange={(event) => setEnds(event.target.value)} /></label>
      <label><span>Validation window (business days)</span><input type="number" min={1} max={30} value={validationDays} onChange={(event) => setValidationDays(Number(event.target.value))} /></label>
      <label><span>Record retention (years)</span><input type="number" min={1} max={25} value={retention} onChange={(event) => setRetention(Number(event.target.value))} /></label>
      <label className="contractor-active"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /><span>Current Agreement for this contractor</span></label>
      <button
        className="btn-primary"
        disabled={busy || !contractorId || !starts || !ends}
        onClick={() => {
          onSave(editing === "new" ? crypto.randomUUID() : editing, {
            contractor_id: contractorId, starts_on: toServiceDate(starts), ends_on: toServiceDate(ends),
            validation_business_days: validationDays, retention_years: retention, is_active: active,
          });
          setOpen(false);
        }}
      >{editing === "new" ? "Create Agreement" : "Save Agreement"}</button>
      {editing !== "new" && <button className="assessment-manage" disabled={busy} onClick={() => beginEdit(null)}>Start a new Agreement instead</button>}
      {editing === "new" && <small className="standards-hint">A new Agreement inherits every standard in the catalog, scored as the catalog scores it. Adjust the assignments below afterwards.</small>}
    </div>}
  </section>;
}

function StandardEditor({ draft, setDraft, standardId, canEdit, busy, onCancel, onSave }: {
  draft: PerformanceStandardInput; setDraft: (next: PerformanceStandardInput) => void; standardId: string;
  canEdit: boolean; busy: boolean; onCancel: () => void; onSave: (id: string, input: PerformanceStandardInput) => void;
}) {
  const isNew = standardId === "new";
  const set = <K extends keyof PerformanceStandardInput>(key: K, value: PerformanceStandardInput[K]) => setDraft({ ...draft, [key]: value });
  const autoWithoutResolver = draft.measurement_source === "auto" && !draft.resolver_key?.trim();

  return <section className="assessment-card standards-editor">
    <div className="assessment-section-head">
      <div>
        <span className="assessment-eyebrow">{isNew ? "New standard" : "Edit standard"}</span>
        <h3>{isNew ? "Add a performance standard" : draft.name || draft.code}</h3>
        <p>A counted-events standard charges per event as it happens. A monthly-value standard measures one number for the month against bands.</p>
      </div>
      <button className="assessment-manage" onClick={onCancel}>Close</button>
    </div>
    <div className="standards-grid">
      <label><span>Code</span>
        <input value={draft.code} disabled={!canEdit || !isNew} onChange={(event) => set("code", event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))} placeholder="OPERATOR_CONDUCT" />
        {!isNew && <small>A standard's code is referenced by resolvers and operational SQL, so it cannot be changed. Retire this one and add a replacement instead.</small>}
      </label>
      <label><span>Name</span><input value={draft.name} disabled={!canEdit} onChange={(event) => set("name", event.target.value)} /></label>
      <label><span>What it measures</span>
        <select value={draft.standard_type} disabled={!canEdit} onChange={(event) => set("standard_type", event.target.value as PerformanceStandardInput["standard_type"])}>
          <option value="occurrence">Counted events — each one is logged and charged</option>
          <option value="threshold">Monthly value — one number scored against bands</option>
        </select>
      </label>
      <label><span>Priority</span>
        <select value={draft.priority} disabled={!canEdit} onChange={(event) => set("priority", event.target.value as PerformanceStandardInput["priority"])}>
          {["High", "Medium", "Low", "NA"].map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      <label><span>Good performance is</span>
        <select value={draft.direction} disabled={!canEdit} onChange={(event) => set("direction", event.target.value as PerformanceStandardInput["direction"])}>
          <option value="lower_is_better">Fewer / lower — a rising number is worse</option>
          <option value="higher_is_better">More / higher — a falling number is worse</option>
        </select>
      </label>
      <label><span>Unit</span>
        <select
          value={CATALOG_UNITS.some((unit) => unit.value === draft.unit_label) ? draft.unit_label : "__custom"}
          disabled={!canEdit}
          onChange={(event) => set("unit_label", event.target.value === "__custom" ? "" : event.target.value)}
        >
          {CATALOG_UNITS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
          <option value="__custom">Something else…</option>
        </select>
        {!CATALOG_UNITS.some((unit) => unit.value === draft.unit_label) &&
          <input value={draft.unit_label} disabled={!canEdit} autoFocus placeholder="Name the unit" onChange={(event) => set("unit_label", event.target.value)} />}
        <small>Percent is stored as a ratio and shown as a percentage everywhere.</small>
      </label>
      <label><span>Measurement</span>
        <select value={draft.measurement_source} disabled={!canEdit} onChange={(event) => set("measurement_source", event.target.value as PerformanceStandardInput["measurement_source"])}>
          <option value="manual">Entered by hand each month</option>
          <option value="auto">Measured automatically from a feed</option>
        </select>
      </label>
      <label><span>Resolver key</span>
        <input value={draft.resolver_key ?? ""} disabled={!canEdit || draft.measurement_source !== "auto"} onChange={(event) => set("resolver_key", event.target.value)} placeholder="OTP_FIXED_ROUTE" />
        {autoWithoutResolver && <small className="standards-flag">An automated standard needs a resolver key, or the month scores as "no data" and reads like a clean month.</small>}
      </label>
      <label><span>Responsible team</span><input value={draft.responsible_team ?? ""} disabled={!canEdit} onChange={(event) => set("responsible_team", event.target.value)} /></label>
      <label><span>Assigned to</span><input value={draft.assigned_to ?? ""} disabled={!canEdit} onChange={(event) => set("assigned_to", event.target.value)} /></label>
      <label><span>Effective from</span><input type="date" value={toInputDate(draft.effective_start_date)} disabled={!canEdit} onChange={(event) => set("effective_start_date", toServiceDate(event.target.value))} /></label>
      <label><span>Retired after</span><input type="date" value={toInputDate(draft.effective_end_date)} disabled={!canEdit} onChange={(event) => set("effective_end_date", event.target.value ? toServiceDate(event.target.value) : null)} /></label>
      <label><span>Sort order</span><input type="number" min={0} value={draft.sort_order} disabled={!canEdit} onChange={(event) => set("sort_order", Number(event.target.value))} /></label>
      <label className="contractor-active"><input type="checkbox" checked={draft.is_scored} disabled={!canEdit} onChange={(event) => set("is_scored", event.target.checked)} /><span>Scored by default</span></label>
      <label className="contractor-active"><input type="checkbox" checked={draft.is_safety_critical} disabled={!canEdit} onChange={(event) => set("is_safety_critical", event.target.checked)} /><span>Safety-critical</span></label>
      <label className="standards-wide"><span>Description</span><textarea rows={2} value={draft.description ?? ""} disabled={!canEdit} onChange={(event) => set("description", event.target.value)} /></label>
      <label className="standards-wide"><span>Data source note</span><textarea rows={2} value={draft.data_source_note ?? ""} disabled={!canEdit} onChange={(event) => set("data_source_note", event.target.value)} placeholder="Which feed, which filter, and any definition the contract settles." /></label>
      <label className="standards-wide"><span>CAP rule note</span><textarea rows={2} value={draft.cap_rule_note ?? ""} disabled={!canEdit} onChange={(event) => set("cap_rule_note", event.target.value)} /></label>
    </div>
    {canEdit && <button
      className="btn-primary"
      disabled={busy || !draft.code || !draft.name.trim() || !draft.unit_label.trim() || autoWithoutResolver}
      onClick={() => onSave(isNew ? crypto.randomUUID() : standardId, draft)}
    >{isNew ? "Add standard" : "Save standard"}</button>}
  </section>;
}

function TierEditor({ standard, tiers, agreement, canEdit, busy, knownQualifiers, onSave }: {
  standard: ContractorPerformanceStandard; tiers: ContractorStandardTier[]; agreement: PerformanceAgreementRecord | null;
  canEdit: boolean; busy: boolean; knownQualifiers: string[];
  onSave: (input: { agreement_id: string | null; effective_start_date: string; tiers: StandardTierInput[] }) => void;
}) {
  const unit = standard.unit_label;
  const [scope, setScope] = useState<"catalog" | "agreement">("catalog");
  const [effective, setEffective] = useState(toInputDate(today()));
  const scopeId = scope === "agreement" ? agreement?.id ?? null : null;
  const existing = useMemo(() => tiers
    .filter((tier) => tier.standard_id === standard.id && !tier.effective_end_date && (tier.agreement_id ?? null) === scopeId)
    .slice().sort((left, right) => left.tier_order - right.tier_order)
    .map((tier): StandardTierInput => ({
      tier_label: tier.tier_label, bound_low: tier.bound_low, bound_high: tier.bound_high,
      qualifier_code: tier.qualifier_code ?? null, penalty_basis: tier.penalty_basis,
      penalty_amount: Number(tier.penalty_amount), triggers_cap: tier.triggers_cap, notes: tier.notes,
    })), [tiers, standard.id, scopeId]);
  const [ladder, setLadder] = useState<StandardTierInput[]>(existing);
  useEffect(() => { setLadder(existing); }, [existing]);

  const update = (index: number, patch: Partial<StandardTierInput>) =>
    setLadder(ladder.map((tier, position) => position === index ? { ...tier, ...patch } : tier));
  const warnings = ladderWarnings(ladder.map((tier) => ({ ...tier, tier_label: tier.tier_label })), unit);

  return <section className="assessment-card standards-editor">
    <div className="assessment-section-head">
      <div>
        <span className="assessment-eyebrow">{standard.name}</span>
        <h3>Penalty bands</h3>
        <p>
          {standard.standard_type === "threshold"
            ? `Each band is matched against the month's measured value in ${unit}. The lower bound counts as inside the band; the upper bound does not.`
            : `Each confirmed occurrence is matched to a band. A band with no value range covers every ${unitNoun(unit)}; add a condition to narrow one to occurrences carrying a marker.`}
        </p>
      </div>
      <div className="standards-scope">
        <label><span>Applies to</span>
          <select value={scope} disabled={!agreement} onChange={(event) => setScope(event.target.value as "catalog" | "agreement")}>
            <option value="catalog">Agency catalog default</option>
            <option value="agreement">This Agreement only</option>
          </select>
        </label>
        <label><span>Effective from</span><input type="date" value={effective} disabled={!canEdit} onChange={(event) => setEffective(event.target.value)} /></label>
      </div>
    </div>

    {scope === "agreement" && <div className="standards-hint">An Agreement ladder replaces the catalog ladder for this standard entirely — every band, not just the ones set here.</div>}

    <div className="standards-bands">
      {ladder.map((tier, index) => {
        const range = bandRangeOf(tier);
        const setRange = (next: BandRange) => update(index, boundsForRange(next, tier.bound_low, tier.bound_high));
        return <div className="standards-band" key={index}>
          <div className="standards-band-head">
            <label><span>Outcome</span>
              <select value={tier.tier_label} disabled={!canEdit} onChange={(event) => update(index, { tier_label: event.target.value as StandardTierInput["tier_label"] })}>
                {TIER_LABELS.map((label) => <option key={label.value} value={label.value}>{label.label}</option>)}
              </select>
            </label>
            {canEdit && <button className="assessment-link-button" onClick={() => setLadder(ladder.filter((_, position) => position !== index))}>Remove band</button>}
          </div>

          <div className="standards-band-criteria">
            <label><span>Applies when the value is</span>
              <select value={range} disabled={!canEdit} onChange={(event) => setRange(event.target.value as BandRange)}>
                {BAND_RANGES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            {(range === "at_or_above" || range === "between") && <label>
              <span>{range === "between" ? "From (included)" : "At or above"}</span>
              <div className="standards-measure">
                <input inputMode="decimal" value={boundToInput(tier.bound_low, unit)} disabled={!canEdit}
                  onChange={(event) => update(index, { bound_low: inputToBound(event.target.value, unit) })} />
                <span>{isRatioUnit(unit) ? "%" : unit}</span>
              </div>
            </label>}
            {(range === "under" || range === "between") && <label>
              <span>Up to, not including</span>
              <div className="standards-measure">
                <input inputMode="decimal" value={boundToInput(tier.bound_high, unit)} disabled={!canEdit}
                  onChange={(event) => update(index, { bound_high: inputToBound(event.target.value, unit) })} />
                <span>{isRatioUnit(unit) ? "%" : unit}</span>
              </div>
            </label>}
            {/* Only occurrence standards can carry a condition. assess.ts
                matches a threshold band with matchTier(tiers, value, direction)
                and no qualifier, and matchTier then considers unqualified bands
                only - so a condition on a monthly-value standard produces a
                band that can never score. Offering the control there would be
                offering a silent dead end. */}
            {standard.standard_type === "occurrence" && <label><span>Condition</span>
              <select value={tier.qualifier_code ?? ""} disabled={!canEdit}
                onChange={(event) => update(index, { qualifier_code: event.target.value || null })}>
                <option value="">Any {unitNoun(unit)}</option>
                {knownQualifiers.map((code) => <option key={code} value={code}>Only when: {qualifierLabel(code)}</option>)}
              </select>
              <small>A condition narrows this band to occurrences carrying that marker.</small>
            </label>}
          </div>

          <div className="standards-band-penalty">
            <label><span>Charge</span>
              <select value={tier.penalty_basis} disabled={!canEdit} onChange={(event) => update(index, {
                penalty_basis: event.target.value as StandardTierInput["penalty_basis"],
                penalty_amount: event.target.value === "none" ? 0 : tier.penalty_amount,
              })}>
                {PENALTY_BASES.map((basis) => <option key={basis.value} value={basis.value}>{basis.label}</option>)}
              </select>
              <small>{PENALTY_BASES.find((basis) => basis.value === tier.penalty_basis)?.hint}</small>
            </label>
            {tier.penalty_basis !== "none" && <label><span>Amount</span>
              <div className="standards-measure">
                <span>$</span>
                <input type="number" min={0} step={50} value={tier.penalty_amount} disabled={!canEdit}
                  onChange={(event) => update(index, { penalty_amount: Number(event.target.value) })} />
              </div>
            </label>}
            <label className="contractor-active">
              <input type="checkbox" checked={tier.triggers_cap} disabled={!canEdit} onChange={(event) => update(index, { triggers_cap: event.target.checked })} />
              <span>Requires a corrective action plan</span>
            </label>
          </div>

          {/* The band restated from the values as saved, so the exclusive upper
              bound and the qualifier are legible before anyone commits money to
              them. */}
          <p className="standards-band-readout">{describeBand(tier, standard)}</p>
        </div>;
      })}
      {!ladder.length && <div className="standards-hint">No bands. A scored standard with no bands charges nothing.</div>}
    </div>

    {warnings.length > 0 && <div className="assessment-warning">
      {warnings.map((warning) => <div key={warning}>{warning}</div>)}
    </div>}

    {canEdit && <div className="standards-tier-actions">
      <button className="assessment-manage" onClick={() => setLadder([...ladder, {
        tier_label: "tier1", bound_low: null, bound_high: null, qualifier_code: null,
        penalty_basis: standard.standard_type === "occurrence" ? "per_unit" : "flat",
        penalty_amount: 500, triggers_cap: false, notes: null,
      }])}>Add band</button>
      <button className="btn-primary" disabled={busy || !ladder.length || !effective} onClick={() => onSave({ agreement_id: scopeId, effective_start_date: toServiceDate(effective), tiers: ladder })}>Save penalty bands</button>
      <small className="standards-hint">Saving writes a new ladder version effective from this date. Assessment periods already opened keep the bands they were opened with.</small>
    </div>}
  </section>;
}
