import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.218",
  date: "2026-09-16",
  sections: [
    {
      heading: "Changed",
      items: [
        "Access & Identity is now its own group in the Administration menu: Overview, People & guests, Access groups, Workloads, Approvals, Access health and Activity log, instead of seven tabs on one page.",
        "The new Overview lists what needs a decision in one place: approval requests, access due to expire, people whose account is disabled or missing, and direct assignments.",
        "Selecting a person on People & guests opens their access and sign-ins beside the list. Sign-ins are still read from Entra only when you ask.",
        "Removing access is a dialog that says what is removed and what stays, and checks the change as soon as a reason is written.",
        "Add access is four numbered steps with a summary beside them that shows, per change, whether it applies straight away or needs a second approver.",
        "Access health groups findings into errors and warnings, uses access-level names instead of role codes, and says where to fix what OnBoard can't repair itself.",
        "The Activity log uses plain words for actions and outcomes, groups entries by day, and can be narrowed to failed or blocked actions.",
      ],
    },
    {
      heading: "Fixed",
      items: [
        "In the dark theme the selected Administration menu item and its small heading are readable again.",
        "On a phone, the Administration menu no longer stretches the page wider than the screen.",
      ],
    },
  ],
};

export default entry;
