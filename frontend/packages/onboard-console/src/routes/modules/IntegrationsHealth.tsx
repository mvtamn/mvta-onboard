import { useEffect, useState } from "react";
import { ApiError, type FeedCheck, type KpiTrust, type KpiTrustDependency, type KpiTrustStream, type KpiTrustStreamName } from "@mvta/shared";
import { api } from "../../config.js";
import {
  KPI_TRUST_STREAMS, STREAM_LABELS, STREAM_MODULES, contractLabel, dateLabel, feedDisplayName,
  kpiTrustStateLabel, kpiTrustStateTone, oldestRequiredDependency, rankTrustState, whenLabel,
} from "./kpiTrustPresentation.js";
import "./integrationsHealth.css";

// Admin > Integrations & Data Health. Two questions, answered in this order:
// which operational KPIs can be read as current (derived from recorded
// ingestion evidence, loaded as the page opens), and whether each upstream
// source answers right now (an explicit, bounded check, because it calls the
// vendors). A reachable feed is not a current KPI; the page keeps them apart.

type Sort = "attention" | "module";

function checkState(check: FeedCheck): { label: string; tone: "success" | "warning" | "danger" | "muted" } {
  if (!check.configured) return { label: "Not configured", tone: "muted" };
  if (check.freshness === "current") return { label: "Current", tone: "success" };
  if (check.freshness === "stale") return { label: "Stale", tone: "warning" };
  if (check.error || !check.status || check.status >= 400) return { label: "Failed", tone: "danger" };
  if ((check.records ?? 0) === 0) return { label: "Empty", tone: "warning" };
  return { label: "Live", tone: "success" };
}

function checkFailure(check: FeedCheck): string | null {
  if (check.error) return check.error;
  if (check.configured && check.status && check.status >= 400) return `HTTP ${check.status} from the source.`;
  return null;
}

function message(error: unknown): string {
  if (error instanceof ApiError && error.status === 401) return "Sign in again to run staff feed checks.";
  if (error instanceof ApiError && error.status === 403) return "Your account does not have access to feed checks.";
  return "Feed checks could not be completed. Try again shortly.";
}

// What a dependency row says on its right-hand side, in the tone of its own
// state: the delivery time when there was one, else the fact there was not.
function dependencyEvidence(dependency: KpiTrustDependency): { text: string; tone: "success" | "warning" | "danger" } {
  const tone = dependency.state === "current" ? "success" : dependency.state === "stale" ? "warning" : "danger";
  if (!dependency.last_success_at) return { text: "Not received", tone };
  const coverageEnd = dependency.coverage_end_at ?? dependency.source_timestamp_at;
  if (dependency.stale_after_minutes === null && coverageEnd) {
    return { text: `Coverage through ${dateLabel(coverageEnd)}`, tone };
  }
  return { text: `Received ${whenLabel(dependency.last_success_at)}`, tone };
}

function IconRefresh() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 3v6h-6" /></svg>;
}
function IconWarning() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>;
}
function IconClock() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
}

function StatePill({ state }: { state: KpiTrustStream["state"] }) {
  return (
    <span className={`ih-pill ${kpiTrustStateTone(state)}${state === "current_but_empty" ? " empty" : ""}`}>
      <i />{kpiTrustStateLabel(state)}
    </span>
  );
}

