// What the live indicator needs to report real deliveries rather than its own
// re-reads. The console re-reads /trip-delays every 30 seconds, but the feed
// behind it is only fetched every five minutes, so nine in ten re-reads return
// the same data. Flashing, counting down and filling a poll bar on each re-read
// described the console, not the feed. These run on the feed's own clock: the
// ledger's last successful delivery, and the poller's cadence.

export interface ArrivalClock {
  // When the feed last delivered successfully (epoch ms).
  lastArrivalAt: number;
  // How often the feed is fetched (ms).
  cadenceMs: number;
}

const KEPT_ARRIVALS = 12;

// Adds a delivery time to the list, once. Re-reads between deliveries return
// the same timestamp and add nothing; an older one (a slower response, or a
// worker lagging a deploy) never moves the clock backwards.
export function recordArrival(arrivals: readonly number[], at: number): number[] {
  if (!Number.isFinite(at)) return [...arrivals];
  const last = arrivals[arrivals.length - 1];
  if (last !== undefined && at <= last) return [...arrivals];
  return [...arrivals, at].slice(-KEPT_ARRIVALS);
}

export function arrivalClock(arrivals: readonly number[], cadenceMs: number | null): ArrivalClock | null {
  const last = arrivals[arrivals.length - 1];
  if (last === undefined || !cadenceMs || cadenceMs <= 0) return null;
  return { lastArrivalAt: last, cadenceMs };
}

// The last deliveries as poll bars, oldest first: true for a delivery, false
// for a slot on the cadence where none arrived. Missed slots come from the
// gaps between deliveries, and from the time since the last one - so a feed
// that has stopped keeps adding empty bars while the page is open, instead of
// showing a full row until something else notices.
//
// A delivery is not counted missed until it is half a cadence late: polls take
// seconds to minutes to land (up to four and a half under load), and a bar that
// empties at 5:01 and refills at 5:20 is noise.
export function arrivalHistory(
  arrivals: readonly number[],
  cadenceMs: number | null,
  now: number,
  length = 6,
): boolean[] {
  if (arrivals.length === 0 || !cadenceMs || cadenceMs <= 0) return [];
  const outcomes: boolean[] = [true];
  for (let i = 1; i < arrivals.length; i++) {
    const missed = Math.max(0, Math.round((arrivals[i] - arrivals[i - 1]) / cadenceMs) - 1);
    for (let k = 0; k < missed; k++) outcomes.push(false);
    outcomes.push(true);
  }
  const sinceLast = now - arrivals[arrivals.length - 1];
  const overdue = Math.max(0, Math.floor((sinceLast - cadenceMs / 2) / cadenceMs));
  for (let k = 0; k < overdue; k++) outcomes.push(false);
  return outcomes.slice(-length);
}
