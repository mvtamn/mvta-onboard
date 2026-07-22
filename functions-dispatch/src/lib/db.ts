// SQL connection pool helper - same approach as functions-restapi/src/lib/db.ts
// (parse the connection string into discrete fields; the mssql package doesn't
// reliably parse the combined "Server=tcp:host,port;..." form). Kept as a copy
// rather than shared because the two Function Apps deploy as separate packages.
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
