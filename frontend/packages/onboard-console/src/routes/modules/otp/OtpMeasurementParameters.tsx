// The measurement standard fixed-route OTP is polled under (ADR 0042).
//
// This is not a tuning knob and the page says so. The seven numbers are MVTA's
// Avail configuration, not a setting of ours, and the early threshold decides
// what counts as on time - so changing it rewrites every historical compliance
// figure and therefore every tier and every amount that followed from one.
//
// Three things in the design exist to keep that honest, rather than to be
// cautious for its own sake:
//
//   * What is in force is always shown with its provenance - the date it took
//     effect, where the standard came from, who wrote it down. A compiled
//     fallback says it is a fallback.
//   * Declaring is behind a confirmation that spells out the consequence in
//     months and rows, taken from the server, before the button will submit.
//   * Declaring re-pulls nothing. The months that fall out of step are listed
//     with a button each, so restating a month is a deliberate act against a
//     named month.
import { useEffect, useState } from "react";
import {
  ApiError,
  type DeclareOtpParametersInput,
  type OtpMeasurementParameterSet,
  type OtpMeasurementParametersResponse,
  type OtpMonthNeedingRepull,
  type OtpParameterDeclaration,
} from "@mvta/shared";
import { api } from "../../../config.js";
import { parameterSentence } from "./otpAuditEntries.js";
import { formatServiceMonth } from "./otpServiceMonth.js";

const FIELDS: { key: keyof OtpMeasurementParameterSet; label: string; hint: string }[] = [
  { key: "early_threshold_minutes", label: "Early threshold", hint: "Minutes early before a departure stops counting as on time." },
  { key: "late_threshold_minutes", label: "Late threshold", hint: "Minutes late before a departure stops counting as on time." },
  { key: "early_outlier_minutes", label: "Early outlier", hint: "Beyond this, an early departure is treated as an outlier." },
  { key: "late_outlier_minutes", label: "Late outlier", hint: "Beyond this, a late departure is treated as an outlier." },
];

const FLAGS: { key: keyof OtpMeasurementParameterSet; label: string; hint: string }[] = [
  { key: "show_missed_stops", label: "Show missed stops", hint: "Avail's parameter 5." },
  { key: "include_outliers", label: "Include outliers", hint: "Whether outlying departures stay in the denominator." },
  { key: "show_detours", label: "Show detours", hint: "Avail's parameter 7." },
];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function OtpMeasurementParameters() {
  const [data, setData] = useState<OtpMeasurementParametersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    api
      .getOtpMeasurementParameters()
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not read the measurement standard."));
  }

  useEffect(() => {
    let cancelled = false;
    api
      .getOtpMeasurementParameters()
      .then((d) => !cancelled && setData(d))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Could not read the measurement standard."));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="subcard" style={{ marginBottom: 16 }}>
      <h2 style={{ marginTop: 0 }}>OTP measurement standard</h2>
      <p className="panel-desc">
        The parameters OnBoard sends Avail when it asks for on-time performance. These are MVTA's
        own Avail configuration, not a setting of ours — Avail can change them on their side
        without telling us, which is why they are declared here with a date and a source rather
        than left in the code. Changing the early threshold changes what counts as on time, so it
        changes every historical figure, tier and amount that followed from one. A declaration
        restates nothing by itself.
      </p>
      {error ? <p className="error-text">{error}</p> : null}
      {data ? (
        <>
          <InForce data={data} />
          <RepullList months={data.needs_repull} inForce={data.in_force.segments} onChanged={refresh} />
          <DeclareForm current={data.in_force.set} onDeclared={refresh} />
          <History history={data.history} inForceId={data.in_force.declaration?.id ?? null} />
        </>
      ) : error ? null : (
        <p className="muted">Loading…</p>
      )}
    </div>
  );
}

function InForce({ data }: { data: OtpMeasurementParametersResponse }) {
  const { in_force: inForce } = data;
  const declaration = inForce.declaration;
  return (
    <div style={{ marginBottom: 16 }}>
      <p style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 600 }}>
        {parameterSentence({ segments: inForce.segments })}
      </p>
      <p className="muted" style={{ marginTop: 0 }}>
        Sent as <code>{inForce.segments}</code>, which is also what every row polled under it is
        stamped with.
      </p>
      {declaration ? (
        <p className="muted" style={{ marginTop: 0 }}>
          In force from <strong>{declaration.effective_from}</strong> · {declaration.source} ·
          declared by {declaration.declared_by} on {declaration.declared_at.slice(0, 10)}
          {declaration.notes ? <> · {declaration.notes}</> : null}
        </p>
      ) : (
        // Not a cosmetic distinction: a fallback nobody declared is exactly the
        // state that let the wrong parameters survive for months.
        <p className="empty-note" style={{ marginTop: 0 }}>
          No declaration is in force — OnBoard is using its compiled default. Either
          migration&nbsp;151 has not been applied, or the register holds nothing usable. Figures
          are still being produced, but nothing records who agreed to this standard.
        </p>
      )}
    </div>
  );
}

