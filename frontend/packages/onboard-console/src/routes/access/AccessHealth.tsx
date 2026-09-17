import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { OnBoardAccessReconciliationFinding } from "@mvta/shared";
import { api } from "../../config.js";
import { roleLabel } from "../../auth/roles.js";
import { Icon, Loading, PageHead, Pill, type Tone } from "./AccessUi.js";
import { changeLabel, displayTime, errorMessage, idempotencyKey, useAccess, withRoleLabels, type PreviewResult } from "./accessData.js";

const SEVERITY: Record<OnBoardAccessReconciliationFinding["severity"], { tone: Tone; label: string; group: string }> = {
  error: { tone: "bad", label: "Error", group: "Errors" },
  warning: { tone: "warn", label: "Warning", group: "Warnings" },
  info: { tone: "info", label: "Info", group: "For information" },
};

// What to do about a finding OnBoard cannot repair itself, by finding code.
function manualFix(finding: OnBoardAccessReconciliationFinding) {
  switch (finding.code) {
    case "missing_directory_object":
      return <>Can’t be repaired here. Remove the assignment from the OnBoard enterprise application in the Entra admin center.</>;
    case "direct_human_assignment":
      return <>Record the exception, or replace it with group access. <Link className="am-link" to="/admin/access/people?show=direct">Open in People &amp; guests</Link></>;
    case "role_group_not_configured":
    case "duplicate_app_role_mapping":
      return <>A configuration change on the OnBoard API, not an Entra assignment. Raise it with the platform administrator.</>;
    default:
      return <>Can’t be repaired here.</>;
  }
}

