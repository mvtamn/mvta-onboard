import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.6.50",
  date: "2026-10-30",
  sections: [
    {
      heading: "Added",
      items: [
        "Groundwork for ridership counting, which replaces the paper Count Sheet's Microsoft Access entry from 1 December. Nothing new is on screen yet; the Ridership page arrives in a later release.",
        "Two new roles in Access & Identity: Ridership Recorder (contractor OCC staff who key and print Count Sheets) and Ridership Manager (Planning, who also keep the block-to-garage list). Nobody holds either until an Access Administrator grants it.",
        "The Dispatch Log now records each trip's scheduled end time as well as its start, once migration 153 is applied, so printed Count Sheets can show both.",
      ],
    },
  ],
};

export default entry;
