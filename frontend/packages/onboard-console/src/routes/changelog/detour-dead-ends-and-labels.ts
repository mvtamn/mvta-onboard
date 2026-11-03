import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.6.67",
  date: "2026-11-01",
  sections: [
    {
      heading: "Changed",
      items: [
        "Record Avail result is now three buttons: Built in Avail, Avail refused it, and Not built yet. You no longer type a value, and a typo can no longer quietly do nothing.",
        "A text message draft no longer offers a Send email button. OnBoard can send email and post to Teams, but not texts, so send the text yourself and mark it published.",
        "Recording that a sign or AVL message went out is disabled, with the reason, when OnBoard would refuse it (for example while a re-review is outstanding). Before, you found out only after clicking.",
        "When a detour, intake or message can't be saved, the error now says which field is wrong instead of only \"Validation failed\".",
        "Plainer words on the detour pages. Avail refusing an entry now reads \"Avail refused it — retry or run it manually\". A detour that overlaps another now reads \"Overlaps another detour — override needed\". Workflow reads Waiting for Avail entry, Built in Avail, Running manually or Avail entry failed. Each way of running a detour has one name everywhere: Build in Avail, Fixed route, run manually, or Mobility, run manually.",
        "Communications read \"All audiences told\" when everyone has been told, and \"No audiences named\" when the detour lists nobody to tell. Messages show their channel by name (Text message, not sms). The history says \"Avail result recorded\", and names owner changes, overridden overlaps, completed re-reviews and edits instead of calling them all a correction.",
        "Detour Intake now says what it is: a report for OCC review, not the detour itself. Its checklist is called Required facts, and its time choices read Times unconfirmed, Times estimated and Times confirmed. On the worklist, Clone is now Re-establish and Someone else is now Assign to…. The Register column is Next action & owner, and Approved by is now External sign-off (e.g. city permit).",
      ],
    },
  ],
};

export default entry;
