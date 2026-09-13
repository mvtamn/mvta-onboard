import type { ReactNode } from "react";
import "./liveSignal.css";
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

export interface LiveSignalProps {
  state: SignalState;
  size?: "sm" | "md" | "lg";
  // The module's own refresh interval, and how much of it is left. Both are
  // required for the countdown arc, and the arc is omitted without them: a
  // surface that does not poll on a known clock (the dashboard's one-shot
  // load, for instance) must not draw a countdown it is not keeping. The
  // negative animation-delay phases the arc to the real deadline rather than
  // to whenever this component happened to mount.
  intervalMs?: number;
  secondsLeft?: number;
  label?: string;
}

export function LiveSignal({ state, size = "md", intervalMs, secondsLeft, label }: LiveSignalProps) {
  const countdown = state === "live" && intervalMs !== undefined && intervalMs > 0 && secondsLeft !== undefined;
  const style = countdown
    ? {
        animationDuration: `${intervalMs}ms`,
        animationDelay: `-${Math.max(0, intervalMs - secondsLeft * 1000)}ms`,
      }
    : undefined;

  return (
    <span
      className={`live-signal ${STATE_CLASS[state]} live-signal-${size}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <svg viewBox="0 0 18 18" focusable="false" aria-hidden="true">
        <circle className="live-signal-track" cx="9" cy="9" r="7.25" />
        {countdown ? <circle className="live-signal-arc" cx="9" cy="9" r="7.25" style={style} /> : null}
        {countdown ? <circle className="live-signal-comet" cx="9" cy="9" r="7.25" style={style} /> : null}
      </svg>
      <span className="live-signal-halo" />
      <span className="live-signal-halo two" />
      <span className="live-signal-bloom" />
      <span className="live-signal-core" />
      {state === "unavailable" ? <span className="live-signal-slash" /> : null}
      {state === "locked" ? <span className="live-signal-keybar" /> : null}
    </span>
  );
}

// The last polls as bars - filled arrived, faint missed. Evidence of the same
// fact the signal animates, in a form that survives a screenshot and reduced
// motion, and the only part of the indicator that says anything about the
// polls before this one. Rendered only where a real history is kept; a
// surface that does not record its poll outcomes shows no bars rather than
// six reassuring ones.
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
  intervalMs?: number;
  secondsLeft?: number;
  history?: boolean[];
  role?: "status" | "alert";
  ariaLabel?: string;
}

// The banner that owns a page's data. It is the loud end of the same
// indicator: at each refresh a lit sweep crosses the top edge, a hairline
// trails the bottom, a sheen crosses the body and the badge throws a glow -
// all on one clock, and all only in the live tone.
export function LiveBanner({
  state, tone, badge, children, intervalMs, secondsLeft, history, role, ariaLabel,
}: LiveBannerProps) {
  return (
    <div className={`live-banner tone-${tone}`} role={role} aria-label={ariaLabel}>
      {tone === "live" ? (
        <>
          <span className="live-banner-sheen" aria-hidden="true"><i /></span>
          <span className="live-banner-wire" aria-hidden="true"><i /></span>
          <span className="live-banner-wire bottom" aria-hidden="true"><i /></span>
        </>
      ) : null}
      {state ? <LiveSignal state={state} intervalMs={intervalMs} secondsLeft={secondsLeft} /> : null}
      <span className="concept-badge">{badge}</span>
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
