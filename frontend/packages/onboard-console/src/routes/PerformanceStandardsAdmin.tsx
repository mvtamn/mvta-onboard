import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AgreementStandardAssignment, AgreementStandardInput, ContractorPerformanceStandard,
  ContractorStandardTier, PerformanceAgreementRecord,
  CapWindowMode, KnownSourceSystem, PerformanceStandardInput, ReferenceValue, RegisteredResolver, StandardMeasurementSource,
  StandardTierInput,
} from "@mvta/shared";
import {
  BAND_RANGES, bandRangeOf, boundsForRange, boundToInput, capWindowSentence, describeBand,
  FALLBACK_PENALTY_BASES, FALLBACK_PRIORITIES, FALLBACK_TIER_LABELS, FALLBACK_UNITS,
  inputToBound, isAutomated, isRatioUnit, ladderWarnings, optionsFor, qualifierLabel, sourceLabel,
  TIER_LABELS, unitNoun, withCurrent, type BandRange, type VocabularyOption,
} from "./performanceStandardsVocabulary.js";
import { Link } from "react-router-dom";
import { api } from "../config.js";
import { useAppDialog } from "../components/AppDialog.js";
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

// Every picker's options, read from ReferenceValues (migration 105) with the
// built-in lists as the pre-migration fallback.
interface Vocabulary {
  units: VocabularyOption[]; priorities: VocabularyOption[]; penaltyBases: VocabularyOption[];
  tierLabels: VocabularyOption[]; conditions: VocabularyOption[];
  sourceSystems: VocabularyOption[]; teams: VocabularyOption[]; owners: VocabularyOption[];
  categories: VocabularyOption[];
}

type Tab = "details" | "bands" | "assignment";
// The fixed filters, plus one per category as `category:<value>`. Categories
// are data, so they cannot be enumerated in a union here - the list is whatever
// Lists currently holds.
type Filter = "all" | "scored" | "unassigned" | "auto" | "manual" | `category:${string}`;

const TABS: { key: Tab; label: string }[] = [
  { key: "details", label: "Details" },
  { key: "bands", label: "Penalty bands" },
  { key: "assignment", label: "Assignment" },
];

// The four ways a month's figure arrives, in the order an administrator is
// most likely to want them.
const MEASUREMENT_SOURCES: { value: StandardMeasurementSource; label: string; hint: string }[] = [
  { value: "manual_entry", label: "Entered by hand", hint: "Somebody types the month's figure in." },
  { value: "structured_import", label: "Transcribed from another system", hint: "Read off another system's structured report and entered here." },
  { value: "api_feed", label: "Ingested from a feed", hint: "A feed this application reads directly." },
  { value: "onboard_compliance", label: "Raised by OnBoard compliance", hint: "Occurrences OnBoard raises from its own modules." },
];

// How a corrective-action window counts. "None" is a real choice and the
// default: most standards charge per occurrence and escalate nothing.
//
// The two counting modes are not interchangeable. Three cases in December and
// three in January breach a calendar-quarter rule never, and a rolling
// ninety-day rule almost certainly - so the picker asks rather than assuming,
// and the hints say what each one does at a boundary.
const CAP_WINDOW_MODES: { value: CapWindowMode | ""; label: string; hint: string }[] = [
  { value: "", label: "No window", hint: "Occurrences are charged as they happen and nothing escalates." },
  { value: "rolling_days", label: "Rolling days", hint: "Counts back a fixed number of days from any point. Never resets." },
  { value: "calendar_quarter", label: "Calendar quarter", hint: "Counts within Jan-Mar, Apr-Jun, and so on. The count restarts each quarter." },
];

const EMPTY_STANDARD: PerformanceStandardInput = {
  code: "", name: "", description: "", standard_type: "occurrence", priority: "Medium",
  is_scored: true, is_safety_critical: false, direction: "lower_is_better", unit_label: "occurrences",
  measurement_source: "manual_entry", resolver_key: null, source_system: null, data_source_note: "", responsible_team: "",
  category: null, assigned_to: "", cap_rule_note: "", cap_window_mode: null, cap_window_days: null, cap_window_threshold: null,
  sort_order: 0, effective_start_date: today(), effective_end_date: null,
};

function standardToInput(standard: ContractorPerformanceStandard): PerformanceStandardInput {
  return {
    code: standard.code, name: standard.name, description: standard.description ?? "",
    standard_type: standard.standard_type, priority: standard.priority,
    is_scored: standard.is_scored, is_safety_critical: standard.is_safety_critical ?? false,
    direction: standard.direction ?? "lower_is_better", unit_label: standard.unit_label,
    measurement_source: standard.measurement_source ?? "manual_entry",
    resolver_key: standard.resolver_key ?? null, source_system: standard.source_system ?? null,
    data_source_note: standard.data_source_note ?? "", responsible_team: standard.responsible_team ?? "",
    category: standard.category ?? null,
    assigned_to: standard.assigned_to ?? "", cap_rule_note: standard.cap_rule_note ?? "",
    cap_window_mode: standard.cap_window_mode ?? null,
    cap_window_days: standard.cap_window_days ?? null,
    cap_window_threshold: standard.cap_window_threshold ?? null,
    sort_order: standard.sort_order ?? 0, effective_start_date: standard.effective_start_date ?? today(),
    effective_end_date: standard.effective_end_date ?? null,
  };
}

