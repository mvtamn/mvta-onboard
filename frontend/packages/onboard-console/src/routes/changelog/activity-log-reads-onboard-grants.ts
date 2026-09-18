import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.278",
  date: "2026-09-18",
  sections: [
    {
      heading: "Fixed",
      items: [
        "The Activity log and the Overview's Recent activity now show the grants, removals, privileged decisions and role edits made in OnBoard. They were reading only the older Entra-era record, which since roles moved into OnBoard collects previews, exports and sign-in views - so the log filled with \"Checked a change\" while every real change was missing.",
        "Somebody whose name was never recorded no longer appears in the feed as a bare object id; the id is matched to the person wherever OnBoard knows them.",
      ],
    },
    {
      heading: "Changed",
      items: [
        "A role can be granted to somebody who has not signed in to OnBoard yet. Picking them out of the directory on Add access records who they are, so a new starter can be given their role before their first day instead of being turned away once first.",
        "Recent activity on the Overview shows what changed; looking - a preview, an export, a sign-in view - stays in the Activity log, which now also names the role each act was about.",
      ],
    },
  ],
};

export default entry;
