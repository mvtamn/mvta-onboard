// The ETA Accuracy Benchmark: how accurate the arrival predictions riders see
// are, scored the way Transit and Swiftly publish it
// (github.com/TransitApp/ETA-Accuracy-Benchmark), so OnBoard's figures can be
// read against Swiftly's (plans/prediction-accuracy-evaluation.md).
//
// A prediction is one ETA for one trip at one stop, sampled at one moment.
// Its bucket is how long after that moment the bus ACTUALLY reached the stop.
// It is accurate when the bus arrived within the bucket's window around the
// predicted time: "no earlier than 30 seconds before and no later than 1.5
// minutes after the predicted arrival time" for a bus 0-3 minutes away, and
// wider further out. A bus that comes early is held tighter than one that
// comes late, because a rider who arrives for the ETA misses an early bus and
// only waits for a late one.
//
// The window is stated here as actual minus predicted, the benchmark's own
// framing, rather than as a "variance" whose sign readers have to remember:
// negative means the bus came before the predicted time.
//
// The overall figure is the straight average of the four bucket percentages,
// not the share of all predictions that were accurate. A bucket with no
// predictions has no percentage and is left out of the average, which the
// result says.
//
// Pure: numbers in, numbers out.

export type BucketId = "0-3" | "3-6" | "6-10" | "10-15";

export interface BenchmarkBucket {
  id: BucketId;
  /** Seconds from sampling to actual arrival: from (inclusive) to (exclusive). */
  fromSeconds: number;
  toSeconds: number;
  /** How far before the predicted time the bus may arrive and still count. */
  earlySeconds: number;
  /** How far after the predicted time the bus may arrive and still count. */
  lateSeconds: number;
}

export const BENCHMARK_BUCKETS: readonly BenchmarkBucket[] = [
  { id: "0-3", fromSeconds: 0, toSeconds: 180, earlySeconds: 30, lateSeconds: 90 },
  { id: "3-6", fromSeconds: 180, toSeconds: 360, earlySeconds: 60, lateSeconds: 150 },
  { id: "6-10", fromSeconds: 360, toSeconds: 600, earlySeconds: 60, lateSeconds: 210 },
  { id: "10-15", fromSeconds: 600, toSeconds: 900, earlySeconds: 90, lateSeconds: 270 },
];

/** The bucket a prediction falls in, by seconds from sampling to actual arrival; null outside 0-15 minutes. */
export function bucketFor(secondsToActual: number): BenchmarkBucket | null {
  return BENCHMARK_BUCKETS.find((b) => secondsToActual >= b.fromSeconds && secondsToActual < b.toSeconds) ?? null;
}

export type PredictionVerdict =
  | { counted: false }
  | { counted: true; bucket: BucketId; accurate: boolean; arrivedEarly: boolean; arrivedLate: boolean };

/**
 * Score one prediction. Times are seconds (epoch). A prediction whose actual
 * arrival is not 0-15 minutes after it was sampled is not counted at all.
 */
export function scorePrediction(sampledAt: number, predictedAt: number, actualAt: number): PredictionVerdict {
  const bucket = bucketFor(actualAt - sampledAt);
  if (!bucket) return { counted: false };
  const actualMinusPredicted = actualAt - predictedAt;
  const arrivedEarly = actualMinusPredicted < -bucket.earlySeconds;
  const arrivedLate = actualMinusPredicted > bucket.lateSeconds;
  return { counted: true, bucket: bucket.id, accurate: !arrivedEarly && !arrivedLate, arrivedEarly, arrivedLate };
}

export interface BucketTally {
  predictions: number;
  accurate: number;
  /** The bus came earlier than the window allowed. */
  early: number;
  /** The bus came later than the window allowed. */
  late: number;
}

export type BenchmarkTallies = Record<BucketId, BucketTally>;

export function emptyTallies(): BenchmarkTallies {
  return {
    "0-3": { predictions: 0, accurate: 0, early: 0, late: 0 },
    "3-6": { predictions: 0, accurate: 0, early: 0, late: 0 },
    "6-10": { predictions: 0, accurate: 0, early: 0, late: 0 },
    "10-15": { predictions: 0, accurate: 0, early: 0, late: 0 },
  };
}

export function tally(tallies: BenchmarkTallies, verdict: PredictionVerdict): void {
  if (!verdict.counted) return;
  const t = tallies[verdict.bucket];
  t.predictions++;
  if (verdict.accurate) t.accurate++;
  if (verdict.arrivedEarly) t.early++;
  if (verdict.arrivedLate) t.late++;
}

/** Tallies added together, e.g. days into a period, or routes into the agency. */
export function combine(...all: readonly BenchmarkTallies[]): BenchmarkTallies {
  const out = emptyTallies();
  for (const tallies of all) {
    for (const bucket of BENCHMARK_BUCKETS) {
      const into = out[bucket.id];
      const from = tallies[bucket.id];
      into.predictions += from.predictions;
      into.accurate += from.accurate;
      into.early += from.early;
      into.late += from.late;
    }
  }
  return out;
}

export interface BenchmarkResult {
  /** Accurate share per bucket, 0-1; null for a bucket with no predictions. */
  buckets: Record<BucketId, number | null>;
  /** Straight average of the bucket shares that exist; null when none do. */
  overall: number | null;
  /** Buckets the overall figure could not include. */
  missingBuckets: BucketId[];
  predictions: number;
}

/**
 * The benchmark over a set of tallies. A route's figure is this over the
 * route's tallies; the agency's is this over everyone's tallies combined,
 * never an average of route figures.
 */
export function benchmark(tallies: BenchmarkTallies): BenchmarkResult {
  const buckets = {} as Record<BucketId, number | null>;
  const shares: number[] = [];
  const missingBuckets: BucketId[] = [];
  let predictions = 0;
  for (const bucket of BENCHMARK_BUCKETS) {
    const t = tallies[bucket.id];
    predictions += t.predictions;
    if (t.predictions === 0) {
      buckets[bucket.id] = null;
      missingBuckets.push(bucket.id);
      continue;
    }
    const share = t.accurate / t.predictions;
    buckets[bucket.id] = share;
    shares.push(share);
  }
  const overall = shares.length === 0 ? null : shares.reduce((a, b) => a + b, 0) / shares.length;
  return { buckets, overall, missingBuckets, predictions };
}
