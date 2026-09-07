import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.137",
  date: "2026-09-07",
  sections: [
    {
      heading: "Changed",
      items: [
        "Administration › Performance Standards leads with each standard's name rather than its code. The code is still shown, as a quiet reference, because resolvers and operational SQL match on it — but a reader no longer has to decode OTP_FIXED_ROUTE to find on-time performance. Each row also says what the standard measures in words: counted events or a monthly value, its unit, and which direction is good.",
        "Penalty bands read as sentences instead of raw bounds. Where the page showed “tier1 75…80: $1,500 flat”, it now says “75% to under 80% → $1,500 for the month”. That wording is deliberate: a band's lower bound counts as inside it and its upper bound does not, so the seeded operator-conduct band that meets the standard below 11 complaints is met at ten and missed at eleven — which two boxes labelled From and To never said.",
        "Bands are edited by picking criteria rather than filling in bounds. A band applies to any measured value, at or above a number, under a number, or from one number to under another; switching between them clears the bound that no longer applies, so a leftover number cannot keep narrowing a band someone believes they widened. Percentages are entered as percentages with the unit shown in the field, and the band restates itself in words underneath as you edit it.",
        "The charge is chosen by what it multiplies by — per occurrence, per occurrence per day, flat for the month — each with a one-line explanation, and the amount field disappears entirely for a band that charges nothing. Units are picked from the catalog's own vocabulary rather than typed free-hand, so a typo cannot quietly create a second unit that formats differently everywhere it appears.",
      ],
    },
    {
      heading: "Fixed",
      items: [
        "A condition can no longer be set on a monthly-value standard, where it could never have matched. Threshold bands are resolved without a qualifier, and a qualified band is then skipped entirely, so setting one built a band that silently never scored.",
        "The editor warns when a ladder has a gap no value falls into, an overlap where two bands match the same value, or a second catch-all band that can never be reached. These are warnings rather than blocks — Attachment G's own bands are not always contiguous — but an unintended gap scores a month at the wrong tier, and it is better named before the ladder is saved than found afterwards.",
      ],
    },
  ],
};

export default entry;
