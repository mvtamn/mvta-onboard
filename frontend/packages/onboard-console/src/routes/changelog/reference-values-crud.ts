import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.145",
  date: "2026-09-07",
  sections: [
    {
      heading: "Changed",
      items: [
        "Every picker in the standards configurator now reads its options from the database instead of a list written into the application. Units, priorities, conditions, source systems, responsible teams, tier labels, charge bases and measurement sources are all editable from \u201cManage lists\u201d on the Performance Standards page \u2014 rename them in the contract's own words, reorder them, and hide the ones MVTA does not use.",
        "Two kinds of list, and the difference is visible. Lists MVTA owns take new values. Lists the scoring engine works from \u2014 charge bases, tier labels, measurement sources, standard types, directions \u2014 can be renamed, reordered and retired, but not added to: a charge basis invented in a form would have no arithmetic behind it, and the month would fail to compute rather than charge the wrong amount quietly.",
        "Retiring a value keeps it out of new pickers while everything that already used it still reads correctly. Deleting is only possible for a value nothing has used.",
        "Which tier outranks which is now a number you can edit rather than an ordering fixed in the code, so a fifth tier is a row instead of a release. Each assessment period records the ranking it was scored under, so reordering tiers later cannot change a month that has already been issued.",
        "\u201cAttachment G\u201d is no longer built into the product. An Agreement now carries its contract number and the name of the standards exhibit it comes from, and the console cites that \u2014 so an agreement whose exhibit is called something else reads correctly.",
      ],
    },
    {
      heading: "Fixed",
      items: [
        "A condition can be used on a penalty band before any other band uses it. Conditions were previously gathered from the bands that already carried one, so the first band with a new condition could never be created here.",
      ],
    },
  ],
};

export default entry;
