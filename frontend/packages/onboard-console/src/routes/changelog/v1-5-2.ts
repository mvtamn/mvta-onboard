import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.2",
  date: "2026-08-07",
  sections: [
    {
      heading: "Added",
      items: [
        "Detours & Closures: every new detour now gets an internal reference number in the form MVTA-DET-2026-0001, generated automatically and shown in the list and detail panel. This is separate from the existing free-text Number field, which is unchanged - keep using that for things like \"951\" or \"Operator Message\".",
        "Detours & Closures: a reference number is issued once and never reassigned, so if a detour is later rescheduled into a different year the original number is kept and a note appears explaining why - quote the number as shown, since it may already be in an email that went out.",
        "A new Detour Maintainer role for staff who maintain detour records without needing full publishing access. It can view, create, edit, and attach files to detours, but cannot delete them.",
      ],
    },
    {
      heading: "Fixed",
      items: [
        "Compliance users could open Detours & Closures from the sidebar but then saw a \"failed to load\" error, because the page and the data behind it disagreed about who was allowed in. Compliance can now read detour records as intended.",
      ],
    },
    {
      heading: "Changed",
      items: [
        "Deleting a detour is now limited to publishers and admins. Everyone who could delete one before still can.",
      ],
    },
  ],
};

export default entry;
