import { useEffect, useMemo, useState } from "react";
import type { DecisionMatrixCandidate, DecisionMatrixProcedure, ProcedureTrustState } from "@mvta/shared";
import { ApiError } from "@mvta/shared";
import { useSearchParams } from "react-router-dom";
import { api } from "../../config.js";
import { useAuth } from "../../auth/AuthContext.js";
import "./decisionMatrix.css";

type View = "scan" | "browse" | "qrg";
const TRUST_STATES: ProcedureTrustState[] = ["Approved", "Preview", "Needs review", "Stale", "Partial", "Unavailable", "Retired"];
const TRUST_CLASS: Record<ProcedureTrustState, string> = {
  Approved: "pill-success", Preview: "pill-warning", "Needs review": "pill-warning",
  Stale: "pill-danger", Partial: "pill-warning", Unavailable: "pill-muted", Retired: "pill-muted",
};

function trustLabel(state: ProcedureTrustState) { return state; }

export function DecisionMatrix() {
  const { roles } = useAuth();
  const isAdmin = roles.includes("OCC.Admin");
  const [searchParams] = useSearchParams();
  const [procedures, setProcedures] = useState<DecisionMatrixProcedure[] | null>(null);
  const [diagnostics, setDiagnostics] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [view, setView] = useState<View>("scan");
  const [trustStates, setTrustStates] = useState<Set<ProcedureTrustState>>(new Set());
  const [tags, setTags] = useState<Set<string>>(new Set());
  const [documentTypes, setDocumentTypes] = useState<Set<"SOP" | "REF">>(new Set());
  const [matches, setMatches] = useState<DecisionMatrixCandidate[]>([]);

  useEffect(() => {
    api.getDecisionMatrix({ q: query || undefined, includeHistory: isAdmin })
      .then((result) => {
        setProcedures(result.procedures);
        setDiagnostics(result.diagnostics.table_ready ? null : "Procedure content is not connected yet; no authoritative records are available.");
        setError(null);
      })
      .catch((reason) => {
        setProcedures([]);
        setError(reason instanceof ApiError ? reason.message : "Decision Matrix content is temporarily unavailable.");
      });
  }, [query, isAdmin]);

  const sourceContext = searchParams.get("source");
  const sourceId = searchParams.get("source_id");
  const selectedProcedureId = searchParams.get("procedure_id");
  const selectedRevision = searchParams.get("revision");

  useEffect(() => {
    if (!sourceContext || !query) {
      setMatches([]);
      return;
    }
    api.getDecisionMatrixMatches({ q: query, source: sourceContext, sourceId: sourceId ?? undefined })
      .then((result) => setMatches(result.candidates))
      .catch(() => setMatches([]));
  }, [query, sourceContext, sourceId]);

  const allTags = useMemo(() => [...new Set((procedures ?? []).flatMap((p) => p.tags))].sort(), [procedures]);
  const filtered = useMemo(() => (procedures ?? []).filter((p) => {
    if (trustStates.size && !trustStates.has(p.trust_state)) return false;
    if (documentTypes.size && !documentTypes.has(p.document_type)) return false;
    if (tags.size && ![...tags].every((tag) => p.tags.includes(tag))) return false;
    return true;
  }), [procedures, trustStates, documentTypes, tags]);

  function toggle<T>(set: Set<T>, value: T, setter: (next: Set<T>) => void) {
    const next = new Set(set);
    if (next.has(value)) next.delete(value); else next.add(value);
    setter(next);
  }

  function clearFilters() {
    setTrustStates(new Set());
    setTags(new Set());
    setDocumentTypes(new Set());
  }

  const activeFilterCount = trustStates.size + tags.size + documentTypes.size;
  return (
    <div className="dmx">
      <header className="dmx-hero">
        <span className="dmx-eyebrow">Governed operational guidance</span>
        <h1>Control Center Decision Matrix</h1>
        <p>Search the structured summary, confirm its trust state, then open the full approved SOP or REF.</p>
        {sourceContext ? <p className="dmx-context" role="status">Opened from operational context: <strong>{sourceContext}</strong>{sourceId ? ` · record ${sourceId}` : ""}{selectedProcedureId ? ` · Procedure ${selectedProcedureId}${selectedRevision ? ` rev ${selectedRevision}` : ""}` : ""}</p> : null}
      </header>

      <div className="dmx-controls">
        <div className="searchrow">
          <label className="sr-only" htmlFor="decision-matrix-search">Search Procedures</label>
          <input id="decision-matrix-search" className="search" type="search" placeholder="Search conditions, criteria, actions, tags, or document code…" value={query} onChange={(event) => setQuery(event.target.value)} />
          {query ? <button className="btn-sm" type="button" onClick={() => setQuery("")}>Clear search</button> : null}
          <div className="viewtoggle" role="tablist" aria-label="Decision Matrix view">
            {(["scan", "browse", "qrg"] as const).map((option) => (
              <button key={option} type="button" role="tab" aria-selected={view === option} className={view === option ? "active" : ""} onClick={() => setView(option)}>
                {option === "scan" ? "Scan" : option === "browse" ? "Browse" : "QRG"}
              </button>
            ))}
          </div>
        </div>

        <div className="dmx-filter-group" aria-label="Trust state filters">
          <span className="dmx-filter-label">Trust state</span>
          {TRUST_STATES.map((state) => <button type="button" className="dmx-filter" aria-pressed={trustStates.has(state)} data-active={trustStates.has(state)} key={state} onClick={() => toggle(trustStates, state, setTrustStates)}>{state}</button>)}
        </div>
        <div className="dmx-filter-group" aria-label="Document type filters">
          <span className="dmx-filter-label">Document</span>
          {(["SOP", "REF"] as const).map((type) => <button type="button" className="dmx-filter" aria-pressed={documentTypes.has(type)} data-active={documentTypes.has(type)} key={type} onClick={() => toggle(documentTypes, type, setDocumentTypes)}>{type}</button>)}
        </div>
        {allTags.length ? <div className="dmx-filter-group" aria-label="Tag filters"><span className="dmx-filter-label">Tags (all selected must match)</span>{allTags.map((tag) => <button type="button" className="dmx-filter" aria-pressed={tags.has(tag)} data-active={tags.has(tag)} key={tag} onClick={() => toggle(tags, tag, setTags)}>{tag}</button>)}</div> : null}
        {activeFilterCount ? <div className="dmx-active-filters" role="status">{activeFilterCount} active filter{activeFilterCount === 1 ? "" : "s"}<button type="button" className="btn-sm" onClick={clearFilters}>Clear all filters</button></div> : null}
        <div className="dmx-meta">{filtered.length} of {(procedures ?? []).length} Procedures</div>
        {isAdmin ? <div className="dmx-admin-actions"><span className="dmx-meta">Admin governance controls are available on each revision.</span></div> : null}
      </div>

      {diagnostics ? <div className="dmx-state dmx-state-warning" role="status">{diagnostics}</div> : null}
      {error ? <div className="dmx-state dmx-state-error" role="alert">{error}</div> : null}
      {sourceContext && matches.length ? <div className="dmx-matches" aria-label="Suggested Procedure matches"><strong>Suggested Procedures for this context</strong>{matches.map((match) => <span key={`${match.procedure_id}-${match.revision}`}>{match.condition} · {match.match_reason}</span>)}</div> : null}
      {procedures === null ? <div className="dmx-empty" role="status">Loading governed Procedures…</div> : filtered.length === 0 ? <div className="dmx-empty">No Procedures match this search or filter set.</div> : view === "qrg" ? <QrgView procedures={filtered} /> : view === "browse" ? <div className="matrix-grid">{filtered.map((procedure) => <MatrixCard key={`${procedure.procedure_id}-${procedure.revision}`} procedure={procedure} isAdmin={isAdmin} />)}</div> : <div className="matrix-list">{filtered.map((procedure) => <MatrixRow key={`${procedure.procedure_id}-${procedure.revision}`} procedure={procedure} isAdmin={isAdmin} />)}</div>}
    </div>
  );
}