// Compares what OnBoard expects with what Entra has assigned. The read is a
// full Graph sweep and is audited, so it runs when the page is first opened
// and again only when asked.
export function AccessHealth() {
  const { reconciliation, reconciliationLoading, loadReconciliation, busy, setBusy, setError, setNotice, load } = useAccess();
  const [selected, setSelected] = useState<number[]>([]);
  const [preview, setPreview] = useState<PreviewResult | null>(null);

  useEffect(() => {
    if (!reconciliation && !reconciliationLoading) void loadReconciliation();
    // Only on first visit; "Check again" re-reads on request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const findings = reconciliation?.findings ?? [];
  const repairs = () => findings.filter((_finding, index) => selected.includes(index)).flatMap((finding) => finding.repair_change ? [finding.repair_change] : []);
  const repairable = findings.filter((finding) => finding.repair_change).length;

  function toggle(index: number, on: boolean) {
    setSelected((current) => on ? [...current, index] : current.filter((item) => item !== index));
    setPreview(null);
  }

  async function refresh() {
    setSelected([]);
    setPreview(null);
    await loadReconciliation();
  }

  async function check() {
    const changes = repairs();
    if (changes.length === 0) return;
    setBusy(true);
    try {
      setPreview(await api.previewAccessChanges(changes));
      setError(null);
    } catch (repairError) {
      setError(errorMessage(repairError, "The repair check failed."));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!preview?.valid) return;
    setBusy(true);
    try {
      await api.submitAccessChanges(repairs(), idempotencyKey("reconcile"));
      setNotice("Selected repairs were submitted; privileged repairs may be waiting for approval.");
      setSelected([]);
      setPreview(null);
      await Promise.all([loadReconciliation(), load()]);
    } catch (repairError) {
      setError(errorMessage(repairError, "Reconciliation repair failed."));
    } finally {
      setBusy(false);
    }
  }

  const errors = findings.filter((finding) => finding.severity === "error").length;
  const warnings = findings.filter((finding) => finding.severity === "warning").length;
  const approvals = preview?.items.filter((item) => item.disposition === "approval_required").length ?? 0;
  const immediate = preview?.items.filter((item) => item.disposition === "immediate").length ?? 0;

  return <>
    <PageHead
      title="Access health"
      description="Compares the access levels OnBoard expects, and the groups configured for them, with what Entra actually has assigned. Repairs are always checked before they run."
    />
    {!reconciliation ? <Loading label={reconciliationLoading ? "Reading current access from Entra…" : "Access health hasn’t been checked yet."} /> : <>
      <div className="am-health">
        <span className={`am-health-ic${errors ? " bad" : warnings ? " warn" : ""}`}><Icon name={findings.length ? "pulse" : "check"} size={20} /></span>
        <div className="am-grow">
          <b>{findings.length === 0 ? "No access drift found" : `${findings.length} ${findings.length === 1 ? "finding needs" : "findings need"} attention`}</b>
          <small>Checked against Entra {displayTime(reconciliation.observed_at)}</small>
        </div>
        {findings.length ? <dl className="am-tally">
          <div><dt>Errors</dt><dd>{errors}</dd></div>
          <div><dt>Warnings</dt><dd>{warnings}</dd></div>
          <div><dt>Repairable</dt><dd>{repairable}</dd></div>
        </dl> : null}
        <button type="button" className="am-btn" disabled={busy || reconciliationLoading} onClick={() => void refresh()}><Icon name="refresh" size={15} />{reconciliationLoading ? "Checking…" : "Check again"}</button>
      </div>

      {(["error", "warning", "info"] as const).map((severity) => {
        const items = findings.map((finding, index) => ({ finding, index })).filter(({ finding }) => finding.severity === severity);
        if (!items.length) return null;
        return <section key={severity} className="am" aria-label={SEVERITY[severity].group}>
          <h3 className="am-group-label">{SEVERITY[severity].group}</h3>
          <ul className="am-findings">{items.map(({ finding, index }) => {
            const on = selected.includes(index);
            const message = withRoleLabels(finding.message);
            return <li key={`${finding.code}-${finding.principal_id ?? "global"}-${finding.role ?? index}`} className={`am-finding${on ? " is-on" : ""}`}>
              {finding.repair_change ? <input type="checkbox" aria-label={`Select repair: ${message}`} checked={on} onChange={(event) => toggle(index, event.target.checked)} /> : <span />}
              <div>
                <b>{message}</b>
                {finding.role ? <p>Access level: {roleLabel(finding.role)}</p> : null}
                <span className="am-fix">
                  {finding.repair_change
                    ? <><Icon name="wrench" size={12} />Repair: {changeLabel(finding.repair_change)} {finding.repair_change.action === "revoke" ? "from" : "to"} {finding.repair_change.principal_type === "group" ? "the group" : "this identity"}</>
                    : <><Icon name="info" size={12} /><span>{manualFix(finding)}</span></>}
                </span>
              </div>
              <Pill tone={SEVERITY[severity].tone}>{SEVERITY[severity].label}</Pill>
            </li>;
          })}</ul>
        </section>;
      })}

      {selected.length ? <div className="am-actionbar" role="region" aria-label="Selected repairs">
        <div className="am-grow">
          <b>{selected.length} {selected.length === 1 ? "repair" : "repairs"} selected</b>
          <small role="status">{!preview ? "Check them before they run."
            : !preview.valid ? preview.items.flatMap((item) => item.errors).join(" ") || "One or more repairs can’t be submitted."
              : [immediate ? `${immediate} ${immediate === 1 ? "applies" : "apply"} on confirm` : "", approvals ? `${approvals} ${approvals === 1 ? "needs" : "need"} a second Access Administrator` : ""].filter(Boolean).join(", ") || "Nothing to change."}</small>
        </div>
        <button type="button" className="am-btn" onClick={() => { setSelected([]); setPreview(null); }}>Clear</button>
        {preview?.valid
          ? <button type="button" className="am-btn solid" disabled={busy} onClick={() => void confirm()}>Confirm selected repairs</button>
          : <button type="button" className="am-btn solid" disabled={busy} onClick={() => void check()}>Check selected repairs</button>}
      </div> : null}
    </>}
  </>;
}
