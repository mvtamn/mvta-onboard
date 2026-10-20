// PROTOTYPE - throwaway. Three layouts for the Detector scorecard on the
// Missed-trip Detectors page, switchable with ?variant=A|B|C (or ← →):
//
//   A  Table        - one row per week for the chosen detector (what PR #428 ships)
//   B  Readiness    - every detector at once: verdict, weekly precision strip, evidence
//   C  Witnesses    - one week, one detector: reviewers vs Avail vs Dispatch Log
//
// Question it answers: what should someone deciding a promotion look at first?
// Lives on branch prototype/detector-scorecard-variants, never on main.
import { useState } from "react";
import type {
  DetectorPeriodFigures,
  DetectorScorecard,
  DetectorScorecardGrouping,
  DetectorScorecardPeriod,
  MissedTripDetectorName,
} from "@mvta/shared";
import { detectorLabel, detectorSource, serviceDateLabel, type PromotionDraft } from "../lib/detectorPromotion.js";
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
import "./detectorScorecardPrototype.css";

export const SCORECARD_VARIANTS = [
  { key: "A", name: "Table" },
  { key: "B", name: "Readiness" },
  { key: "C", name: "Witnesses" },
] as const;

export const PROTOTYPE_DETECTORS: MissedTripDetectorName[] = ["gtfs_cancellation", "gtfs_silent_no_show", "spare"];

export interface ScorecardVariantProps {
  scorecard: DetectorScorecard | null;
  usingFixture: boolean;
  grouping: DetectorScorecardGrouping;
  setGrouping: (value: DetectorScorecardGrouping) => void;
  detector: MissedTripDetectorName;
  setDetector: (value: MissedTripDetectorName) => void;
  onUseWeek: (fill: Partial<PromotionDraft>) => void;
}

const figuresFor = (period: DetectorScorecardPeriod, detector: MissedTripDetectorName) =>
  period.detectors.find((d) => d.detector === detector)!;

function DetectorTabs({ detector, setDetector }: Pick<ScorecardVariantProps, "detector" | "setDetector">) {
  return <div className="detector-toggle" role="group" aria-label="Scorecard detector">
    {PROTOTYPE_DETECTORS.map((d) => <button key={d} type="button" className="btn-sm" aria-pressed={detector === d}
      onClick={() => setDetector(d)}>{detectorLabel(d)}</button>)}
  </div>;
}

function FixtureNote({ usingFixture }: { usingFixture: boolean }) {
  return usingFixture ? <p className="proto-fixture">Prototype fixture data - the scorecard API did not answer.</p> : null;
}

// ---------------------------------------------------------------------------
// A - the table PR #428 ships

export function VariantA(props: ScorecardVariantProps) {
  const { scorecard, grouping, setGrouping, detector } = props;
  return <section className="detector-scorecard" aria-label="Detector scorecard">
    <header className="detector-scorecard-head">
      <div>
        <h3>Scorecard</h3>
        <p className="detector-note">Precision is confirmed cases over every decisive review; indeterminate reviews and held cases are counted apart.</p>
      </div>
      <div className="detector-toggle" role="group" aria-label="Group by">
        {(["week", "day"] as const).map((value) => <button key={value} type="button" className="btn-sm"
          aria-pressed={grouping === value} onClick={() => setGrouping(value)}>{value === "week" ? "Weeks" : "Days"}</button>)}
      </div>
    </header>
    <DetectorTabs {...props} />
    <FixtureNote usingFixture={props.usingFixture} />
    {scorecard && <div className="detector-scorecard-scroll">
      <table className="data detector-scorecard-table">
        <thead><tr>
          <th scope="col">{scorecard.grouping === "week" ? "Service week" : "Service date"}</th>
          <th scope="col">Precision</th><th scope="col">Held / indeterminate</th><th scope="col">Avail</th>
          <th scope="col">Dispatcher agrees</th><th scope="col">Review burden</th>
          <th scope="col">Fixed-route recall vs Avail</th><th scope="col">vs Dispatch Log</th>
          {scorecard.grouping === "week" && <th scope="col">Promotion bar</th>}
        </tr></thead>
        <tbody>
          {[...scorecard.periods].reverse().map((period) => {
            const f = figuresFor(period, detector);
            const fill = draftFromWeek(period, f);
            const fixedRoute = detector !== "spare";
            return <tr key={period.start}>
              <th scope="row">{periodLabel(period, scorecard.grouping)}</th>
              <td>{precisionText(f)}</td>
              <td>{f.cases.held} held · {f.outcomes.indeterminate} indeterminate<small>{rateText(f.unknown_rate)} of {f.cases.detected}</small></td>
              <td>{availText(f)}</td>
              <td>{dispatcherText(f)}</td>
              <td>{reviewBurdenText(f.review)}</td>
              <td>{fixedRoute ? availRecallText(period.avail_recall) : "—"}</td>
              <td>{fixedRoute ? dispatcherRecallText(period.dispatcher_recall) : "—"}</td>
              {scorecard.grouping === "week" && <td className={f.bar?.meets_bar ? "detector-bar is-met" : "detector-bar"}>
                <span>{f.bar?.sentence}</span>
                {fill && <button type="button" className="btn-sm" onClick={() => props.onUseWeek(fill)}>Use this week</button>}
              </td>}
            </tr>;
          })}
        </tbody>
      </table>
    </div>}
  </section>;
}

