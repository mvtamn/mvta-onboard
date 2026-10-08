// Which missed-trip detectors count toward an assessment, and since when.
//
// Every detector runs in Shadow detection until somebody decides otherwise:
// its cases are reviewed, but a confirmation never reaches an assessment. That
// decision used to be a deployment setting with no date, no evidence and no
// author (ADR-0035). It is made here now, and it is made for a service date, so
// promoting a detector cannot change a month already measured.
import { useEffect, useState } from "react";
import type { DetectorPromotionView } from "@mvta/shared";
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
import "./modules/serviceRisk.css";
import "./detectorPromotion.css";

export function MissedTripDetectorsAdmin() {
  const [view, setView] = useState<DetectorPromotionView | null>(null);
  const [draft, setDraft] = useState<PromotionDraft>(EMPTY_DRAFT);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const errors = draftErrors(draft);
  const set = (patch: Partial<PromotionDraft>) => setDraft((current) => ({ ...current, ...patch }));

  async function refresh() {
    setView(await api.getMissedTripDetectorPromotions());
  }

  useEffect(() => {
    void refresh().catch(() => setFailure("The promotion history is unavailable."));
  }, []);

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
