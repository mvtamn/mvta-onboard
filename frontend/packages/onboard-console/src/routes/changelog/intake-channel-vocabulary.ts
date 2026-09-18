import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.274",
  date: "2026-09-18",
  sections: [
    {
      heading: "Changed",
      items: [
        "Detour Intake now asks for the channels a communication can actually go out on, taken from the same list the composer in Detours & Closures uses. It used to offer its own set — including radio and 'dispatch board', neither of which anything can send — so an intake could require a channel nobody could satisfy.",
        "A channel an existing record names that is no longer offered stays on it, marked and removable, rather than disappearing.",
      ],
    },
  ],
};

export default entry;
