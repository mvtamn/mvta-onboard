import { useEffect, useState } from "react";
import type { AssessmentPeriod, OpenManualInput } from "@mvta/shared";
import { api } from "../../../config.js";
import { useAuth } from "../../../auth/AuthContext.js";

// The hand-entered figures still missing for the month, the signed-in
// owner's first. "No data" on a scorecard has meant "nobody typed it in";
// this says whose turn it is.
export function OpenInputs({ period }: { period: AssessmentPeriod | undefined }) {
  const { account } = useAuth();
  const [open, setOpen] = useState<OpenManualInput[]>([]);
  useEffect(() => {
    if (!period) { setOpen([]); return; }
    let active = true;
    api.getOpenManualInputs(period.service_month).then(r => { if (active) setOpen(r.open.filter(o => o.contractor_id === period.contractor_id)); }).catch(() => { if (active) setOpen([]); });
    return () => { active = false; };
  }, [period]);
  if (!period || !open.length) return null;
  const me = account?.username?.toLowerCase() ?? "";
  const mine = open.filter(o => o.principal_upn && o.principal_upn.toLowerCase() === me);
  const others = open.filter(o => !mine.includes(o));
  return <div className={`assessment-warning ${mine.length ? "assessment-open-mine" : ""}`}>
    {mine.length > 0 && <p><strong>Yours to enter for this month:</strong> {mine.map(o => o.name).join(", ")}.</p>}
    {others.length > 0 && <p><strong>Still open:</strong> {others.map(o => `${o.name} (${o.assigned_to ?? o.responsible_team ?? "unassigned"})`).join(", ")}.</p>}
  </div>;
}
