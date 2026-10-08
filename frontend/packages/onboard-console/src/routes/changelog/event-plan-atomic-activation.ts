import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.314",
  date: "2026-10-08",
  sections: [
    {
      heading: "Fixed",
      items: [
        "A refused activation no longer leaves a published scope behind. Activating an Event Plan captured its scope snapshot — and wrote the reasoned conflict override — before the status change that could still refuse. When it did refuse, which a double submit or a concurrent transition will cause, the caller saw an error while a snapshot and an override had already been written for a plan that never activated. Event AVL and crossing detection read published snapshots, so that was the partially-published scope activation is meant to make impossible.",
        "Applying a revision publishes its snapshot in the same transaction as the scope it describes. The swap committed first and the snapshot was captured afterwards, so a failure there left the active scope replaced while Event AVL went on reading the previous snapshot — planning and monitoring disagreeing with nothing to show which was right.",
        "The whole lifecycle move is one transaction that locks the plan's own row first, refuses before it writes anything, and rolls back on every refusal.",
      ],
    },
  ],
};

export default entry;
