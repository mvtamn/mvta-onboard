// The bar that marks a missed-trip case's first stop as a likely GPS dead
// zone, with every first stop's record beside it. Moving the bar previews
// which stops it would add or drop before anything is saved - the same idea
// as the OTP Threshold Tuner - because a number nobody can see the effect of
// gets tuned blind. The bar is two AppSettings rows (migration 155); saving
// writes both through PATCH /app-settings.
import { useEffect, useState } from "react";
import type { MissedTripDeadZones } from "@mvta/shared";
import { api } from "../config.js";
import { barDraftErrors, barSummary, deadZoneRows, draftBar, type BarDraft } from "../lib/deadZoneBar.js";

const MODULE = "missed_trip";

export function DeadZoneBarPanel() {
  const [data, setData] = useState<MissedTripDeadZones | null>(null);
  const [draft, setDraft] = useState<BarDraft>({ ran_percent: "", min_cases: "" });
  const [failure, setFailure] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function load(next: MissedTripDeadZones) {
    setData(next);
    setDraft({ ran_percent: String(next.bar.ran_percent), min_cases: String(next.bar.min_cases) });
  }

  useEffect(() => {
    let current = true;
    api.getMissedTripDeadZones()
      .then((next) => { if (current) load(next); })
      .catch(() => { if (current) setFailure("The dead-zone records are unavailable."); });
    return () => { current = false; };
  }, []);

  const errors = data ? barDraftErrors(draft, data.limits) : {};
  const bar = data ? draftBar(draft, data.bar, errors) : null;
  const rows = data && bar ? deadZoneRows(data.stops, data.bar, bar) : [];
  const changed = Boolean(data && bar && (bar.ran_percent !== data.bar.ran_percent || bar.min_cases !== data.bar.min_cases));
  const valid = Object.keys(errors).length === 0;

  async function save() {
    if (!data || !bar || !valid || !changed) return;
    setSaving(true);
    setFailure(null);
    setMessage(null);
    try {
      if (bar.ran_percent !== data.bar.ran_percent) await api.updateAppSetting(MODULE, "dead_zone_ran_percent", String(bar.ran_percent));
      if (bar.min_cases !== data.bar.min_cases) await api.updateAppSetting(MODULE, "dead_zone_min_cases", String(bar.min_cases));
      load(await api.getMissedTripDeadZones());
      setMessage(`Saved. Cases are now marked at ${bar.ran_percent}% of at least ${bar.min_cases} cases.`);
    } catch (error) {
      setFailure(error instanceof Error && error.message ? error.message : "The bar could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return <section className="detector-decision dead-zone-bar" aria-label="GPS dead zones">
    <h3>GPS dead zones</h3>
    <p className="detector-note">
      A missed-trip case is marked "likely GPS dead zone" when enough of the other silent no-shows at its first stop
      turned out to have run. Only cases the evidence could judge count: retired cases, and ones raised while the
      vehicle feed was down, are left out. The mark is a note for the reviewer; it does not open, hold or close a case.
    </p>

    {data && !data.configured && <p className="detector-warning" role="status">
      The bar is at its default and cannot be changed until migration 155 is applied.
    </p>}

    {data && <>
      <div className="detector-fields">
        <label>
          <span>Share that ran</span>
          <input aria-label="Share that ran" type="number" inputMode="numeric" step={1}
            min={data.limits.ran_percent.min} max={data.limits.ran_percent.max} value={draft.ran_percent}
            onChange={(event) => setDraft((current) => ({ ...current, ran_percent: event.target.value }))}
            aria-invalid={Boolean(errors.ran_percent)} disabled={!data.configured} />
          {errors.ran_percent ? <small className="detector-error">{errors.ran_percent}</small> : <small>Percent of the stop's judged cases.</small>}
        </label>
        <label>
          <span>Fewest cases</span>
          <input aria-label="Fewest cases" type="number" inputMode="numeric" step={1}
            min={data.limits.min_cases.min} max={data.limits.min_cases.max} value={draft.min_cases}
            onChange={(event) => setDraft((current) => ({ ...current, min_cases: event.target.value }))}
            aria-invalid={Boolean(errors.min_cases)} disabled={!data.configured} />
          {errors.min_cases ? <small className="detector-error">{errors.min_cases}</small> : <small>Below this, a stop's record says nothing.</small>}
        </label>
      </div>

      <p className="dead-zone-summary" role="status">{barSummary(rows)}</p>

      {rows.length > 0 && <div className="dead-zone-scroll">
        <table className="data dead-zone-table">
          <thead>
            <tr><th scope="col">First stop</th><th scope="col">Judged cases</th><th scope="col">Ran</th><th scope="col">Share</th><th scope="col">Dead zone</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => <tr key={row.stop_id} className={row.change ? `is-${row.change}` : row.flagged ? "is-flagged" : undefined}>
              <td className="dead-zone-stop">{row.name}</td>
              <td>{row.cases}</td>
              <td>{row.ran}</td>
              <td>{row.percent}%</td>
              <td>{row.change === "added" ? "Would be flagged" : row.change === "removed" ? "Would no longer be flagged" : row.flagged ? "Flagged" : "—"}</td>
            </tr>)}
          </tbody>
        </table>
      </div>}
      <p className="detector-note">A case is measured against the other cases at its stop, so on a case each figure reads one lower.</p>

      <button className="btn-sm" disabled={!data.configured || !changed || !valid || saving} onClick={() => void save()}>
        {saving ? "Saving…" : "Save bar"}
      </button>
    </>}
    {!data && !failure && <p className="detector-empty">Loading the stop records.</p>}
    <div className="detector-live" role="status">
      {message && <small className="detector-saved">{message}</small>}
      {failure && <small className="detector-error">{failure}</small>}
    </div>
  </section>;
}
