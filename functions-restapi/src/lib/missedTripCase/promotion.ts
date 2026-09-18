// Which detectors are out of Shadow detection, and since when.
//
// Promotion used to be MISSED_TRIP_PROMOTED_DETECTORS, an app setting: a
// comma-separated list with no date, no reason and no author. Three things were
// wrong with it. A detector was promoted for all of history the moment the
// setting changed, so a month already assessed on Shadow-detection figures
// silently gained missed trips. Nothing recorded who decided, on what evidence.
// And a setting SQL cannot read forced vw_MissedTrip to report every detector as
// unpromoted, so the warehouse and the app disagreed.
//
// Promotion is now a decision with a date: an append-only history of
// promote/demote entries, each effective from a SERVICE date, each carrying the
// measured precision and sample size it was decided on and the person who
// decided. A case counts toward an assessment when its detector was promoted on
// the service date the case belongs to - so promoting today never rewrites last
// month, and demoting a detector that started misfiring leaves the months it was
// trusted for alone.
//
// Readers do not query the history table. `promotionWindows` compiles it into
// the spans a detector was promoted for, and `promotionWindowsSql` renders those
// spans as literals, so every query carries its own answer and a database
// without the table behaves exactly as it does today: nothing promoted.
import { sql } from "../db";
import { MISSED_TRIP_DETECTORS, type MissedTripDetector } from "./types";

/** One promote or demote decision, as stored. */
export interface DetectorPromotionEntry {
  detector: MissedTripDetector;
  /** Service date key (YYYYMMDD) the decision takes effect from. */
  effective_service_date: string;
  promoted: boolean;
  reason: string;
  measured_precision: number | null;
  sample_size: number | null;
  decided_by: string;
  decided_at: Date;
}

/** A span a detector was promoted for: [from, until), by service date key. */
export interface PromotionWindow {
  detector: MissedTripDetector;
  from: string;
  until: string | null;
}

export const SERVICE_DATE_KEY = /^\d{8}$/;

const known = (value: string): value is MissedTripDetector =>
  (MISSED_TRIP_DETECTORS as readonly string[]).includes(value);

/**
 * Detector names the history mentions that this build does not know. A typo, or
 * a detector retired since the decision: either way it promotes nothing, and the
 * admin surface says so rather than leaving a decision that looks applied.
 */
export function ignoredDetectorNames(entries: readonly { detector: string }[]): string[] {
  return [...new Set(entries.map((e) => e.detector).filter((d) => !known(d)))].sort();
}

/**
 * The spans each detector was promoted for. Entries are read in decision order -
 * effective date first, then when the decision was recorded - and a decision
 * that repeats the state it is already in changes nothing.
 */
export function promotionWindows(entries: readonly DetectorPromotionEntry[]): PromotionWindow[] {
  const windows: PromotionWindow[] = [];
  for (const detector of MISSED_TRIP_DETECTORS) {
    const mine = entries
      .filter((e) => e.detector === detector && SERVICE_DATE_KEY.test(e.effective_service_date))
      .sort((a, b) =>
        a.effective_service_date.localeCompare(b.effective_service_date) ||
        a.decided_at.getTime() - b.decided_at.getTime());
    let open: PromotionWindow | null = null;
    for (const entry of mine) {
      if (entry.promoted && !open) {
        open = { detector, from: entry.effective_service_date, until: null };
        windows.push(open);
      } else if (!entry.promoted && open) {
        // A demotion effective on the day it was promoted leaves no span at all.
        if (open.from === entry.effective_service_date) windows.pop();
        else open.until = entry.effective_service_date;
        open = null;
      }
    }
  }
  return windows;
}

/** Whether a detector was promoted on a service date. The twin of the SQL below. */
export function isPromotedOn(
  windows: readonly PromotionWindow[],
  detector: MissedTripDetector,
  serviceDate: string | null | undefined,
): boolean {
  const key = (serviceDate ?? "").slice(0, 8);
  if (!SERVICE_DATE_KEY.test(key)) return false;
  return windows.some((w) =>
    w.detector === detector && key >= w.from && (w.until === null || key < w.until));
}

/**
 * A reader that may depend on the history table - only vw_MissedTrip, which
 * migration 134 creates alongside it. The view cannot be handed compiled
 * windows, because nothing regenerates it when a promotion is recorded, so it
 * reads the history itself and the warehouse agrees with the app by
 * construction. Everything else passes windows.
 */
export const PROMOTION_HISTORY = "history";
export type PromotionSource = readonly PromotionWindow[] | typeof PROMOTION_HISTORY;

