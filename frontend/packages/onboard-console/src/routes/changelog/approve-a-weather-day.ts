import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.294",
  date: "2026-09-22",
  sections: [
    {
      heading: "Added",
      items: [
        "Weather Exclusions has an Approve button. Approving a recorded day subtracts the departures it carried from the month's official OTP figure — until now the ability existed only in the API, so a day could be recorded in the console but never approved there.",
        "Approving says what it took out: how many departures, across how many stops, on which day of the week. A reviewer is told what left the figure rather than just that the click worked.",
        "A new \"Removed from OTP\" column shows what each approved day is actually subtracting, so the page answers what the month has been adjusted for without opening anything else.",
        "An approved day shows who approved it and when.",
      ],
    },
    {
      heading: "Changed",
      items: [
        "When a day cannot be approved, the page shows the reason the server gave — no departure data for that date, or no rows for that day of the week — against that day, and leaves it recorded but unapproved. A second day's refusal does not clear the first one's explanation.",
      ],
    },
    {
      heading: "Fixed",
      items: [
        "Approving or rejecting anything now re-reads the month's figures. Approving a stop exclusion used to update the decision list and leave Route Summary showing the figure from before it, until the month was switched or the page reloaded.",
      ],
    },
  ],
};

export default entry;