// ---------------------------------------------------------------------------
// B - Readiness: all three detectors, verdict first

const shortDate = (key: string) =>
  new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(4, 6)) - 1, Number(key.slice(6, 8))))
    .toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

const STRIP_W = 300;
const STRIP_H = 72;
const FLOOR = 0.6; // the strip's bottom; precision below it is drawn at the floor

function PrecisionStrip({ periods, detector, selected, onSelect }: {
  periods: DetectorScorecardPeriod[]; detector: MissedTripDetectorName; selected: string; onSelect: (start: string) => void;
}) {
  const slot = STRIP_W / periods.length;
  const y = (value: number) => STRIP_H - ((Math.max(value, FLOOR) - FLOOR) / (1 - FLOOR)) * STRIP_H;
  return <svg className="proto-strip" viewBox={`0 0 ${STRIP_W} ${STRIP_H + 16}`} role="img"
    aria-label={`Weekly precision for ${detectorLabel(detector)}`}>
    <line x1={0} x2={STRIP_W} y1={y(0.95)} y2={y(0.95)} className="proto-strip-bar" />
    <text x={0} y={y(0.95) - 3} className="proto-strip-label">95% bar</text>
    {periods.map((period, i) => {
      const f = figuresFor(period, detector);
      const tone = !period.ended || !f.bar?.complete ? "is-open" : f.bar.meets_bar ? "is-met" : "is-short";
      const top = f.precision === null ? STRIP_H - 2 : y(f.precision);
      return <g key={period.start} onClick={() => onSelect(period.start)} className="proto-strip-week" role="button"
        aria-label={`${periodLabel(period, "week")}: ${precisionText(f)}`} aria-pressed={selected === period.start}>
        <rect x={i * slot + 3} y={0} width={slot - 6} height={STRIP_H + 14}
          className={selected === period.start ? "proto-strip-hit is-selected" : "proto-strip-hit"} />
        <rect x={i * slot + slot / 2 - 7} y={top} width={14} height={STRIP_H - top} className={`proto-strip-col ${tone}`} rx={2} />
        <text x={i * slot + slot / 2} y={STRIP_H + 12} textAnchor="middle" className="proto-strip-label">
          {shortDate(period.start)}
        </text>
      </g>;
    })}
  </svg>;
}

function ReadinessRow({ scorecard, detector, onUseWeek }: { scorecard: DetectorScorecard; detector: MissedTripDetectorName; onUseWeek: ScorecardVariantProps["onUseWeek"] }) {
  const complete = scorecard.periods.filter((p) => figuresFor(p, detector).bar?.complete);
  const latest = complete[complete.length - 1] ?? scorecard.periods[scorecard.periods.length - 1];
  const [selected, setSelected] = useState(latest.start);
  const period = scorecard.periods.find((p) => p.start === selected) ?? latest;
  const f = figuresFor(period, detector);
  const fill = draftFromWeek(period, f);
  const met = scorecard.periods.filter((p) => figuresFor(p, detector).bar?.meets_bar).length;
  const fixedRoute = detector !== "spare";
  return <article className={f.bar?.meets_bar ? "proto-ready is-met" : "proto-ready"}>
    <div className="proto-ready-verdict">
      <strong>{detectorLabel(detector)}</strong>
      <small>{detectorSource(detector)}</small>
      <span className="proto-ready-figure">{f.precision === null ? "—" : rateText(f.precision)}</span>
      <small>{periodLabel(period, "week")} · {f.sample} decisive</small>
      <p>{f.bar?.sentence}</p>
      {fill ? <button type="button" className="btn-sm" onClick={() => onUseWeek(fill)}>Promote with this week</button>
        : <small>{met} of {scorecard.periods.length} weeks met the bar</small>}
    </div>
    <PrecisionStrip periods={scorecard.periods} detector={detector} selected={period.start} onSelect={setSelected} />
    <dl className="proto-ready-evidence">
      <div><dt>Held · indeterminate</dt><dd>{f.cases.held} · {f.outcomes.indeterminate}<small>{heldReasonsText(f.held_reasons) || "no held cases"}</small></dd></div>
      <div><dt>Avail</dt><dd>{availText(f)}{fixedRoute && <small>recall {availRecallText(period.avail_recall)}</small>}</dd></div>
      <div><dt>Dispatchers agree</dt><dd>{dispatcherText(f)}{fixedRoute && <small>recall {dispatcherRecallText(period.dispatcher_recall)}</small>}</dd></div>
      <div><dt>Review burden</dt><dd>{reviewBurdenText(f.review)}</dd></div>
    </dl>
  </article>;
}

