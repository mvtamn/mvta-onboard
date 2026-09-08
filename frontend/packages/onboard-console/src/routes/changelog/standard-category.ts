import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.157",
  date: "2026-09-08",
  sections: [
    {
      heading: "Added",
      items: [
        "A standard now says which part of the contract it belongs to. The catalog was thirty standards in one flat list with nothing grouping them, so “how is the contractor doing on safety” was a question you answered by knowing which of the thirty were the safety ones. Pick a category in the standards editor; the list shows it on each row and filters to one category, including the standards that have none.",
        "Seven categories are seeded — Service Delivery, Operations & Supervision, Staffing & Training, Safety, Maintenance & Fleet, Customer Experience, Reporting & Compliance — and every one of the thirty standards is given a starting category. All of it is editable: the categories themselves under Lists, and each standard's category in its own editor.",
        "A category never reaches the scoring engine. It groups a catalog and a scorecard, so recategorising a standard changes how a finalised month reads in a report and cannot change what that month cost. That is also why it is not snapshotted onto the period.",
      ],
    },
  ],
};

export default entry;