/** The latest decision at or before the service date, read from the history. */
export function promotionHistorySql(detectorExpr: string, dateExpr: string): string {
  return `(SELECT TOP 1 p.promoted FROM dbo.MissedTripDetectorPromotions p
        WHERE p.detector = ${detectorExpr} AND p.effective_service_date <= LEFT(${dateExpr}, 8)
        ORDER BY p.effective_service_date DESC, p.decided_at DESC) = 1`;
}

/**
 * The same question in SQL, as literals: no query depends on the history table
 * existing. `detectorExpr` names the detector column, `dateExpr` the service
 * date key. No windows means nothing is promoted, which is Shadow detection.
 */
export function promotionWindowsSql(
  detectorExpr: string,
  dateExpr: string,
  source: PromotionSource,
): string {
  if (source === PROMOTION_HISTORY) return promotionHistorySql(detectorExpr, dateExpr);
  const terms = source
    .filter((w) => known(w.detector))
    .map((w) => {
      if (!SERVICE_DATE_KEY.test(w.from) || (w.until !== null && !SERVICE_DATE_KEY.test(w.until))) {
        throw new TypeError("promotion window dates must be service date keys (YYYYMMDD)");
      }
      const until = w.until === null ? "" : ` AND LEFT(${dateExpr}, 8) < N'${w.until}'`;
      return `(${detectorExpr} = N'${w.detector}' AND LEFT(${dateExpr}, 8) >= N'${w.from}'${until})`;
    });
  return terms.length ? terms.join(" OR ") : "1 = 0";
}

/**
 * The stored history. A database without migration 134 has no history, which
 * reads as Shadow detection rather than an error - the same answer the app gave
 * before promotion had a home.
 */
export async function readDetectorPromotions(pool: sql.ConnectionPool): Promise<DetectorPromotionEntry[]> {
  const present = (await pool.request().query<{ there: number }>(
    `SELECT CASE WHEN OBJECT_ID('dbo.MissedTripDetectorPromotions','U') IS NULL THEN 0 ELSE 1 END there`))
    .recordset[0]?.there === 1;
  if (!present) return [];
  return (await pool.request().query<DetectorPromotionEntry & { promoted: boolean }>(`
    SELECT detector, effective_service_date, CAST(promoted AS BIT) promoted, reason,
           measured_precision, sample_size, decided_by, decided_at
    FROM dbo.MissedTripDetectorPromotions
    ORDER BY effective_service_date, decided_at`)).recordset
    .map((row) => ({ ...row, promoted: row.promoted === true || (row.promoted as unknown) === 1 }));
}

/**
 * Promotion changes rarely and is read by every missed-trip query, so it is held
 * briefly rather than fetched per query. A promotion recorded in the console is
 * live within a minute.
 */
const CACHE_MS = 60_000;
let cached: { at: number; windows: PromotionWindow[] } | null = null;

export async function detectorPromotionWindows(pool: sql.ConnectionPool, now = Date.now()): Promise<PromotionWindow[]> {
  if (cached && now - cached.at < CACHE_MS) return cached.windows;
  const windows = promotionWindows(await readDetectorPromotions(pool));
  cached = { at: now, windows };
  return windows;
}

/** Drops the held copy, so a decision just recorded is read back immediately. */
export function forgetPromotionCache(): void {
  cached = null;
}

// ---------------------------------------------------------------------------
// Making the decision

/** CONTEXT's bar: a complete service week at 95 percent precision. */
export const PRECISION_BAR = 0.95;

export interface PromotionRequest {
  detector: string;
  effective_service_date: string;
  promoted: boolean;
  reason: string;
  measured_precision?: number | null;
  sample_size?: number | null;
  /**
   * On-demand service quality additionally requires two complete service weeks,
   * dispatcher agreement, and no unresolved feed-health issue (CONTEXT: Shadow
   * detection). Nothing measures those, so promoting the Spare detector means
   * saying they are met; the answer is written into the record.
   */
  on_demand_conditions_met?: boolean;
}

export type PromotionRefusalCode =
  | "unknown_detector"
  | "bad_service_date"
  | "reason_required"
  | "evidence_required"
  | "below_precision_bar"
  | "on_demand_conditions"
  | "no_change";

export interface PromotionRefusal { code: PromotionRefusalCode; sentence: string }

export type PromotionDecision =
  | { ok: true; entry: Omit<DetectorPromotionEntry, "decided_at" | "decided_by"> }
  | { ok: false; refusal: PromotionRefusal };

const refuse = (code: PromotionRefusalCode, sentence: string): PromotionDecision => ({ ok: false, refusal: { code, sentence } });

const ON_DEMAND_NOTE =
  "Two complete service weeks, dispatcher agreement and no unresolved feed-health issue confirmed.";

