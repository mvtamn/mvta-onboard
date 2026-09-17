import { ClientSecretCredential } from "@azure/identity";
import { getPool, sql } from "./db";
import { recordProcedureAuditEvent } from "./procedureAudit";

// Document Reference Health: whether the source document a Supporting Document
// Reference expects is present and unchanged, as last observed. See CONTEXT.md
// and the 2026-09-17 amendment to ADR 0025.
//
// This module is the only writer of that record. It used to have two: the
// daily timer checked as the application, and Submit, Approve and Check
// documents checked on behalf of whichever Admin clicked, using that Admin's
// own SharePoint rights. Both wrote the same columns, so the last writer won
// and whether a Procedure Revision could be approved depended on who pressed
// the button. Now every check - scheduled or on demand - is made by the one
// dedicated integrity-monitor identity, and there is no user token anywhere
// in it.

/** Where a Supporting Document Reference says its source document lives. */
export type DocumentLocation = { site_id: string; drive_id: string; item_id: string };

/** What SharePoint reported about an item. */
export type ObservedDocument = { version: string | null; file_name: string | null; mime_type: string | null };

/**
 * One metadata read. A refusal is kept apart from a failure, and 401 from 403,
 * because each has a different owner: a credential that no longer works, a
 * site grant that was never issued, a file that is not there, an outage.
 */
export type MetadataRead =
  | { kind: "found"; document: ObservedDocument }
  | { kind: "credential_rejected" }
  | { kind: "grant_missing" }
  | { kind: "not_found" }
  | { kind: "failed"; detail: string };

/**
 * The seam. Health needs one thing from SharePoint - an item's version, name
 * and type - and two adapters satisfy it: Microsoft Graph in production, an
 * in-memory set of documents in tests.
 */
export interface DocumentMetadataReader {
  read(location: DocumentLocation): Promise<MetadataRead>;
}

/** Why a reference's health is what it is. "ok" covers both Valid and Needs review: the document was read. */
export type ObservationOutcome = "ok" | "forbidden" | "not_found" | "failed";

export type ReferenceHealth = {
  reference_id: string;
  expected_file_name: string;
  outcome: ObservationOutcome;
  health_status: "Valid" | "Needs review" | "Unavailable";
  reason: string | null;
  observed: ObservedDocument | null;
};

export type RevisionHealthRefresh =
  | { outcome: "checked"; reason: null; document_references: ReferenceHealth[] }
  | { outcome: "not_configured"; reason: string; document_references: [] };

/** The actor recorded for checks nobody asked for. */
export const DAILY_CHECK_ACTOR = "Decision Matrix daily health check";

export const NOT_CONFIGURED_REASON =
  "Document checks are not configured, so nothing was checked and nothing was recorded. OnBoard checks documents only as the Decision Matrix documents application, and DECISION_MATRIX_HEALTH_CLIENT_ID and DECISION_MATRIX_HEALTH_CLIENT_SECRET are not set.";

const MISMATCH_REASON = "The SharePoint document metadata no longer matches this Procedure Revision.";
const GRANT_MISSING_REASON =
  "SharePoint refused OnBoard's document check, so the document was never inspected. A SharePoint administrator must grant the Decision Matrix documents application read access on this site (step 4 of the SharePoint documents runbook). This is not a problem with the document.";
const CREDENTIAL_REJECTED_REASON =
  "SharePoint rejected the Decision Matrix documents application's credential, so the document was never inspected. Its client secret may have expired or been replaced. This is a configuration fault, not a problem with the document.";
const NOT_FOUND_REASON =
  "SharePoint has no document at the site, drive and item this Procedure records. It may have been moved, replaced with a new item, or deleted.";

type GraphFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** The production adapter: Microsoft Graph, as whichever identity `getToken` belongs to. */
export function createGraphMetadataReader(getToken: () => Promise<string>, fetchGraph: GraphFetch = fetch): DocumentMetadataReader {
  return {
    async read(location) {
      try {
        const token = await getToken();
        const response = await fetchGraph(
          `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(location.site_id)}/drives/${encodeURIComponent(location.drive_id)}/items/${encodeURIComponent(location.item_id)}?$select=eTag,name,file`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (response.status === 401) return { kind: "credential_rejected" };
        if (response.status === 403) return { kind: "grant_missing" };
        if (response.status === 404) return { kind: "not_found" };
        if (!response.ok) return { kind: "failed", detail: `Microsoft Graph returned ${response.status}.` };
        const item = await response.json() as { eTag?: unknown; name?: unknown; file?: { mimeType?: unknown } };
        return {
          kind: "found",
          document: {
            version: typeof item.eTag === "string" ? item.eTag : null,
            file_name: typeof item.name === "string" ? item.name : null,
            mime_type: typeof item.file?.mimeType === "string" ? item.file.mimeType : null,
          },
        };
      } catch (error) {
        return { kind: "failed", detail: error instanceof Error ? error.message : "Microsoft Graph could not be reached." };
      }
    },
  };
}

/** The test adapter: documents keyed by item id; anything absent reads as not found. Records what it was asked for. */
export function createInMemoryMetadataReader(documents: Record<string, MetadataRead>): DocumentMetadataReader & { reads: DocumentLocation[] } {
  const reads: DocumentLocation[] = [];
  return {
    reads,
    async read(location) {
      reads.push(location);
      return documents[location.item_id] ?? { kind: "not_found" };
    },
  };
}

/**
 * The identity documents are checked as: the dedicated Decision Matrix
 * documents application, and nothing else.
 *
 * There is deliberately no fallback to the sign-in application. A fallback
 * would make the identity doing the checking depend on which settings happen
 * to be present - which is the two-identity problem this module exists to end.
 */
export function documentCheckCredential(env: NodeJS.ProcessEnv = process.env): { tenantId: string; clientId: string; clientSecret: string } | null {
  const value = (name: string) => env[name]?.trim() || null;
  const tenantId = value("AZURE_TENANT_ID");
  const clientId = value("DECISION_MATRIX_HEALTH_CLIENT_ID");
  const clientSecret = value("DECISION_MATRIX_HEALTH_CLIENT_SECRET");
  return tenantId && clientId && clientSecret ? { tenantId, clientId, clientSecret } : null;
}

/** The production reader, or null when documents cannot be checked here. */
export function documentHealthReader(env: NodeJS.ProcessEnv = process.env): DocumentMetadataReader | null {
  const credential = documentCheckCredential(env);
  if (!credential) return null;
  const secret = new ClientSecretCredential(credential.tenantId, credential.clientId, credential.clientSecret);
  return createGraphMetadataReader(async () => {
    const token = await secret.getToken("https://graph.microsoft.com/.default");
    if (!token?.token) throw new Error("Microsoft Graph application token acquisition returned no token.");
    return token.token;
  });
}

type ReferenceRow = {
  reference_id: string;
  site_id: string;
  drive_id: string;
  item_id: string;
  expected_version: string;
  expected_file_name: string;
  expected_mime_type: string;
};

function assess(reference: ReferenceRow, read: MetadataRead): ReferenceHealth {
  const base = { reference_id: reference.reference_id, expected_file_name: reference.expected_file_name };
  switch (read.kind) {
    case "found": {
      const matches = read.document.version === reference.expected_version
        && read.document.file_name === reference.expected_file_name
        && read.document.mime_type === reference.expected_mime_type;
      return { ...base, outcome: "ok", health_status: matches ? "Valid" : "Needs review", reason: matches ? null : MISMATCH_REASON, observed: read.document };
    }
    case "credential_rejected":
      return { ...base, outcome: "forbidden", health_status: "Unavailable", reason: CREDENTIAL_REJECTED_REASON, observed: null };
    case "grant_missing":
      return { ...base, outcome: "forbidden", health_status: "Unavailable", reason: GRANT_MISSING_REASON, observed: null };
    case "not_found":
      return { ...base, outcome: "not_found", health_status: "Unavailable", reason: NOT_FOUND_REASON, observed: null };
    case "failed":
      return { ...base, outcome: "failed", health_status: "Unavailable", reason: `SharePoint check failed: ${read.detail}`, observed: null };
  }
}

/**
 * Refresh the health of every Supporting Document Reference on one Procedure
 * Revision, and record what was seen.
 *
 * `requestedBy` is who caused the check - an Admin, or DAILY_CHECK_ACTOR - and
 * is recorded as the audit actor. It is never used to read SharePoint: the
 * event also records that the application made the observation, so nobody
 * later reads "this Admin approved it" as "this Admin could open that SOP".
 *
 * With no reader, nothing is checked and nothing is written. A missing
 * credential says nothing about any document, and recording it as Unavailable
 * is how a configuration gap comes to look like a document problem.
 */
export async function refreshRevisionHealth(
  procedureId: string,
  revision: number,
  requestedBy: string,
  reader: DocumentMetadataReader | null,
): Promise<RevisionHealthRefresh> {
  if (!reader) return { outcome: "not_configured", reason: NOT_CONFIGURED_REASON, document_references: [] };

  const pool = await getPool();
  const references = await pool.request()
    .input("procedure_id", sql.NVarChar, procedureId)
    .input("revision", sql.Int, revision)
    .query<ReferenceRow>("SELECT reference_id,site_id,drive_id,item_id,expected_version,expected_file_name,expected_mime_type FROM ProcedureDocumentReferences WHERE procedure_id=@procedure_id AND revision=@revision ORDER BY sort_order");

  // Every SharePoint round trip happens before a transaction opens. The old
  // loop held one open across each Graph call, keeping locks while it waited
  // on another service.
  const observations: ReferenceHealth[] = [];
  for (const reference of references.recordset) {
    observations.push(assess(reference, await reader.read(reference)));
  }

  // Migration 126 adds health_outcome. Checking first keeps checks working on a
  // database it has not reached; T-SQL binds every column before running, so
  // naming a missing one fails the whole UPDATE rather than skipping it.
  const recordOutcome = await hasHealthOutcomeColumn(pool);

  // Health and its audit events commit together, and on their own: they
  // describe SharePoint, so they stand whether or not the lifecycle decision
  // that asked for them goes on to succeed.
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    for (const observation of observations) {
      const update = transaction.request();
      update.input("reference_id", sql.UniqueIdentifier, observation.reference_id);
      update.input("health_status", sql.NVarChar, observation.health_status);
      update.input("observed_version", sql.NVarChar, observation.observed?.version ?? null);
      update.input("observed_file_name", sql.NVarChar, observation.observed?.file_name ?? null);
      update.input("observed_mime_type", sql.NVarChar, observation.observed?.mime_type ?? null);
      update.input("reason", sql.NVarChar, observation.reason);
      update.input("outcome", sql.NVarChar, observation.outcome);
      await update.query(`UPDATE ProcedureDocumentReferences SET health_status=@health_status,checked_at=SYSUTCDATETIME(),observed_version=@observed_version,observed_file_name=@observed_file_name,observed_mime_type=@observed_mime_type,health_reason=@reason${recordOutcome ? ",health_outcome=@outcome" : ""} WHERE reference_id=@reference_id`);
      await recordProcedureAuditEvent(transaction, procedureId, revision, "document_checked", requestedBy, observation.reason, {
        reference_id: observation.reference_id,
        health_status: observation.health_status,
        outcome: observation.outcome,
        observed_by: "application",
        observed_version: observation.observed?.version ?? null,
        observed_file_name: observation.observed?.file_name ?? null,
        observed_mime_type: observation.observed?.mime_type ?? null,
      });
    }
    await transaction.commit();
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    throw error;
  }
  return { outcome: "checked", reason: null, document_references: observations };
}

