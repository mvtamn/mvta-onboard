import { Fragment, useMemo, useState } from "react";
import { Avatar, Icon, Loading, PageHead, Pill } from "./AccessUi.js";
import { useAccess } from "./accessData.js";
import { actionLabel, outcomeNeedsLook, outcomeOf } from "./auditVocabulary.js";

// The append-only record of every administrative action on OnBoard access,
// grouped by day: the grants, removals, requests and role edits held in
// OnBoard's own tables, together with the Graph-era audit. Filters work on what
// the API returned; they do not re-query.
export function AccessActivity() {
  const { activity, loading } = useAccess();
  const [query, setQuery] = useState("");
  const [action, setAction] = useState("all");
  const [problemsOnly, setProblemsOnly] = useState(false);

  const actions = useMemo(() => [...new Set(activity.map((entry) => entry.action))].sort((a, b) => actionLabel(a).localeCompare(actionLabel(b))), [activity]);
  const rows = useMemo(() => {
    const text = query.trim().toLowerCase();
    return activity
      .filter((entry) => (action === "all" || entry.action === action)
        && (!problemsOnly || outcomeNeedsLook(entry.outcome))
        && (!text || [entry.actor, entry.target ?? "", entry.role ?? "", entry.reason ?? "", actionLabel(entry.action)].some((value) => value.toLowerCase().includes(text))));
  }, [action, activity, problemsOnly, query]);

  const day = (value: string) => new Date(value).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: "numeric" });
  const time = (value: string) => new Date(value).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  return <>
    <PageHead title="Activity log" description="Every administrative action on OnBoard access, kept append-only. Sign-in event details are never copied here." />
    <div className="am-toolbar">
      <label className="am-search"><Icon name="search" size={15} /><input type="search" aria-label="Search activity" placeholder="Person, role or reason" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <select className="am-select" aria-label="Filter action" value={action} onChange={(event) => setAction(event.target.value)}>
        <option value="all">All actions</option>
        {actions.map((item) => <option key={item} value={item}>{actionLabel(item)}</option>)}
      </select>
      <div className="am-seg" role="group" aria-label="Outcome">
        <button type="button" aria-pressed={!problemsOnly} onClick={() => setProblemsOnly(false)}>All outcomes</button>
        <button type="button" aria-pressed={problemsOnly} onClick={() => setProblemsOnly(true)}>Failed or blocked</button>
      </div>
      <span className="am-toolbar-meta" role="status">{rows.length === activity.length ? `${activity.length} entries` : `Showing ${rows.length} of ${activity.length}`}</span>
    </div>
    {loading && activity.length === 0 ? <Loading label="Loading activity…" /> : <div className="am-table-wrap">
      <table className="am-table">
        <thead><tr><th>Time</th><th>Who</th><th>Action</th><th>Person</th><th>Role</th><th>Outcome</th><th>Reason</th></tr></thead>
        <tbody>{rows.length === 0 ? <tr><td colSpan={7}><p className="am-empty">{activity.length ? "No activity matches these filters." : "No administrative activity yet."}</p></td></tr> : rows.map((entry, index) => {
          const heading = index === 0 || day(rows[index - 1]!.occurredAt) !== day(entry.occurredAt);
          const outcome = outcomeOf(entry.outcome);
          return <Fragment key={entry.id}>
            {heading ? <tr className="am-day"><td colSpan={7}>{day(entry.occurredAt)}</td></tr> : null}
            <tr>
              <td className="am-muted" title={entry.occurredAt}>{time(entry.occurredAt)}</td>
              <td><div className="am-who"><Avatar name={entry.actor} /><b>{entry.actor}</b></div></td>
              <td title={entry.action}>{actionLabel(entry.action)}</td>
              <td>{entry.target ?? <span className="am-muted">—</span>}</td>
              <td>{entry.role ?? <span className="am-muted">—</span>}</td>
              <td><Pill tone={outcome.tone}>{outcome.label}</Pill></td>
              <td className="am-muted">{entry.reason || "—"}</td>
            </tr>
          </Fragment>;
        })}</tbody>
      </table>
    </div>}
  </>;
}
