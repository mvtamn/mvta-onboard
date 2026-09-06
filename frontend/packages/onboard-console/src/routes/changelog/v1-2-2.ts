import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.2.2",
  date: "2026-07-27",
  sections: [
    {
      heading: "Added",
      items: [
        "Alert via Teams Compose option with separate Operations and Customer Service targets.",
        "Affected-route entry in Compose for internal and customer route-impact messages.",
        "Channel visibility in Active Messages and Audit Log.",
        "Dispatch channel-selection unit tests.",
      ],
    },
    {
      heading: "Fixed",
      items: [
        "Subscriber dispatch now honors explicit SMS and email selections, preventing internal or Teams-only messages from being sent to riders.",
        "The rider application now explicitly requests Website messages, preventing internal-only messages from appearing as public service alerts.",
      ],
    },
  ],
};

export default entry;
