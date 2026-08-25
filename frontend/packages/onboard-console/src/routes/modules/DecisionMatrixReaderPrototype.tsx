// PROTOTYPE ONLY: four Decision Matrix reader layouts, switchable on /occ?prototype=reader&variant=.
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import "./decisionMatrixReaderPrototype.css";

type Variant = "split" | "action-first" | "progressive" | "grid";
type PreviewState = "ready" | "loading" | "unavailable";
type DocumentHealth = "Valid" | "Needs review" | "Unavailable";

type Procedure = {
  id: string;
  condition: string;
  severity: "Stop service" | "Restrict service" | "Routine / no escalation";
  severityMeaning: string;
  criteria: string[];
  actions: string[];
  owner: string;
  effectiveRevision: string;
  health: DocumentHealth;
  healthDetail: string;
  sourceAvailable: boolean;
  hasRendition: boolean;
  withdrawal?: { reason: string; replacement: string };
};

const VARIANTS: { key: Variant; label: string }[] = [
  { key: "split", label: "Split detail" },
  { key: "action-first", label: "Action-first detail" },
  { key: "progressive", label: "Progressive detail" },
  { key: "grid", label: "Existing grid" },
];

const PROCEDURES: Procedure[] = [
  {
    id: "vehicle-collision",
    condition: "Vehicle collision with injury or blocked lane",
    severity: "Stop service",
    severityMeaning: "Suspend affected service until emergency command releases the scene.",
    criteria: ["A person reports an injury, vehicle damage affects safe operation, or a travel lane is blocked.", "Do not use this Procedure for a minor incident with no injury, damage, or safety effect."],
    actions: ["Stop the affected vehicle and protect the scene.", "Notify emergency services and OCC command staff.", "Record the location, involved vehicle, and immediate safety status."],
    owner: "Operations Control Center",
    effectiveRevision: "Revision 4 · effective Aug 12, 2026",
    health: "Valid",
    healthDetail: "Primary SOP version matches the approved revision. Checked today at 08:42.",
    sourceAvailable: true,
    hasRendition: true,
  },
  {
    id: "lift-outage",
    condition: "Lift or mobility-device securement outage",
    severity: "Restrict service",
    severityMeaning: "Continue only where accessible service can be safely maintained.",
    criteria: ["A lift, ramp, or securement device fails its pre-trip or in-service check.", "Exclude a temporary delay where the device is still safe and available."],
    actions: ["Restrict the vehicle from trips requiring the affected accessibility feature.", "Arrange an accessible replacement or customer support response.", "Notify maintenance and document the vehicle restriction."],
    owner: "Accessible Service Operations",
    effectiveRevision: "Revision 2 · effective Jul 7, 2026",
    health: "Needs review",
    healthDetail: "The primary SOP changed in SharePoint after approval. Keep using this structured guidance and ask an Admin to review the document reference.",
    sourceAvailable: true,
    hasRendition: false,
  },
  {
    id: "routine-delay",
    condition: "Routine traffic delay with no safety impact",
    severity: "Routine / no escalation",
    severityMeaning: "Record the delay and manage service normally; no escalation is required.",
    criteria: ["Traffic or congestion delays the trip without a safety concern or missed critical connection.", "Exclude conditions that trigger a safety, accessibility, or service interruption Procedure."],
    actions: ["Record the delay using the standard operational log.", "Advise the operator to continue service safely.", "Monitor for a changed condition that requires another Procedure."],
    owner: "Service Delivery",
    effectiveRevision: "Revision 1 · effective Jun 10, 2026",
    health: "Unavailable",
    healthDetail: "The primary source cannot currently be opened. The approved structured actions remain available; report the reference failure to an Admin.",
    sourceAvailable: false,
    hasRendition: false,
  },
  {
    id: "bridge-closure",
    condition: "Bridge closure detour guidance",
    severity: "Restrict service",
    severityMeaning: "This former Procedure must not be used for a new service condition.",
    criteria: ["This fixture represents an emergency-withdrawn Procedure reached through an old link."],
    actions: ["Do not use the withdrawn guidance.", "Open the identified replacement Procedure before making an operating decision."],
    owner: "Service Delivery",
    effectiveRevision: "Revision 3 · withdrawn Aug 23, 2026",
    health: "Unavailable",
    healthDetail: "Historical document access is not a substitute for current approved guidance.",
    sourceAvailable: false,
    hasRendition: false,
    withdrawal: { reason: "The detour boundaries were found to be unsafe.", replacement: "Current bridge closure detour Procedure" },
  },
];

