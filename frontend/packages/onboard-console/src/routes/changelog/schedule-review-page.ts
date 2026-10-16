import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.325",
  date: "2026-10-16",
  sections: [
    {
      heading: "Added",
      items: [
        "Schedule Review, a new page under Specialist Operations. The same route table as Integrations & Data Health, where a route name opens the evidence behind each of its flags: the stop pairs that are placeholders and how many trips carry them, the timepoints the long gap sits between, which route a late bus comes off and how often, the tight hand-overs by time and terminal. Each flag says who can fix it and how.",
        "Below the evidence, the route's scheduled running time over each timepoint segment, hour by hour. A row that reads the same in every hour is marked: that is a schedule that says traffic never changes.",
        "Route names on Integrations & Data Health now open that route on the Schedule Review page. The review is analysis of the published schedule, not compliance, so it sits beside OCC Tools rather than inside the OTP module, and every signed-in role can read it.",
      ],
    },
  ],
};

export default entry;
