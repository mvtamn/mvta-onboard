import { useMemo, useState } from "react";
import {
  DATA,
  reasonCodes,
  dateReasonCodes,
  computeOfficialPct,
  PAGE_META,
  INITIAL_DATE_EXCLUSIONS,
  type CandidateStatus,
  type DateExclusion,
} from "./otpData.js";
import "./otp.css";

interface CandidateState {
  status: CandidateStatus;
  reason: string;
}
interface TimelineEntry {
  title: string;
  desc: string;
}

const NAV: { page: string; label: string }[] = [
  { page: "dashboard", label: "Dashboard" },
  { page: "queue", label: "Review Queue" },
  { page: "routes", label: "Route Summary" },
  { page: "weather", label: "Weather Exclusions" },
  { page: "monthly", label: "Monthly Assessments" },
  { page: "audit", label: "Audit Stream" },
  { page: "admin", label: "Administration" },
];

const SEED_TIMELINE: TimelineEntry[] = [
  { title: "Service week imported", desc: "Jul 7–13, 2026 · 18,036 timepoint events · T. Fant" },
  { title: "Candidate detection run", desc: `${DATA.candidates.length} stops flagged for early-departure bias` },
  { title: "Metric confirmed", desc: "Attachment G basis set to Departure adherence" },
];

const reasonLabel = (code: string) => reasonCodes.find((r) => r[0] === code)?.[1] ?? code;
const dateReasonLabel = (code: string) => dateReasonCodes.find((r) => r[0] === code)?.[1] ?? code;

// OTP Compliance — ported from otp_app.html. A self-contained module with its
// own light/dark theme scoped to .otp-app (never document.body). Approve/reject
// are staff actions; nothing is auto-applied.
export function OtpModule() {
  const [page, setPage] = useState("queue");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [candidates, setCandidates] = useState<CandidateState[]>(
    DATA.candidates.map(() => ({ status: "pending", reason: "SCHED_RECOVERY" })),
  );
  const [timelineLog, setTimelineLog] = useState<TimelineEntry[]>([]);
  const [dateExclusions, setDateExclusions] = useState<DateExclusion[]>(INITIAL_DATE_EXCLUSIONS);

  const statuses = candidates.map((c) => c.status);

  function pushTimeline(title: string, desc: string) {
    setTimelineLog((log) => [{ title, desc }, ...log]);
  }

  function resolve(i: number, action: "approve" | "reject") {
    setCandidates((cs) => {
      const next = cs.slice();
      next[i] = { ...next[i], status: action === "approve" ? "approved" : "rejected" };
      return next;
    });
    const c = DATA.candidates[i];
    pushTimeline(
      action === "approve" ? "Exclusion approved" : "Candidate rejected",
      `Route ${c.route} · ${c.stopName} · ${action === "approve" ? reasonLabel(candidates[i].reason) : "kept in OTP calc"}`,
    );
  }

  function setReason(i: number, reason: string) {
    setCandidates((cs) => {
      const next = cs.slice();
      next[i] = { ...next[i], reason };
      return next;
    });
  }

  const meta = PAGE_META[page];

  return (
    <div className={`otp-app${theme === "dark" ? " otp-dark" : ""}`} data-theme={theme}>
      <aside className="otp-sidebar">
        <div className="otp-brand">
          <div className="brand-mark">M</div>
          <div>
            <div className="brand-text">OTP Compliance</div>
            <div className="brand-sub">MVTA OnBoard</div>
          </div>
        </div>
        <nav className="otp-nav">
          {NAV.map((n) => (
            <button
              key={n.page}
              className={`navitem${page === n.page ? " active" : ""}`}
              onClick={() => setPage(n.page)}
            >
              {n.label}
            </button>
          ))}
          <div className="navlabel">Tools</div>
          <button className={`navitem${page === "tuner" ? " active" : ""}`} onClick={() => setPage("tuner")}>
            Threshold Tuner
          </button>
        </nav>
        <div className="otp-foot">
          <div className="status-row"><span className="status-dot" />Module ready</div>
          <span className="version-pill">v1.0.0 · Dev</span>
        </div>
      </aside>

      <div className="otp-main">
        <header className="otp-topbar">
          <div>
            <h1>{meta.title}</h1>
            <div className="subtitle">{meta.sub}</div>
          </div>
          <button className="icon-btn" title="Toggle theme" onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}>
            {theme === "dark" ? "☀" : "☾"}
          </button>
        </header>

        <div className="otp-metabar">
          <div className="meta-item"><div className="meta-label">Service Week</div><div className="meta-value">Jul 7 – Jul 13, 2026</div></div>
          <div className="meta-item"><div className="meta-label">Metric</div><div className="meta-value">Departure adherence</div></div>
          <div className="meta-item"><div className="meta-label">Imported</div><div className="meta-value">18,036 timepoint events</div></div>
        </div>

        <div className="otp-content">
          {page === "dashboard" && <DashboardPage statuses={statuses} weatherCount={dateExclusions.length} />}
          {page === "queue" && (
            <ReviewQueuePage
              candidates={candidates}
              timeline={[...timelineLog, ...SEED_TIMELINE].slice(0, 10)}
              onResolve={resolve}
              onReason={setReason}
            />
          )}
          {page === "routes" && <RouteSummaryPage statuses={statuses} />}
          {page === "weather" && (
            <WeatherPage
              dateExclusions={dateExclusions}
              onAdd={(ex) => {
                setDateExclusions((list) => [ex, ...list]);
                pushTimeline(
                  "Weather exclusion logged",
                  `${ex.date} · ${ex.scope === "Agency" ? "All routes" : "Route " + ex.route} · ${dateReasonLabel(ex.reason)}`,
                );
              }}
            />
          )}
          {["monthly", "audit", "admin", "tuner"].includes(page) && <PlaceholderPage page={page} />}
        </div>
      </div>
    </div>
  );
}