const RECOMMENDATIONS = [
  { procedureId: "vehicle-collision", source: "Suggested Alert", reason: "The alert reports an injury and a blocked lane." },
  { procedureId: "lift-outage", source: "Service Risk", reason: "The affected trip has an active accessible-service constraint." },
];

function isVariant(value: string | null): value is Variant {
  return VARIANTS.some((variant) => variant.key === value);
}

export function DecisionMatrixReaderPrototype() {
  const [searchParams, setSearchParams] = useSearchParams();
  const variantParam = searchParams.get("variant");
  const variant: Variant = isVariant(variantParam) ? variantParam : "split";
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [previewState, setPreviewState] = useState<PreviewState>("ready");
  const selected = PROCEDURES.find((procedure) => procedure.id === selectedId) ?? null;
  const visibleProcedures = useMemo(() => PROCEDURES.filter((procedure) => `${procedure.condition} ${procedure.criteria.join(" ")} ${procedure.actions.join(" ")}`.toLowerCase().includes(query.toLowerCase())), [query]);
  const displayedProcedure = selected === null ? null : visibleProcedures.find((procedure) => procedure.id === selected.id) ?? null;

  function chooseProcedure(procedureId: string) {
    setSelectedId(procedureId);
    setPreviewState("ready");
  }

  function setVariant(next: Variant) {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("prototype", "reader");
    nextParams.set("variant", next);
    setSearchParams(nextParams);
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const element = event.target as HTMLElement | null;
      if (element?.matches("input, textarea, [contenteditable='true']")) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const index = VARIANTS.findIndex((item) => item.key === variant);
      const offset = event.key === "ArrowLeft" ? -1 : 1;
      setVariant(VARIANTS[(index + offset + VARIANTS.length) % VARIANTS.length].key);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [searchParams, variant]);

  return (
    <div className="dmxp">
      <header className="dmxp-hero">
        <span>PROTOTYPE · NOT GOVERNED GUIDANCE</span>
        <h1>Decision Matrix reader</h1>
        <p>Compare four views while keeping Criteria and Immediate Actions ahead of document health and visual support.</p>
      </header>

      <section className="dmxp-recommendations" aria-label="Explainable Procedure recommendations">
        <div><strong>Suggested Procedures</strong><p>Choose a Procedure; this prototype never selects one automatically.</p></div>
        <div className="dmxp-recommendation-list">
          {RECOMMENDATIONS.map((recommendation) => {
            const procedure = PROCEDURES.find((item) => item.id === recommendation.procedureId)!;
            return <button key={recommendation.procedureId} type="button" className={selected?.id === procedure.id ? "selected" : ""} onClick={() => chooseProcedure(procedure.id)}>
              <span>{procedure.condition}</span><small>{recommendation.source} · {recommendation.reason}</small>
            </button>;
          })}
        </div>
      </section>

      <label className="dmxp-search" htmlFor="prototype-procedure-search">
        <span>Find guidance</span>
        <input id="prototype-procedure-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search conditions, Criteria, or Immediate Actions" />
      </label>
      <div className="dmxp-fixture-picker" aria-label="Prototype Procedure fixtures">
        <span>Inspect fixture</span>
        {visibleProcedures.map((procedure) => <button key={procedure.id} type="button" className={selected?.id === procedure.id ? "selected" : ""} onClick={() => chooseProcedure(procedure.id)}>{procedure.severity}: {procedure.health}</button>)}
      </div>
      {visibleProcedures.length === 0 ? <p className="dmxp-empty" role="status">No prototype Procedures match this search.</p> : variant === "grid" ? <GridDetail procedures={visibleProcedures} selectedId={selected?.id ?? null} chooseProcedure={chooseProcedure} /> : displayedProcedure === null ? <p className="dmxp-empty" role="status">Select a suggested Procedure, a search result, or a fixture to open its structured guidance.</p> : <>
        {variant === "split" ? <SplitDetail procedure={displayedProcedure} previewState={previewState} setPreviewState={setPreviewState} /> : null}
        {variant === "action-first" ? <ActionFirstDetail procedure={displayedProcedure} previewState={previewState} setPreviewState={setPreviewState} /> : null}
        {variant === "progressive" ? <ProgressiveDetail procedures={visibleProcedures} procedure={displayedProcedure} chooseProcedure={chooseProcedure} previewState={previewState} setPreviewState={setPreviewState} /> : null}
      </>}

      <PrototypeState variant={variant} procedure={displayedProcedure} previewState={previewState} />
      <PrototypeSwitcher variant={variant} setVariant={setVariant} />
    </div>
  );
}

