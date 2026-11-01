import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.6.66",
  date: "2026-11-01",
  sections: [
    {
      heading: "Changed",
      items: [
        "A missed-trip case now opens with four lines, the same for a fixed-route trip and an on-demand request: what was scheduled, what we saw, what it looks like, and whether a confirmation is charged. The source, detector, version and reference are under Technical details.",
        "\"Looks like\" reads the evidence for you: a late start, a block that did not run, or a trip that may have run without reporting (for example where the block's bus was working, or at a likely GPS dead zone). It is a reading, not a decision. You still record the outcome.",
        "On-demand cases show the pickup and dropoff the rider was promised, where Spare moved them, and when the vehicle arrived. When Spare's minutes-late figure matches none of those times, the case says so.",
        "A case says whether its detector is in Shadow detection (a confirmation is recorded, not charged) instead of \"once its detector is out of Shadow detection\".",
        "Plainer words: Ready for review (was Potential missed), 30-minute deadline (was Grace deadline), \"passed the first stop\" (was \"under way\"), \"signed in\" with minutes from the scheduled start, Block 515 (was 515-v64), Suspected no-shows and Advance cancellations everywhere, and Timely service (was False positives).",
        "Missed-trip Detectors: when unreviewed cases keep the verdict on an older week, the scorecard says how many cases are waiting. The Avail and dispatcher comparisons are written out in full.",
      ],
    },
  ],
};

export default entry;
