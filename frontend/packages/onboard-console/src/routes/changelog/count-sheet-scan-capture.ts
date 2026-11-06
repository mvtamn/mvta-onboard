import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.7.51",
  date: "2026-11-05",
  sections: [
    {
      heading: "Added",
      items: [
        "Ridership › Upload scans: the garage check-in desk uploads the PDF of the shift's scanned Count Sheets. OnBoard keeps the file as it arrived and works out which sheet each page is from its QR code, drops blank backs and marks a second copy. A page it cannot read is listed by its page number, so the desk can type the block and date from the paper. The desk sees which pages were recognised, never the pages themselves.",
        "On Enter sheets, a sheet from a garage that scans shows Scanned or Not scanned, and the garage card counts both. An open sheet shows its scanned page beside the form, for the Ridership Recorder, Ridership Manager and compliance roles. Every time a scan is opened, OnBoard records who opened it.",
        "Nothing is read from a scan yet: every count is still typed. This is the Burnsville capture pilot; it needs migrations 163 and 164 and the scan storage account before it works.",
      ],
    },
  ],
};

export default entry;
