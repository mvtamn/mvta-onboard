// The Detector scorecard, read the way a promotion is decided: one row per
// detector family, verdict first. The verdict is the family's latest complete
// service week against the 95% bar; the strip shows every week's precision
// against the same bar; the evidence beside it is the week the strip has
// selected. Chosen over a week-by-week table (prototype variant B, branch
// prototype/detector-scorecard-variants) because the question on this page is
// "can this detector be promoted yet", and all three families answer it at once.
import { useState } from "react";
import type { DetectorScorecard, DetectorScorecardPeriod, MissedTripDetectorName } from "@mvta/shared";
import { detectorLabel, detectorSource, type PromotionDraft } from "../lib/detectorPromotion.js";
import {
  availRecallText,
  availText,
  dispatcherRecallText,
  dispatcherText,
  draftFromWeek,
  featuredWeek,
  heldReasonsText,
  periodLabel,
  precisionText,
  rateText,
  reviewBurdenText,
  shortDateLabel,
  weeksMetText,
  weekTone,
} from "../lib/detectorScorecard.js";

// The strip's floor: precision below it is drawn at the floor, so the
// difference between 90% and 99% - the part that matters - is not squashed.
const FLOOR = 0.6;
const heightOf = (precision: number | null) =>
  precision === null ? 0 : ((Math.max(precision, FLOOR) - FLOOR) / (1 - FLOOR)) * 100;

const figuresFor = (period: DetectorScorecardPeriod, detector: MissedTripDetectorName) =>
  period.detectors.find((d) => d.detector === detector);

function PrecisionStrip({ periods, detector, bar, selected, onSelect }: {
  periods: DetectorScorecardPeriod[];
  detector: MissedTripDetectorName;
  bar: number;
  selected: string;
  onSelect: (start: string) => void;
}) {
  return <div className="readiness-strip" role="group" aria-label={`Weekly precision, ${detectorLabel(detector)}`}>
    <div className="readiness-strip-plot">
      <span className="readiness-strip-bar" style={{ bottom: `${heightOf(bar)}%` }}>{Math.round(bar * 100)}% bar</span>
      {periods.map((period) => {
        const figures = figuresFor(period, detector);
        if (!figures) return null;
        return <button key={period.start} type="button"
          className={`readiness-strip-week is-${weekTone(figures)}`}
          aria-pressed={selected === period.start}
          aria-label={`${periodLabel(period, "week")}: ${precisionText(figures)}. ${figures.bar?.sentence ?? ""}`}
          onClick={() => onSelect(period.start)}>
          <span className="readiness-strip-col" style={{ height: `${heightOf(figures.precision)}%` }} />
        </button>;
      })}
    </div>
    <div className="readiness-strip-axis" aria-hidden="true">
      {periods.map((period) => <span key={period.start}>{shortDateLabel(period.start)}</span>)}
    </div>
  </div>;
}

function DetectorRow({ scorecard, detector, onUseWeek }: {
  scorecard: DetectorScorecard;
  detector: MissedTripDetectorName;
  onUseWeek: (fill: Partial<PromotionDraft>) => void;
}) {
  const featured = featuredWeek(scorecard.periods, detector);
  const [selected, setSelected] = useState<string | null>(null);
  const period = scorecard.periods.find((p) => p.start === selected) ?? featured;
  const figures = period && figuresFor(period, detector);
  if (!period || !figures) return null;
  const fill = draftFromWeek(period, figures);
  const fixedRoute = detector !== "spare";
  const tone = weekTone(figures);

  return <article className={`readiness-row is-${tone}`} aria-label={detectorLabel(detector)}>
    <div className="readiness-verdict">
      <strong>{detectorLabel(detector)}</strong>
      <small>{detectorSource(detector)}</small>
      <span className="readiness-figure">{figures.precision === null ? "—" : rateText(figures.precision)}</span>
      <small>{periodLabel(period, "week")} · {figures.sample} decisive</small>
      <p>{figures.bar?.sentence}</p>
      {fill
        ? <button type="button" className="btn-sm" onClick={() => onUseWeek(fill)}>Promote with this week</button>
        : <small>{weeksMetText(scorecard.periods, detector)}</small>}
    </div>

    <PrecisionStrip periods={scorecard.periods} detector={detector} bar={scorecard.precision_bar}
      selected={period.start} onSelect={setSelected} />

    <dl className="readiness-evidence">
      <div>
        <dt>Held · indeterminate</dt>
        <dd>
          {figures.cases.held} · {figures.outcomes.indeterminate}
          <small>{rateText(figures.unknown_rate)} of {figures.cases.detected} detected{figures.held_reasons.length > 0 ? ` · ${heldReasonsText(figures.held_reasons)}` : ""}</small>
        </dd>
      </div>
      <div>
        <dt>Avail</dt>
        <dd>{availText(figures)}{fixedRoute && <small>Recall {availRecallText(period.avail_recall)}</small>}</dd>
      </div>
      <div>
        <dt>Dispatchers agree</dt>
        <dd>{dispatcherText(figures)}{fixedRoute && <small>Recall {dispatcherRecallText(period.dispatcher_recall)}</small>}</dd>
      </div>
      <div>
        <dt>Review burden</dt>
        <dd>{reviewBurdenText(figures.review)}</dd>
      </div>
    </dl>
  </article>;
}

export function DetectorReadiness({ scorecard, failure, detectors, onUseWeek }: {
  scorecard: DetectorScorecard | null;
  failure: string | null;
  detectors: readonly MissedTripDetectorName[];
  onUseWeek: (fill: Partial<PromotionDraft>) => void;
}) {
  return <section className="detector-scorecard" aria-label="Detector scorecard">
    <header>
      <h3>Ready to promote?</h3>
      <p className="detector-note">
        Each detector's latest complete service week (Monday to Sunday) against the {Math.round((scorecard?.precision_bar ?? 0.95) * 100)}% bar.
        Precision is confirmed cases over every decisive review; held cases and indeterminate reviews are counted apart.
        Select a week in the strip to read its evidence. Avail and the Dispatch Log are compared for fixed route only.
      </p>
    </header>
    {failure && <p className="detector-error">{failure}</p>}
    {!scorecard && !failure && <p className="detector-empty">Loading the scorecard.</p>}
    {scorecard && detectors.map((detector) =>
      <DetectorRow key={detector} scorecard={scorecard} detector={detector} onUseWeek={onUseWeek} />)}
    {scorecard && (!scorecard.sources.avail || !scorecard.sources.dispatch_log) && <p className="detector-note">
      {!scorecard.sources.avail && "This database has no Avail evidence links (migration 136), so Avail is not compared. "}
      {!scorecard.sources.dispatch_log && "This database has no Dispatch Log verifications, so dispatchers are not compared."}
    </p>}
  </section>;
}
