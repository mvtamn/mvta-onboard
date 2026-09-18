import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.274",
  date: "2026-09-18",
  sections: [
    {
      heading: "Changed",
      items: [
        "Dashboard → Triage exceptions reads properly now. A row's text wraps onto a second line instead of being cut off mid-sentence, which matters most for On-Demand suggestions: every one of them begins with the same words, so on a single line they all looked identical and the zone and the wait time were both past the cut.",
        "Each row says what kind of thing it is — a rider alert, a suggested alert, or a feed that is not answering — instead of leaving you to work it out from a coloured bar.",
        "Status and action are no longer the same piece of text. \"Expired 6 min ago\" is a fact about the row; \"Renew or retire\" is the thing you click.",
        "A critical suggested alert now looks critical. It used to be drawn in the same calm blue as an informational one.",
      ],
    },
    {
      heading: "Fixed",
      items: [
        "The queue was not really sorted by urgency. A published alert due to expire in twenty minutes could sit below an informational suggestion. The order is now decided by what kind of problem it is, then by how long it has been waiting.",
        "When there are more than five exceptions the queue says so and offers the rest, rather than dropping them silently.",
        "The small green headings above each panel were close to unreadable in dark mode.",
      ],
    },
  ],
};

export default entry;
