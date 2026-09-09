import { useEffect, useState } from "react";
import type { PeriodKpiAssessment } from "@mvta/shared";

// One loader for the selected period's rows. Every reason to reload - the
// period changed, or an action on it finished - goes through the same
// effect, which cancels itself when its inputs change, so a response for a
// period that is no longer selected is dropped rather than shown. The KPI
// selection resets with the period: a detailId from July is not a row in
// August.
export function usePeriodRows(load: (periodId: string) => Promise<{ assessments: PeriodKpiAssessment[] }>, selected: string, refreshKey: number) {
  const [rows, setRows] = useState<PeriodKpiAssessment[]>([]);
  const [detailId, setDetailId] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!selected) { setRows([]); setDetailId(""); return; }
    let cancelled = false;
    setError("");
    load(selected).then(r => {
      if (cancelled) return;
      setRows(r.assessments);
      setDetailId(current => r.assessments.some(row => row.id === current) ? current : r.assessments[0]?.id ?? "");
    }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "Unable to load scorecard"); });
    return () => { cancelled = true; };
  }, [load, selected, refreshKey]);
  return { rows, detailId, setDetailId, error };
}
