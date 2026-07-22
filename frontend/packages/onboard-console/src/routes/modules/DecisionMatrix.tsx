import { useEffect, useMemo, useState } from "react";
import {
  MOCK_DATA,
  SEV_LABEL,
  type MatrixEntry,
  type Severity,
  type DocType,
} from "./decisionMatrix.data.js";
import "./decisionMatrix.css";

const SEVERITIES: Severity[] = ["stop", "restricting", "clear"];
const DOCTYPES: DocType[] = ["SOP", "REF"];

// OCC Decision Matrix — ported from occ_decision_matrix.html. Search + filter
// reference over the decision matrix; each entry links to its SOP/REF.
export function DecisionMatrix() {
  const [query, setQuery] = useState("");
  const [severities, setSeverities] = useState<Set<Severity>>(new Set());
  const [docTypes, setDocTypes] = useState<Set<DocType>>(new Set());
  const [tags, setTags] = useState<Set<string>>(new Set());
  const [view, setView] = useState<"list" | "grid">("list");
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
            placeholder="Search conditions, criteria, actions, or tags…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="viewtoggle">
            <button className={view === "list" ? "active" : ""} onClick={() => setView("list")}>List</button>
            <button className={view === "grid" ? "active" : ""} onClick={() => setView("grid")}>Grid</button>
          </div>
        </div>

        <div className="sevfilters">
          {SEVERITIES.map((sev) => (
            <button
              key={sev}
              className={`sevbtn ${sev}`}
              data-active={severities.has(sev)}
              onClick={() => toggle(severities, sev, setSeverities)}
            >
              <span className="ring" />
              {SEV_LABEL[sev]}
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

        <div className="dmx-meta">{filtered.length} of {MOCK_DATA.length} entries</div>
      </div>

      {filtered.length === 0 ? (
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

function MatrixRow({ item }: { item: MatrixEntry }) {
  return (
    <div className={`row ${item.severity}`}>
      <div className={`signal ${item.severity}`} />
      <div className="rowbody">
        <h3>{item.condition}</h3>
        <div className="field"><div className="flabel">Criteria</div><div className="fvalue">{item.criteria}</div></div>
        <div className="field"><div className="flabel">Required Action</div><div className="fvalue">{item.requiredAction}</div></div>
        <div className="tags">{item.tags.map((t) => <span key={t}>{t}</span>)}</div>
      </div>
      <div className="rowaction">
        <div className={`sevlabel ${item.severity}`}>{SEV_LABEL[item.severity]}</div>
        <div className="doccode">{item.docType} · {item.docCode}</div>
        <a className="doclink" href={item.docUrl} target="_blank" rel="noopener noreferrer">Open ↗</a>
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
        <div className={`card-sev ${item.severity}`}><span className={`signal ${item.severity}`} />{SEV_LABEL[item.severity]}</div>
      </div>
      <div className="cfield"><span className="clabel">Criteria</span>{item.criteria}</div>
      <div className="cfield"><span className="clabel">Required Action</span>{item.requiredAction}</div>
      <div className="ctags">{item.tags.map((t) => <span key={t}>{t}</span>)}</div>
      <div className="card-foot">
        <div className="doccode">{item.docType} · {item.docCode}</div>
        <a href={item.docUrl} target="_blank" rel="noopener noreferrer">Open ↗</a>
      </div>
    </div>
  );
}
