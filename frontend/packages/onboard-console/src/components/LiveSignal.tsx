import { useMemo, useRef, type ReactNode } from "react";
import "./liveSignal.css";
import type { ArrivalClock } from "../context/feedArrivals.js";
import type { OperationalDataState } from "../hooks/useLiveStats.js";

// One indicator for every surface that reports whether operational data is
// arriving. Before this, four unrelated treatments said "live": a badge, a
// 7px dot, a coloured row and a nav pill - and a live feed differed from a
// dead one by a single colour swap on a static dot.
//
// The signal moves only while the connection is answering, and stops dead
// otherwise, so stillness is what draws the eye. Motion is never the only
// cue: the core changes shape (round -> squared -> hollow), the ring goes
// dashed, and the label says which state it is, so the indicator still reads
// in a screenshot, under prefers-reduced-motion, and to a colour-blind
// operator. Nothing here animates unless it is reporting a real event.
export type SignalState = "live" | "connecting" | "stale" | "unavailable" | "locked";

export function signalStateFor(state: OperationalDataState): SignalState {
  if (state === "live") return "live";
  if (state === "loading") return "connecting";
  if (state === "stale") return "stale";
  if (state === "authentication-required") return "locked";
  return "unavailable";
}

const STATE_CLASS: Record<SignalState, string> = {
  live: "is-live",
  connecting: "is-connecting",
  stale: "is-stale",
  unavailable: "is-down",
  locked: "is-locked",
};

// True once the delivery time has changed since this component mounted.
// Opening a page is not a delivery: the data was already there, and a flash
// on load would say something had just arrived when nothing had.
function useArrivedSinceMount(arrivalKey: number | null | undefined): boolean {
  const first = useRef(arrivalKey);
  return arrivalKey != null && arrivalKey !== first.current;
}

export interface LiveSignalProps {
  state: SignalState;
  size?: "sm" | "md" | "lg";
  // The feed's own delivery clock. Without it there is no countdown and no
  // arrival flash: a surface that does not know when data last landed, or how
  // often it lands, must not draw either.
  clock?: ArrivalClock | null;
  label?: string;
}

export function LiveSignal({ state, size = "md", clock, label }: LiveSignalProps) {
  const live = state === "live";
  const lastArrivalAt = clock?.lastArrivalAt ?? null;
  const cadenceMs = clock?.cadenceMs ?? null;
  const arrived = useArrivedSinceMount(live ? lastArrivalAt : null);

  // The arc unwinds once, from the last real delivery towards the next one on
  // the poller's cadence, and stays empty if that delivery is late - it does
  // not loop as though another one were on its way. Keyed on the delivery, so
  // a new one restarts it; the elapsed time is fixed per delivery, so the
  // provider's once-a-second re-render does not nudge a running animation.
  const arcStyle = useMemo(() => {
    if (lastArrivalAt === null || cadenceMs === null) return undefined;
    const elapsed = Math.min(cadenceMs, Math.max(0, Date.now() - lastArrivalAt));
    return { animationDuration: `${cadenceMs}ms`, animationDelay: elapsed > 0 ? `-${elapsed}ms` : "0ms" };
  }, [lastArrivalAt, cadenceMs]);
  const countdown = live && arcStyle !== undefined;

  return (
    <span
      className={`live-signal ${STATE_CLASS[state]} live-signal-${size}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <svg viewBox="0 0 18 18" focusable="false" aria-hidden="true">
        <circle className="live-signal-track" cx="9" cy="9" r="7.25" />
        {countdown ? <circle key={`arc-${lastArrivalAt}`} className="live-signal-arc" cx="9" cy="9" r="7.25" style={arcStyle} /> : null}
        {countdown ? <circle key={`comet-${lastArrivalAt}`} className="live-signal-comet" cx="9" cy="9" r="7.25" style={arcStyle} /> : null}
      </svg>
      <span className="live-signal-halo" />
      <span className="live-signal-halo two" />
      {/* Remounted per delivery so the one-shot punch and bloom replay. */}
      <span key={`bloom-${lastArrivalAt}`} className={`live-signal-bloom${arrived ? " arrive" : ""}`} />
      <span key={`core-${lastArrivalAt}`} className={`live-signal-core${arrived ? " arrive" : ""}`} />
      {state === "unavailable" ? <span className="live-signal-slash" /> : null}
      {state === "locked" ? <span className="live-signal-keybar" /> : null}
    </span>
  );
}

// The last feed deliveries as bars - filled arrived, faint missed. Evidence of
// the same fact the signal animates, in a form that survives a screenshot and
// reduced motion, and the only part of the indicator that says anything about
// the deliveries before this one. Rendered only where a real history is kept;
// a surface that does not record deliveries shows no bars rather than six
// reassuring ones.
export function FeedHistory({ outcomes, live }: { outcomes: boolean[]; live: boolean }) {
  if (outcomes.length === 0) return null;
  const arrived = outcomes.filter(Boolean).length;
  return (
    <span
      className={`feed-history${live ? " live" : ""}`}
      role="img"
      aria-label={`Last ${outcomes.length} polls: ${arrived} arrived`}
    >
      {outcomes.map((ok, index) => (
        <i
          key={index}
          className={`feed-tick${ok ? " on" : ""}${ok && index === outcomes.length - 1 ? " head" : ""}`}
        />
      ))}
    </span>
  );
}

export type BannerTone = "live" | "warning" | "danger" | "muted" | "accent";

export interface LiveBannerProps {
  // A banner without a signal state is a plain notice - the training-scenario
  // and preview-data banners are exactly that, and must not wear a live core
  // or a moving wire, because no feed is answering behind them.
  state?: SignalState;
  tone: BannerTone;
  badge: string;
  children: ReactNode;
  clock?: ArrivalClock | null;
  history?: boolean[];
  role?: "status" | "alert";
  ariaLabel?: string;
}

// The banner that owns a page's data. It is the loud end of the same
// indicator: when a delivery lands, a lit sweep crosses the top edge, a
// hairline trails the bottom, a sheen crosses the body and the badge throws a
// glow - once, together, and only in the live tone. It used to run every six
// seconds whatever the feed was doing; a page whose data has not changed for
// four minutes now holds still, which is the truth about it.
export function LiveBanner({
  state, tone, badge, children, clock, history, role, ariaLabel,
}: LiveBannerProps) {
  const arrivalKey = tone === "live" ? clock?.lastArrivalAt ?? null : null;
  const arrived = useArrivedSinceMount(arrivalKey);
  const sweep = arrived ? " arrive" : "";
  return (
    <div className={`live-banner tone-${tone}`} role={role} aria-label={ariaLabel}>
      {tone === "live" ? (
        <>
          <span key={`sheen-${arrivalKey}`} className={`live-banner-sheen${sweep}`} aria-hidden="true"><i /></span>
          <span key={`wire-${arrivalKey}`} className={`live-banner-wire${sweep}`} aria-hidden="true"><i /></span>
          <span key={`wire-bottom-${arrivalKey}`} className={`live-banner-wire bottom${sweep}`} aria-hidden="true"><i /></span>
        </>
      ) : null}
      {state ? <LiveSignal state={state} clock={clock} /> : null}
      <span key={`badge-${arrivalKey}`} className={`concept-badge${sweep}`}>{badge}</span>
      <span className="live-banner-message">{children}</span>
      {history && history.length > 0 ? (
        <>
          <span className="live-banner-spacer" />
          <FeedHistory outcomes={history} live={state === "live"} />
        </>
      ) : null}
    </div>
  );
}
