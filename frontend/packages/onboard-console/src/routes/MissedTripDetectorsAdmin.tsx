// Which missed-trip detectors count toward an assessment, and since when.
//
// Every detector runs in Shadow detection until somebody decides otherwise:
// its cases are reviewed, but a confirmation never reaches an assessment. That
// decision used to be a deployment setting with no date, no evidence and no
// author (ADR-0035). It is made here now, and it is made for a service date, so
// promoting a detector cannot change a month already measured.
import { useEffect, useState } from "react";
import type { DetectorPromotionView, DetectorScorecard, DetectorScorecardGrouping } from "@mvta/shared";
import { api } from "../config.js";
import {
  decisionTitle,
  detectorLabel,
  detectorSource,
  draftErrors,
  EMPTY_DRAFT,
  ignoredWarning,
  measurementText,
  promotionInput,
  serviceDateLabel,
  standingSentence,
  type PromotionDraft,
} from "../lib/detectorPromotion.js";
import {
  availRecallText,
  availText,
  dispatcherRecallText,
  dispatcherText,
  draftFromWeek,
  heldReasonsText,
  periodLabel,
  precisionText,
  rateText,
  reviewBurdenText,
} from "../lib/detectorScorecard.js";
import "./modules/serviceRisk.css";
import "./detectorPromotion.css";