export async function hasHealthOutcomeColumn(pool: sql.ConnectionPool): Promise<boolean> {
  const check = await pool.request().query<{ ok: number }>(
    "SELECT CASE WHEN COL_LENGTH('dbo.ProcedureDocumentReferences','health_outcome') IS NULL THEN 0 ELSE 1 END AS ok");
  return check.recordset[0]?.ok === 1;
}

/**
 * A check older than this is overdue. The daily run is at 05:00 UTC; two hours
 * of slack keeps a slow morning from looking like a stopped timer.
 */
export const HEALTH_CHECK_OVERDUE_HOURS = 26;

/** What the governance workspace needs to say whether document checks are working. */
export type DocumentCheckStatus = {
  /** Whether the documents application is configured. A settings check, not a SharePoint call. */
  configured: boolean;
  /** Approved and Under review revisions that carry references: what controllers read and what awaits approval. */
  current_revision_count: number;
  never_checked_reference_count: number;
  oldest_check_at: string | null;
  /** Any current reference never checked, or last checked more than HEALTH_CHECK_OVERDUE_HOURS ago. */
  overdue: boolean;
  /** References whose latest check SharePoint refused. Null until migration 126 has run. */
  refused_reference_count: number | null;
};

/**
 * Whether document checks are actually happening, derived from the health
 * record itself rather than from a separate record of timer runs.
 *
 * A run log would be a second account of the same facts, able to disagree with
 * the health rows - and the timer skipped silently for eight days with only a
 * log line to show for it. This reads what the checks left behind: how old the
 * oldest observation is, how many were never made, and how many SharePoint
 * refused. With no current revisions there is nothing to be stale, but
 * `configured` still says whether checks could run at all.
 */
