import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.188",
  date: "2026-09-11",
  sections: [
    {
      heading: "Fixed",
      items: [
        "A rider who types their mobile number the way it appears on their phone can subscribe. The opt-in form converts what they typed to the E.164 form the API requires, instead of sending it as typed and reporting the rejection as “check your contact information”.",
        "The opt-in form says which field the API rejected, rather than answering every failure with the same sentence.",
      ],
    },
  ],
};

export default entry;
