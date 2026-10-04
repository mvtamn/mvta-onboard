import { useEffect, useState } from "react";
import { ApiError, type OtpAuditEntry, type OtpReasonCode } from "@mvta/shared";
import { api } from "../../../config.js";
import { auditLines } from "./otpAuditEntries.js";
import { formatServiceMonth } from "./otpServiceMonth.js";

export function AuditStreamPage({ serviceMonth, reasonCodes }: { serviceMonth: string | null; reasonCodes: OtpReasonCode[] }) {
  const [entries, setEntries] = useState<OtpAuditEntry[] | null>(null);
  const [scopeToMonth, setScopeToMonth] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getOtpAuditStream(scopeToMonth ? serviceMonth ?? undefined : undefined, 100)
      .then((d) => {
        setEntries(d.entries);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load the audit stream."));
  }, [scopeToMonth, serviceMonth]);

  return (
    <div className="subcard">
      <div className="otp-queue-toolbar" style={{ marginBottom: 12 }}>
        <label>
          <input type="checkbox" checked={scopeToMonth} onChange={(e) => setScopeToMonth(e.target.checked)} disabled={!serviceMonth} />
          {" "}Current month only{serviceMonth ? ` (${formatServiceMonth(serviceMonth)})` : ""}
        </label>
      </div>
      {error ? <p className="error-text">{error}</p> : null}
      {entries === null && !error ? <p className="muted">Loading…</p> : null}
      {entries && entries.length === 0 ? <p className="empty-note">No exclusion actions recorded yet.</p> : null}
      {auditLines(entries ?? [], reasonCodes).map((t, i) => (
        <div className="timeline-item" key={i}>
          <div className="t-title">{t.title}</div>
          <div className="t-desc">{t.detail}</div>
          <div className="td-dim" style={{ fontSize: 11 }}>{new Date(t.at).toLocaleString()}</div>
        </div>
      ))}
    </div>
  );
}
