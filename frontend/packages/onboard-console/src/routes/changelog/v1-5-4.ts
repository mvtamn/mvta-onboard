import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.4",
  date: "2026-08-07",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Detours & Closures: no detour was ever showing as Active - everything read \"Recently finished\" no matter its dates, including closures running for months yet. Statuses are now correct everywhere they appear.",
        "Detours & Closures: opening Edit on a detour and saving could clear its start and end dates without warning. The dates now load into the form correctly. If a detour lost its dates recently, that's why - re-enter them and they'll stick.",
        "Detours & Closures: date columns were showing raw timestamps like \"2026-08-08T00:00:00.000Z\" instead of readable dates.",
        "Missed Trips: the investigation queue no longer lists trips that already resolved on their own. Those needed no review and were burying the trips that do; resolved history is still on Monthly Assessments.",
        "Missed Trips: times over an hour now read like \"4h 10m ago\" instead of \"250 min ago\".",
      ],
    },
    {
      heading: "Changed",
      items: [
        "Missed Trips: a newly detected trip now reads \"Potential missed\" in amber until someone reviews it, and only becomes a red \"Missed\" once a reviewer confirms it - a detection is a candidate, not a verdict.",
        "Detour Reports: a \"Created by\" column, and clearer created/last-edited detail on each detour. Detours that came from the Avail sync say so, rather than showing a system account name.",
        "Detours & Closures: the \"Reported by\" and \"Approved by\" lines now appear only when something was actually recorded, instead of showing a row of dashes on every detour.",
      ],
    },
  ],
};

export default entry;
