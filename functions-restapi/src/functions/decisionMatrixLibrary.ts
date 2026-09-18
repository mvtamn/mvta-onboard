import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { ClientSecretCredential } from "@azure/identity";
import { ADMIN_ROLES, requireRole } from "../lib/auth";
import { createSharePointLibrary, type LibraryConfig, type LibraryItemReader, type SharePointLibrary } from "../lib/sharepointLibrary";

function setting(name: string): string | null {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : null;
}

// Which library, as configuration rather than request input. The picker browses
// one approved location; a site or drive taken from the query string would let
// anyone holding OCC.Admin reach every library the tenant has granted the
// application, which is precisely what choosing Sites.Selected was meant to
// prevent.
export function libraryConfig(): LibraryConfig | null {
  const site = setting("DECISION_MATRIX_LIBRARY_SITE_ID");
  const drive = setting("DECISION_MATRIX_LIBRARY_DRIVE_ID");
  return site && drive ? { site_id: site, drive_id: drive } : null;
}

// Browsing the library is app-only - Sites.Selected is an application
// permission - and it reads as the sign-in application, explicitly.
//
// It used to prefer the dedicated Decision Matrix documents application where
// that was configured, falling back to the sign-in application. That preference
// would have moved browsing onto the integrity monitor the moment its settings
// appeared, which is the "alternate user-access path" ADR 0025 rules out for
// that identity: listing folders and file names for an Admin is not checking a
// reference. Whether the integrity monitor may also list the library during
// authoring is an open question, deliberately not settled by which settings
// happen to exist. Document health reads as the documents application and
// never this one; see lib/decisionMatrixDocumentHealth.ts.
export function browsingCredential(): { tenantId: string; clientId: string; clientSecret: string } | null {
  const tenantId = setting("AZURE_TENANT_ID");
  const clientId = setting("ONBOARD_API_CLIENT_ID");
  const clientSecret = setting("ONBOARD_API_CLIENT_SECRET");
  return tenantId && clientId && clientSecret ? { tenantId, clientId, clientSecret } : null;
}

function productionLibrary(config: LibraryConfig): SharePointLibrary | null {
  const credential = browsingCredential();
  if (!credential) return null;
  const secret = new ClientSecretCredential(credential.tenantId, credential.clientId, credential.clientSecret);
  return createSharePointLibrary(config, async () => {
    const token = await secret.getToken("https://graph.microsoft.com/.default");
    if (!token?.token) throw new Error("Microsoft Graph application token acquisition returned no token.");
    return token.token;
  });
}

const NO_LIBRARY_REASON = "No approved SharePoint library is configured. Set DECISION_MATRIX_LIBRARY_SITE_ID and DECISION_MATRIX_LIBRARY_DRIVE_ID.";
const NO_CREDENTIAL_REASON = "No credential is configured for browsing SharePoint. Set AZURE_TENANT_ID, ONBOARD_API_CLIENT_ID and ONBOARD_API_CLIENT_SECRET.";

let overrideLibrary: Pick<SharePointLibrary, "listFolder"> | null = null;
/** Test seam: the handler is the piece worth testing, not Graph. */
export function setDecisionMatrixLibraryForTests(library: Pick<SharePointLibrary, "listFolder"> | null) {
  overrideLibrary = library;
}

/**
 * The Approved Document Library, for reading the one document an author chose.
 *
 * Choosing a document is authoring, so it reads as the same identity browsing
 * does. It always answers: an environment with no library or no credential
 * reads every item as not_configured, with the setting to fix, so a caller has
 * no null to forget.
 */
export function approvedLibraryItems(): LibraryItemReader {
  const approved = approvedLibrary();
  if ("library" in approved) return approved.library;
  return { readItem: async () => ({ outcome: "not_configured", reason: approved.reason }) };
}

/**
 * The Approved Document Library as the sign-in application reads it, with the
 * settings that name it - or the reason it cannot be read here. The daily SOP
 * folder walk lists what an Admin can already browse, so it reads as the same
 * identity rather than as the documents application, which only checks
 * references (ADR 0025).
 */
export function approvedLibrary(): { config: LibraryConfig; library: SharePointLibrary } | { config: LibraryConfig | null; reason: string } {
  const config = libraryConfig();
  if (!config) return { config: null, reason: NO_LIBRARY_REASON };
  const library = productionLibrary(config);
  return library ? { config, library } : { config, reason: NO_CREDENTIAL_REASON };
}

export async function browseDecisionMatrixLibrary(request: HttpRequest, context: InvocationContext) {
  const auth = requireRole(request, ADMIN_ROLES);
  if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };

  const config = libraryConfig();
  if (!config) {
    // Not an error: an environment where the approved library has not been
    // named yet is unconfigured, not broken, and says which settings name it.
    return {
      status: 200,
      jsonBody: {
        entries: [],
        diagnostics: {
          configured: false,
          outcome: "not_configured",
          path: "",
          reason: NO_LIBRARY_REASON,
        },
      },
    };
  }

  const library = overrideLibrary ?? productionLibrary(config);
  if (!library) {
    return {
      status: 200,
      jsonBody: {
        entries: [],
        diagnostics: {
          configured: false,
          outcome: "not_configured",
          path: "",
          reason: NO_CREDENTIAL_REASON,
        },
      },
    };
  }

  try {
    const listing = await library.listFolder(request.query.get("path"));
    if (listing.outcome !== "ok") {
      // Still a 200. The request was well formed and the answer is known - the
      // library was not readable, and the reason says which kind of not
      // readable. A 500 here would be the console's cue to report an outage.
      return {
        status: 200,
        jsonBody: {
          entries: [],
          diagnostics: { configured: true, outcome: listing.outcome, path: listing.path, reason: listing.reason },
        },
      };
    }
    return {
      status: 200,
      jsonBody: {
        entries: listing.entries,
        diagnostics: {
          configured: true,
          outcome: "ok",
          path: listing.path,
          reason: null,
          // No site or drive: they are configuration, and a chosen document
          // no longer carries them. The server fills them in when the Draft is
          // saved (lib/supportingDocumentReferences.ts).
          folder_count: listing.entries.filter((entry) => entry.kind === "folder").length,
          file_count: listing.entries.filter((entry) => entry.kind === "file").length,
        },
      },
    };
  } catch (error) {
    context.error("GET Decision Matrix library browse failed", error);
    return { status: 500, jsonBody: { error: "The approved SharePoint library could not be read." } };
  }
}

app.http("decisionMatrixLibraryBrowse", {
  route: "manage/decision-matrix/library",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: browseDecisionMatrixLibrary,
});
