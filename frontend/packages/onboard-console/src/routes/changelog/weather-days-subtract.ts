import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.290",
  date: "2026-09-22",
  sections: [
    {
      heading: "Added",
      items: [
        "A weather or emergency day can now be approved, and an approved day is subtracted from the month's official OTP figure. Until now the Weather page could only record a date: there was no way to approve one at all, and the figure never moved.",
        "Approving a day freezes what it carried — the departures on every route and stop that ran that date — and the month subtracts that stored record rather than working it out again later. What was taken out stays exactly what the reviewer approved, whatever the source says afterwards.",
        "A day that cannot be evidenced is refused rather than approved. If there is no departure data for the date, or the month has no rows for that day of the week, the approval is declined and says which it was — instead of being accepted and quietly changing nothing.",
      ],
    },
    {
      heading: "Changed",
      items: [
        "Raw OTP is untouched: it stays exactly what Avail published, so it still reconciles against Avail's own reporting. Only the official figure moves.",
        "The month now reports what each rule took out separately — stops removed on review, and weather days — rather than one combined figure, so it is clear why a route moved.",
        "The Weather page says what is actually happening: how many days are recorded, how many of those are approved and subtracting, and that the rest change nothing until somebody approves them.",
        "Reports read the official figure from the two new assessable columns on the OTP reporting view. Summing the old way still gives the figure before weather, which is worth being able to see.",
      ],
    },
    {
      heading: "Fixed",
      items: [
        "Weather days recorded since the feature was built have been sitting in a state nothing read. They are still recorded, and can now be approved so they count.",
      ],
    },
  ],
};

export default entry;
