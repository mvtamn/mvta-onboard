import { useEffect } from "react";
import { Link } from "react-router-dom";
import type { AccessHealthFinding } from "@mvta/shared";
import { Icon, Loading, PageHead, Pill, SetupNotice, type Tone } from "./AccessUi.js";
import { useAccess } from "./accessData.js";

const SEVERITY: Record<AccessHealthFinding["severity"], { tone: Tone; label: string; group: string }> = {
  attention: { tone: "bad", label: "Needs attention", group: "Needs attention" },
  watch: { tone: "warn", label: "Worth watching", group: "Worth watching" },
};

// What to do about a finding, by its code. The old page compared OnBoard's
// expectations with Entra's app-role and group assignments and offered to
// repair the drift; since ADR-0032 those assignments decide nothing, so there
// is no drift to repair. What is left is about OnBoard's own grants, and every
// answer is a decision somebody makes here rather than a button that guesses.
function whatToDo(finding: AccessHealthFinding) {
  switch (finding.code) {
    case "signed_in_without_access":
      return <>Grant them a role, or leave them if that is intended. <Link className="am-link" to="/admin/access/people?show=nothing">Show them in People &amp; guests</Link></>;
    case "expiring_access":
      return <>Grant the role again with a later end date if the work continues. <Link className="am-link" to="/admin/access/people?show=expiry">Show them in People &amp; guests</Link></>;
    case "few_access_administrators":
      return <>Give a second person a role that can manage access. <Link className="am-link" to="/admin/access/add">Add access</Link></>;
    case "roles_nobody_holds":
      return <>Grant it to somebody, or archive it so the list stays honest. <Link className="am-link" to="/admin/access/roles">Open Roles</Link></>;
    default:
      return <>Decide what to do about it here.</>;
  }
}

// Access health reads OnBoard's own records: who signed in and holds nothing,
// what expires soon, whether a second Access Administrator exists to decide a
// privileged change, and which roles nobody holds. It is read on first visit to
// this page and again only when asked.
export function AccessHealth() {
  const { findings, findingsLoading, loadFindings, notReady } = useAccess();

  useEffect(() => {
    if (!findings && !findingsLoading) void loadFindings();
    // Only on first visit; "Check again" re-reads on request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const items = findings ?? [];
  const attention = items.filter((finding) => finding.severity === "attention").length;
  const watch = items.filter((finding) => finding.severity === "watch").length;

  return <>
    <PageHead
      title="Access health"
      description="What is worth an Access Administrator’s attention about OnBoard’s own roles and grants: people who can reach OnBoard but hold nothing, access about to end, and whether a privileged change could be decided today."
    />
    {notReady ? <SetupNotice message={notReady} /> : null}
    {!findings ? <Loading label={findingsLoading ? "Reading OnBoard’s grants…" : notReady ? "Access health needs the roles tables." : "Access health hasn’t been checked yet."} /> : <>
      <div className="am-health">
        <span className={`am-health-ic${attention ? " bad" : watch ? " warn" : ""}`}><Icon name={items.length ? "pulse" : "check"} size={20} /></span>
        <div className="am-grow">
          <b>{items.length === 0 ? "Nothing needs attention" : `${items.length} ${items.length === 1 ? "finding" : "findings"}`}</b>
          <small>Read from OnBoard’s own roles and grants, not from Entra.</small>
        </div>
        {items.length ? <dl className="am-tally">
          <div><dt>Needs attention</dt><dd>{attention}</dd></div>
          <div><dt>Worth watching</dt><dd>{watch}</dd></div>
        </dl> : null}
        <button type="button" className="am-btn" disabled={findingsLoading} onClick={() => void loadFindings()}><Icon name="refresh" size={15} />{findingsLoading ? "Checking…" : "Check again"}</button>
      </div>

      {(["attention", "watch"] as const).map((severity) => {
        const group = items.filter((finding) => finding.severity === severity);
        if (!group.length) return null;
        return <section key={severity} className="am" aria-label={SEVERITY[severity].group}>
          <h3 className="am-group-label">{SEVERITY[severity].group}</h3>
          <ul className="am-findings">{group.map((finding) => <li key={finding.code} className="am-finding">
            <span />
            <div>
              <b>{finding.headline}</b>
              <p>{finding.detail}</p>
              {finding.people?.length ? <p className="am-fine">{finding.people.join(" · ")}</p> : null}
              <span className="am-fix"><Icon name="info" size={12} /><span>{whatToDo(finding)}</span></span>
            </div>
            <Pill tone={SEVERITY[severity].tone}>{SEVERITY[severity].label}</Pill>
          </li>)}</ul>
        </section>;
      })}
    </>}
  </>;
}
