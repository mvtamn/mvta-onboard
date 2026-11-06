import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.7.63",
  date: "2026-11-06",
  sections: [
    {
      heading: "Changed",
      items: [
        "A fixed-route missed trip that says the bus never left now gets an Evidence conflict when Avail's next-day OTP Daily feed saw every scheduled departure leave the trip's first stop in that hour and called none missed. The conflict names the stop, the hour and Avail's counts, and stays until a reviewer records an outcome. The case is not closed or reopened, and no review is changed. Stops where Avail records nothing, such as Burnsville Center, say nothing either way.",
      ],
    },
  ],
};

export default entry;