function DashboardPage({ statuses, weatherCount }: { statuses: CandidateStatus[]; weatherCount: number }) {
  const approved = statuses.filter((s) => s === "approved").length;
  const rejected = statuses.filter((s) => s === "rejected").length;
  const pending = statuses.length - approved - rejected;
  const below = DATA.routes.filter((r) => computeOfficialPct(r, statuses) < 90).length;
  const cards = [
    { label: "Pending review", value: pending, sub: "Candidate stops" },
    { label: "Approved", value: approved, sub: "Active exclusion rules" },
    { label: "Routes below 90%", value: below, sub: "Official departure OTP" },
    { label: "Weather exclusions", value: weatherCount, sub: "Logged this year" },
  ];
  return (
    <div className="single">
      <div className="stat-grid">
        {cards.map((c) => (
          <div className="otp-card stat-card" key={c.label}>
            <div className="stat-label">{c.label}</div>
            <div className="stat-value">{c.value}</div>
            <div className="stat-sub">{c.sub}</div>
          </div>
        ))}
      </div>
      <div className="otp-card placeholder-card">
        Route-level OTP trend and penalty exposure charts land here once Power BI is wired in.
      </div>
    </div>
  );
}

function AdherenceStrip({ c }: { c: (typeof DATA.candidates)[number] }) {
  const other = Math.max(0, 100 - c.early_pct - c.ontime_pct - c.late_pct - c.missed_pct);
  const segs = [
    { cls: "early", v: c.early_pct },
    { cls: "ontime", v: c.ontime_pct },
    { cls: "late", v: c.late_pct },
    { cls: "missed", v: c.missed_pct + other },
  ];
  return (
    <div className="adherence-strip">
      {segs.map((s, i) => <div key={i} className={`seg ${s.cls}`} style={{ width: `${s.v}%` }} />)}
    </div>
  );
}

