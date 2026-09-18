// The SQL side of Access Management after the ADR-0032 cutover.
//
// Migration 052's tables stay as history, but only three of them are still
// written: the audit trail, the idempotency ledger that keeps a retried submit
// from sending a second invitation, and the guest-invitation claims. Pending
// privileged changes, their decisions, and the access metadata an expiry sweep
// used to walk belong to OnBoard's own roles and grants now, so nothing here
// reads or writes them; the metadata rows are still read as history.
import { getPool, sql } from "./db";
import type {
  AccessAuditEntry,
  AccessManagementStore,
  AccessMetadata,
} from "./accessManagementHttp";

export class AccessManagementStateConflictError extends Error {
  constructor(message = "Access Management state changed before this operation completed.") {
    super(message);
    this.name = "AccessManagementStateConflictError";
  }
}

export class SqlAccessManagementStore implements AccessManagementStore {
  async appendAudit(entry: AccessAuditEntry): Promise<void> {
    const request = (await getPool()).request();
    request.input("environment", sql.NVarChar(30), entry.environment);
    request.input("actorId", sql.NVarChar(200), entry.actor_id);
    request.input("actorName", sql.NVarChar(320), entry.actor_name);
    request.input("action", sql.NVarChar(100), entry.action);
    request.input("targetId", sql.NVarChar(200), entry.target_id);
    request.input("reason", sql.NVarChar(1000), entry.reason);
    request.input("outcome", sql.NVarChar(50), entry.outcome);
    request.input("correlationId", sql.NVarChar(200), entry.correlation_id);
    request.input("occurredAt", sql.DateTime2, new Date(entry.occurred_at));
    request.input("details", sql.NVarChar(sql.MAX), entry.details ? JSON.stringify(entry.details) : null);
    await request.query(`
      INSERT AccessManagementAudit (
        environment, actor_id, actor_name, action, target_id, reason, outcome,
        correlation_id, occurred_at, details_json
      ) VALUES (
        @environment, @actorId, @actorName, @action, @targetId, @reason, @outcome,
        @correlationId, @occurredAt, @details
      )
    `);
  }

  async listAudit(environment: string): Promise<AccessAuditEntry[]> {
    const request = (await getPool()).request();
    request.input("environment", sql.NVarChar(30), environment);
    const result = await request.query<{
      id: string; environment: string; actor_id: string; actor_name: string; action: string;
      target_id: string | null; reason: string | null; outcome: string; correlation_id: string | null;
      occurred_at: Date; details_json: string | null;
    }>(`
      SELECT TOP 500 id, environment, actor_id, actor_name, action, target_id, reason,
             outcome, correlation_id, occurred_at, details_json
      FROM AccessManagementAudit WHERE environment = @environment ORDER BY occurred_at DESC
    `);
    return result.recordset.map((row) => ({
      id: row.id,
      environment: row.environment,
      actor_id: row.actor_id,
      actor_name: row.actor_name,
      action: row.action,
      target_id: row.target_id,
      reason: row.reason,
      outcome: row.outcome,
      correlation_id: row.correlation_id,
      occurred_at: row.occurred_at.toISOString(),
      ...(row.details_json ? { details: JSON.parse(row.details_json) as Record<string, unknown> } : {}),
    }));
  }

  async getOperation(idempotencyKey: string, environment: string): Promise<unknown | null> {
    const request = (await getPool()).request();
    request.input("environment", sql.NVarChar(30), environment);
    request.input("key", sql.NVarChar(200), idempotencyKey);
    const result = await request.query<{ response_json: string }>(`
      SELECT response_json FROM AccessManagementOperations
      WHERE environment = @environment AND idempotency_key = @key AND status = 'completed'
    `);
    return result.recordset[0]?.response_json ? JSON.parse(result.recordset[0].response_json) : null;
  }