function ProcedureHeader({ procedure }: { procedure: Procedure }) {
  return <header className="dmxp-procedure-header"><div><span className={`dmxp-severity ${procedure.severity.toLowerCase().replaceAll(" ", "-").replaceAll("/", "")}`}>{procedure.severity}</span><h2>{procedure.condition}</h2><p>{procedure.severityMeaning}</p>{procedure.withdrawal ? <p className="dmxp-withdrawal" role="alert"><strong>Withdrawn — do not use this guidance.</strong> {procedure.withdrawal.reason} Use <strong>{procedure.withdrawal.replacement}</strong> instead.</p> : null}</div><div className="dmxp-meta"><strong>{procedure.owner}</strong><span>{procedure.effectiveRevision}</span></div></header>;
}

function Criteria({ procedure }: { procedure: Procedure }) {
  return <section className="dmxp-criteria"><h3>Criteria</h3><ul>{procedure.criteria.map((criterion) => <li key={criterion}>{criterion}</li>)}</ul></section>;
}

function ImmediateActions({ procedure }: { procedure: Procedure }) {
  return <section className="dmxp-actions"><h3>Immediate Actions</h3><ol>{procedure.actions.map((action) => <li key={action}>{action}</li>)}</ol></section>;
}

function DocumentSupport({ procedure, previewState, setPreviewState }: { procedure: Procedure; previewState: PreviewState; setPreviewState: (state: PreviewState) => void }) {
  return <section className="dmxp-documents" aria-label="Document and visual support"><h3>Document support</h3><div className={`dmxp-health ${procedure.health.toLowerCase().replaceAll(" ", "-")}`}><strong>{procedure.health}</strong><p>{procedure.healthDetail}</p></div>{procedure.hasRendition ? <VisualPreview state={previewState} setState={setPreviewState} /> : <p className="dmxp-preview-fallback">No approved PNG/JPEG rendition is available. The structured Procedure remains the operating guidance.</p>}{procedure.sourceAvailable ? <a className="dmxp-source" href="https://mvtamn.sharepoint.com/sites/Operations/" target="_blank" rel="noreferrer">Open source document in SharePoint <span aria-hidden="true">↗</span></a> : <p className="dmxp-source-unavailable">Source document currently unavailable</p>}<ul className="dmxp-supporting-links"><li>QRG · supporting only</li><li>Form · supporting only</li></ul></section>;
}

function VisualPreview({ state, setState }: { state: PreviewState; setState: (state: PreviewState) => void }) {
  return <details className="dmxp-preview"><summary>Open prototype placeholder rendition (PNG)</summary><div className={`dmxp-preview-art ${state}`} aria-live="polite">{state === "loading" ? "Loading approved visual rendition…" : state === "unavailable" ? "Approved visual rendition unavailable" : <><span>Prototype placeholder · scene protection</span><span>Prototype placeholder · emergency response</span><span>Prototype placeholder · OCC notification</span></>}</div><div className="dmxp-preview-controls"><button type="button" onClick={() => setState("ready")}>Show rendition</button><button type="button" onClick={() => setState("loading")}>Preview loading</button><button type="button" onClick={() => setState("unavailable")}>Preview unavailable</button></div></details>;
}

function SplitDetail({ procedure, previewState, setPreviewState }: { procedure: Procedure; previewState: PreviewState; setPreviewState: (state: PreviewState) => void }) {
  return <article className="dmxp-detail dmxp-split-detail"><div className="dmxp-guidance"><ProcedureHeader procedure={procedure} /><Criteria procedure={procedure} /><ImmediateActions procedure={procedure} /></div><aside><DocumentSupport procedure={procedure} previewState={previewState} setPreviewState={setPreviewState} /></aside></article>;
}

