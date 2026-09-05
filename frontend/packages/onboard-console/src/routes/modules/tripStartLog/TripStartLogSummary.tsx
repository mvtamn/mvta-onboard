import { START_BUCKETS, type TripStartSummary } from "./tripStartLogState.js";

interface Props {
  summary: TripStartSummary | null;
  /** Whether the numbers are backed by a materialized day. */
  live: boolean;
}

// The summary strip (spec §4.3), computed over the filtered set. A zero here
// is a claim, so nothing is shown until the day's log actually exists.
export function TripStartLogSummary({ summary, live }: Props) {
  const value = (n: number | null | undefined) => (live && summary && n !== null && n !== undefined ? n : "—");
  const otp = live && summary && summary.start_otp !== null ? `${Math.round(summary.start_otp * 100)}%` : "—";
  const awaiting = live && summary ? summary.awaiting_initials : null;
  return (
    <div className="tsl-summary" aria-label="Dispatch log summary">
      {START_BUCKETS.map((bucket) => (
        <div key={bucket.key} className={`tsl-stat ${bucket.tone}`}>
          <strong>{value(summary?.counts[bucket.key])}</strong>
          <span>{bucket.label}</span>
        </div>
      ))}
      <div className="tsl-stat accent">
        <strong>{otp}</strong>
        <span>Start OTP</span>
      </div>
      <div className={`tsl-stat accent${awaiting ? " attention" : ""}`}>
        <strong>{awaiting === null ? "—" : awaiting}</strong>
        <span>Awaiting initials</span>
      </div>
    </div>
  );
}
