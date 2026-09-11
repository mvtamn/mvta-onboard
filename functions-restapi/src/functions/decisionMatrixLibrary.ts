import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { ClientSecretCredential } from "@azure/identity";
import { ADMIN_ROLES, requireRole } from "../lib/auth";
import { createSharePointLibrary, type LibraryConfig, type SharePointLibrary } from "../lib/sharepointLibrary";

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

// Reading a library is app-only: Sites.Selected is an application permission,
// and the sync that shares this credential runs on a timer with no signed-in
// user to borrow an identity from.
//
// The dedicated document credential is preferred where it exists, because the
// runbook's separate registration keeps SharePoint access off the app that
// signs users in. On dev the permission was granted to the API app instead, so
// its credential is the fallback rather than an error - one identity doing both
// jobs is a narrower posture than the feature simply not working.
export function documentCredential(): { tenantId: string; clientId: string; clientSecret: string } | null {
  const tenantId = setting("AZURE_TENANT_ID");
  if (!tenantId) return null;
  const dedicatedId = setting("DECISION_MATRIX_HEALTH_CLIENT_ID");
  const dedicatedSecret = setting("DECISION_MATRIX_HEALTH_CLIENT_SECRET");
  if (dedicatedId && dedicatedSecret) return { tenantId, clientId: dedicatedId, clientSecret: dedicatedSecret };
  const apiId = setting("ONBOARD_API_CLIENT_ID");
  const apiSecret = setting("ONBOARD_API_CLIENT_SECRET");
  if (apiId && apiSecret) return { tenantId, clientId: apiId, clientSecret: apiSecret };
  return null;
}

function productionLibrary(config: LibraryConfig): SharePointLibrary | null {
  const credential = documentCredential();
  if (!credential) return null;
  const secret = new ClientSecretCredential(credential.tenantId, credential.clientId, credential.clientSecret);
  return createSharePointLibrary(config, async () => {
    const token = await secret.getToken("https://graph.microsoft.com/.default");
    if (!token?.token) throw new Error("Microsoft Graph application token acquisition returned no token.");
    return token.token;
  });
}

let overrideLibrary: SharePointLibrary | null = null;
/** Test seam: the handler is the piece worth testing, not Graph. */
export function setDecisionMatrixLibraryForTests(library: SharePointLibrary | null) {
  overrideLibrary = library;
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
          reason: "No approved SharePoint library is configured. Set DECISION_MATRIX_LIBRARY_SITE_ID and DECISION_MATRIX_LIBRARY_DRIVE_ID.",
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
          reason: "No credential is configured for reading SharePoint. Set AZURE_TENANT_ID with either DECISION_MATRIX_HEALTH_CLIENT_ID/_SECRET or ONBOARD_API_CLIENT_ID/_SECRET.",
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
          diagnostics: { configured: true, outcome: listing.outcome, path: listing.path, reason: listing.reason, site_id: config.site_id, drive_id: config.drive_id },
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
          // The site and drive are configuration, so the picker cannot know
          // them and a chosen document needs them. Reporting which library was
          // read is also the only way a reader can tell which one they are
          // looking at.
          site_id: config.site_id,
          drive_id: config.drive_id,
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