function TrustCard({ name, stream }: { name: KpiTrustStreamName; stream: KpiTrustStream }) {
  const healthy = stream.state === "current" && !stream.contract_pending;
  const failure = stream.dependencies.find((dependency) => dependency.required && dependency.last_failure_reason);
  return (
    <article className="ih-card" aria-labelledby={`ih-stream-${name}`}>
      <div className="ih-card-head">
        <div>
          <h3 id={`ih-stream-${name}`}>{STREAM_LABELS[name]}</h3>
          <span>{STREAM_MODULES[name]}</span>
        </div>
        <StatePill state={stream.state} />
      </div>
      <p>
        {stream.explanation}
        {healthy && oldestRequiredDependency([stream])?.last_success_at
          ? ` Last required ingestion ${whenLabel(oldestRequiredDependency([stream])!.last_success_at!)}.`
          : ""}
      </p>
      {healthy ? (
        // A current stream has one fact per dependency - when it last landed -
        // so it takes a chip, not a row. Anything else gets the full row so an
        // administrator can see which dependency is the reason.
        <div className="ih-chips">
          {stream.dependencies.map((dependency) => (
            <span className={`ih-chip${dependency.required ? "" : " supporting"}`} key={dependency.feed_name}>
              {feedDisplayName(dependency.feed_name)}{" "}
              <b>{dependency.last_success_at ? whenLabel(dependency.last_success_at) : "—"}</b>
            </span>
          ))}
        </div>
      ) : (
        <div className="ih-deps" role="list" aria-label={`${STREAM_LABELS[name]} dependencies`}>
          {stream.dependencies.map((dependency) => {
            const evidence = dependencyEvidence(dependency);
            return (
              <div className="ih-dep" role="listitem" key={dependency.feed_name}>
                <span className={`ih-dep-kind ${dependency.required ? "required" : "supporting"}`}>{dependency.required ? "Required" : "Supporting"}</span>
                <span className="ih-dep-name">{feedDisplayName(dependency.feed_name)} <small>· {contractLabel(dependency)}</small></span>
                <span className={`ih-dep-when ${evidence.tone}`}>{evidence.text}</span>
              </div>
            );
          })}
        </div>
      )}
      {failure && (
        <div className="ih-note danger">
          <IconWarning />
          <span>
            {failure.last_failure_at ? `Last failure ${whenLabel(failure.last_failure_at)} · ` : ""}
            <strong>{failure.last_failure_reason}</strong>
          </span>
        </div>
      )}
      {stream.contract_pending && (
        <div className="ih-note muted"><IconClock /><span>Reporting deadline pending Operations approval. This stream never enters Stale automatically.</span></div>
      )}
      {(stream.state === "stale" || stream.state === "unavailable") && (
        <div className="ih-note plain">Stale-data acknowledgement is required before this stream supports a manual communication.</div>
      )}
    </article>
  );
}

