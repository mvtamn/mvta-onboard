import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.109",
  date: "2026-09-05",
  sections: [
    {
      heading: "Changed",
      items: [
        "Detour Reports opens on Active. Status is a tab bar with a count on each tab, replacing the status dropdown and the separate Show/Hide history toggle; the counts reflect whatever else you have narrowed to, and an empty tab tells you which status still has matches.",
        "Search is now the main control on Detour Reports. Source, reason, severity and the date range sit behind a Filters button that shows how many are applied, and each one appears as a chip you can drop on its own. Clearing the filters keeps the status tab you are on.",
        "The Detour Reports table shows seven columns instead of fifteen. Avail number, fulfillment path, workflow, reason, severity, source and who created or last edited the detour all moved into the row's expanded record, which is now a labelled grid. Rows open with a real button, so the record can be reached from the keyboard.",
      ],
    },
    {
      heading: "Added",
      items: [
        "Detour Reports previews an export before it downloads: the file name, how many detours and columns it contains, the filters it was taken under, and the rows themselves. From the preview you can download the CSV or open the same export as a page in a new browser tab.",
      ],
    },
    {
      heading: "Removed",
      items: [
        "The Legacy spreadsheet history panel on Detour Reports, including the CSV/JSON upload it contained. Rows imported previously are untouched, but the console no longer shows them or offers a way to import more.",
      ],
    },
  ],
};

export default entry;
