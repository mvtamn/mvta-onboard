import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.306",
  date: "2026-10-04",
  sections: [
    {
      heading: "Fixed",
      items: [
        "The stat cards on the OTP Dashboard, Subscribers and the threshold tuner are cards again. They had no styling at all — three stacked lines of text on the page background — and the colour each page sets on the card's left edge had nothing to appear on.",
        "The OTP trend chart colours a month against the target the month is judged by. It used a fixed 85%, so a different contract target would have shaded the bars against one figure while the card above them counted routes against another.",
        "The late-running colour is readable in dark mode. Below-target bars and the late segment of the adherence strip used a light-mode colour that went muddy under the theme.",
        "A target that does not divide cleanly reads as 82.9% rather than 82.89999999999999%.",
      ],
    },
  ],
};

export default entry;