/**
 * Whether this promotion or demotion may be recorded, and what gets recorded.
 *
 * The precision bar is CONTEXT's, enforced here rather than left to whoever
 * fills the form: a detector that has not met it is not promoted, and the
 * refusal says what it measured against what it needed. Demotion asks for none
 * of that - taking a misfiring detector back out should never be the harder
 * thing to do.
 */
export function decidePromotion(
  history: readonly DetectorPromotionEntry[],
  request: PromotionRequest,
): PromotionDecision {
  if (!known(request.detector)) {
    return refuse("unknown_detector", `OnBoard has no detector called "${request.detector}".`);
  }
  const detector = request.detector;
  const on = (request.effective_service_date ?? "").trim();
  if (!SERVICE_DATE_KEY.test(on)) {
    return refuse("bad_service_date", "Give the service date the decision applies from, as YYYYMMDD.");
  }
  const reason = (request.reason ?? "").trim();
  if (!reason) {
    return refuse("reason_required", request.promoted
      ? "Say what this detector measured, and over which service week."
      : "Say why this detector is being taken back out.");
  }

  const precision = request.measured_precision ?? null;
  const sample = request.sample_size ?? null;
  if (request.promoted) {
    if (precision === null || sample === null || sample <= 0) {
      return refuse("evidence_required",
        "Record the precision measured over a complete service week, and how many cases it was measured on.");
    }
    if (precision < PRECISION_BAR) {
      return refuse("below_precision_bar",
        `This detector measured ${(precision * 100).toFixed(1)}% precision. A detector leaves Shadow detection at ${PRECISION_BAR * 100}% over a complete service week.`);
    }
    if (detector === "spare" && request.on_demand_conditions_met !== true) {
      return refuse("on_demand_conditions",
        "On-demand service quality also needs two complete service weeks, dispatcher agreement and no unresolved feed-health issue. Confirm those before promoting this detector.");
    }
  }

  // Nothing to record if the detector is already in the state being asked for
  // on that date - it would read as a decision that changed something.
  const windows = promotionWindows(history);
  if (isPromotedOn(windows, detector, on) === request.promoted) {
    return refuse("no_change", request.promoted
      ? "This detector already counts on that service date."
      : "This detector is already in Shadow detection on that service date.");
  }

  return {
    ok: true,
    entry: {
      detector,
      effective_service_date: on,
      promoted: request.promoted,
      reason: detector === "spare" && request.promoted ? `${reason} ${ON_DEMAND_NOTE}` : reason,
      measured_precision: request.promoted ? precision : precision ?? null,
      sample_size: request.promoted ? sample : sample ?? null,
    },
  };
}

/** Records a decision. The history is append-only, so this only ever inserts. */
export async function recordDetectorPromotion(
  pool: sql.ConnectionPool,
  request: PromotionRequest,
  decidedBy: string,
): Promise<{ ok: true; entry: DetectorPromotionEntry } | { ok: false; refusal: PromotionRefusal }> {
  const decision = decidePromotion(await readDetectorPromotions(pool), request);
  if (!decision.ok) return decision;
  const { entry } = decision;
  const written = (await pool.request()
    .input("detector", sql.NVarChar(40), entry.detector)
    .input("effective", sql.Char(8), entry.effective_service_date)
    .input("promoted", sql.Bit, entry.promoted ? 1 : 0)
    .input("reason", sql.NVarChar(1000), entry.reason)
    .input("precision", sql.Decimal(5, 4), entry.measured_precision)
    .input("sample", sql.Int, entry.sample_size)
    .input("by", sql.NVarChar(200), decidedBy)
    .query<DetectorPromotionEntry>(`
      INSERT INTO dbo.MissedTripDetectorPromotions
        (detector, effective_service_date, promoted, reason, measured_precision, sample_size, decided_by)
      OUTPUT INSERTED.detector, INSERTED.effective_service_date, INSERTED.promoted, INSERTED.reason,
             INSERTED.measured_precision, INSERTED.sample_size, INSERTED.decided_by, INSERTED.decided_at
      VALUES (@detector, @effective, @promoted, @reason, @precision, @sample, @by)`)).recordset[0];
  forgetPromotionCache();
  return { ok: true, entry: { ...written, promoted: written.promoted === true || (written.promoted as unknown) === 1 } };
}

/** Where each detector stands today, for the page that shows it. */
export interface DetectorStanding {
  detector: MissedTripDetector;
  promoted: boolean;
  /** The service date it has counted from, when it counts today. */
  since: string | null;
}

export function detectorStandings(
  windows: readonly PromotionWindow[],
  today: string,
): DetectorStanding[] {
  return MISSED_TRIP_DETECTORS.map((detector) => {
    const open = windows.find((w) => w.detector === detector && today >= w.from && w.until === null);
    return { detector, promoted: Boolean(open), since: open?.from ?? null };
  });
}