export function VariantB(props: ScorecardVariantProps) {
  const { scorecard } = props;
  return <section className="detector-scorecard" aria-label="Detector scorecard">
    <header>
      <h3>Ready to promote?</h3>
      <p className="detector-note">Each detector's latest complete service week, against the 95% bar. Click a week in the strip to read its evidence.</p>
    </header>
    <FixtureNote usingFixture={props.usingFixture} />
    {scorecard?.grouping === "week" && PROTOTYPE_DETECTORS.map((d) =>
      <ReadinessRow key={d} scorecard={scorecard} detector={d} onUseWeek={props.onUseWeek} />)}
  </section>;
}

// ---------------------------------------------------------------------------
// C - Witnesses: one week, three sources side by side

function Witness({ title, rows, note }: { title: string; rows: [string, number | string, string?][]; note?: string }) {
  return <div className="proto-witness">
    <h4>{title}</h4>
    {rows.map(([label, value, tone]) => <div key={label} className={`proto-witness-row ${tone ?? ""}`}>
      <span>{label}</span><strong>{value}</strong>
    </div>)}
    {note && <small>{note}</small>}
  </div>;
}

export function VariantC(props: ScorecardVariantProps) {
  const { scorecard, detector } = props;
  const periods = scorecard?.periods ?? [];
  const [index, setIndex] = useState(() => Math.max(0, periods.map((p) => p.ended).lastIndexOf(true)));
  if (!scorecard || periods.length === 0) return null;
  const period = periods[Math.min(index, periods.length - 1)];
  const f: DetectorPeriodFigures = figuresFor(period, detector);
  const fill = draftFromWeek(period, f);
  const fixedRoute = detector !== "spare";
  const av = period.avail_recall;
  const dr = period.dispatcher_recall;
  return <section className="detector-scorecard" aria-label="Detector scorecard">
    <header className="detector-scorecard-head">
      <div>
        <h3>What the witnesses say</h3>
        <p className="detector-note">One service week, one detector. Reviewers measure precision; Avail and dispatchers are independent checks.</p>
      </div>
      <div className="proto-stepper">
        <button type="button" className="btn-sm" aria-label="Earlier week" disabled={index === 0} onClick={() => setIndex(index - 1)}>‹</button>
        <strong>{periodLabel(period, "week")}</strong>
        <button type="button" className="btn-sm" aria-label="Later week" disabled={index >= periods.length - 1} onClick={() => setIndex(index + 1)}>›</button>
      </div>
    </header>
    <DetectorTabs {...props} />
    <FixtureNote usingFixture={props.usingFixture} />
    <div className="proto-witnesses">
      <Witness title="Reviewers" rows={[
        ["Confirmed missed", f.outcomes.confirmed, "is-agree"],
        ["Ran after all", f.outcomes.timely_service + f.outcomes.partial_service_failure, "is-disagree"],
        ["Couldn't say", f.outcomes.indeterminate + f.cases.held, "is-unknown"],
        ["Precision", f.precision === null ? "—" : rateText(f.precision)],
      ]} note={`${f.review.awaiting_review} waiting · ${f.review.average_hours_to_review ?? "—"} h average to review`} />
      {fixedRoute && f.avail && av ? <Witness title="Avail" rows={[
        ["Backs the case", f.avail.corroborated, "is-agree"],
        ["Contradicts it", f.cases.evidence_conflicts, "is-disagree"],
        ["Probable, unplaced", av.awaiting_reviewer, "is-unknown"],
        ["Misses nobody flagged", av.unmatched + av.linked_not_flagged, "is-missed"],
      ]} note={`Recall ${rateText(av.recall)} of ${av.whole_misses} whole-trip misses`} />
        : <Witness title="Avail" rows={[["Not compared", "—"]]} note="Avail reports fixed route only." />}
      {fixedRoute && f.dispatcher && dr ? <Witness title="Dispatch Log" rows={[
        ["Didn't see it leave", f.dispatcher.not_observed, "is-agree"],
        ["Saw it leave", f.dispatcher.observed_on_time + f.dispatcher.observed_left_late, "is-disagree"],
        ["Unseen, no case", dr.missed, "is-missed"],
        ["Agreement", rateText(f.dispatcher.agreement)],
      ]} note={`${dr.verifications} trips verified this week`} />
        : <Witness title="Dispatch Log" rows={[["Not compared", "—"]]} note="The Dispatch Log covers fixed route only." />}
    </div>
    <footer className={f.bar?.meets_bar ? "proto-verdict is-met" : "proto-verdict"}>
      <span>{f.bar?.sentence}</span>
      {fill && <button type="button" className="btn-sm" onClick={() => props.onUseWeek(fill)}>Use this week</button>}
    </footer>
  </section>;
}

