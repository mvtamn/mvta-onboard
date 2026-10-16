import { Link, useNavigate } from "react-router-dom";
import { OWNER_FILTERS, type OwnerFilter, type RankedRouteItem, type RouteSort } from "./routeRanking.js";

// The ranked routes beside the open one. Each route is a real link
// (?route=), so Back, bookmarks, shared links and "open in new tab" work.
// When the page is too narrow for the list beside the route (a phone), the
// list gives way to one Route picker in the same ranked order, so the open
// route is not pushed below every other route (scheduleReview.css).

export function RouteList({
  items,
  total,
  selected,
  sort,
  onSort,
  owner,
  onOwner,
  observedState,
  windowNote,
  onPick,
}: {
  items: RankedRouteItem[];
  total: number;
  selected: string | null;
  sort: RouteSort;
  onSort: (sort: RouteSort) => void;
  owner: OwnerFilter;
  onOwner: (owner: OwnerFilter) => void;
  /** Whether "confirmed by Avail" can be shown. */
  observedState: "ready" | "loading" | "no-access" | "error";
  windowNote: string | null;
  onPick: (routeId: string) => void;
}) {
  const navigate = useNavigate();
  const pickerHasSelected = selected === null || items.some((r) => r.routeId === selected);
  return (
    <nav className="sr-list" aria-label="Routes, ranked">
      <label className="sr-picker">
        Route
        <select
          value={selected ?? ""}
          onChange={(e) => {
            onPick(e.target.value);
            navigate({ search: `?route=${encodeURIComponent(e.target.value)}` });
          }}
        >
          {pickerHasSelected ? null : <option value={selected ?? ""}>{selected}</option>}
          {items.map((r) => (
            <option key={r.routeId} value={r.routeId}>
              {[
                r.short,
                r.name,
                observedState === "ready" && r.confirmed !== null ? `${r.confirmed} confirmed` : null,
                `${r.fixable} fixable`,
              ].filter(Boolean).join(" · ")}
            </option>
          ))}
        </select>
      </label>
      <div className="sr-list-head">
        <div className="sr-list-title">
          <h2>{items.length === total ? `${total} routes` : `${items.length} of ${total} routes`}</h2>
          <label>
            Rank by
            <select value={sort} onChange={(e) => onSort(e.target.value as RouteSort)}>
              <option value="confirmed" disabled={observedState !== "ready"}>Confirmed by Avail</option>
              <option value="fixable">Fixable flags</option>
              <option value="route">Route number</option>
            </select>
          </label>
        </div>
        <div className="sr-chips" role="group" aria-label="Who can fix it">
          {OWNER_FILTERS.map((f) => (
            <button key={f.key} type="button" aria-pressed={owner === f.key} onClick={() => onOwner(f.key)}>{f.label}</button>
          ))}
        </div>
      </div>
      {items.length === 0 ? (
        <p className="sr-muted sr-list-empty">No route has a flag for that owner. Choose All to see every route.</p>
      ) : (
        <ol className="sr-list-items">
          {items.map((r) => (
            <li key={r.routeId}>
              <Link
                to={{ search: `?route=${encodeURIComponent(r.routeId)}` }}
                aria-current={selected === r.routeId ? "page" : undefined}
                onClick={() => onPick(r.routeId)}
              >
                <span className="sr-list-name">
                  <span className="sr-route-chip">{r.short}</span>
                  <span className="sr-list-long">{r.name ?? `Route ${r.short}`}</span>
                </span>
                <span className="sr-list-counts">
                  {observedState === "ready" ? (
                    r.confirmed === null
                      ? <span className="sr-muted">{r.notMeasured ? "not measured by Avail" : "no Avail reading"}</span>
                      : <span><strong className={r.confirmed > 0 ? "sr-warn" : "sr-quiet"}>{r.confirmed}</strong> confirmed by Avail</span>
                  ) : null}
                  <span><strong>{r.fixable}</strong> fixable {r.fixable === 1 ? "flag" : "flags"}</span>
                  {r.structural > 0 ? <span className="sr-muted">+{r.structural} not {r.structural === 1 ? "a schedule fix" : "schedule fixes"}</span> : null}
                </span>
                {r.worst ? <span className="sr-list-worst">{r.worst}</span> : null}
              </Link>
            </li>
          ))}
        </ol>
      )}
      <p className="sr-list-foot">
        {observedState === "ready"
          ? `Confirmed by Avail: segments where departures run late in a peak against midday and the lateness grows across the segment${windowNote ? `, ${windowNote}` : ""}.`
          : observedState === "no-access"
            ? "Ranking by what Avail confirms needs Compliance access; routes are ranked by fixable flags."
            : observedState === "error"
              ? "What Avail confirms could not be loaded; routes are ranked by fixable flags."
              : "Loading what Avail confirms…"}
      </p>
    </nav>
  );
}
