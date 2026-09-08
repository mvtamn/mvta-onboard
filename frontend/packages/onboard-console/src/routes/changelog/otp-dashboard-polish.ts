import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.159",
  date: "2026-09-08",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Stat cards render as cards again. The four figures at the top of OTP Compliance's Dashboard — and the pairs on Subscribers and on the OTP admin page — were three bare lines of text on the page background, because the classes they are built from had no styling anywhere in the console. Each one had even been given its own accent colour, which had no border to appear on. They are now bordered tiles with the figure set apart from its label.",
        "The trend chart and the figure above it can no longer disagree about the contract target. \"Routes below target\" read the target from the feed; the chart decided which months were green using a fixed 85% written into the page. If the target ever moved, the two would have quietly told different stories.",
        "The \"below target\" bars are legible in dark mode. Their colour was set once, for the light theme, and was never given a dark counterpart — on the dark surface it sank almost into the background.",
      ],
    },
    {
      heading: "Changed",
      items: [
        "The OTP trend chart now shows the target it is measured against: the contract target is drawn across the plot with the passing range shaded above it, so a month is read by whether it clears the line rather than by comparing bar heights. The plot is also taller, because the months differ by a few points and that difference was a few pixels.",
        "Beside the chart, the latest month is stated outright with its change from the month before, alongside how many months in the window cleared the target, the window's average, and how far the worst month fell short.",
        "Every OTP Compliance page now opens with the page's own name and purpose as a heading, with the service month and a live-or-preview indicator on the same line. This replaces the blue banner that repeated the feed's status across all six pages; the feed's details are now a caption under the heading.",
        "A Dashboard figure only takes on a warning or alert colour when it is something to act on — no stops left to review reads as settled rather than as a warning coloured zero.",
      ],
    },
  ],
};

export default entry;
