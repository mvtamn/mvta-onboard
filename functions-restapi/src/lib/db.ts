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

function unwrapConnectionStringValue(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/""/g, '"');
  }
  if (value.length >= 2 && value.startsWith("{") && value.endsWith("}")) {
    return value.slice(1, -1).replace(/}}/g, "}");
  }
  return value;
}

export function parseConnectionString(connectionString: string): sql.config {
  const parts: Record<string, string> = {};
  connectionString.split(";").forEach((segment) => {
    const idx = segment.indexOf("=");
    if (idx === -1) return;
    const key = segment.substring(0, idx).trim().toLowerCase();
    const value = segment.substring(idx + 1).trim();
    if (key) parts[key] = value;
  });

  // Passwords commonly contain semicolons. The generic split above cannot
  // preserve them, so recover the complete password using the next known
  // connection-string property as the delimiter. Quoted and ADO.NET-style
  // braced values are supported as well.
  const passwordMatch = connectionString.match(
    /(?:^|;)\s*(?:password|pwd)\s*=\s*(.*?)(?=;\s*(?:server|data source|database|initial catalog|user id|uid|encrypt|trustservercertificate|connection timeout)\s*=|;?\s*$)/i,
  );
  const password = passwordMatch
    ? unwrapConnectionStringValue(passwordMatch[1].trim())
    : parts["password"] || parts["pwd"];

  const serverRaw = (parts["server"] || "").replace(/^tcp:/i, "");
  const [server, portStr] = serverRaw.split(",");

  return {
    server,
    port: portStr ? parseInt(portStr, 10) : 1433,
    database: parts["database"],
    user: parts["user id"] || parts["uid"],
    password,
    options: {
      encrypt: (parts["encrypt"] || "true").toLowerCase() === "true",
      trustServerCertificate: (parts["trustservercertificate"] || "false").toLowerCase() === "true",
    },
  };
}

// The dev SQL Database runs on a serverless tier that auto-pauses after idle
// time (see infra-stage0/modules/sql.bicep); the first connection attempt
// after a pause commonly fails with a transient error while the database
// resumes (typically 30-60s), surfacing to callers as a bare 500. Retry a
// few times with backoff before giving up instead of failing on the first
// blip. This only wraps the initial connect - a query that fails mid-flight
// is not retried here, since retrying an already-issued non-idempotent
// write could double it.
const CONNECT_RETRY_ATTEMPTS = 4;
const CONNECT_RETRY_BASE_DELAY_MS = 2000;

function isTransientConnectError(err: unknown): boolean {
  const code = (err as { code?: string } | undefined)?.code;
  return code === "ESOCKET" || code === "ETIMEOUT" || code === "ECONNRESET";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectWithRetry(config: sql.config): Promise<sql.ConnectionPool> {
  for (let attempt = 1; attempt <= CONNECT_RETRY_ATTEMPTS; attempt++) {
    try {
      return await sql.connect(config);
    } catch (err) {
      if (attempt === CONNECT_RETRY_ATTEMPTS || !isTransientConnectError(err)) throw err;
      await sleep(CONNECT_RETRY_BASE_DELAY_MS * attempt);
    }
  }
  // Unreachable - the loop above always returns or throws - but keeps TS satisfied.
  throw new Error("connectWithRetry exhausted attempts without a result");
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
    poolPromise = connectWithRetry(config).catch((err) => {
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
