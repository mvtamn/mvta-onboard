// GET /maps/token - issues a short-lived Azure AD token scoped to Azure
// Maps, for the console's Azure Maps Web SDK ('anonymous' auth mode) to use
// (event-module-implementation-plan.md, Part A3). Zero-standing-secret: no
// Maps subscription key is ever generated or shipped to the browser - the
// Function App's own managed identity (granted Azure Maps Data Reader on
// the account, see infra-phase1/modules/maps.bicep) mints this token
// server-side, same DefaultAzureCredential pattern already used for Blob
// Storage SAS minting (blobStorage.ts) and Service Bus (events.ts).
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { DefaultAzureCredential } from "@azure/identity";
import { requireRole, STAFF_READ_ROLES } from "../lib/auth";

const MAPS_SCOPE = "https://atlas.microsoft.com/.default";

let credential: DefaultAzureCredential | null = null;
function getCredential(): DefaultAzureCredential {
  if (!credential) credential = new DefaultAzureCredential();
  return credential;
}

app.http("mapsToken", {
  route: "maps/token",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireRole below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = requireRole(request, [...STAFF_READ_ROLES, "OCC.Compliance"]);
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }

    // Public identifier, not a secret - see maps.bicep's mapsClientId output.
    const clientId = process.env.AZURE_MAPS_CLIENT_ID;
    if (!clientId) {
      return { status: 500, jsonBody: { error: "AZURE_MAPS_CLIENT_ID is not configured." } };
    }

    try {
      const token = await getCredential().getToken(MAPS_SCOPE);
      if (!token) {
        throw new Error("DefaultAzureCredential returned no token for the Azure Maps scope.");
      }
      return {
        status: 200,
        jsonBody: {
          client_id: clientId,
          access_token: token.token,
          expires_on: token.expiresOnTimestamp,
        },
      };
    } catch (err) {
      context.error("GET /maps/token failed:", err);
      return { status: 500, jsonBody: { error: "Could not acquire an Azure Maps token." } };
    }
  },
});