  async reserveOperation(
    idempotencyKey: string,
    environment: string,
    requestHash: string,
    allowStaleRecovery: boolean,
  ): Promise<{ state: "reserved" } | { state: "in_progress" } | { state: "completed"; response: unknown }> {
    const request = (await getPool()).request();
    request.input("environment", sql.NVarChar(30), environment);
    request.input("key", sql.NVarChar(200), idempotencyKey);
    request.input("requestHash", sql.NVarChar(64), requestHash);
    request.input("allowStaleRecovery", sql.Bit, allowStaleRecovery);
    const result = await request.query<{ state: string; request_hash: string; response_json: string | null }>(`
      SET XACT_ABORT ON;
      SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
      BEGIN TRANSACTION;
      DECLARE @existingStatus NVARCHAR(20), @existingHash NVARCHAR(64), @existingResponse NVARCHAR(MAX), @existingUpdatedAt DATETIME2;
      SELECT @existingStatus = status, @existingHash = request_hash, @existingResponse = response_json, @existingUpdatedAt = updated_at
      FROM AccessManagementOperations WITH (UPDLOCK, HOLDLOCK)
      WHERE environment = @environment AND idempotency_key = @key;
      IF @existingStatus IS NULL
      BEGIN
        INSERT AccessManagementOperations(environment, idempotency_key, request_hash, status)
        VALUES(@environment, @key, @requestHash, 'in_progress');
        SELECT 'reserved' AS state, @requestHash AS request_hash, CAST(NULL AS NVARCHAR(MAX)) AS response_json;
      END
      ELSE IF @existingStatus = 'in_progress' AND @existingHash = @requestHash
        AND @allowStaleRecovery = 1 AND @existingUpdatedAt < DATEADD(minute, -5, SYSUTCDATETIME())
      BEGIN
        UPDATE AccessManagementOperations SET updated_at = SYSUTCDATETIME()
        WHERE environment = @environment AND idempotency_key = @key;
        SELECT 'reserved' AS state, @existingHash AS request_hash, CAST(NULL AS NVARCHAR(MAX)) AS response_json;
      END
      ELSE
        SELECT @existingStatus AS state, @existingHash AS request_hash, @existingResponse AS response_json;
      COMMIT TRANSACTION;
    `);
    const row = result.recordset[0];
    if (row.request_hash !== requestHash) {
      throw new AccessManagementStateConflictError("Idempotency-Key was already used for a different request.");
    }
    if (row.state === "reserved") return { state: "reserved" };
    if (row.state === "completed" && row.response_json) {
      return { state: "completed", response: JSON.parse(row.response_json) };
    }
    return { state: "in_progress" };
  }

  async saveOperation(idempotencyKey: string, environment: string, response: unknown): Promise<void> {
    const request = (await getPool()).request();
    request.input("environment", sql.NVarChar(30), environment);
    request.input("key", sql.NVarChar(200), idempotencyKey);
    request.input("response", sql.NVarChar(sql.MAX), JSON.stringify(response));
    await request.query(`
      UPDATE AccessManagementOperations
      SET status = 'completed', response_json = @response, updated_at = SYSUTCDATETIME()
      WHERE environment = @environment AND idempotency_key = @key AND status = 'in_progress'
    `);
  }

  async listMetadata(environment: string): Promise<AccessMetadata[]> {
    const request = (await getPool()).request();
    request.input("environment", sql.NVarChar(30), environment);
    const result = await request.query<{
      id: string; environment: string; principal_id: string; principal_type: AccessMetadata["principal_type"];
      role_value: AccessMetadata["role"]; assignment_source: AccessMetadata["source"];
      assignment_source_id: string | null; reason: string;
      sponsor: string | null; organization: string | null; expires_at: Date | null;
      status: AccessMetadata["status"]; last_correlation_id: string | null; updated_at: Date;
    }>(`
      SELECT id, environment, principal_id, principal_type, role_value, assignment_source, assignment_source_id,
             reason, sponsor, organization, expires_at, status, last_correlation_id, updated_at
      FROM AccessManagementMetadata
      WHERE environment = @environment AND status <> 'revoked'
      ORDER BY expires_at, created_at
    `);
    return result.recordset.map((row) => ({
      id: row.id,
      environment: row.environment,
      principal_id: row.principal_id,
      principal_type: row.principal_type,
      role: row.role_value,
      source: row.assignment_source,
      source_id: row.assignment_source_id,
      reason: row.reason,
      sponsor: row.sponsor,
      organization: row.organization,
      expires_at: row.expires_at?.toISOString() ?? null,
      status: row.status,
      last_correlation_id: row.last_correlation_id,
      updated_at: row.updated_at.toISOString(),
    }));
  }