export function MissedTripDetectorsAdmin() {
  const [view, setView] = useState<DetectorPromotionView | null>(null);
  const [draft, setDraft] = useState<PromotionDraft>(EMPTY_DRAFT);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [scorecard, setScorecard] = useState<DetectorScorecard | null>(null);
  const [grouping, setGrouping] = useState<DetectorScorecardGrouping>("week");
  const [scorecardFailure, setScorecardFailure] = useState<string | null>(null);

  const errors = draftErrors(draft);
  const set = (patch: Partial<PromotionDraft>) => setDraft((current) => ({ ...current, ...patch }));

  async function refresh() {
    setView(await api.getMissedTripDetectorPromotions());
  }

  useEffect(() => {
    void refresh().catch(() => setFailure("The promotion history is unavailable."));
  }, []);

  useEffect(() => {
    let current = true;
    setScorecardFailure(null);
    api.getMissedTripDetectorScorecard({ group: grouping })
      .then((next) => { if (current) setScorecard(next); })
      .catch(() => { if (current) setScorecardFailure("The scorecard is unavailable."); });
    return () => { current = false; };
  }, [grouping]);

  function applyWeek(fill: Partial<PromotionDraft>) {
    set(fill);
    setShowErrors(false);
    setMessage("The week's measurement is in the form. Choose the service date it applies from.");
  }

  async function record() {
    setShowErrors(true);
    if (Object.keys(errors).length > 0) return;
    setSaving(true);
    setFailure(null);
    setMessage(null);
    try {
      const entry = await api.recordMissedTripDetectorPromotion(promotionInput(draft));
      await refresh();
      setDraft(EMPTY_DRAFT);
      setShowErrors(false);
      setMessage(`${decisionTitle(entry)}, from ${serviceDateLabel(entry.effective_service_date)}.`);
    } catch (error) {
      setFailure(error instanceof Error && error.message ? error.message : "The decision could not be recorded.");
    } finally {
      setSaving(false);
    }
  }

  const warning = ignoredWarning(view?.ignored ?? []);

  return <div className="risk-module">
    <div className="risk-module-head">
      <div>
        <span className="risk-eyebrow">Administration · Standards &amp; Contracts</span>
        <h2>Missed-trip Detectors</h2>
        <p>Which detectors count toward an assessment, and from which service date. A detector in Shadow detection still opens cases and still gets reviewed - its confirmations just never reach an assessment.</p>
      </div>
    </div>

    {warning && <p className="detector-warning" role="status">{warning}</p>}

    <section className="detector-standings" aria-label="Detector standing">
      {(view?.standings ?? []).map((standing) => <article key={standing.detector} className={standing.promoted ? "detector-card is-promoted" : "detector-card"}>
        <header>
          <strong>{detectorLabel(standing.detector)}</strong>
          <small>{detectorSource(standing.detector)}</small>
        </header>
        <span className={standing.promoted ? "detector-state is-promoted" : "detector-state"}>
          {standing.promoted ? "Counts toward assessments" : "Shadow detection"}
        </span>
        <p>{standingSentence(standing)}</p>
      </article>)}
      {!view && <p className="detector-empty">Loading the promotion history.</p>}
    </section>

    <section className="detector-scorecard" aria-label="Detector scorecard">
      <header className="detector-scorecard-head">
        <div>
          <h3>Scorecard</h3>
          <p className="detector-note">
            Precision is confirmed cases over every decisive review; indeterminate reviews and held cases are counted
            apart. Avail and the Dispatch Log are checked against fixed-route cases only. Service weeks run Monday to Sunday.
          </p>
        </div>
        <div className="detector-toggle" role="group" aria-label="Group by">
          {(["week", "day"] as const).map((value) => <button key={value} type="button" className="btn-sm"
            aria-pressed={grouping === value} onClick={() => setGrouping(value)}>{value === "week" ? "Weeks" : "Days"}</button>)}
        </div>
      </header>
      <div className="detector-toggle" role="group" aria-label="Scorecard detector">
        {(view?.standings ?? []).map((standing) => <button key={standing.detector} type="button" className="btn-sm"
          aria-pressed={draft.detector === standing.detector} onClick={() => set({ detector: standing.detector })}>
          {detectorLabel(standing.detector)}
        </button>)}
      </div>
      {scorecardFailure && <p className="detector-error">{scorecardFailure}</p>}
      {!scorecard && !scorecardFailure && <p className="detector-empty">Loading the scorecard.</p>}
      {scorecard && <div className="detector-scorecard-scroll">
        <table className="data detector-scorecard-table">
          <thead>
            <tr>
              <th scope="col">{scorecard.grouping === "week" ? "Service week" : "Service date"}</th>
              <th scope="col">Precision</th>
              <th scope="col">Held / indeterminate</th>
              <th scope="col">Avail</th>
              <th scope="col">Dispatcher agrees</th>
              <th scope="col">Review burden</th>
              <th scope="col">Fixed-route recall vs Avail</th>
              <th scope="col">vs Dispatch Log</th>
              {scorecard.grouping === "week" && <th scope="col">Promotion bar</th>}
            </tr>
          </thead>
          <tbody>
            {[...scorecard.periods].reverse().map((period) => {
              const figures = period.detectors.find((d) => d.detector === draft.detector);
              if (!figures) return null;
              const fixedRoute = figures.detector !== "spare";
              const fill = draftFromWeek(period, figures);
              return <tr key={period.start}>
                <th scope="row">{periodLabel(period, scorecard.grouping)}</th>
                <td>{precisionText(figures)}</td>
                <td>
                  {figures.cases.held} held · {figures.outcomes.indeterminate} indeterminate
                  <small>{rateText(figures.unknown_rate)} of {figures.cases.detected}{figures.held_reasons.length > 0 ? ` · ${heldReasonsText(figures.held_reasons)}` : ""}</small>
                </td>
                <td>{availText(figures)}</td>
                <td>{dispatcherText(figures)}</td>
                <td>{reviewBurdenText(figures.review)}</td>
                <td>{fixedRoute ? availRecallText(period.avail_recall) : "—"}</td>
                <td>{fixedRoute ? dispatcherRecallText(period.dispatcher_recall) : "—"}</td>
                {scorecard.grouping === "week" && <td className={figures.bar?.meets_bar ? "detector-bar is-met" : "detector-bar"}>
                  <span>{figures.bar?.sentence}</span>
                  {fill && <button type="button" className="btn-sm" onClick={() => applyWeek(fill)}>Use this week</button>}
                </td>}
              </tr>;
            })}
          </tbody>
        </table>
      </div>}
      {scorecard && (!scorecard.sources.avail || !scorecard.sources.dispatch_log) && <p className="detector-note">
        {!scorecard.sources.avail && "This database has no Avail evidence links (migration 136), so Avail is not compared. "}
        {!scorecard.sources.dispatch_log && "This database has no Dispatch Log verifications, so dispatchers are not compared."}
      </p>}
    </section>

    <section className="detector-decision" aria-label="Record a decision">
      <h3>Record a decision</h3>
      <p className="detector-note">
        A detector leaves Shadow detection after a complete service week at 95% precision or better, with indeterminate
        and unmatched cases reported separately. On-demand service quality also needs two complete service weeks,
        dispatcher agreement, and no unresolved feed-health issue.
      </p>

      <div className="detector-fields">
        <label>
          <span>Detector</span>
          <select aria-label="Detector" value={draft.detector} onChange={(event) => set({ detector: event.target.value as PromotionDraft["detector"] })}>
            {(view?.standings ?? []).map((standing) => <option key={standing.detector} value={standing.detector}>{detectorLabel(standing.detector)}</option>)}
          </select>
        </label>

        <label>
          <span>Decision</span>
          <select aria-label="Decision" value={draft.promoted ? "promote" : "demote"} onChange={(event) => set({ promoted: event.target.value === "promote" })}>
            <option value="promote">Promote — start counting toward assessments</option>
            <option value="demote">Demote — back into Shadow detection</option>
          </select>
        </label>

        <label>
          <span>From service date</span>
          <input aria-label="From service date" type="date" value={draft.effectiveDate} onChange={(event) => set({ effectiveDate: event.target.value })} aria-invalid={Boolean(showErrors && errors.effectiveDate)} />
          {showErrors && errors.effectiveDate && <small className="detector-error">{errors.effectiveDate}</small>}
          <small>Cases on this service date and after. Earlier months keep the figures they were measured with.</small>
        </label>

        {draft.promoted && <>
          <label>
            <span>Measured precision</span>
            <input aria-label="Measured precision" type="number" inputMode="decimal" min={0} max={100} step={0.1} value={draft.precisionPercent}
              onChange={(event) => set({ precisionPercent: event.target.value })}
              aria-invalid={Boolean(showErrors && errors.precisionPercent)} />
            {showErrors && errors.precisionPercent && <small className="detector-error">{errors.precisionPercent}</small>}
            <small>Percent, over a complete service week.</small>
          </label>

          <label>
            <span>Cases measured</span>
            <input aria-label="Cases measured" type="number" inputMode="numeric" min={1} step={1} value={draft.sampleSize}
              onChange={(event) => set({ sampleSize: event.target.value })}
              aria-invalid={Boolean(showErrors && errors.sampleSize)} />
            {showErrors && errors.sampleSize && <small className="detector-error">{errors.sampleSize}</small>}
          </label>
        </>}

        <label className="detector-reason">
          <span>Reason</span>
          <textarea aria-label="Reason" rows={3} value={draft.reason} onChange={(event) => set({ reason: event.target.value })}
            aria-invalid={Boolean(showErrors && errors.reason)} />
          {showErrors && errors.reason && <small className="detector-error">{errors.reason}</small>}
        </label>

        {draft.promoted && draft.detector === "spare" && <label className="detector-confirm">
          <input aria-label="On-demand conditions confirmed" type="checkbox" checked={draft.onDemandConditionsMet} onChange={(event) => set({ onDemandConditionsMet: event.target.checked })} />
          <span>Two complete service weeks, dispatcher agreement and no unresolved feed-health issue are confirmed.</span>
          {showErrors && errors.onDemandConditionsMet && <small className="detector-error">{errors.onDemandConditionsMet}</small>}
        </label>}
      </div>

      <button className="btn-sm" disabled={saving} onClick={() => void record()}>
        {draft.promoted ? "Record promotion" : "Record demotion"}
      </button>
      <div className="detector-live" role="status">
        {message && <small className="detector-saved">{message}</small>}
        {failure && <small className="detector-error">{failure}</small>}
      </div>
    </section>

    <section className="detector-history" aria-label="Decision history">
      <h3>Decisions</h3>
      {(view?.history ?? []).length === 0 && <p className="detector-empty">No detector has been promoted. Every one of them is in Shadow detection.</p>}
      {[...(view?.history ?? [])].reverse().map((item) => <article key={`${item.detector}-${item.effective_service_date}-${item.decided_at}`} className="detector-history-row">
        <strong>{decisionTitle(item)}</strong>
        <small>From {serviceDateLabel(item.effective_service_date)} · {measurementText(item)}</small>
        <p>{item.reason}</p>
        <small>{item.decided_by} · {new Date(item.decided_at).toLocaleString()}</small>
      </article>)}
    </section>
  </div>;
}
