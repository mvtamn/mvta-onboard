// The Approved Document Library, seen as somewhere a QRG can be read from.
//
// qrgDraftSeed.ts wants one thing - a QrgSource that answers an item id with a
// name, a media type, the version seen, and the bytes. The library offers two
// calls, one for an item's facts and one for its bytes. This is the whole
// adapter between them, and it exists so neither side has to know the other's
// vocabulary: qrgDraftSeed carries no SharePoint types, and sharepointLibrary
// carries nothing about QRGs.
import type { QrgRead, QrgReadFailure, QrgSource } from "./qrgDraftSeed";
import type { LibraryContentReader, LibraryItemReader } from "./sharepointLibrary";

/** The library's four outcomes as the seeder's four failures. They differ by
 *  one name: a library that was never configured is not an outage. */
function asFailure(outcome: "not_configured" | "forbidden" | "not_found" | "failed", reason: string): QrgReadFailure {
  return { failure: outcome === "not_configured" ? "unconfigured" : outcome, reason };
}

export function libraryQrgSource(library: LibraryItemReader & LibraryContentReader): QrgSource {
  return {
    async read(itemId: string): Promise<QrgRead | QrgReadFailure> {
      // Facts first. They are cheap, they establish that the document is in
      // the approved library at all, and a folder or a document with no media
      // type is refused before anything downloads its bytes.
      const facts = await library.readItem(itemId);
      if (facts.outcome !== "ok") return asFailure(facts.outcome, facts.reason);
      if (facts.item.kind !== "file") {
        return { failure: "not_found", reason: `${facts.item.name} is a folder, not a document.` };
      }
      if (!facts.item.mime_type) {
        return { failure: "not_found", reason: `SharePoint does not say what kind of document ${facts.item.name} is.` };
      }
      // A document with no eTag cannot be referenced either - the picker
      // already refuses to let one be chosen - so there is nothing to freeze
      // the Draft's reference against.
      if (!facts.item.etag) {
        return { failure: "not_found", reason: `SharePoint does not report a version for ${facts.item.name}.` };
      }

      const content = await library.readContent(itemId);
      if (content.outcome !== "ok") return asFailure(content.outcome, content.reason);

      return {
        name: facts.item.name,
        mime: facts.item.mime_type,
        seen_version: facts.item.etag,
        bytes: content.bytes,
      };
    },
  };
}
