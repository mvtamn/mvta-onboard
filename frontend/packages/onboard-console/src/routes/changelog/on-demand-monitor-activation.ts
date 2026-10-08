import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.275",
  date: "2026-09-18",
  sections: [
    {
      heading: "Changed",
      items: [
        "Service Risk & Quality now monitors MVTA Connect on-demand wait times, for all three MVTA Connect services, instead of showing Not connected.",
        "Waits that go beyond the service standard now prepare a Suggested Alert draft for staff to review. Nothing is sent to riders unless staff choose to.",
        "Eagan requests show as unzoned, because Eagan is not one of the monitored zones.",
        "MVTA Connect webhook deliveries from Spare now arrive on their own service, so they no longer compete with the feed polls and the console.",
        "Wait times update as Spare reports them, not only once an hour.",
      ],
    },
  ],
};

export default entry;
