export type DocumentReferenceIdentity = {
  site_id: string;
  drive_id: string;
  item_id: string;
  expected_version: string;
  expected_file_name: string;
  expected_mime_type: string;
};

export type DocumentHealthResult = {
  health_status: "Valid" | "Needs review" | "Unavailable";
  observed_version: string | null;
  observed_file_name: string | null;
  observed_mime_type: string | null;
  reason: string | null;
};

export type DocumentReferenceChecker = (reference: DocumentReferenceIdentity, userAssertion?: string) => Promise<DocumentHealthResult>;
type TokenProvider = (userAssertion: string) => Promise<string>;
type GraphFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export function createGraphDocumentChecker(getDelegatedToken: TokenProvider, fetchGraph: GraphFetch = fetch): DocumentReferenceChecker {
  return async (reference, userAssertion) => {
    if (!userAssertion) {
      return { health_status: "Needs review", observed_version: null, observed_file_name: null, observed_mime_type: null, reason: "A delegated Admin session is required to check this SharePoint document." };
    }
    try {
      const token = await getDelegatedToken(userAssertion);
      const response = await fetchGraph(`https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(reference.site_id)}/drives/${encodeURIComponent(reference.drive_id)}/items/${encodeURIComponent(reference.item_id)}?$select=eTag,name,file`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      // 401, 403 and 404 used to collapse into one message that blamed the
      // document. They are three different faults with three different owners:
      // a credential SharePoint would not accept, a library OnBoard was never
      // granted, and a file that is genuinely not where the Procedure says it
      // is. Only the last is about the document.
      //
      // The distinction is not academic. On 2026-09-06 the tenant had consented
      // no SharePoint permission of any kind, so Graph answered 403 to every
      // request - and every reference in the system would have reported that
      // SharePoint had not made the document available, while the documents sat
      // untouched and correct. An Admin reading that goes looking in SharePoint,
      // which is the one place the answer is not. See
      // docs/runbooks/decision-matrix-sharepoint-documents.md.
      //
      // All three remain Unavailable - the column allows only Valid, Needs
      // review and Unavailable, and a document that could not be inspected must
      // not present itself as checked. What changes is what the reason says.
      if (response.status === 401 || response.status === 403) {
        return {
          health_status: "Unavailable",
          observed_version: null,
          observed_file_name: null,
          observed_mime_type: null,
          reason: response.status === 403
            ? "OnBoard is not authorized to read this SharePoint library, so the document was never inspected. This is a permissions gap to fix in Entra, not a problem with the document."
            : "SharePoint rejected OnBoard's credential, so the document was never inspected. This is a configuration fault, not a problem with the document.",
        };
      }
      if (response.status === 404) {
        return { health_status: "Unavailable", observed_version: null, observed_file_name: null, observed_mime_type: null, reason: "SharePoint has no document at the site, drive and item this Procedure records. It may have been moved, replaced with a new item, or deleted." };
      }
      if (!response.ok) throw new Error(`Microsoft Graph returned ${response.status}.`);
      const item = await response.json() as { eTag?: unknown; name?: unknown; file?: { mimeType?: unknown } };
      const observedVersion = typeof item.eTag === "string" ? item.eTag : null;
      const observedName = typeof item.name === "string" ? item.name : null;
      const observedMime = typeof item.file?.mimeType === "string" ? item.file.mimeType : null;
      if (observedVersion === reference.expected_version && observedName === reference.expected_file_name && observedMime === reference.expected_mime_type) {
        return { health_status: "Valid", observed_version: observedVersion, observed_file_name: observedName, observed_mime_type: observedMime, reason: null };
      }
      return { health_status: "Needs review", observed_version: observedVersion, observed_file_name: observedName, observed_mime_type: observedMime, reason: "The SharePoint document metadata no longer matches this Procedure Revision." };
    } catch (error) {
      return { health_status: "Unavailable", observed_version: null, observed_file_name: null, observed_mime_type: null, reason: error instanceof Error ? `SharePoint check failed: ${error.message}` : "SharePoint check failed." };
    }
  };
}
