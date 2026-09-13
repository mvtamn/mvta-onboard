import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.197",
  date: "2026-09-12",
  sections: [
    {
      heading: "Changed",
      items: [
        "Every surface that reports whether operational data is arriving now uses one indicator. The Dashboard freshness bar, the Feeds & freshness rail, the sidebar footer and the feed banners on Service Risk, Garage Departures, Dispatch Log and Missed Trip Review previously used four unrelated treatments for the same idea, and a live feed differed from a dead one by a colour swap on a static 7px dot.",
        "The indicator moves only while a feed is answering, and stops dead when it is not. A live signal pulses, flashes when data lands, and — where the page has a real refresh clock — winds down a countdown ring to the next poll. A stale or unavailable one does not move at all, so a feed that has stopped is what catches the eye on a screen of moving ones.",
        "Stillness is never the only cue. The core changes shape between states, the ring goes dashed, the banner changes tone, and the label says which state it is, so the indicator still reads in a screenshot, in a printout, and for anyone who has asked their system to reduce motion — where every animation is switched off.",
        "Where a module records its poll outcomes, the last six are shown as bars beside the indicator: filled arrived, faint missed. A page that does not poll on a known clock shows neither bars nor a countdown rather than a reassuring one it is not keeping.",
        "A live feed banner is evergreen rather than the informational blue it shared with preview data. Training and preview banners carry no live indicator at all, because no feed is answering behind them.",
      ],
    },
  ],
};

export default entry;