function ReviewQueuePage({
  candidates,
  timeline,
  onResolve,
  onReason,
}: {
  candidates: CandidateState[];
  timeline: TimelineEntry[];
  onResolve: (i: number, action: "approve" | "reject") => void;
  onReason: (i: number, reason: string) => void;
}) {
  const [routeFilter, setRouteFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("pending");
  const [search, setSearch] = useState("");
  const routes = useMemo(() => [...new Set(DATA.candidates.map((c) => c.route))].sort(), []);

  return (
    <div className="otp-two">
      <div className="otp-card queue-card">
        <div className="queue-toolbar">
          <select value={routeFilter} onChange={(e) => setRouteFilter(e.target.value)}>
            <option value="">All routes</option>
            {routes.map((r) => <option key={r} value={r}>Route {r}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="pending">Pending review</option>
            <option value="all">All candidates</option>
            <option value="resolved">Resolved only</option>
          </select>
          <input placeholder="Search stop name…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        {DATA.candidates.map((c, i) => {
          const st = candidates[i];
          if (routeFilter && c.route !== routeFilter) return null;
          if (statusFilter === "pending" && st.status !== "pending") return null;
          if (statusFilter === "resolved" && st.status === "pending") return null;
          if (search && !c.stopName.toLowerCase().includes(search.toLowerCase())) return null;

          const varLabel = c.avg_var < 0 ? `${Math.abs(c.avg_var)}s early (avg)` : `${c.avg_var}s late (avg, mixed pattern)`;
          const iconClass = st.status === "approved" ? "ok" : st.status === "rejected" ? "rejected" : "warn";
          const iconGlyph = st.status === "approved" ? "✓" : st.status === "rejected" ? "✕" : "!";

          return (
            <div className={`check-row${st.status === "pending" ? " highlight" : ""}`} key={`${c.route}-${c.stopId}-${i}`}>
              <div className={`status-icon ${iconClass}`}>{iconGlyph}</div>
              <div className="check-body">
                <div className="check-title"><span className="route-chip">RT {c.route}</span>{c.stopName}</div>
                <div className="check-desc">Stop {c.stopId} · {c.direction || "—"} · {c.n} trips sampled · {varLabel}</div>
                <AdherenceStrip c={c} />
              </div>
              <div className="check-actions">
                {st.status === "pending" ? (
                  <>
                    <select value={st.reason} onChange={(e) => onReason(i, e.target.value)}>
                      {reasonCodes.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                    </select>
                    <button className="btn btn-primary" onClick={() => onResolve(i, "approve")}>Approve</button>
                    <button className="btn btn-secondary" onClick={() => onResolve(i, "reject")}>Reject</button>
                  </>
                ) : st.status === "approved" ? (
                  <span className="resolved-tag">Excluded — {reasonLabel(st.reason)}</span>
                ) : (
                  <span className="resolved-tag rejected">Kept in OTP calc</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <aside className="otp-card timeline-card">
        <h2>Review Timeline</h2>
        {timeline.map((t, i) => (
          <div className="timeline-item" key={i}>
            <div className="t-title">{t.title}</div>
            <div className="t-desc">{t.desc}</div>
          </div>
        ))}
      </aside>
    </div>
  );
}

function RouteSummaryPage({ statuses }: { statuses: CandidateStatus[] }) {
  return (
    <div className="single">
      <p className="section-title">Route OTP — official vs. raw</p>
      <p className="section-sub">
        Official % is departure adherence (Attachment G), excluding approved stop rules and excluded
        days. Raw % is the unfiltered departure export.
      </p>
      <div className="otp-card" style={{ overflow: "hidden" }}>
        <table className="data">
          <thead>
            <tr><th>Route</th><th>Departure events</th><th>Raw OTP %</th><th>Official OTP %</th><th>Δ from exclusions</th><th>Status vs. 90%</th></tr>
          </thead>
          <tbody>
            {DATA.routes.map((r) => {
              const official = computeOfficialPct(r, statuses);
              const delta = Math.round((official - r.pct_raw) * 10) / 10;
              const below = official < 90;
              return (
                <tr key={r.route}>
                  <td><span className="route-chip">RT {r.route}</span></td>
                  <td>{r.total}</td>
                  <td>{r.pct_raw}%</td>
                  <td><b>{official}%</b></td>
                  <td className={delta > 0 ? "delta-up" : "delta-flat"}>{delta > 0 ? "+" : ""}{delta} pts</td>
                  <td>{below ? <span className="flag flag-below">Below 90%</span> : <span className="flag flag-ok">Meets 90%</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WeatherPage({
  dateExclusions,
  onAdd,
}: {
  dateExclusions: DateExclusion[];
  onAdd: (ex: DateExclusion) => void;
}) {
  const [scope, setScope] = useState<"Agency" | "Route">("Agency");
  const [route, setRoute] = useState("");
  const [date, setDate] = useState("");
  const [reason, setReason] = useState(dateReasonCodes[0][0]);
  const [notes, setNotes] = useState("");

  function add() {
    if (!date) { window.alert("Enter a service date."); return; }
    if (scope === "Route" && !route.trim()) { window.alert("Enter a route for a route-specific exclusion."); return; }
    onAdd({
      scope,
      route: scope === "Route" ? route.trim() : null,
      date,
      reason,
      notes: notes.trim(),
      status: "Proposed",
      notified: false,
      notifiedDate: null,
      acknowledged: false,
    });
    setRoute("");
    setNotes("");
    setDate("");
  }

  const sorted = [...dateExclusions].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="single">
      <p className="section-title">Weather &amp; emergency day exclusions</p>
      <p className="section-sub">
        Pulls a full service date out of the monthly assessment — agency-wide or for specific
        routes — with a contractor notification trail.
      </p>
      <div className="otp-card form-card">
        <div className="form-row">
          <label>Scope
            <select value={scope} onChange={(e) => setScope(e.target.value as "Agency" | "Route")}>
              <option value="Agency">All routes (agency-wide)</option>
              <option value="Route">Specific route</option>
            </select>
          </label>
          {scope === "Route" && (
            <label>Route<input value={route} onChange={(e) => setRoute(e.target.value)} placeholder="e.g. 490" /></label>
          )}
          <label>Service date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label>Reason
            <select value={reason} onChange={(e) => setReason(e.target.value)}>
              {dateReasonCodes.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
            </select>
          </label>
        </div>
        <div className="form-row">
          <label className="grow">Notes<input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Metro-wide snow emergency" /></label>
          <button className="btn btn-primary" style={{ alignSelf: "flex-end" }} onClick={add}>Add exclusion</button>
        </div>
      </div>
      <div className="otp-card" style={{ overflow: "hidden" }}>
        <table className="data">
          <thead>
            <tr><th>Date</th><th>Scope</th><th>Reason</th><th>Status</th><th>Contractor notified</th></tr>
          </thead>
          <tbody>
            {sorted.map((d, i) => (
              <tr key={i}>
                <td>{d.date}</td>
                <td>{d.scope === "Agency" ? "All routes" : `Route ${d.route}`}</td>
                <td>
                  {dateReasonLabel(d.reason)}
                  {d.notes ? <div className="check-desc" style={{ marginTop: 2 }}>{d.notes}</div> : null}
                </td>
                <td>{d.status === "Approved" ? <span className="badge badge-approved">Approved</span> : <span className="badge badge-proposed">Proposed</span>}</td>
                <td>
                  {!d.notified ? (
                    <span className="badge badge-pending">Not yet notified</span>
                  ) : d.acknowledged ? (
                    <span className="badge badge-approved">Acknowledged {d.notifiedDate}</span>
                  ) : (
                    <span className="badge badge-notified">Notified {d.notifiedDate}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PlaceholderPage({ page }: { page: string }) {
  const copy: Record<string, string> = {
    monthly: "No finalized months yet in Dev. Run sp_FinalizeMonthlyOtpAssessment once a service month closes.",
    audit: "Audit log view — coming once the module is connected to Dev SQL.",
    admin: "Admin settings — coming soon.",
    tuner: "Tuning workspace — coming soon.",
  };
  return (
    <div className="single">
      <p className="section-title">{PAGE_META[page].title}</p>
      <p className="section-sub">{PAGE_META[page].sub}</p>
      <div className="otp-card placeholder-card">{copy[page]}</div>
    </div>
  );
}
