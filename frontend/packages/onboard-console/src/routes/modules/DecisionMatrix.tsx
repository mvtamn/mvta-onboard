import { useEffect, useMemo, useState } from "react";
import type { DecisionMatrixReaderProcedure, DecisionMatrixRecommendation } from "@mvta/shared";
import { ApiError } from "@mvta/shared";
import { useSearchParams } from "react-router-dom";
import { api } from "../../config.js";
import "./decisionMatrix.css";

type View = "scan" | "action-first" | "grid" | "qrg";
const VIEWS: Array<{ value: View; label: string }> = [{ value: "scan", label: "Reader" }, { value: "action-first", label: "Action first" }, { value: "grid", label: "Grid" }, { value: "qrg", label: "QRG" }];

function formatDate(value: string) { return new Date(value).toLocaleDateString(); }

export function DecisionMatrix() {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const selectedId = searchParams.get("procedure_id");
  const requestedView = searchParams.get("view");
  const view: View = requestedView === "action-first" || requestedView === "grid" || requestedView === "qrg" ? requestedView : "scan";
  const [procedures, setProcedures] = useState<DecisionMatrixReaderProcedure[] | null>(null);
  const [recommendations, setRecommendations] = useState<DecisionMatrixRecommendation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const sourceType = searchParams.get("source_type");
  const sourceQualifier = searchParams.get("source_qualifier");

  useEffect(() => {
    api.getDecisionMatrix({ q: query || undefined }).then((result) => { setProcedures(result.procedures); setError(null); }).catch((reason) => { setProcedures([]); setError(reason instanceof ApiError ? reason.message : "Decision Matrix content is temporarily unavailable."); });
  }, [query]);

  useEffect(() => {
    if ((sourceType !== "SuggestedAlert" && sourceType !== "ServiceRisk") || !sourceQualifier) { setRecommendations([]); return; }
    api.getDecisionMatrixRecommendations({ sourceType, sourceQualifier }).then((result) => setRecommendations(result.recommendations)).catch(() => setRecommendations([]));
  }, [sourceType, sourceQualifier]);

  const selected = useMemo(() => procedures?.find((procedure) => procedure.procedure_id === selectedId) ?? null, [procedures, selectedId]);
  function update(params: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams);
    for (const [name, value] of Object.entries(params)) value ? next.set(name, value) : next.delete(name);
    setSearchParams(next, { replace: true });
  }

  return <div className="dmx">
    <header className="dmx-hero"><span className="dmx-eyebrow">Governed operational guidance</span><h1>Control Center Decision Matrix</h1><p>Read approved criteria and immediate actions first. Supporting documents remain in SharePoint.</p></header>
    <div className="dmx-controls"><div className="searchrow"><label className="sr-only" htmlFor="decision-matrix-search">Search approved Procedures</label><input id="decision-matrix-search" className="search" type="search" placeholder="Search condition, criteria, actions, tags, or document identifier…" value={query} onChange={(event) => update({ q: event.target.value || null })} />{query ? <button className="btn-sm" type="button" onClick={() => update({ q: null })}>Clear search</button> : null}<div className="viewtoggle" aria-label="Decision Matrix view">{VIEWS.map((option) => <button key={option.value} type="button" aria-pressed={view === option.value} className={view === option.value ? "active" : ""} onClick={() => update({ view: option.value })}>{option.label}</button>)}</div></div><div className="dmx-meta">{procedures?.length ?? 0} approved Procedure{procedures?.length === 1 ? "" : "s"}</div></div>
    {error ? <div className="dmx-state dmx-state-error" role="alert">{error}</div> : null}
    {recommendations.length ? <section className="dmx-matches" aria-label="Suggested Procedures"><strong>Suggested Procedures — controller selection required</strong><span>Source: {sourceType} · {sourceQualifier}</span>{recommendations.map((recommendation) => <div className="dmx-recommendation" key={recommendation.match_rule_id}><button type="button" className="btn-sm" onClick={() => update({ procedure_id: recommendation.procedure_id })}>Choose {recommendation.condition}</button><span>Priority {recommendation.priority} · {recommendation.explanation}</span></div>)}</section> : null}
    {procedures === null ? <div className="dmx-empty" role="status">Loading approved Procedures…</div> : procedures.length === 0 ? <div className="dmx-empty">No approved Procedures match this search.</div> : view === "grid" ? <div className="matrix-grid">{procedures.map((procedure) => <ProcedureCard key={`${procedure.procedure_id}-${procedure.revision}`} procedure={procedure} onSelect={() => update({ procedure_id: procedure.procedure_id })} />)}</div> : view === "qrg" ? <QrgView procedures={procedures} onSelect={(id) => update({ procedure_id: id })} /> : <div className="matrix-list">{procedures.map((procedure) => <ProcedureReader key={`${procedure.procedure_id}-${procedure.revision}`} procedure={procedure} actionFirst={view === "action-first"} expanded={selected?.procedure_id === procedure.procedure_id || !selectedId} onSelect={() => update({ procedure_id: procedure.procedure_id })} />)}</div>}
  </div>;
}