export async function documentCheckStatus(env: NodeJS.ProcessEnv = process.env): Promise<DocumentCheckStatus> {
  const pool = await getPool();
  const withOutcome = await hasHealthOutcomeColumn(pool);
  const status = await pool.request()
    .input("overdue_hours", sql.Int, HEALTH_CHECK_OVERDUE_HOURS)
    .query<{ current_revision_count: number | null; never_checked: number | null; oldest_check_at: Date | null; overdue_count: number | null; refused: number | null }>(`
      SELECT
        COUNT(DISTINCT CONCAT(d.procedure_id, '|', d.revision)) AS current_revision_count,
        SUM(CASE WHEN d.checked_at IS NULL THEN 1 ELSE 0 END) AS never_checked,
        MIN(d.checked_at) AS oldest_check_at,
        SUM(CASE WHEN d.checked_at IS NULL OR d.checked_at < DATEADD(HOUR, -@overdue_hours, SYSUTCDATETIME()) THEN 1 ELSE 0 END) AS overdue_count,
        ${withOutcome ? "SUM(CASE WHEN d.health_outcome='forbidden' THEN 1 ELSE 0 END)" : "CAST(NULL AS INT)"} AS refused
      FROM ProcedureDocumentReferences d
      JOIN ProcedureRevisions r ON r.procedure_id=d.procedure_id AND r.revision=d.revision
      WHERE r.lifecycle_state IN ('Approved','Under review')`);
  const row = status.recordset[0];
  const oldest = row?.oldest_check_at ?? null;
  return {
    configured: documentCheckCredential(env) !== null,
    current_revision_count: row?.current_revision_count ?? 0,
    never_checked_reference_count: row?.never_checked ?? 0,
    oldest_check_at: oldest ? new Date(oldest).toISOString() : null,
    overdue: (row?.overdue_count ?? 0) > 0,
    // SUM over no rows is NULL; with the column present that means none refused.
    refused_reference_count: withOutcome ? row?.refused ?? 0 : null,
  };
}

/**
 * The revisions the daily check refreshes: Approved, which controllers read,
 * and Under review, which is waiting on an approval decision - where any
 * reference is unchecked or more than a day old. Drafts are checked when they
 * are submitted; Superseded and Retired revisions are history nothing gates on,
 * and a Draft cloned from one starts unchecked anyway.
 */
export async function revisionsDueForHealthCheck(): Promise<Array<{ procedure_id: string; revision: number }>> {
  const pool = await getPool();
  const due = await pool.request().query<{ procedure_id: string; revision: number }>(`
    SELECT DISTINCT d.procedure_id,d.revision
    FROM ProcedureDocumentReferences d
    JOIN ProcedureRevisions r ON r.procedure_id=d.procedure_id AND r.revision=d.revision
    WHERE r.lifecycle_state IN ('Approved','Under review')
      AND (d.checked_at IS NULL OR d.checked_at<DATEADD(DAY,-1,SYSUTCDATETIME()))`);
  return due.recordset;
}
