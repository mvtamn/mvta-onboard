// Connection pool helper. Azure Functions reuses the same process across
// many invocations, so creating a new SQL connection on every request is
// slow and wastes connections - this keeps one pool alive and shares it.
//
// Parses SQL_CONNECTION_STRING into discrete config fields rather than
// passing the raw ADO.NET-style string straight to sql.connect(). The
// combined "Server=tcp:host,port;..." string format isn't reliably parsed
// by the mssql package in all cases - a direct sqlcmd connection using the
// identical credentials worked fine while the app kept failing with
// ELOGIN, which pointed at how the string was being interpreted here,
// not the credentials themselves. Confirmed as the real fix in production.
import sql from "mssql";

let poolPromise: Promise<sql.ConnectionPool> | null = null;

function parseConnectionString(connectionString: string): sql.config {
  const parts: Record<string, string> = {};
  connectionString.split(";").forEach((segment) => {
    const idx = segment.indexOf("=");
    if (idx === -1) return;
    const key = segment.substring(0, idx).trim().toLowerCase();
    const value = segment.substring(idx + 1).trim();
    if (key) parts[key] = value;
  });

  const serverRaw = (parts["server"] || "").replace(/^tcp:/i, "");
  const [server, portStr] = serverRaw.split(",");

  return {
    server,
    port: portStr ? parseInt(portStr, 10) : 1433,
    database: parts["database"],
    user: parts["user id"] || parts["uid"],
    password: parts["password"] || parts["pwd"],
    options: {
      encrypt: (parts["encrypt"] || "true").toLowerCase() === "true",
      trustServerCertificate: (parts["trustservercertificate"] || "false").toLowerCase() === "true",
    },
  };
}

export function getPool(): Promise<sql.ConnectionPool> {
  if (!poolPromise) {
    const connectionString = process.env.SQL_CONNECTION_STRING;
    if (!connectionString) {
      throw new Error(
        "SQL_CONNECTION_STRING app setting is not configured. " +
          "See local.settings.json.example for the expected format, " +
          "or infra-phase1/README.md for how this should be wired to Key Vault in production.",
      );
    }
    const config = parseConnectionString(connectionString);
    poolPromise = sql.connect(config).catch((err) => {
      // Clear the cached promise on failure so the next call actually
      // retries instead of permanently reusing this same rejected promise
      // until the whole process restarts.
      poolPromise = null;
      throw err;
    });
  }
  return poolPromise;
}

export { sql };
