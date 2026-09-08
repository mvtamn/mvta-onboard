import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.138",
  date: "2026-09-07",
  sections: [
    {
      heading: "Changed",
      items: [
        "A performance standard now says what measures it, and the console offers the real options rather than a text box. The catalog has carried a \u201cresolver key\u201d since the assessment module was built, but nothing read it \u2014 the monthly compute recognised on-time performance by name and nothing else, so adding an automatically measured standard meant a code change rather than a configuration one. Automated standards are now matched to a named measurement, picked from the ones this deployment actually has, and only the ones that suit the kind of standard being edited are offered.",
        "An assessment period records which measurement produced its numbers, alongside the targets and bands it already recorded. Repointing a standard at a different feed no longer changes how an already-issued month recalculates.",
      ],
    },
    {
      heading: "Fixed",
      items: [
        "A standard set to measure automatically, but pointing at nothing the system recognises, is now reported as not assessable with the reason named. It previously fell through to hand-entered figures, found none, and scored the month as \u201cno data\u201d \u2014 which on a scorecard is indistinguishable from a clean month with nothing to report.",
        "A measurement can no longer be attached to a kind of standard it cannot serve, in either direction \u2014 a saved pairing like that produced a standard whose monthly figure could never be found.",
      ],
    },
  ],
};

export default entry;