export function IntegrationsHealth() {
  const [trust, setTrust] = useState<KpiTrust | null>(null);
  const [trustLoadedAt, setTrustLoadedAt] = useState<string | null>(null);
  const [trustError, setTrustError] = useState(false);
  const [checks, setChecks] = useState<FeedCheck[] | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState<Sort>("attention");

  async function loadTrust(): Promise<void> {
    try {
      const result = await api.getKpiTrust();
      setTrust(result.streams);
      setTrustLoadedAt(result.checked_at ?? new Date().toISOString());
      setTrustError(false);
    } catch {
      setTrustError(true);
    }
  }

  useEffect(() => { void loadTrust(); }, []);

  async function runChecks(): Promise<void> {
    setLoading(true);
    setCheckError(null);
    try {
      // Trust is refreshed alongside, so the two halves of the page describe
      // the same moment; a trust failure does not take the checks down with it.
      const [result] = await Promise.all([api.getFeedChecks(), loadTrust()]);
      setChecks(result.checks);
      setCheckedAt(result.checked_at);
    } catch (err) {
      setCheckError(message(err));
    } finally {
      setLoading(false);
    }
  }

  const streams = KPI_TRUST_STREAMS
    .filter((name) => Boolean(trust?.[name]))
    .map((name) => ({ name, stream: trust![name] as KpiTrustStream }));
  const ordered = sort === "attention"
    ? [...streams].sort((a, b) => rankTrustState(a.stream.state) - rankTrustState(b.stream.state))
    : streams;

  const currentCount = streams.filter((item) => item.stream.state === "current").length;
  const attentionCount = streams.filter((item) => item.stream.state === "stale" || item.stream.state === "unavailable").length;
  const emptyCount = streams.filter((item) => item.stream.state === "current_but_empty").length;
  const oldest = oldestRequiredDependency(streams.map((item) => item.stream));

  const configured = checks?.filter((check) => check.configured) ?? null;
  const failed = configured?.filter((check) => checkState(check).tone === "danger") ?? null;

  return (
    <div className="ih">
      <div className="ih-summary" aria-label="Data health summary">
        <div className="ih-stat">
          <span className="ih-eyebrow muted">KPI streams</span>
          <div className="ih-stat-value">
            <strong>{trust ? `${currentCount} of ${streams.length}` : "—"}</strong>
            <span>current</span>
          </div>
          <span className={`ih-stat-note ${attentionCount ? "warning" : trust ? "success" : ""}`}>
            {!trust
              ? (trustError ? "KPI trust is unavailable right now." : "Loading…")
              : attentionCount || emptyCount
                ? [attentionCount ? `${attentionCount} need${attentionCount === 1 ? "s" : ""} attention` : null, emptyCount ? `${emptyCount} no records` : null].filter(Boolean).join(" · ")
                : "All streams current"}
          </span>
        </div>
        <div className="ih-stat">
          <span className="ih-eyebrow muted">Feed connections</span>
          <div className="ih-stat-value">
            <strong>{configured ? `${configured.length - (failed?.length ?? 0)} of ${configured.length}` : "—"}</strong>
            <span>reachable</span>
          </div>
          <span className={`ih-stat-note ${failed?.length ? "danger" : configured ? "success" : ""}`}>
            {!configured
              ? "Not checked this session."
              : failed?.length
                ? `${failed.map((check) => check.name).join(", ")} failed`
                : "Every configured source answered"}
          </span>
        </div>
        <div className="ih-stat">
          <span className="ih-eyebrow muted">Oldest required ingestion</span>
          <div className="ih-stat-value">
            <strong>{oldest?.last_success_at ? whenLabel(oldest.last_success_at) : "—"}</strong>
          </div>
          <span className="ih-stat-note">{oldest ? `${feedDisplayName(oldest.feed_name)} · ${contractLabel(oldest)}` : "No contracted required feed has recorded a delivery."}</span>
        </div>
        <div className="ih-stat action">
          <span className="ih-eyebrow muted">Source verification</span>
          <span className="ih-stat-desc">Bounded, credential-safe. No rider, driver, or location records.</span>
          <button type="button" className="ih-check" onClick={() => void runChecks()} disabled={loading}>
            <IconRefresh />{loading ? "Checking…" : "Check feeds"}
          </button>
        </div>
      </div>

      <section className="ih-section" aria-labelledby="ih-trust-title">
        <div className="ih-section-head">
          <div>
            <span className="ih-eyebrow">KPI trust</span>
            <h2 id="ih-trust-title">Which operational KPIs can be read as current</h2>
            <p>Derived from recorded ingestion evidence against each stream's freshness contract. Does not run vendor checks.</p>
          </div>
          <div className="ih-section-aside">
            {trustLoadedAt && <span>Loaded {whenLabel(trustLoadedAt)}</span>}
            <div className="seg" role="group" aria-label="Sort streams">
              <button type="button" aria-pressed={sort === "attention"} onClick={() => setSort("attention")}>Attention first</button>
              <button type="button" aria-pressed={sort === "module"} onClick={() => setSort("module")}>By module</button>
            </div>
          </div>
        </div>
        {trustError && !trust && <p className="ih-error" role="alert">KPI trust could not be loaded. Feed connection checks still work.</p>}
        {trust && (
          <>
            <div className="ih-board">
              {ordered.map(({ name, stream }) => <TrustCard key={name} name={name} stream={stream} />)}
            </div>
            <div className="ih-legend">
              <span><i />Required dependency</span>
              <span><i className="supporting" />Supporting dependency</span>
              <span>Times are last successful ingestion, agency local.</span>
            </div>
          </>
        )}
      </section>

      <section className="ih-section" aria-labelledby="ih-feeds-title">
        <div className="ih-section-head">
          <div>
            <span className="ih-eyebrow">Feed connections</span>
            <h2 id="ih-feeds-title">Connectivity diagnostics</h2>
            <p>Whether each source answers right now. A reachable feed is not the same as a current KPI; read trust above for that.</p>
          </div>
          {checkedAt && <div className="ih-section-aside"><span>Checked {whenLabel(checkedAt)}</span></div>}
        </div>
        {checkError && <p className="ih-error" role="alert">{checkError}</p>}
        <div className="ih-table" role="table" aria-label="Feed check results">
          <div className="ih-table-head" role="row">
            <span role="columnheader">Feed</span><span role="columnheader">Last success</span><span role="columnheader">Records</span><span role="columnheader" className="ih-row-status">Status</span>
          </div>
          {!checks && <div className="ih-table-empty">Run Check feeds to verify each configured source.</div>}
          {checks?.map((check) => {
            const state = checkState(check);
            const failure = checkFailure(check);
            return (
              <div key={check.name} style={{ display: "contents" }}>
                <div className="ih-row" role="row">
                  <strong role="cell">{check.name}</strong>
                  <span role="cell" className={check.last_success_at ? "" : "empty"}>{check.last_success_at ? whenLabel(check.last_success_at) : "—"}</span>
                  <span role="cell" className={check.records === undefined ? "empty" : ""}>{check.records === undefined ? "—" : check.records.toLocaleString()}</span>
                  <span role="cell" className="ih-row-status"><span className={`ih-pill ${state.tone}`}>{state.label}</span></span>
                </div>
                {failure && <div className="ih-row-error"><span><IconWarning />{failure}</span></div>}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
