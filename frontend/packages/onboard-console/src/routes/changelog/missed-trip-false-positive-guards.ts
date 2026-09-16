import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.214",
  date: "2026-09-15",
  sections: [
    {
      heading: "Changed",
      items: [
        "A missed trip is no longer raised on a single reading. A scheduled trip that passes its 30-minute deadline with no sign of a vehicle is now held, and only joins the review queue if a later poll still finds nothing. One slow feed publish, one failed fetch, or a bus that reported a few seconds the wrong side of the deadline can no longer produce a finding on its own — it costs five minutes, on a queue nobody reviews in real time.",
        "Detection now checks that the schedule it is judging against is the schedule the agency is running. A static import more than two days old, or one whose trips the realtime feeds have never heard of — the signature of a service change that has not been re-imported — stops the day being read as a day of missed trips.",
        "One dead vehicle transponder no longer fills the queue with a whole block's work. If no bus on a trip's block reported a position anywhere that day, its silence is the vehicle's and not the trip's, so the trip is recorded rather than counted. A block that genuinely never left the garage is still caught, by garage departures, which can tell the two apart.",
        "A block's other trips now vouch for it. When the bus demonstrably ran a trip before this one and a trip after it, it was in service right through the window this trip is supposed to have vanished from — which is far more often a trip number the system failed to match than a bus that disappeared for half an hour, so the trip is recorded rather than counted. A block whose buses stop and never resume, or start late, is untouched: those are real, and they are the clearest missed trips there are.",
        "The queue says what it is holding back. Candidates waiting for a second poll, and candidates held because something other than the trip explains the silence, are both reported above the list — a queue that is quiet because detection is being careful should not look like a queue that is quiet because service ran clean.",
        "Every held candidate records why it is held, so the remedy is visible: re-run the schedule sync, look at a vehicle, or simply wait.",
      ],
    },
  ],
};

export default entry;