function ActionFirstDetail({ procedure, previewState, setPreviewState }: { procedure: Procedure; previewState: PreviewState; setPreviewState: (state: PreviewState) => void }) {
  return <article className="dmxp-detail dmxp-action-first-detail"><ProcedureHeader procedure={procedure} /><ImmediateActions procedure={procedure} /><Criteria procedure={procedure} /><details open><summary>Visual and source-document support</summary><DocumentSupport procedure={procedure} previewState={previewState} setPreviewState={setPreviewState} /></details></article>;
}

function ProgressiveDetail({ procedures, procedure, chooseProcedure, previewState, setPreviewState }: { procedures: Procedure[]; procedure: Procedure; chooseProcedure: (id: string) => void; previewState: PreviewState; setPreviewState: (state: PreviewState) => void }) {
  return <article className="dmxp-detail dmxp-progressive-detail"><nav aria-label="Prototype search results"><h2>Results</h2>{procedures.map((item) => <button key={item.id} type="button" className={item.id === procedure.id ? "selected" : ""} onClick={() => chooseProcedure(item.id)}><strong>{item.condition}</strong><span>{item.actions[0]}</span></button>)}</nav><div className="dmxp-progressive-reader"><ProcedureHeader procedure={procedure} /><ImmediateActions procedure={procedure} /><Criteria procedure={procedure} /><details><summary>Open visual and source-document support</summary><DocumentSupport procedure={procedure} previewState={previewState} setPreviewState={setPreviewState} /></details></div></article>;
}

function GridDetail({ procedures, selectedId, chooseProcedure }: { procedures: Procedure[]; selectedId: string | null; chooseProcedure: (id: string) => void }) {
  return <section className="dmxp-grid-detail"><header><div><span>EXISTING BROWSE PATTERN</span><h2>Procedure grid</h2><p>High-density scanning of conditions, first actions, and Document Reference Health. Select a card, then switch to a detail view for the full guidance.</p></div><p className="dmxp-grid-preference">Specialist view choice: shareable in this prototype URL; saved profile preference is intentionally not modeled here.</p></header><div className="dmxp-grid" aria-label="Procedure grid results">{procedures.map((procedure) => <button key={procedure.id} type="button" aria-pressed={selectedId === procedure.id} className={selectedId === procedure.id ? "selected" : ""} onClick={() => chooseProcedure(procedure.id)}><span className={`dmxp-severity ${procedure.severity.toLowerCase().replaceAll(" ", "-").replaceAll("/", "")}`}>{procedure.severity}</span><h3>{procedure.condition}</h3><p><strong>Criteria</strong>{procedure.criteria[0]}</p><p className="dmxp-grid-action"><strong>First immediate action</strong>{procedure.actions[0]}</p><footer><span className={`dmxp-grid-health ${procedure.health.toLowerCase().replaceAll(" ", "-")}`}>{procedure.health}</span><span>{procedure.effectiveRevision}</span></footer></button>)}</div></section>;
}

function PrototypeState({ variant, procedure, previewState }: { variant: Variant; procedure: Procedure | null; previewState: PreviewState }) {
  return <section className="dmxp-state" aria-label="Prototype state"><strong>Prototype state</strong><span>Variant: {VARIANTS.find((item) => item.key === variant)?.label}</span><span>View choice: URL query parameter; no saved profile preference in this prototype</span><span>Displayed Procedure: {procedure?.condition ?? "No matching Procedure"}</span><span>Document Reference Health: {procedure?.health ?? "Not applicable"}</span><span>Visual preview: {previewState}</span></section>;
}

function PrototypeSwitcher({ variant, setVariant }: { variant: Variant; setVariant: (next: Variant) => void }) {
  const index = VARIANTS.findIndex((item) => item.key === variant);
  const previous = VARIANTS[(index - 1 + VARIANTS.length) % VARIANTS.length];
  const next = VARIANTS[(index + 1) % VARIANTS.length];
  return <div className="dmxp-switcher" aria-label="Prototype layout switcher"><button type="button" onClick={() => setVariant(previous.key)} aria-label={`Show ${previous.label}`}>←</button><span><strong>{String.fromCharCode(65 + index)}</strong> · {VARIANTS[index].label}</span><button type="button" onClick={() => setVariant(next.key)} aria-label={`Show ${next.label}`}>→</button></div>;
}
