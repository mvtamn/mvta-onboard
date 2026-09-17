import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.234",
  date: "2026-09-17",
  sections: [
    {
      heading: "Changed",
      items: [
        "Decision Matrix document checks are made by OnBoard, not with your own SharePoint access. Before, approving a Procedure re-checked its SOP as the person who clicked Approve, while the overnight check ran as OnBoard, and both wrote the same result — so whether a Procedure could be approved depended on who pressed the button. Now every check, whenever it runs, is made the same way, and \"Valid\" means the document is there and unchanged, not that any particular person can open it.",
        "Check documents, and a refused Submit or Approve, now show each document's result and the reason — for example that SharePoint has not granted OnBoard access to the library — instead of \"Document references could not be checked.\"",
        "Where document checks have not been set up, Check documents says so and records nothing, and Submit and Approve are refused with that reason rather than failing as though a document were wrong.",
      ],
    },
  ],
};

export default entry;