function TrustPill({ state }: { state: ProcedureTrustState }) { return <span className={`pill-sm ${TRUST_CLASS[state]}`}>{trustLabel(state)}</span>; }

function GovernanceActions({ procedure, isAdmin }: { procedure: DecisionMatrixProcedure; isAdmin: boolean }) {
  if (!isAdmin || procedure.approval_state === "Retired") return null;
  return <div className="dmx-governance"><button type="button" className="btn-sm" disabled={procedure.approval_state === "Approved"} onClick={() => api.governDecisionMatrix(procedure.procedure_id, procedure.revision, "approve").then(() => window.location.reload())}>Approve</button><button type="button" className="btn-sm danger" onClick={() => api.governDecisionMatrix(procedure.procedure_id, procedure.revision, "retire", "Retired by OCC Admin").then(() => window.location.reload())}>Retire</button></div>;
}

function ProcedureActions({ procedure, isAdmin }: { procedure: DecisionMatrixProcedure; isAdmin: boolean }) {
  return <><GovernanceActions procedure={procedure} isAdmin={isAdmin} />{procedure.source_url && procedure.trust_state !== "Unavailable" ? <a className="btn-sm" href={procedure.source_url} target="_blank" rel="noopener noreferrer">Open {procedure.document_type} ↗</a> : <span className="dmx-unavailable">Full {procedure.document_type} unavailable</span>}</>;
}

