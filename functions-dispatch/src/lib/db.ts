// SQL connection pool helper - same approach as functions-restapi/src/lib/db.ts
// (parse the connection string into discrete fields; the mssql package doesn't
// reliably parse the combined "Server=tcp:host,port;..." form). Kept as a copy
// rather than shared because the two Function Apps deploy as separate packages.
import sql from "mssql";

let poolPromise: Promise<sql.ConnectionPool> | null = null;

export function parseConnectionString(connectionString: string): sql.config {
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
  const base = {
    server,
    port: portStr ? parseInt(portStr, 10) : 1433,
    database: parts["database"],
    options: {
      encrypt: (parts["encrypt"] || "true").toLowerCase() === "true",
      trustServerCertificate: (parts["trustservercertificate"] || "false").toLowerCase() === "true",
    },
  };

  // "Authentication=Active Directory Default" signs in as the app's managed
  // identity, with no password - see functions-restapi/src/lib/db.ts.
  const authentication = (parts["authentication"] || "").toLowerCase();
  if (authentication === "active directory default") {
    return { ...base, authentication: { type: "azure-active-directory-default", options: {} } };
  }
  if (authentication && authentication !== "sql password") {
    throw new Error(
      `SQL_CONNECTION_STRING has Authentication=${parts["authentication"]}; ` +
        'only "Active Directory Default" and "Sql Password" are supported.',
    );
  }

  return { ...base, user: parts["user id"] || parts["uid"], password: parts["password"] || parts["pwd"] };
}

export function getPool(): Promise<sql.ConnectionPool> {
  if (!poolPromise) {
    const connectionString = process.env.SQL_CONNECTION_STRING;
    if (!connectionString) {
      throw new Error("SQL_CONNECTION_STRING app setting is not configured.");
    }
    poolPromise = sql.connect(parseConnectionString(connectionString)).catch((err) => {
      poolPromise = null;
      throw err;
    });
  }
  return poolPromise;
}

export { sql };
