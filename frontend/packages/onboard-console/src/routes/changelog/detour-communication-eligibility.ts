import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.246",
  date: "2026-09-17",
  sections: [
    {
      heading: "Fixed",
      items: [
        "A Detour communication can no longer be sent when the Detour is closed, when its reviewed facts are waiting on a re-review, or before the Detour is in place. Publishing it now says which of those to fix. This applies whether OnBoard sends it or you record that you sent it yourself.",
        "A send that the mail or Teams service refuses leaves the communication as a draft you can retry, and no longer records it as published or counts the audience as told.",
        "A Detour is counted as communicated only when a message actually went out — a queued or failed send no longer clears \"needs communication\".",
      ],
    },
  ],
};

export default entry;
