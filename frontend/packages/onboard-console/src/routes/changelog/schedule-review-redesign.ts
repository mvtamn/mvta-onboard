import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.334",
  date: "2026-10-16",
  sections: [
    {
      heading: "Changed",
      items: [
        "Schedule Review keeps the ranked routes beside the open route. Picking a route opens it on the right and changes the address, so Back, bookmarks and shared links open the same route. On a phone the list becomes one Route picker above the route.",
        "Routes are ranked by how many stretches Avail confirms run late, then by flags the schedule can fix. Each route shows its worst reading, for example \"PM 46% late at 157th Street Station westbound, against 4% midday\". Flags that are not a schedule fix, such as a long gap between timepoints, are counted separately. Filter the list by who can fix it: MVTA scheduling, Avail's export or Operations.",
        "Each direction has one grid: scheduled minutes and what Avail saw, hour by hour, for every stretch between timepoints. A stretch scheduled the same all day is marked, and its readings sit beside it.",
        "Checks are grouped by who can fix them, and \"Copy evidence for scheduling\" copies the route's readings and flagged checks as text to paste into an email.",
        "\"Since the last review\" is one line at the top of the page, with the full comparison a click away.",
        "Muted text and the keyboard focus outline are darker in light mode and brighter in dark mode across the console, so both are easier to read.",
      ],
    },
  ],
};

export default entry;
