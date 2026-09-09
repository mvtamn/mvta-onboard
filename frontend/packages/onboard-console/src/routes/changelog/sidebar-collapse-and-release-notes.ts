import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.159",
  date: "2026-09-08",
  sections: [
    {
      heading: "Changed",
      items: [
        "The collapsed navigation rail keeps its categories. Collapsing used to drop every group heading and leave one undifferentiated column of icons; the categories are now hairline rules between the icon runs, so the grouping the menu is built around survives at 64px. Hovering an icon gives a panel naming its category, its page, and what that page is for, instead of the operating system's own tooltip arriving a second later with the label alone.",
        "Administration collapses to a single control. Eight destinations, four of them drawn with the same wrench, were unreadable as a stack of icons — the one place in the rail where you had to hover items one at a time to find anything. Collapsed, the category is one gear carrying the number of pages behind it, and pointing at it opens the full list. Expanded, the category is exactly what it was.",
        "Every category is now a collapsible group, Service Operations included. It was the one heading you could not close, and the Dashboard link sat above it belonging to nothing.",
        "One button collapses and expands the rail, and it no longer changes shape: the paired chevrons are replaced by the same menu icon the narrow-screen drawer already uses.",
        "Release notes moved from the wordmark to the foot of the rail, beside the console-status light, as a proper control rather than an underline on eleven-pixel text. It opens the same What's new panel it always did, and carries a dot until the running release has been read once.",
      ],
    },
  ],
};

export default entry;
