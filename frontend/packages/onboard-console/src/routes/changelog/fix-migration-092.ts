import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.258",
  date: "2026-09-18",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Migration 092 could never be applied. It added the detour delivery columns and, in the same batch, a constraint naming one of them — which SQL Server rejects before running any of it, so nothing was added and the run looked uneventful. That is why server-side detour email has answered 503 since it was written.",
      ],
    },
  ],
};

export default entry;
