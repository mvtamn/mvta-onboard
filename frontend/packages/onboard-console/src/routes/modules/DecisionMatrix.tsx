import { useEffect, useMemo, useState } from "react";
import {
  MOCK_DATA,
  SEV_LABEL,
  type MatrixEntry,
  type Severity,
  type DocType,
} from "./decisionMatrix.data.js";
import { QRG_SECTIONS, type QrgSection } from "./decisionMatrixQrg.data.js";
import "./decisionMatrix.css";

const SEVERITIES: Severity[] = ["stop", "restricting", "clear"];
const DOCTYPES: DocType[] = ["SOP", "REF"];
const SEV_PILL: Record<Severity, string> = { stop: "pill-danger", restricting: "pill-warning", clear: "pill-success" };
type View = "list" | "grid" | "qrg";

// OCC Decision Matrix — ported from occ_decision_matrix.html. Search + filter
// reference over the decision matrix; each entry links to its SOP/REF.
// Severity uses the same pill-sm convention as every other status indicator
// in the console (message severity, subscriber status, etc), so this reads as
// part of the same app rather than a separately-styled reference tool.
export function DecisionMatrix() {
  const [query, setQuery] = useState("");
  const [severities, setSeverities] = useState<Set<Severity>>(new Set());
  const [docTypes, setDocTypes] = useState<Set<DocType>>(new Set());
  const [tags, setTags] = useState<Set<string>>(new Set());
  const [view, setView] = useState<View>("list");
  const [clock, setClock] = useState(() => "--:--:--");

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString("en-US", { hour12: false }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    MOCK_DATA.forEach((d) => d.tags.forEach((t) => s.add(t)));
    return [...s].sort();
  }, []);

  function toggle<T>(set: Set<T>, value: T, setter: (s: Set<T>) => void) {
    const next = new Set(set);
    next.has(value) ? next.delete(value) : next.add(value);
    setter(next);
  }

  const filtered = MOCK_DATA.filter((item) => {
    const q = query.trim().toLowerCase();
    if (q) {
      const hay = `${item.condition} ${item.criteria} ${item.requiredAction} ${item.tags.join(" ")} ${item.docCode}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (severities.size && !severities.has(item.severity)) return false;
    if (docTypes.size && !docTypes.has(item.docType)) return false;
    if (tags.size && ![...tags].every((t) => item.tags.includes(t))) return false;
    return true;
  });

  const qrgRowCount = useMemo(
    () => QRG_SECTIONS.reduce((n, s) => n + s.subsections.reduce((m, sub) => m + sub.rows.length, 0), 0),
    [],
  );

  const filteredQrgSections = useMemo<QrgSection[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return QRG_SECTIONS;
    return QRG_SECTIONS.map((section) => ({
      ...section,
      subsections: section.subsections
        .map((sub) => ({
          ...sub,
          rows: sub.rows.filter((row) =>
            `${row.trouble} ${row.cause} ${row.remedy} ${row.ref ?? ""}`.toLowerCase().includes(q),
          ),
        }))
        .filter((sub) => sub.rows.length > 0),
    })).filter((section) => section.subsections.length > 0);
  }, [query]);
  const filteredQrgRowCount = filteredQrgSections.reduce(
    (n, s) => n + s.subsections.reduce((m, sub) => m + sub.rows.length, 0),
    0,
  );

  return (
    <div className="dmx">
      <div className="dochead">
        <div className="agency">MINNESOTA VALLEY TRANSIT AUTHORITY</div>
        <div className="doctitle">OCC Decision Matrix — Master REF</div>
      </div>

      <header className="dmx-hero">
        <h1>Control Center Decision Matrix</h1>
        <p>
          Condition, criteria, and required action for control center staff — each entry links to
          its governing SOP or REF document on SharePoint.
        </p>
      </header>

      <div className="dmx-controls">
        <div className="searchrow">
          <input
            className="search"
            type="text"
            placeholder={
              view === "qrg"
                ? "Search trouble, cause, remedy, or reference…"
                : "Search conditions, criteria, actions, or tags…"
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="viewtoggle">
            <button className={view === "list" ? "active" : ""} onClick={() => setView("list")}>List</button>
            <button className={view === "grid" ? "active" : ""} onClick={() => setView("grid")}>Grid</button>
            <button className={view === "qrg" ? "active" : ""} onClick={() => setView("qrg")}>QRG</button>
          </div>
        </div>

        {view === "qrg" ? null : (
          <>
            <div className="sevfilters">
              {SEVERITIES.map((sev) => (
                <button
                  key={sev}
                  className="sevbtn"
                  data-active={severities.has(sev)}
                  onClick={() => toggle(severities, sev, setSeverities)}
                >
                  <span className={`pill-sm ${SEV_PILL[sev]}`}>{SEV_LABEL[sev]}</span>
                </button>
              ))}
            </div>

            <div className="doctypefilters">
              {DOCTYPES.map((dt) => (
                <button
                  key={dt}
                  className="doctypebtn"
                  data-active={docTypes.has(dt)}
                  onClick={() => toggle(docTypes, dt, setDocTypes)}
                >
                  {dt}
                </button>
              ))}
            </div>

            <div className="tagrow">
              {allTags.map((tag) => (
                <div
                  key={tag}
                  className="tag"
                  data-active={tags.has(tag)}
                  onClick={() => toggle(tags, tag, setTags)}
                >
                  {tag}
                </div>
              ))}
            </div>
          </>
        )}

        <div className="dmx-meta">
          {view === "qrg"
            ? `${filteredQrgRowCount} of ${qrgRowCount} entries`
            : `${filtered.length} of ${MOCK_DATA.length} entries`}
        </div>
      </div>

      {view === "qrg" ? (
        filteredQrgSections.length === 0 ? (
          <div className="dmx-empty">No QRG entries match your search.</div>
        ) : (
          <div className="dmx-qrg">
            {filteredQrgSections.map((section) => (
              <QrgSectionBlock key={section.label} section={section} />
            ))}
          </div>
        )
      ) : filtered.length === 0 ? (
        <div className="dmx-empty">No entries match your search or filters.</div>
      ) : view === "list" ? (
        <div className="matrix-list">
          {filtered.map((item) => <MatrixRow key={item.id} item={item} />)}
        </div>
      ) : (
        <div className="matrix-grid">
          {filtered.map((item) => <MatrixCard key={item.id} item={item} />)}
        </div>
      )}

      <div className="docfoot">
        <div>INTERNAL DOCUMENT</div>
        <div>{clock}</div>
        <div>REF-2026-[PENDING]</div>
      </div>
    </div>
  );
}

function QrgSectionBlock({ section }: { section: QrgSection }) {
  return (
    <div className="qrg-section">
      <div className="qrg-section-header">{section.label}</div>
      {section.subsections.map((sub) => (
        <div className="qrg-subsection" key={sub.title}>
          <div className="qrg-subsection-header">{sub.title}</div>
          <table className="data">
            <thead>
              <tr>
                <th>Trouble</th>
                <th>Probable Cause</th>
                <th>Remedy</th>
                <th>Reference</th>
              </tr>
            </thead>
            <tbody>
              {sub.rows.map((row) => (
                <tr key={row.trouble}>
                  <td>{row.trouble}</td>
                  <td>{row.cause}</td>
                  <td>{row.remedy}</td>
                  <td className="qrg-ref-cell">
                    {row.ref ? (
                      <a className="btn-sm" href={row.refUrl} target="_blank" rel="noopener noreferrer">
                        {row.ref}
                      </a>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function MatrixRow({ item }: { item: MatrixEntry }) {
  return (
    <div className={`row ${item.severity}`}>
      <div className="rowbody">
        <h3>{item.condition}</h3>
        <div className="field"><div className="flabel">Criteria</div><div className="fvalue">{item.criteria}</div></div>
        <div className="field"><div className="flabel">Required Action</div><div className="fvalue">{item.requiredAction}</div></div>
        <div className="tags">{item.tags.map((t) => <span key={t}>{t}</span>)}</div>
      </div>
      <div className="rowaction">
        <span className={`pill-sm ${SEV_PILL[item.severity]}`}>{SEV_LABEL[item.severity]}</span>
        <div className="doccode">{item.docType} · {item.docCode}</div>
        <a className="btn-sm" href={item.docUrl} target="_blank" rel="noopener noreferrer">Open ↗</a>
        <div className="reviewed">Reviewed {item.lastReviewed}</div>
      </div>
    </div>
  );
}

function MatrixCard({ item }: { item: MatrixEntry }) {
  return (
    <div className={`card ${item.severity}`}>
      <div className="card-top">
        <h3>{item.condition}</h3>
        <span className={`pill-sm ${SEV_PILL[item.severity]}`}>{SEV_LABEL[item.severity]}</span>
      </div>
      <div className="cfield"><span className="clabel">Criteria</span>{item.criteria}</div>
      <div className="cfield"><span className="clabel">Required Action</span>{item.requiredAction}</div>
      <div className="ctags">{item.tags.map((t) => <span key={t}>{t}</span>)}</div>
      <div className="card-foot">
        <div className="doccode">{item.docType} · {item.docCode}</div>
        <a className="btn-sm" href={item.docUrl} target="_blank" rel="noopener noreferrer">Open ↗</a>
      </div>
    </div>
  );
}