function RepullList({
  months,
  inForce,
  onChanged,
}: {
  months: OtpMonthNeedingRepull[];
  inForce: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function repull(month: string) {
    setBusy(month);
    setError(null);
    try {
      // Only the OTP phase: a re-pull is about this month's OTP figures, and
      // waiting on a Missed Trips reload it never asked for is what used to
      // time this request out at the gateway and report a completed re-pull
      // as a failure (dev 2026-10-28, 202605 and 202606).
      const result = await api.runOtpHistoricalBackfill({ month, phase: "otp_monthly" });
      if (result.otp_monthly?.error) {
        setError(`${month}: ${result.otp_monthly.error}`);
      } else {
        setDone((d) => ({ ...d, [month]: `${result.otp_monthly?.upserted ?? 0} rows re-pulled` }));
        onChanged();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Could not re-pull ${month}.`);
    } finally {
      setBusy(null);
    }
  }

  if (months.length === 0) {
    return (
      <p className="ok-text" style={{ marginBottom: 16 }}>
        Every stored month was polled under the standard in force. The figures are comparable with
        each other.
      </p>
    );
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <h3 style={{ marginBottom: 4 }}>Months measured under a different standard</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        These months hold figures polled under something other than <code>{inForce}</code>, so they
        are not comparable with today's — including against the manual figure in the OTP compliance
        validation. Re-pulling a month asks Avail for it again under the standard in force and
        records the change as a restatement. Nothing happens until you ask for it.
      </p>
      {error ? <p className="error-text">{error}</p> : null}
      <table className="data">
        <thead>
          <tr>
            <th>Month</th>
            <th>Measured under</th>
            <th style={{ width: 110 }}>Rows</th>
            <th style={{ width: 150 }}>Already current</th>
            <th style={{ width: 130 }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {months.map((month) => (
            <tr key={month.service_month}>
              <td>{formatServiceMonth(month.service_month)}</td>
              <td className="td-dim">
                {month.stale.map((row) => (
                  <div key={row.segments ?? "unrecorded"}>
                    {row.segments ? <code>{row.segments}</code> : <em>not recorded</em>}
                    {" — "}
                    {parameterSentence({ segments: row.segments ?? "" })}
                  </div>
                ))}
              </td>
              <td>{month.stale.reduce((n, row) => n + row.rows, 0).toLocaleString()}</td>
              <td>{month.rows_in_force > 0 ? `${month.rows_in_force.toLocaleString()} rows` : "—"}</td>
              <td>
                {done[month.service_month] ? (
                  <span className="ok-text">{done[month.service_month]}</span>
                ) : (
                  <button
                    className="btn-sm"
                    disabled={busy !== null}
                    onClick={() => void repull(month.service_month)}
                  >
                    {busy === month.service_month ? "Re-pulling…" : "Re-pull"}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {months.some((month) => month.rows_unrecorded > 0) ? (
        <p className="muted">
          "Not recorded" means the rows were stored before OnBoard stamped its figures with the
          standard they were polled under. They are not assumed to be current: the declaration
          history below says what was in force when they were stored.
        </p>
      ) : null}
    </div>
  );
}

function DeclareForm({
  current,
  onDeclared,
}: {
  current: OtpMeasurementParameterSet;
  onDeclared: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<OtpMeasurementParameterSet>(current);
  const [effectiveFrom, setEffectiveFrom] = useState(today());
  const [source, setSource] = useState("");
  const [notes, setNotes] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const segments = [
    values.early_threshold_minutes,
    values.late_threshold_minutes,
    values.early_outlier_minutes,
    values.late_outlier_minutes,
    values.show_missed_stops,
    values.include_outliers,
    values.show_detours,
  ].join("/");
  const changed = FIELDS.concat(FLAGS).filter(({ key }) => values[key] !== current[key]);

  async function declare() {
    setBusy(true);
    setError(null);
    try {
      const input: DeclareOtpParametersInput = { ...values, effective_from: effectiveFrom, source: source.trim(), notes: notes.trim() || null };
      const response = await api.declareOtpMeasurementParameters(input);
      setResult(
        response.in_force.declaration?.id === response.declaration.id
          ? `Declared, and in force now. ${response.needs_repull.length} month${response.needs_repull.length === 1 ? "" : "s"} no longer match it.`
          : `Declared, taking effect ${response.declaration.effective_from}. Nothing has changed yet.`,
      );
      setConfirming(false);
      setOpen(false);
      onDeclared();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not declare this standard.");
    } finally {
      setBusy(false);
    }
  }

  if (result && !open) {
    return (
      <p className="ok-text" style={{ marginBottom: 16 }}>
        {result}{" "}
        <button className="btn-sm" onClick={() => { setResult(null); setOpen(true); }}>Declare another</button>
      </p>
    );
  }

  if (!open) {
    return (
      <p style={{ marginBottom: 16 }}>
        <button className="btn-sm" onClick={() => { setValues(current); setOpen(true); }}>
          Declare a new standard
        </button>
        <span className="muted"> — when Avail confirms a change to MVTA's configuration.</span>
      </p>
    );
  }

  return (
    <div className="subcard" style={{ marginBottom: 16 }}>
      <h3 style={{ marginTop: 0 }}>Declare a new standard</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Record what Avail has confirmed MVTA's configuration to be. The previous declaration stays
        on the record — it is what existing figures were polled under, so it is never edited or
        removed.
      </p>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
        {FIELDS.map(({ key, label, hint }) => (
          <label key={key} style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }} title={hint}>
            {label} (min)
            <input
              className="f"
              type="number"
              min={1}
              max={720}
              style={{ width: 110 }}
              value={values[key]}
              onChange={(e) => setValues((v) => ({ ...v, [key]: Number(e.target.value) }))}
            />
          </label>
        ))}
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 10 }}>
        {FLAGS.map(({ key, label, hint }) => (
          <label key={key} style={{ fontSize: 13 }} title={hint}>
            <input
              type="checkbox"
              checked={values[key] === 1}
              onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.checked ? 1 : 0 }))}
            />{" "}
            {label}
          </label>
        ))}
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 10 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
          In force from
          <input className="f" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, flex: 1, minWidth: 260 }}>
          Where this came from
          <input
            className="f"
            placeholder="e.g. Avail confirmation 2026-10-27"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
        </label>
      </div>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, marginBottom: 10 }}>
        Notes (optional)
        <textarea className="f" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <p className="muted" style={{ marginTop: 0 }}>
        Will be sent as <code>{segments}</code>.
      </p>
      {error ? <p className="error-text">{error}</p> : null}
      {confirming ? (
        // The consequence, in the units somebody can act on, before the button
        // that does it. A dropdown that silently restated years of contractual
        // performance is the hazard this whole module is answering.
        <div className="empty-note">
          <p style={{ marginTop: 0 }}>
            <strong>This declares the standard every figure polled from now on is measured
            against.</strong>{" "}
            {changed.length === 0
              ? "Nothing in the set itself has changed, so stored figures stay comparable."
              : `Changing ${changed.map(({ label }) => label.toLowerCase()).join(", ")} means every stored month becomes a figure measured a different way — including closed months already reported to the contractor.`}
          </p>
          <p>
            Nothing is re-pulled. Every month that stops matching will be listed above with a
            re-pull button, and each one you re-pull is recorded as a restatement.
          </p>
          <button className="btn-post" disabled={busy} onClick={() => void declare()}>
            {busy ? "Declaring…" : `Declare ${segments}`}
          </button>{" "}
          <button className="btn-sm" disabled={busy} onClick={() => setConfirming(false)}>Back</button>
        </div>
      ) : (
        <>
          <button
            className="btn-post"
            disabled={source.trim().length < 3 || !effectiveFrom}
            onClick={() => setConfirming(true)}
          >
            Review and declare
          </button>{" "}
          <button className="btn-sm" onClick={() => setOpen(false)}>Cancel</button>
          {source.trim().length < 3 ? (
            <span className="muted"> — say where this standard came from first.</span>
          ) : null}
        </>
      )}
    </div>
  );
}

function History({
  history,
  inForceId,
}: {
  history: OtpParameterDeclaration[];
  inForceId: string | null;
}) {
  if (history.length === 0) {
    return <p className="muted">No declarations are recorded — migration 151 has not been applied.</p>;
  }
  return (
    <>
      <h3 style={{ marginBottom: 4 }}>Declaration history</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Append-only. An earlier declaration is what the figures of its day were polled under, so it
        is kept exactly as it was written.
      </p>
      <table className="data">
        <thead>
          <tr>
            <th style={{ width: 120 }}>In force from</th>
            <th style={{ width: 130 }}>Sent as</th>
            <th>Standard</th>
            <th>Source</th>
            <th style={{ width: 180 }}>Declared</th>
          </tr>
        </thead>
        <tbody>
          {history.map((row) => (
            <tr key={row.id}>
              <td>
                {row.effective_from}
                {row.id === inForceId ? <> <span className="pill-sm pill-success">In force</span></> : null}
              </td>
              <td className="td-dim"><code>{row.segments}</code></td>
              <td>
                {parameterSentence(row)}
                {row.notes ? <div className="muted">{row.notes}</div> : null}
              </td>
              <td>{row.source}</td>
              <td className="td-dim">{row.declared_by}<br />{row.declared_at.slice(0, 10)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