// ---------------------------------------------------------------------------
// Fixture, for previewing with no API behind the console

const WEEKS = ["20260831", "20260907", "20260914", "20260921", "20260928", "20261005", "20261012", "20261019"];

function fixtureFigures(detector: MissedTripDetectorName, i: number): DetectorPeriodFigures {
  const sample = detector === "gtfs_cancellation" ? 6 + (i % 3) : detector === "spare" ? 14 + i : 30 + i * 3;
  const confirmed = detector === "gtfs_cancellation" ? sample
    : detector === "spare" ? sample - (i % 4 === 0 ? 2 : 0)
      : sample - [5, 4, 3, 1, 3, 1, 1, 2][i];
  const precision = confirmed / sample;
  const ended = i < WEEKS.length - 1;
  const waiting = ended ? (i === 6 && detector === "spare" ? 2 : 0) : 5;
  const complete = ended && waiting === 0;
  const meets = complete && precision >= 0.95;
  const fixed = detector !== "spare";
  return {
    detector,
    cases: { detected: sample + 3 + waiting, open: 0, closed_by_evidence: 2, held: 2, awaiting_review: waiting, reviewed: sample + 1, legacy: 0, evidence_conflicts: fixed ? i % 2 : 0 },
    outcomes: { confirmed, timely_service: sample - confirmed, partial_service_failure: 0, indeterminate: 1 },
    precision, sample,
    held_reasons: [{ reason: "unknown_data_gap", count: 1 }, { reason: "awaiting_operating_window", count: 1 }],
    unknown_rate: 3 / (sample + 3 + waiting),
    avail: fixed ? { corroborated: Math.round(confirmed * 0.7), partial: 1, confirmed_without_avail: Math.round(confirmed * 0.3) } : null,
    dispatcher: fixed ? { not_observed: 5, observed_on_time: i % 3 === 0 ? 1 : 0, observed_left_late: 0, agreement: i % 3 === 0 ? 5 / 6 : 1 } : null,
    review: { reviewed: sample + 1, awaiting_review: waiting, average_hours_to_review: 3 + (i % 4) },
    bar: {
      complete, meets_bar: meets,
      sentence: !ended ? "This service week has not ended."
        : waiting > 0 ? `${waiting} case(s) still waiting for review or a decision.`
          : `${rateText(precision)} precision over ${sample} case(s) ${meets ? "meets the bar." : "is below 95%."}`,
    },
  };
}

export function scorecardFixture(grouping: DetectorScorecardGrouping): DetectorScorecard {
  return {
    from: WEEKS[0], to: "20261025", grouping, precision_bar: 0.95, sources: { avail: true, dispatch_log: true },
    periods: WEEKS.map((start, i) => ({
      start, end: start, ended: i < WEEKS.length - 1,
      detectors: PROTOTYPE_DETECTORS.map((d) => fixtureFigures(d, i)),
      avail_recall: { whole_misses: 14, caught: 9 + (i % 3), linked_not_flagged: 1, awaiting_reviewer: 1, unmatched: 3 - (i % 3), recall: (9 + (i % 3)) / 13, unmatched_rate: (3 - (i % 3)) / 14 },
      dispatcher_recall: { verifications: 320, not_observed: 6, caught: 5, missed: 1, recall: 5 / 6 },
    })),
  };
}
