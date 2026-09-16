import { Fragment, useMemo, useState } from "react";
import { Avatar, Icon, Loading, PageHead, Pill } from "./AccessUi.js";
import { useAccess } from "./accessData.js";
import { actionLabel, outcomeNeedsLook, outcomeOf } from "./auditVocabulary.js";

// The append-only record of every administrative action on OnBoard access,
// grouped by day. Filters work on what the API returned; they do not re-query.
export function AccessActivity() {
  const { audit, loading, principalName } = useAccess();
  const [query, setQuery] = useState("");
  const [action, setAction] = useState("all");
  const [problemsOnly, setProblemsOnly] = useState(false);

  const actions = useMemo(() => [...new Set(audit.map((entry) => entry.action))].sort((a, b) => actionLabel(a).localeCompare(actionLabel(b))), [audit]);
  const rows = useMemo(() => {
    const text = query.trim().toLowerCase();
    return [...audit]
      .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
      .filter((entry) => (action === "all" || entry.action === action)
        && (!problemsOnly || outcomeNeedsLook(entry.outcome))
        && (!text || [entry.actor_name, entry.target_id ? principalName(entry.target_id) : "", entry.reason ?? "", actionLabel(entry.action)].some((value) => value.toLowerCase().includes(text))));
  }, [action, audit, principalName, problemsOnly, query]);

  const day = (value: string) => new Date(value).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: "numeric" });
  const time = (value: string) => new Date(value).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  return <>
    <PageHead title="Activity log" description="Every administrative action on OnBoard access, kept append-only. Sign-in event details are never copied here." />
    <div className="am-toolbar">
      <label className="am-search"><Icon name="search" size={15} /><input type="search" aria-label="Search activity" placeholder="Person, target or reason" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <select className="am-select" aria-label="Filter action" value={action} onChange={(event) => setAction(event.target.value)}>
        <option value="all">All actions</option>
        {actions.map((item) => <option key={item} value={item}>{actionLabel(item)}</option>)}
      </select>
      <div className="am-seg" role="group" aria-label="Outcome">
        <button type="button" aria-pressed={!problemsOnly} onClick={() => setProblemsOnly(false)}>All outcomes</button>
        <button type="button" aria-pressed={problemsOnly} onClick={() => setProblemsOnly(true)}>Failed or blocked</button>
      </div>
      <span className="am-toolbar-meta" role="status">{rows.length === audit.length ? `${audit.length} entries` : `Showing ${rows.length} of ${audit.length}`}</span>
    </div>
    {loading && audit.length === 0 ? <Loading label="Loading activity…" /> : <div className="am-table-wrap">
      <table className="am-table">
        <thead><tr><th>Time</th><th>Who</th><th>Action</th><th>Target</th><th>Outcome</th><th>Reason</th></tr></thead>
        <tbody>{rows.length === 0 ? <tr><td colSpan={6}><p className="am-empty">{audit.length ? "No activity matches these filters." : "No administrative activity yet."}</p></td></tr> : rows.map((entry, index) => {
          const heading = index === 0 || day(rows[index - 1]!.occurred_at) !== day(entry.occurred_at);
          const outcome = outcomeOf(entry.outcome);
          return <Fragment key={entry.id ?? `${entry.occurred_at}-${index}`}>
            {heading ? <tr className="am-day"><td colSpan={6}>{day(entry.occurred_at)}</td></tr> : null}
            <tr>
              <td className="am-muted" title={entry.occurred_at}>{time(entry.occurred_at)}</td>
              <td><div className="am-who"><Avatar name={entry.actor_name} /><b>{entry.actor_name}</b></div></td>
              <td title={entry.action}>{actionLabel(entry.action)}</td>
              <td>{entry.target_id ? principalName(entry.target_id) : <span className="am-muted">—</span>}</td>
              <td><Pill tone={outcome.tone}>{outcome.label}</Pill></td>
              <td className="am-muted">{entry.reason || "—"}</td>
            </tr>
          </Fragment>;
        })}</tbody>
      </table>
    </div>}
  </>;
}