function MatrixRow({ procedure, isAdmin }: { procedure: DecisionMatrixProcedure; isAdmin: boolean }) {
  return <article className={`row ${procedure.trust_state.toLowerCase().replace(/\s/g, "-")}`}>
    <div className="rowbody"><h3>{procedure.condition}</h3><div className="field"><div className="flabel">Criteria</div><div className="fvalue">{procedure.criteria}</div></div><div className="field"><div className="flabel">Immediate actions</div><ol className="action-list">{procedure.immediate_actions.map((action) => <li key={action}>{action}</li>)}</ol></div><div className="tags">{procedure.tags.map((tag) => <span key={tag}>{tag}</span>)}</div></div>
    <div className="rowaction"><TrustPill state={procedure.trust_state} /><div className="doccode">{procedure.document_type} · {procedure.document_code} · Rev {procedure.revision}</div><ProcedureActions procedure={procedure} isAdmin={isAdmin} /><div className="reviewed">{procedure.owner ? `Owner: ${procedure.owner}` : "Owner unavailable"}<br />Review {procedure.next_review_at ? new Date(procedure.next_review_at).toLocaleDateString() : "date unavailable"}</div></div>
  </article>;
}

function MatrixCard({ procedure, isAdmin }: { procedure: DecisionMatrixProcedure; isAdmin: boolean }) {
  return <article className="card"><div className="card-top"><h3>{procedure.condition}</h3><TrustPill state={procedure.trust_state} /></div><div className="cfield"><span className="clabel">Criteria</span>{procedure.criteria}</div><div className="cfield"><span className="clabel">First action</span>{procedure.immediate_actions[0] ?? "No immediate action published"}</div><div className="ctags">{procedure.tags.map((tag) => <span key={tag}>{tag}</span>)}</div><div className="card-foot"><span className="doccode">{procedure.document_type} · Rev {procedure.revision}</span><ProcedureActions procedure={procedure} isAdmin={isAdmin} /></div></article>;
}

function QrgView({ procedures }: { procedures: DecisionMatrixProcedure[] }) {
  const groups = new Map<string, DecisionMatrixProcedure[]>();
  for (const procedure of procedures) { const group = procedure.affected_workflow || "General operations"; groups.set(group, [...(groups.get(group) ?? []), procedure]); }
  return <div className="dmx-qrg"><div className="dmx-state dmx-state-info">QRG view uses the same governed Procedure records as Scan and Browse.</div>{[...groups.entries()].map(([group, rows]) => <section className="qrg-section" key={group}><h2 className="qrg-section-header">{group}</h2><table className="data"><thead><tr><th>Condition</th><th>Criteria</th><th>Immediate remedy</th><th>Reference</th></tr></thead><tbody>{rows.map((procedure) => <tr key={`${procedure.procedure_id}-${procedure.revision}`}><td><strong>{procedure.condition}</strong><br /><TrustPill state={procedure.trust_state} /></td><td>{procedure.criteria}</td><td>{procedure.immediate_actions[0] ?? "No immediate action published"}</td><td><ProcedureActions procedure={procedure} isAdmin={false} /></td></tr>)}</tbody></table></section>)}</div>;
}
