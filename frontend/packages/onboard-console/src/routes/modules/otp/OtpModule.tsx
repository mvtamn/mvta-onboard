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
  { page: "tuner", label: "Threshold Tuner" },
];

const SEED_TIMELINE: TimelineEntry[] = [
  { title: "Service week imported", desc: "Jul 7–13, 2026 · 18,036 timepoint events · T. Fant" },
  { title: "Candidate detection run", desc: `${DATA.candidates.length} stops flagged for early-departure bias` },
  { title: "Metric confirmed", desc: "Attachment G basis set to Departure adherence" },
];

const reasonLabel = (code: string) => reasonCodes.find((r) => r[0] === code)?.[1] ?? code;
const dateReasonLabel = (code: string) => dateReasonCodes.find((r) => r[0] === code)?.[1] ?? code;

// OTP Compliance — ported from otp_app.html. Renders as a section of the OCC
// Tools tab: no shell of its own (no sidebar, no topbar, no theme toggle) -
// the console's own chrome is the only chrome, and every page here reuses the
// console's shared classes (pill-sm, btn-sm, subcard, table.data, stat-card)
// so it reads as one app rather than an app nested inside an app.
// Approve/reject are staff actions; nothing is auto-applied.
export function OtpModule() {
  const [page, setPage] = useState("queue");
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
    <div className="otp-panel">
      <div className="occ-switch small">
        {NAV.map((n) => (
          <button
            key={n.page}
            className={page === n.page ? "active" : ""}
            onClick={() => setPage(n.page)}
          >
            {n.label}
          </button>
        ))}
      </div>

      <p className="panel-desc" style={{ marginBottom: 10 }}>
        <b>{meta.title}.</b> {meta.sub}
      </p>

      <div className="otp-meta">
        <div className="otp-meta-item"><div className="otp-meta-label">Service Week</div><div className="otp-meta-value">Jul 7 – Jul 13, 2026</div></div>
        <div className="otp-meta-item"><div className="otp-meta-label">Metric</div><div className="otp-meta-value">Departure adherence</div></div>
        <div className="otp-meta-item"><div className="otp-meta-label">Imported</div><div className="otp-meta-value">18,036 timepoint events</div></div>
      </div>

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
  );
}

function DashboardPage({ statuses, weatherCount }: { statuses: CandidateStatus[]; weatherCount: number }) {
  const approved = statuses.filter((s) => s === "approved").length;
  const rejected = statuses.filter((s) => s === "rejected").length;
  const pending = statuses.length - approved - rejected;
  const below = DATA.routes.filter((r) => computeOfficialPct(r, statuses) < 90).length;
  const cards = [
    { label: "Pending review", value: pending, sub: "Candidate stops", color: "#F78E1E" },
    { label: "Approved", value: approved, sub: "Active exclusion rules", color: "#00553D" },
    { label: "Routes below 90%", value: below, sub: "Official departure OTP", color: "#8A1F1F" },
    { label: "Weather exclusions", value: weatherCount, sub: "Logged this year", color: "#417B68" },
  ];
  return (
    <>
      <div className="stat-grid">
        {cards.map((c) => (
          <div className="stat-card" key={c.label} style={{ borderLeftColor: c.color }}>
            <div className="stat-label">{c.label}</div>
            <div className="stat-value">{c.value}</div>
            <div className="stat-sub">{c.sub}</div>
          </div>
        ))}
      </div>
      <div className="subcard empty-note" style={{ textAlign: "center", padding: "40px 20px" }}>
        Route-level OTP trend and penalty exposure charts land here once Power BI is wired in.
      </div>
    </>
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
      <div className="subcard otp-queue">
        <div className="otp-queue-toolbar">
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
                    <button className="btn-post" onClick={() => onResolve(i, "approve")}>Approve</button>
                    <button className="btn-sm" onClick={() => onResolve(i, "reject")}>Reject</button>
                  </>
                ) : st.status === "approved" ? (
                  <span className="ok-text">Excluded — {reasonLabel(st.reason)}</span>
                ) : (
                  <span className="muted">Kept in OTP calc</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <aside className="subcard otp-timeline">
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
    <div className="subcard" style={{ overflow: "hidden" }}>
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
                <td className={delta > 0 ? "ok-text" : "muted"}>{delta > 0 ? "+" : ""}{delta} pts</td>
                <td>{below ? <span className="pill-sm pill-danger">Below 90%</span> : <span className="pill-sm pill-success">Meets 90%</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
    <>
      <div className="subcard" style={{ marginBottom: 16 }}>
        <div className="field-grid">
          <div>
            <p className="field-label">Scope</p>
            <select className="f" value={scope} onChange={(e) => setScope(e.target.value as "Agency" | "Route")}>
              <option value="Agency">All routes (agency-wide)</option>
              <option value="Route">Specific route</option>
            </select>
          </div>
          {scope === "Route" && (
            <div>
              <p className="field-label">Route</p>
              <input className="f" value={route} onChange={(e) => setRoute(e.target.value)} placeholder="e.g. 490" />
            </div>
          )}
          <div>
            <p className="field-label">Service date</p>
            <input className="f" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <p className="field-label">Reason</p>
            <select className="f" value={reason} onChange={(e) => setReason(e.target.value)}>
              {dateReasonCodes.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
            </select>
          </div>
        </div>
        <div className="field-grid single">
          <div>
            <p className="field-label">Notes</p>
            <input className="f" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Metro-wide snow emergency" />
          </div>
        </div>
        <button className="btn-post" onClick={add}>Add exclusion</button>
      </div>
      <div className="subcard" style={{ overflow: "hidden" }}>
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
                  {d.notes ? <div className="td-dim" style={{ marginTop: 2 }}>{d.notes}</div> : null}
                </td>
                <td>{d.status === "Approved" ? <span className="pill-sm pill-success">Approved</span> : <span className="pill-sm pill-warning">Proposed</span>}</td>
                <td>
                  {!d.notified ? (
                    <span className="pill-sm pill-muted">Not yet notified</span>
                  ) : d.acknowledged ? (
                    <span className="pill-sm pill-success">Acknowledged {d.notifiedDate}</span>
                  ) : (
                    <span className="pill-sm pill-accent">Notified {d.notifiedDate}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function PlaceholderPage({ page }: { page: string }) {
  const copy: Record<string, string> = {
    monthly: "No finalized months yet in Dev. Run sp_FinalizeMonthlyOtpAssessment once a service month closes.",
    audit: "Audit log view — coming once the module is connected to Dev SQL.",
    admin: "Admin settings — coming soon.",
    tuner: "Tuning workspace — coming soon.",
  };
  return <div className="subcard empty-note" style={{ textAlign: "center", padding: "40px 20px" }}>{copy[page]}</div>;
}