  async getGuestInvitation(email: string, environment: string): Promise<{ principal_id: string; correlation_id: string | null } | null> {
    const request = (await getPool()).request();
    request.input("environment", sql.NVarChar(30), environment);
    request.input("email", sql.NVarChar(320), email.toLowerCase());
    const result = await request.query<{ principal_id: string; invitation_correlation_id: string | null }>(`
      SELECT principal_id, invitation_correlation_id
      FROM AccessManagementGuestInvitations
      WHERE environment = @environment AND email = @email AND principal_id IS NOT NULL
    `);
    const row = result.recordset[0];
    return row ? { principal_id: row.principal_id, correlation_id: row.invitation_correlation_id } : null;
  }

  async claimGuestInvitation(
    email: string,
    environment: string,
    claimedAt: string,
  ): Promise<
    | { state: "claimed" }
    | { state: "in_progress" }
    | { state: "recover" }
    | { state: "existing"; principal_id: string; correlation_id: string | null }
  > {
    const request = (await getPool()).request();
    request.input("environment", sql.NVarChar(30), environment);
    request.input("email", sql.NVarChar(320), email.toLowerCase());
    request.input("claimedAt", sql.DateTime2, new Date(claimedAt));
    const result = await request.query<{
      state: "claimed" | "in_progress" | "recover" | "existing";
      principal_id: string | null;
      invitation_correlation_id: string | null;
    }>(`
      SET XACT_ABORT ON;
      SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
      BEGIN TRANSACTION;
      DECLARE @state NVARCHAR(30);
      DECLARE @principalId NVARCHAR(200);
      DECLARE @correlationId NVARCHAR(200);
      SELECT @principalId = principal_id, @correlationId = invitation_correlation_id
      FROM AccessManagementGuestInvitations WITH (UPDLOCK, HOLDLOCK)
      WHERE environment = @environment AND email = @email;
      IF @principalId IS NOT NULL
        SET @state = 'existing';
      ELSE IF EXISTS (
        SELECT 1 FROM AccessManagementGuestInvitations
        WHERE environment = @environment AND email = @email
          AND updated_at >= DATEADD(minute, -5, @claimedAt)
      )
        SET @state = 'in_progress';
      ELSE IF EXISTS (
        SELECT 1 FROM AccessManagementGuestInvitations
        WHERE environment = @environment AND email = @email
      )
      BEGIN
        UPDATE AccessManagementGuestInvitations SET updated_at = @claimedAt
        WHERE environment = @environment AND email = @email;
        SET @state = 'recover';
      END
      ELSE
      BEGIN
        INSERT AccessManagementGuestInvitations(
          environment, email, principal_id, invitation_correlation_id, status, created_at, updated_at
        ) VALUES (
          @environment, @email, NULL, NULL, 'inviting', @claimedAt, @claimedAt
        );
        SET @state = 'claimed';
      END;
      SELECT @state AS state, @principalId AS principal_id, @correlationId AS invitation_correlation_id;
      COMMIT TRANSACTION;
    `);
    const row = result.recordset[0];
    if (row.state === "existing" && row.principal_id) {
      return { state: "existing", principal_id: row.principal_id, correlation_id: row.invitation_correlation_id };
    }
    return { state: row.state as "claimed" | "in_progress" | "recover" };
  }

  async saveGuestInvitation(
    email: string,
    environment: string,
    principalId: string,
    correlationId: string | null,
    status: "invited" | "assigned" | "assignment_failed",
    changedAt: string,
  ): Promise<void> {
    const request = (await getPool()).request();
    request.input("environment", sql.NVarChar(30), environment);
    request.input("email", sql.NVarChar(320), email.toLowerCase());
    request.input("principalId", sql.NVarChar(200), principalId);
    request.input("correlationId", sql.NVarChar(200), correlationId);
    request.input("status", sql.NVarChar(30), status);
    request.input("changedAt", sql.DateTime2, new Date(changedAt));
    await request.query(`
      SET XACT_ABORT ON;
      SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
      BEGIN TRANSACTION;
      UPDATE AccessManagementGuestInvitations
      SET principal_id = @principalId, invitation_correlation_id = COALESCE(invitation_correlation_id, @correlationId),
          status = @status, updated_at = @changedAt
      WHERE environment = @environment AND email = @email;
      IF @@ROWCOUNT = 0
        INSERT AccessManagementGuestInvitations(
          environment, email, principal_id, invitation_correlation_id, status, created_at, updated_at
        ) VALUES (
          @environment, @email, @principalId, @correlationId, @status, @changedAt, @changedAt
        );
      COMMIT TRANSACTION;
    `);
  }
}
