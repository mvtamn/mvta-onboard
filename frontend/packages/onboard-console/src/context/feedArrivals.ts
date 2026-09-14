// What the live indicator needs to report real deliveries rather than its own
// re-reads. The console re-reads /trip-delays every 30 seconds, but the feed
// behind it is only fetched every five minutes, so nine re-reads in ten return
// the same data. Flashing, counting down and filling a poll bar on each re-read
// described the console, not the feed. These run on the feed's own clock: the
// ledger's last successful delivery, and the poller's cadence.
//
// Deliveries are counted per poll slot, not per timestamp. The poller's
// schedule is a UTC-aligned grid (every five minutes on the minute), and the
// ledger's delivery time is not a clean one-per-slot signal:
//   - two pollers read the same feed on the same schedule (gtfsDelaysPoll and
//     gtfsMissedTripsPoll), and each stamps the ledger when its fetch lands,
//     seconds apart - so one slot can show two delivery times;
//   - after a host restart the timer runs a missed occurrence late (a
//     "past due" catch-up), stamping the ledger minutes into the slot.
// Counted by timestamp, either one read as a second arrival: a second flash, an
// extra poll bar, and a countdown aimed at "last stamp + five minutes" rather
// than the next poll. Counted by slot, each slot delivers at most once.

export interface ArrivalClock {
  // When the latest slot's delivery landed (epoch ms) - its first stamp.
  lastArrivalAt: number;
  // The start of that poll slot on the poller's grid (epoch ms). The flash is
  // keyed on this, and the countdown runs from it to the next slot.
  slotStartAt: number;
  // How often the feed is fetched (ms).
  cadenceMs: number;
}

const KEPT_ARRIVALS = 12;

function slotOf(at: number, cadenceMs: number): number {
  return Math.floor(at / cadenceMs);
}

// Adds a delivery, once per poll slot. Re-reads between deliveries return the
// same time and add nothing; a second stamp or a catch-up run landing in a slot
// that already delivered adds nothing; an older time (a slower response, or a
// worker lagging a deploy) never moves the clock backwards. Without a known
// cadence, only exact repeats are collapsed - the slot is unknowable then.
export function recordArrival(arrivals: readonly number[], at: number, cadenceMs: number | null): number[] {
  if (!Number.isFinite(at)) return [...arrivals];
  const last = arrivals[arrivals.length - 1];
  if (last !== undefined) {
    if (at <= last) return [...arrivals];
    if (cadenceMs && cadenceMs > 0 && slotOf(at, cadenceMs) === slotOf(last, cadenceMs)) return [...arrivals];
  }
  return [...arrivals, at].slice(-KEPT_ARRIVALS);
}

export function arrivalClock(arrivals: readonly number[], cadenceMs: number | null): ArrivalClock | null {
  if (arrivals.length === 0 || !cadenceMs || cadenceMs <= 0) return null;
  const lastSlot = slotOf(arrivals[arrivals.length - 1], cadenceMs);
  // The slot's first stamp, in case deliveries were recorded before the
  // cadence was known and one slot holds more than one.
  const firstInSlot = arrivals.find((at) => slotOf(at, cadenceMs) === lastSlot) as number;
  return { lastArrivalAt: firstInSlot, slotStartAt: lastSlot * cadenceMs, cadenceMs };
}

// The last poll slots as bars, oldest first: true for a slot that delivered,
// false for one that did not. Missed slots come from the gaps between
// delivered slots, and from the slots since the last delivery - so a feed that
// has stopped keeps adding empty bars while the page is open, instead of
// showing a full row until something else notices.
//
// The slot in progress is not counted missed until it is half over: a poll
// fires on the slot boundary and takes seconds to minutes to land (up to four
// and a half under load), and a bar that empties at 5:01 and refills at 5:20
// is noise.
export function arrivalHistory(
  arrivals: readonly number[],
  cadenceMs: number | null,
  now: number,
  length = 6,
): boolean[] {
  if (arrivals.length === 0 || !cadenceMs || cadenceMs <= 0) return [];
  const slots = [...new Set(arrivals.map((at) => slotOf(at, cadenceMs)))].sort((a, b) => a - b);
  const outcomes: boolean[] = [true];
  for (let i = 1; i < slots.length; i++) {
    for (let k = 0; k < slots[i] - slots[i - 1] - 1; k++) outcomes.push(false);
    outcomes.push(true);
  }
  const lastSlot = slots[slots.length - 1];
  const currentSlot = slotOf(now, cadenceMs);
  if (currentSlot > lastSlot) {
    const intoCurrent = now - currentSlot * cadenceMs;
    const missed = currentSlot - lastSlot - 1 + (intoCurrent > cadenceMs / 2 ? 1 : 0);
    for (let k = 0; k < missed; k++) outcomes.push(false);
  }
  return outcomes.slice(-length);
}
