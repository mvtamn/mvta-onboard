import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.3",
  date: "2026-08-07",
  sections: [
    {
      heading: "Added",
      items: [
        "Detour Reports: a new read-only page under Tools for looking up detour history. Search across closure text, routes, numbers and staff names, filter by status, reason, severity, source or start date, and download whatever you're looking at as a CSV for Excel.",
        "Detours & Closures: new reporting fields on each detour - a reason category, severity, who reported and approved it and when, notes on how it resolved, and checkboxes for radio, dispatch board and social media alongside the existing email flags. All of them are optional; fill them in later if a detour goes up mid-incident.",
        "Detours & Closures: a \"Clone\" button on each detour. It starts a new detour pre-filled with the same closure, routes and reason, but with blank dates and nothing marked as sent - for when one notice covers two closures on different dates.",
        "Detours & Closures: a search box above the table.",
      ],
    },
    {
      heading: "Changed",
      items: [
        "\"Detours & Closures\" has moved down the sidebar into the Tools group, next to the new Detour Reports page.",
        "Reason categories are admin-editable: admins can rename, reorder or retire them without a code change. Retiring one leaves past detours that used it untouched.",
      ],
    },
  ],
};

export default entry;
