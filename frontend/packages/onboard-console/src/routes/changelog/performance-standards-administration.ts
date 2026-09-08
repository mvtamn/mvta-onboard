import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.133",
  date: "2026-09-06",
  sections: [
    {
      heading: "Added",
      items: [
        "Administration › Performance Standards: the Attachment G standards catalog is now editable. Every standard's tier bands, priority, unit, measurement source, owner and effective dates can be changed from the console, and new occurrence-based or threshold-based standards can be added — Attachment G reserves the right to amend a threshold by amendment, and until now doing so meant writing a SQL migration. Saving a ladder writes a new dated version rather than overwriting the old one, so assessment periods already opened keep the bands they were scored against. Administrator access is required to change anything; the compliance roles can read.",
        "Performance Agreements can be created and amended from the console. There was previously no code path anywhere that created one: migration 032b's insert was a one-time backfill, so a contractor added through Performance Assessment afterwards got no agreement, and then the compliance candidate poll failed on every run while no assessment period could be opened at all. Creating an agreement seeds its standard assignments from the catalog, so a new term starts held to what MVTA scores today.",
      ],
    },
    {
      heading: "Changed",
      items: [
        "Performance standards are assigned to an agreement rather than to the agency at large (migration 102). Assessment periods used to snapshot every standard flagged as scored, with no contractor dimension anywhere — correct for one contractor under one agreement and unable to express anything else. Each agreement now names the standards it holds its contractor to and over which months, and may carry its own tier bands overriding the catalog's. An override governs a standard's whole ladder or none of it, because blending one with the catalog's defaults would produce bands nobody wrote.",
        "A second contractor is no longer forbidden by the schema. The index enforcing one active agreement was keyed on the active flag alone, permitting exactly one active agreement across the whole database; it is now keyed per contractor, which is the actual rule.",
        "Opening an assessment period for an agreement that assigns no standards is refused with a message naming the page that fixes it, instead of producing a period that scores nothing and reads like a clean month.",
        "The Performance Assessment module's Standards tab now shows each band's bounds, qualifier, CAP trigger and owner, not just its tier label and dollar amount — a manager could not previously confirm from the console that on-time performance tier 1 is the 75–80% band. It stays read-only and links administrators to the new page.",
      ],
    },
  ],
};

export default entry;