function ProcedureReader({ procedure, actionFirst, expanded, onSelect }: { procedure: DecisionMatrixReaderProcedure; actionFirst: boolean; expanded: boolean; onSelect: () => void }) {
  const content = <><section className="field"><div className="flabel">Criteria</div><ul className="fvalue">{procedure.criteria.map((criterion) => <li key={criterion.id}>{criterion.kind === "excludes" ? "Does not apply: " : "Applies: "}{criterion.text}</li>)}</ul></section><section className="field"><div className="flabel">Immediate actions</div><ol className="action-list">{procedure.immediate_actions.map((action) => <li key={action.id}>{action.instruction}</li>)}</ol></section></>;
  return <article className="row"><div className="rowbody"><div className="card-top"><h2>{procedure.condition}</h2><button type="button" className="btn-sm" onClick={onSelect} aria-pressed={expanded}>{expanded ? "Selected" : "Read Procedure"}</button></div>{actionFirst ? <><section className="field"><div className="flabel">Immediate actions</div><ol className="action-list">{procedure.immediate_actions.map((action) => <li key={action.id}>{action.instruction}</li>)}</ol></section><section className="field"><div className="flabel">Criteria</div><ul className="fvalue">{procedure.criteria.map((criterion) => <li key={criterion.id}>{criterion.kind === "excludes" ? "Does not apply: " : "Applies: "}{criterion.text}</li>)}</ul></section></> : content}{expanded ? <ProcedureDetails procedure={procedure} /> : null}</div></article>;
}

function ProcedureDetails({ procedure }: { procedure: DecisionMatrixReaderProcedure }) {
  const warnings = procedure.document_references.filter((reference) => reference.health_status !== "Valid");
  const primary = procedure.document_references.find((reference) => reference.source_available);
  return <div className="dmx-details"><section className="field"><div className="flabel">Revision</div><div className="fvalue">Approved revision {procedure.revision}</div></section><section className="field"><div className="flabel">Severity</div><div className="fvalue"><strong>{procedure.severity}</strong><br />{procedure.severity_meaning}</div></section><section className="field"><div className="flabel">Owner & review</div><div className="fvalue">{procedure.owner_team}{procedure.owner_contact ? ` · ${procedure.owner_contact}` : ""}<br />Effective {formatDate(procedure.effective_at)} · review by {formatDate(procedure.next_review_at)}</div></section>{warnings.length ? <div className="dmx-state dmx-state-warning" role="status"><strong>Document check needed:</strong> {warnings.map((reference) => `${reference.expected_file_name} is ${reference.health_status.toLowerCase()}${reference.health_reason ? ` — ${reference.health_reason}` : ""}`).join("; ")}. Guidance above remains available.</div> : null}<section className="dmx-documents" aria-label="Supporting documents"><h3>Supporting documents</h3>{procedure.document_references.map((reference) => <DocumentReference key={reference.reference_id} procedure={procedure} reference={reference} />)}{primary ? <a className="btn-sm" href={primary.web_url} target="_blank" rel="noopener noreferrer">Open primary {primary.document_type} in SharePoint ↗</a> : <span className="dmx-unavailable">Primary SOP or Reference is unavailable until its health check is valid.</span>}</section></div>;
}

function DocumentReference({ procedure, reference }: { procedure: DecisionMatrixReaderProcedure; reference: DecisionMatrixReaderProcedure["document_references"][number] }) {
  const [preview, setPreview] = useState<string | null>(null); const [error, setError] = useState<string | null>(null);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  async function showPreview() { try { const file = await api.getDecisionMatrixRendition(procedure.procedure_id, procedure.revision, reference.reference_id); setPreview(URL.createObjectURL(file)); setError(null); } catch { setError("The visual rendition cannot be displayed with your current SharePoint access."); } }
  return <div className="dmx-document"><span><strong>{reference.document_type}</strong> · {reference.document_code} · {reference.expected_file_name} · {reference.health_status}{reference.checked_at ? ` · checked ${formatDate(reference.checked_at)}` : " · not yet checked"}{reference.health_reason ? ` — ${reference.health_reason}` : ""}</span>{reference.inline_preview_available ? <button type="button" className="btn-sm" onClick={showPreview}>View inline</button> : null}<a href={reference.web_url} target="_blank" rel="noopener noreferrer" className="btn-sm">Open in SharePoint ↗</a>{preview ? <img className="dmx-rendition" src={preview} alt={`${reference.document_type}: ${reference.expected_file_name}`} /> : null}{error ? <span className="dmx-unavailable">{error}</span> : null}</div>;
}

function ProcedureCard({ procedure, onSelect }: { procedure: DecisionMatrixReaderProcedure; onSelect: () => void }) { return <article className="card"><div className="card-top"><h2>{procedure.condition}</h2><button className="btn-sm" type="button" onClick={onSelect}>Read</button></div><div className="cfield"><span className="clabel">First action</span>{procedure.immediate_actions[0]?.instruction ?? "No action published"}</div><div className="cfield"><span className="clabel">Criteria</span>{procedure.criteria[0]?.text ?? "No criteria published"}</div><div className="ctags">{procedure.tags.map((tag) => <span key={tag}>{tag}</span>)}</div></article>; }
function QrgView({ procedures, onSelect }: { procedures: DecisionMatrixReaderProcedure[]; onSelect: (id: string) => void }) { return <div className="dmx-qrg"><div className="dmx-state dmx-state-info">QRGs are rendered inline when they are Valid PNG or JPEG visual renditions. SOPs, References, Forms, and applications open in SharePoint.</div><table className="data"><thead><tr><th>Condition</th><th>Immediate action</th><th>Quick reference</th></tr></thead><tbody>{procedures.map((procedure) => <tr key={`${procedure.procedure_id}-${procedure.revision}`}><td><button type="button" className="btn-sm" onClick={() => onSelect(procedure.procedure_id)}>{procedure.condition}</button></td><td>{procedure.immediate_actions[0]?.instruction}</td><td>{procedure.document_references.filter((reference) => reference.document_type === "QRG" || reference.document_type === "Visual rendition").map((reference) => <DocumentReference key={reference.reference_id} procedure={procedure} reference={reference} />)}</td></tr>)}</tbody></table></div>; }