export function PerformanceStandardsAdmin() {
  const { roles } = useAuth();
  const { confirm } = useAppDialog();
  const isAdmin = roles.includes("OCC.Admin");

  const [standards, setStandards] = useState<ContractorPerformanceStandard[]>([]);
  const [tiers, setTiers] = useState<ContractorStandardTier[]>([]);
  const [agreements, setAgreements] = useState<PerformanceAgreementRecord[]>([]);
  const [assignments, setAssignments] = useState<AgreementStandardAssignment[]>([]);
  const [resolvers, setResolvers] = useState<RegisteredResolver[]>([]);
  const [sourceSystems, setSourceSystems] = useState<KnownSourceSystem[]>([]);
  const [referenceValues, setReferenceValues] = useState<ReferenceValue[]>([]);
  const [agreementId, setAgreementId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<PerformanceStandardInput | null>(null);
  const [tab, setTab] = useState<Tab>("details");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [ready, setReady] = useState(true);

  const load = useCallback(async () => {
    try {
      setError("");
      const [catalog, reference] = await Promise.all([
        api.getPerformanceStandards(),
        // Absent before migration 105; the pickers fall back to their built-in
        // lists rather than rendering empty.
        api.getReferenceValues().catch(() => ({ values: [] as ReferenceValue[] })),
      ]);
      setStandards(catalog.standards);
      setTiers(catalog.tiers);
      setAgreements(catalog.agreements);
      setAssignments(catalog.assignments);
      setResolvers(catalog.resolvers ?? []);
      setSourceSystems(catalog.source_systems ?? []);
      setReferenceValues(reference.values ?? []);
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
  const vocab: Vocabulary = useMemo(() => ({
    units: optionsFor(referenceValues, "unit", FALLBACK_UNITS),
    priorities: optionsFor(referenceValues, "priority", FALLBACK_PRIORITIES),
    penaltyBases: optionsFor(referenceValues, "penalty_basis", FALLBACK_PENALTY_BASES),
    tierLabels: optionsFor(referenceValues, "tier_label", FALLBACK_TIER_LABELS),
    conditions: optionsFor(referenceValues, "condition_code", []),
    sourceSystems: optionsFor(referenceValues, "source_system",
      sourceSystems.map((system) => ({ value: system.value, label: system.label, description: system.description }))),
    teams: optionsFor(referenceValues, "responsible_team", []),
    owners: optionsFor(referenceValues, "assigned_to", []),
    categories: optionsFor(referenceValues, "category", []),
  }), [referenceValues, sourceSystems]);

  // Conditions come from the vocabulary table. They used to be derived from the
  // tiers that already used one, so the first band carrying a new condition
  // could never be created from the console.
  const knownQualifiers = useMemo(() => {
    const inUse = tiers.map((tier) => tier.qualifier_code).filter((code): code is string => Boolean(code));
    return [...new Set([...vocab.conditions.map((option) => option.value), ...inUse])];
  }, [vocab, tiers]);
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
    setTab("details");
    setDraft({ ...EMPTY_STANDARD, sort_order: Math.max(0, ...standards.map((s) => s.sort_order ?? 0)) + 1 });
  }

  // Deleting is only ever available for a standard nothing has been assessed
  // against; the server re-checks and answers 409 with the references that
  // blocked it, which is what the administrator needs to see.
  async function confirmDelete(standard: ContractorPerformanceStandard) {
    const confirmed = await confirm({
      title: `Delete ${standard.name}?`,
      description: "This removes the standard, its penalty bands and its Agreement assignments. It is refused if the standard has ever been assessed against — retire it with an end date instead.",
      confirmLabel: "Delete standard",
      danger: true,
    });
    if (!confirmed) return;
    await run(async () => {
      await api.deletePerformanceStandard(standard.id);
      setSelectedId("");
      setDraft(null);
    }, `${standard.name} deleted.`);
  }

  const scoredCount = standards.filter((standard) => assignmentFor.get(standard.id)?.is_scored).length;
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return standards.filter((standard) => {
      const assignment = assignmentFor.get(standard.id);
      if (filter === "scored" && !assignment?.is_scored) return false;
      if (filter === "unassigned" && assignment) return false;
      if (filter === "auto" && !isAutomated(standard.measurement_source)) return false;
      if (filter === "manual" && isAutomated(standard.measurement_source)) return false;
      if (filter.startsWith("category:") && (standard.category ?? "") !== filter.slice("category:".length)) return false;
      if (!needle) return true;
      return `${standard.name} ${standard.code} ${standard.unit_label}`.toLowerCase().includes(needle);
    });
  }, [standards, assignmentFor, filter, search]);

  function assign(standard: ContractorPerformanceStandard, patch: Partial<AgreementStandardInput>) {
    if (!agreement) return;
    const current = assignmentFor.get(standard.id);
    const next: AgreementStandardInput = {
      standard_id: standard.id,
      is_scored: current?.is_scored ?? false,
      effective_start_date: current?.effective_start_date ?? agreement.starts_on.replace(/\D/g, "").slice(0, 8),
      effective_end_date: current?.effective_end_date ?? null,
      assignment_note: current?.assignment_note ?? null,
      ...patch,
    };
    void run(() => api.putAgreementStandards(agreement.id, [next]), `${standard.name} updated on this Agreement.`);
  }

  return <>
    <div className="panel-header">Performance Standards</div>
    <div className="panel-body standards-page">
      <div className="standards-head">
        <div>
          <span className="assessment-eyebrow">Administration · Contract governance</span>
          <h2>Performance Standards</h2>
          <p>The contractor performance standards catalog, its penalty bands, and which standards each Agreement holds the contractor to.</p>
        </div>
        <div className="standards-head-actions">
          {isAdmin && <button className="btn-primary" disabled={busy} onClick={addStandard}>New standard</button>}
        </div>
      </div>

      {!isAdmin && <div className="assessment-warning">You can read the catalog. Changing a standard, a penalty band, or an Agreement assignment requires Administrator access.</div>}
      {!ready && <div className="assessment-warning">Migration 102 has not been applied to this database. The catalog reads correctly, but Agreement assignment is unavailable until it runs.</div>}
      {error && <div className="assessment-error">{error}</div>}
      {notice && <div className="standards-notice">{notice}</div>}

      {/* The Agreement is the context assignments are read in, not something
          edited here - that is its own section now. */}
      <AgreementBar agreements={agreements} agreementId={agreementId} onSelect={setAgreementId} />

      {/* List and detail side by side, each scrolling in its own right, so
          picking a standard does not push the thing being edited off the
          bottom of a page that keeps growing. */}
      <div className="standards-workspace">
        <section className="standards-list" aria-label="Standards catalog">
          <div className="standards-list-toolbar">
            <input
              type="search" value={search} placeholder="Search standards"
              aria-label="Search standards" onChange={(event) => setSearch(event.target.value)}
            />
            <select value={filter} aria-label="Filter standards" onChange={(event) => setFilter(event.target.value as Filter)}>
              <option value="all">All standards</option>
              <option value="scored">Scored on this Agreement</option>
              <option value="unassigned">Not assigned</option>
              <option value="auto">Measured automatically</option>
              <option value="manual">Entered by hand</option>
              {vocab.categories.length > 0 && <optgroup label="Category">
                {vocab.categories.map((option) => <option key={option.value} value={`category:${option.value}`}>{option.label}</option>)}
                {/* Offered only when something is actually uncategorised, so it
                    is never a filter that returns an empty list. */}
                {standards.some((standard) => !standard.category) && <option value="category:">No category</option>}
              </optgroup>}
            </select>
          </div>
          <div className="standards-list-meta">
            {visible.length === standards.length
              ? `${standards.length} standards · ${scoredCount} scored on this Agreement`
              : `${visible.length} of ${standards.length} standards`}
          </div>
          <ul className="standards-rows">
            {visible.map((standard) => {
              const assignment = assignmentFor.get(standard.id);
              const state = assignment ? (assignment.is_scored ? "Scored" : "Dormant") : "Unassigned";
              return <li key={standard.id}>
                <button
                  type="button"
                  className={`standards-row${standard.id === selectedId ? " selected" : ""}`}
                  aria-current={standard.id === selectedId}
                  onClick={() => edit(standard)}
                >
                  <span className="standards-row-name">
                    <strong>{standard.name}</strong>
                    {/* The description rather than the code: the code is an
                        identifier for resolvers and SQL, not something a reader
                        scanning the catalog needs. It stays on the detail
                        header, where the standard being worked on is named.
                        Clamped to two lines with the full text on hover, so a
                        long description does not set the row height. */}
                    {standard.description?.trim()
                      ? <small className="standards-row-description" title={standard.description}>{standard.description}</small>
                      : <small className="standards-row-description is-empty">No description yet</small>}
                  </span>
                  <span className="standards-row-meta">
                    <span className={`standards-state ${state.toLowerCase()}`}>{state}</span>
                    <small>
                      {/* The category leads: it is how a reader finds their way
                          through thirty standards in one list. */}
                      {standard.category
                        ? `${vocab.categories.find((option) => option.value === standard.category)?.label ?? standard.category} · `
                        : ""}
                      {standard.standard_type === "occurrence" ? "Counted events" : "Monthly value"}
                      {" · "}{sourceLabel(standard.measurement_source, standard.source_system)}
                      {isAutomated(standard.measurement_source) && !standard.resolver_key ? " · no resolver" : ""}
                    </small>
                  </span>
                </button>
              </li>;
            })}
            {!visible.length && <li className="standards-list-empty">No standard matches that search.</li>}
          </ul>
        </section>

        <aside className="standards-detail" aria-label="Selected standard">
          {!selected && !draft ? (
            <div className="standards-detail-empty">
              <strong>No standard selected</strong>
              <span>Pick one from the list to see its details, penalty bands and Agreement assignment.</span>
            </div>
          ) : <>
            <div className="standards-detail-head">
              <div>
                <h3>{draft && selectedId === "new" ? "New standard" : selected?.name}</h3>
                {selected && <small className="mono-ref">{selected.code}</small>}
                {selected && <div className="standards-detail-bands">
                  <TierSummary standard={selected} tiers={tiers} agreementId={agreementId} vocab={vocab} />
                </div>}
              </div>
              {selected && isAdmin && <div className="standards-detail-actions">
                <button
                  className="btn-sm" disabled={busy}
                  title="Stop this standard scoring future months, keeping the ones it already scored"
                  onClick={() => { setTab("details"); setDraft({ ...standardToInput(selected), effective_end_date: today() }); }}
                >Retire…</button>
                <button
                  className="btn-sm standards-danger" disabled={busy}
                  title="Only possible for a standard nothing has been assessed against"
                  onClick={() => void confirmDelete(selected)}
                >Delete</button>
              </div>}
            </div>

            {/* The submenu: one standard, three things you can do to it. */}
            <nav className="standards-tabs" aria-label="Standard sections">
              {TABS.map((option) => (
                <button
                  key={option.key}
                  className={tab === option.key ? "active" : ""}
                  aria-current={tab === option.key}
                  disabled={selectedId === "new" && option.key !== "details"}
                  title={selectedId === "new" && option.key !== "details" ? "Save the standard first" : undefined}
                  onClick={() => setTab(option.key)}
                >{option.label}</button>
              ))}
            </nav>

            <div className="standards-tab-body">
              {tab === "details" && draft && <StandardEditor
                draft={draft} setDraft={setDraft} standardId={selectedId} canEdit={isAdmin} busy={busy} resolvers={resolvers} vocab={vocab}
                onCancel={() => { setDraft(null); setSelectedId(""); }}
                onSave={(id, input) => void run(() => api.putPerformanceStandard(id, input), `${input.name} saved.`)}
              />}
              {tab === "bands" && selected && <TierEditor
                key={`tiers-${selected.id}-${agreementId}`}
                standard={selected} tiers={tiers} agreement={agreement} canEdit={isAdmin && ready} busy={busy}
                knownQualifiers={knownQualifiers} vocab={vocab}
                onSave={(input) => void run(() => api.putStandardTiers(selected.id, input), `${selected.name} penalty bands saved.`)}
              />}
              {tab === "assignment" && selected && <AssignmentTab
                standard={selected} agreement={agreement} assignment={assignmentFor.get(selected.id) ?? null}
                canEdit={isAdmin && ready} busy={busy} onAssign={(patch) => assign(selected, patch)}
              />}
            </div>
          </>}
        </aside>
      </div>
    </div>
  </>;
}

// One standard's place on the selected Agreement. Separated from the catalog
// row because assignment is a fact about a contract term, not about the
// standard: the same standard can be scored on one Agreement and dormant on
// another, and the dates say over which months.
function AssignmentTab({ standard, agreement, assignment, canEdit, busy, onAssign }: {
  standard: ContractorPerformanceStandard;
  agreement: PerformanceAgreementRecord | null;
  assignment: AgreementStandardAssignment | null;
  canEdit: boolean; busy: boolean;
  onAssign: (patch: Partial<AgreementStandardInput>) => void;
}) {
  if (!agreement) {
    return <div className="standards-hint">No Agreement is selected, so there is nothing to assign this standard to.</div>;
  }
  return <div className="standards-grid">
    <div className="standards-wide standards-hint">
      Assignment for {agreement.contractor_name ?? "this contractor"}, {toInputDate(agreement.starts_on)} to {toInputDate(agreement.ends_on)}.
      Unassigning is recorded as an end date rather than a deletion, because a month that already scored this standard has to keep resolving what it scored.
    </div>
    <label className="contractor-active">
      <input
        type="checkbox" disabled={!canEdit || busy} checked={Boolean(assignment?.is_scored)}
        onChange={(event) => onAssign({ is_scored: event.target.checked })}
      />
      <span>Scored on this Agreement</span>
    </label>
    <label><span>Scored from</span>
      <input
        type="date" disabled={!canEdit || busy}
        value={toInputDate(assignment?.effective_start_date ?? agreement.starts_on)}
        onChange={(event) => onAssign({ effective_start_date: toServiceDate(event.target.value) })}
      />
    </label>
    <label><span>Stopped after</span>
      <input
        type="date" disabled={!canEdit || busy}
        value={toInputDate(assignment?.effective_end_date)}
        onChange={(event) => onAssign({ effective_end_date: event.target.value ? toServiceDate(event.target.value) : null })}
      />
      <small>Leave empty while the standard still applies.</small>
    </label>
    <label className="standards-wide"><span>Assignment note</span>
      <textarea
        rows={2} disabled={!canEdit || busy} defaultValue={assignment?.assignment_note ?? ""}
        placeholder="Why this standard is or is not scored this term."
        onBlur={(event) => {
          const value = event.target.value.trim() || null;
          if (value !== (assignment?.assignment_note ?? null)) onAssign({ assignment_note: value });
        }}
      />
    </label>
    {!assignment && <div className="standards-wide standards-hint">
      {standard.name} is not yet assigned to this Agreement. Ticking the box above assigns it.
    </div>}
  </div>;
}

function resolveLadder(standard: ContractorPerformanceStandard, tiers: ContractorStandardTier[], agreementId: string) {
  const forStandard = tiers.filter((tier) => tier.standard_id === standard.id && !tier.effective_end_date);
  const override = forStandard.filter((tier) => tier.agreement_id === agreementId);
  const source: "agreement" | "catalog" = override.length ? "agreement" : "catalog";
  const ladder = (override.length ? override : forStandard.filter((tier) => !tier.agreement_id)).slice()
    .sort((left, right) => left.tier_order - right.tier_order);
  return { ladder, source };
}

function TierSummary({ standard, tiers, agreementId, vocab }: { standard: ContractorPerformanceStandard; tiers: ContractorStandardTier[]; agreementId: string; vocab: Vocabulary }) {
  const { ladder, source } = resolveLadder(standard, tiers, agreementId);
  if (!ladder.length) return <small className="standards-flag">No bands configured</small>;
  return <>
    {source === "agreement" && <small className="standards-override">Agreement override</small>}
    <ul className="standards-band-list">
      {ladder.map((tier) => <li key={tier.id}>
        <span className={`assessment-tier ${tier.tier_label}`}>{vocab.tierLabels.find((option) => option.value === tier.tier_label)?.label ?? TIER_LABELS.find((t) => t.value === tier.tier_label)?.label ?? tier.tier_label}</span>
        <small>{describeBand(tier, standard)}</small>
      </li>)}
    </ul>
  </>;
}

function AgreementBar({ agreements, agreementId, onSelect }: {
  agreements: PerformanceAgreementRecord[]; agreementId: string; onSelect: (id: string) => void;
}) {
  if (!agreements.length) {
    return <div className="assessment-warning">
      No Performance Agreement exists, so no standard can be assigned and no assessment period can be opened.
      Create one under <Link to="/admin/performance/agreements">Agreements</Link>.
    </div>;
  }
  const current = agreements.find((record) => record.id === agreementId);
  return <div className="standards-agreement-bar">
    <span>Agreement</span>
    <select aria-label="Agreement" value={agreementId} onChange={(event) => onSelect(event.target.value)}>
      {agreements.map((record) => <option key={record.id} value={record.id}>
        {record.contractor_name ?? "Contractor"} · {toInputDate(record.starts_on)} to {toInputDate(record.ends_on)}{record.is_active ? "" : " (inactive)"}
      </option>)}
    </select>
    {current?.exhibit_reference && <span className="standards-exhibit">{current.exhibit_reference}</span>}
    <Link className="btn-sm" to="/admin/performance/agreements">Edit Agreement</Link>
  </div>;
}

function StandardEditor({ draft, setDraft, standardId, canEdit, busy, resolvers, vocab, onCancel, onSave }: {
  draft: PerformanceStandardInput; setDraft: (next: PerformanceStandardInput) => void; standardId: string;
  canEdit: boolean; busy: boolean; resolvers: RegisteredResolver[]; vocab: Vocabulary;
  onCancel: () => void; onSave: (id: string, input: PerformanceStandardInput) => void;
}) {
  const isNew = standardId === "new";
  const set = <K extends keyof PerformanceStandardInput>(key: K, value: PerformanceStandardInput[K]) => setDraft({ ...draft, [key]: value });
  // Only the resolvers that serve this source kind AND this standard type: a
  // feed measures a monthly value, an OnBoard intake raises occurrence rows.
  // The server enforces the same pairing.
  const automated = draft.measurement_source === "api_feed" || draft.measurement_source === "onboard_compliance";
  const usable = resolvers.filter((resolver) =>
    resolver.source === draft.measurement_source && resolver.applies_to === draft.standard_type);
  const chosen = resolvers.find((resolver) => resolver.key === draft.resolver_key);
  const missingResolver = automated
    && (!draft.resolver_key?.trim() || !usable.some((resolver) => resolver.key === draft.resolver_key));
  const missingSourceSystem = draft.measurement_source === "structured_import" && !draft.source_system?.trim();
  const incomplete = missingResolver || missingSourceSystem;

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
      <fieldset className="standards-choice standards-segmented">
        <legend>What it measures</legend>
        <div>
          {[
            { value: "occurrence" as const, label: "Counted events", hint: "each one logged and charged" },
            { value: "threshold" as const, label: "Monthly value", hint: "one number, scored against bands" },
          ].map((option) => (
            <label key={option.value} className={draft.standard_type === option.value ? "selected" : ""}>
              <input
                type="radio" name="standard-type" value={option.value} disabled={!canEdit}
                checked={draft.standard_type === option.value}
                onChange={() => set("standard_type", option.value)}
              />
              <strong>{option.label}</strong><small>{option.hint}</small>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="standards-choice standards-segmented">
        <legend>Good performance is</legend>
        <div>
          {[
            { value: "lower_is_better" as const, label: "Lower", hint: "a rising number is worse" },
            { value: "higher_is_better" as const, label: "Higher", hint: "a falling number is worse" },
          ].map((option) => (
            <label key={option.value} className={draft.direction === option.value ? "selected" : ""}>
              <input
                type="radio" name="standard-direction" value={option.value} disabled={!canEdit}
                checked={draft.direction === option.value}
                onChange={() => set("direction", option.value)}
              />
              <strong>{option.label}</strong><small>{option.hint}</small>
            </label>
          ))}
        </div>
      </fieldset>
      <label><span>Priority</span>
        <select value={draft.priority} disabled={!canEdit} onChange={(event) => set("priority", event.target.value as PerformanceStandardInput["priority"])}>
          {withCurrent(vocab.priorities, draft.priority).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      <label><span>Unit</span>
        <select
          value={vocab.units.some((unit) => unit.value === draft.unit_label) ? draft.unit_label : "__custom"}
          disabled={!canEdit}
          onChange={(event) => set("unit_label", event.target.value === "__custom" ? "" : event.target.value)}
        >
          {withCurrent(vocab.units, draft.unit_label).map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
          <option value="__custom">Something else…</option>
        </select>
        {!vocab.units.some((unit) => unit.value === draft.unit_label) &&
          <input value={draft.unit_label} disabled={!canEdit} autoFocus placeholder="Name the unit" onChange={(event) => set("unit_label", event.target.value)} />}
        <small>Percent is stored as a ratio and shown as a percentage everywhere.</small>
      </label>
      {/* Four cards rather than a dropdown: the choice decides what the
          standard needs next, so each option carries the consequence beside
          it instead of hiding it behind a closed select. Real radios, so
          arrow keys and screen readers behave. */}
      <fieldset className="standards-choice standards-wide">
        <legend>Where the figure comes from</legend>
        <div className="standards-choice-cards">
          {MEASUREMENT_SOURCES.map((option) => (
            <label key={option.value} className={draft.measurement_source === option.value ? "selected" : ""}>
              <input
                type="radio" name="measurement-source" value={option.value} disabled={!canEdit}
                checked={draft.measurement_source === option.value}
                onChange={() => {
                  // Clearing the fields the new kind does not use: a leftover
                  // resolver on a hand-entered standard reads as automated to
                  // anyone scanning the catalog, and the server refuses it.
                  setDraft({
                    ...draft,
                    measurement_source: option.value,
                    resolver_key: option.value === "api_feed" || option.value === "onboard_compliance" ? draft.resolver_key ?? null : null,
                    source_system: option.value === "structured_import" ? draft.source_system ?? null : null,
                  });
                }}
              />
              <strong>{option.label}</strong>
              <small>{option.hint}</small>
            </label>
          ))}
        </div>
      </fieldset>
      {draft.measurement_source === "structured_import" && <label><span>Source system</span>
        <select
          value={vocab.sourceSystems.some((system) => system.value === draft.source_system) || !draft.source_system ? draft.source_system ?? "" : "__other"}
          disabled={!canEdit}
          onChange={(event) => set("source_system", event.target.value === "__other" ? "" : event.target.value || null)}
        >
          <option value="">Select the system…</option>
          {vocab.sourceSystems.map((system) => <option key={system.value} value={system.value}>{system.label}</option>)}
          <option value="__other">Another system…</option>
        </select>
        {draft.source_system !== null && !vocab.sourceSystems.some((system) => system.value === draft.source_system) &&
          <input value={draft.source_system ?? ""} disabled={!canEdit} placeholder="Name the system" onChange={(event) => set("source_system", event.target.value)} />}
        <small>
          {vocab.sourceSystems.find((system) => system.value === draft.source_system)?.description
            ?? "Names who to chase when the month's figure is missing."}
        </small>
      </label>}
      {automated && <label><span>Measured by</span>
        <select value={draft.resolver_key ?? ""} disabled={!canEdit} onChange={(event) => set("resolver_key", event.target.value || null)}>
          <option value="">Select what measures it…</option>
          {usable.map((resolver) => <option key={resolver.key} value={resolver.key}>{resolver.label}</option>)}
        </select>
        {chosen && chosen.source === draft.measurement_source && chosen.applies_to === draft.standard_type && <small>{chosen.description}</small>}
        {missingResolver && <small className="standards-flag">
          {usable.length
            ? "Pick what measures this standard. Without it the month is reported as not assessable rather than scored."
            : `Nothing registered serves a ${draft.standard_type === "threshold" ? "monthly-value" : "counted-events"} standard from this source. Enter it by hand instead.`}
        </small>}
      </label>}
      <ListField
        label="Category" options={vocab.categories} value={draft.category ?? ""} disabled={!canEdit}
        hint="Which part of the contract this belongs to. Groups the catalog and a scorecard; it is never read when a month is scored."
        onChange={(value) => set("category", value || null)}
      />
      <ListField
        label="Responsible team" options={vocab.teams} value={draft.responsible_team ?? ""} disabled={!canEdit}
        hint="The team accountable for this standard. Maintained under Lists."
        onChange={(value) => set("responsible_team", value)}
      />
      <ListField
        label="Assigned to" options={vocab.owners} value={draft.assigned_to ?? ""} disabled={!canEdit}
        hint="The person who owns it month to month, and who is chased when a figure is missing."
        onChange={(value) => set("assigned_to", value)}
      />
      <label><span>Effective from</span><input type="date" value={toInputDate(draft.effective_start_date)} disabled={!canEdit} onChange={(event) => set("effective_start_date", toServiceDate(event.target.value))} /></label>
      <label><span>Retired after</span><input type="date" value={toInputDate(draft.effective_end_date)} disabled={!canEdit} onChange={(event) => set("effective_end_date", event.target.value ? toServiceDate(event.target.value) : null)} /></label>
      <label><span>Sort order</span><input type="number" min={0} value={draft.sort_order} disabled={!canEdit} onChange={(event) => set("sort_order", Number(event.target.value))} /></label>
      <label className="contractor-active"><input type="checkbox" checked={draft.is_scored} disabled={!canEdit} onChange={(event) => set("is_scored", event.target.checked)} /><span>Scored by default</span></label>
      <label className="contractor-active"><input type="checkbox" checked={draft.is_safety_critical} disabled={!canEdit} onChange={(event) => set("is_safety_critical", event.target.checked)} /><span>Safety-critical</span></label>
      <label className="standards-wide"><span>Description</span>
        <textarea
          rows={2} value={draft.description ?? ""} disabled={!canEdit}
          placeholder="What this standard measures, in a sentence."
          onChange={(event) => set("description", event.target.value)}
        />
        <small>Shown under the standard's name in the catalog list, clamped to two lines with the rest on hover.</small>
      </label>
      <label className="standards-wide"><span>Data source note</span><textarea rows={2} value={draft.data_source_note ?? ""} disabled={!canEdit} onChange={(event) => set("data_source_note", event.target.value)} placeholder="Which feed, which filter, and any definition the contract settles." /></label>
      <fieldset className="standards-choice standards-wide">
        <legend>Corrective action window</legend>
        <div className="standards-choice-cards">
          {CAP_WINDOW_MODES.map((option) => (
            <label key={option.value || "none"} className={(draft.cap_window_mode ?? "") === option.value ? "selected" : ""}>
              <input
                type="radio" name="cap-window-mode" value={option.value} disabled={!canEdit}
                checked={(draft.cap_window_mode ?? "") === option.value}
                onChange={() => {
                  // Each mode keeps only the fields it reads. A day count left
                  // beside a calendar quarter is a number nothing uses, and a
                  // threshold left behind with no window would be stored as a
                  // rule that never trips; migration 109's CHECK refuses both.
                  const mode = option.value === "" ? null : option.value;
                  setDraft({
                    ...draft,
                    cap_window_mode: mode,
                    cap_window_days: mode === "rolling_days" ? draft.cap_window_days ?? 90 : null,
                    cap_window_threshold: mode ? draft.cap_window_threshold ?? 3 : null,
                  });
                }}
              />
              <strong>{option.label}</strong>
              <small>{option.hint}</small>
            </label>
          ))}
        </div>
      </fieldset>
      {draft.cap_window_mode && <label><span>More than</span>
        <input
          type="number" min={1} step={1} value={draft.cap_window_threshold ?? ""} disabled={!canEdit}
          onChange={(event) => set("cap_window_threshold", event.target.value === "" ? null : Number(event.target.value))}
        />
        <small>Occurrences in the window before corrective action is owed. The window trips above this count, not at it.</small>
      </label>}
      {draft.cap_window_mode === "rolling_days" && <label><span>Within</span>
        <input
          type="number" min={1} max={3650} step={1} value={draft.cap_window_days ?? ""} disabled={!canEdit}
          onChange={(event) => set("cap_window_days", event.target.value === "" ? null : Number(event.target.value))}
        />
        <small>Days the count reaches back over, from any point. 90 is a rolling quarter; it is not the same rule as a calendar quarter.</small>
      </label>}
      {draft.cap_window_mode && <p className="standards-wide standards-hint">{capWindowSentence(draft)}</p>}
      <label className="standards-wide"><span>CAP rule note</span><textarea rows={2} value={draft.cap_rule_note ?? ""} disabled={!canEdit} onChange={(event) => set("cap_rule_note", event.target.value)} />
        <small>What the contract says in words. The window above is what the scoring engine reads.</small>
      </label>
    </div>
    {canEdit && <button
      className="btn-primary"
      disabled={busy || !draft.code || !draft.name.trim() || !draft.unit_label.trim() || incomplete}
      onClick={() => onSave(isNew ? crypto.randomUUID() : standardId, draft)}
    >{isNew ? "Add standard" : "Save standard"}</button>}
  </section>;
}

// One band bound, with a slider only where a slider means anything.
//
// A percentage runs 0-100 on a scale everyone shares, and Attachment G's own
// thresholds sit on round numbers - dragging to 85 and nudging is genuinely
// faster than typing. Miles between road calls does not work that way: its
// bands are 10,000-12,000 on an open-ended scale, so a 0-100 track would be
// meaningless and a track sized to today's numbers would be a guess. Those
// keep the number field alone.
//
// The number input stays authoritative either way: the slider steps in halves,
// and a contract that says 84.9% has to be typeable.
// A value chosen from a list, with room for one the list does not have yet.
//
// The lists are seeded from what the catalog already holds, so they start
// complete - but a new team or owner appearing mid-edit should not mean
// leaving the standard to add it somewhere else. Anything typed here is saved
// on the standard; adding it under Lists is what offers it to everyone else.
function ListField({ label, options, value, disabled, hint, onChange }: {
  label: string; options: VocabularyOption[]; value: string; disabled: boolean; hint: string;
  onChange: (value: string) => void;
}) {
  // Typing a new value is a mode the reader chooses, not something inferred
  // from the value being unknown - otherwise clearing the box to type would
  // close the box you were typing in. A value the list has not caught up with
  // still shows as itself, via withCurrent, rather than as "Someone else".
  const [entering, setEntering] = useState(false);
  const choices = withCurrent(options, value);
  return <label>
    <span>{label}</span>
    <select
      value={entering ? "__other" : value} disabled={disabled}
      onChange={(event) => {
        if (event.target.value === "__other") { setEntering(true); return; }
        setEntering(false);
        onChange(event.target.value);
      }}
    >
      <option value="">Not set</option>
      {choices.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      <option value="__other">Someone else…</option>
    </select>
    {entering && <input
      value={value} disabled={disabled} autoFocus placeholder={`Name the ${label.toLowerCase()}`}
      onChange={(event) => onChange(event.target.value)}
    />}
    {!options.length
      ? <small>No {label.toLowerCase()} list exists yet. Anything entered here is saved on the standard; add it under Lists to offer it everywhere.</small>
      : <small>{hint}</small>}
  </label>;
}

function BoundField({ label, unit, value, disabled, onChange }: {
  label: string; unit: string; value: number | null; disabled: boolean;
  onChange: (bound: number | null) => void;
}) {
  const ratio = isRatioUnit(unit);
  const text = boundToInput(value, unit);
  return (
    <label className={ratio ? "standards-bound has-slider" : "standards-bound"}>
      <span>{label}</span>
      <div className="standards-measure">
        <input
          inputMode="decimal" value={text} disabled={disabled}
          onChange={(event) => onChange(inputToBound(event.target.value, unit))}
        />
        <span>{ratio ? "%" : unit}</span>
      </div>
      {ratio && <input
        className="standards-slider" type="range" min={0} max={100} step={0.5}
        aria-label={`${label} (percent)`}
        value={text === "" ? 0 : Number(text)} disabled={disabled}
        onChange={(event) => onChange(inputToBound(event.target.value, unit))}
      />}
    </label>
  );
}

function TierEditor({ standard, tiers, agreement, canEdit, busy, knownQualifiers, vocab, onSave }: {
  standard: ContractorPerformanceStandard; tiers: ContractorStandardTier[]; agreement: PerformanceAgreementRecord | null;
  canEdit: boolean; busy: boolean; knownQualifiers: string[]; vocab: Vocabulary;
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
                {withCurrent(vocab.tierLabels, tier.tier_label).map((label) => <option key={label.value} value={label.value}>{label.label}</option>)}
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
            {(range === "at_or_above" || range === "between") && <BoundField
              label={range === "between" ? "From (included)" : "At or above"}
              unit={unit} value={tier.bound_low} disabled={!canEdit}
              onChange={(bound) => update(index, { bound_low: bound })}
            />}
            {(range === "under" || range === "between") && <BoundField
              label="Up to, not including"
              unit={unit} value={tier.bound_high} disabled={!canEdit}
              onChange={(bound) => update(index, { bound_high: bound })}
            />}
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
                {knownQualifiers.map((code) => <option key={code} value={code}>Only when: {vocab.conditions.find((option) => option.value === code)?.label ?? qualifierLabel(code)}</option>)}
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
                {withCurrent(vocab.penaltyBases, tier.penalty_basis).map((basis) => <option key={basis.value} value={basis.value}>{basis.label}</option>)}
              </select>
              <small>{vocab.penaltyBases.find((basis) => basis.value === tier.penalty_basis)?.description}</small>
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
