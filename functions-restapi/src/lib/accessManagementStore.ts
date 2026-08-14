import { getPool, sql } from "./db";
import type {
  AccessAuditEntry,
  AccessChangeRecord,
  AccessChangeStatus,
  AccessManagementStore,
  AccessMetadata,
  DirectoryChange,
  DirectoryChangeResult,
} from "./accessManagementHttp";

export class AccessManagementStateConflictError extends Error {
  constructor(message = "Access Management state changed before this operation completed.") {
    super(message);
    this.name = "AccessManagementStateConflictError";
  }
}

interface ChangeRow {
  id: string;
  environment: string;
  action: DirectoryChange["action"];
  principal_id: string;
  principal_type: DirectoryChange["principal_type"];
  role_value: DirectoryChange["role"];
  assignment_source: DirectoryChange["source"];
  assignment_source_id: string | null;
  reason: string;
  sponsor: string | null;
  organization: string | null;
  expires_at: Date | null;
  status: AccessChangeStatus;
  requested_by_id: string;
  requested_by_name: string;
  requested_at: Date;
  approval_expires_at: Date;
  decided_by_id: string | null;
  decided_by_name: string | null;
  decided_at: Date | null;
  result_json: string | null;
}

function changeOf(row: ChangeRow): AccessChangeRecord {
  return {
    id: row.id,
    environment: row.environment,
    change: {
      action: row.action,
      principal_id: row.principal_id,
      principal_type: row.principal_type,
      role: row.role_value,
      source: row.assignment_source,
      ...(row.assignment_source_id ? { source_id: row.assignment_source_id } : {}),
      reason: row.reason,
      ...(row.sponsor ? { sponsor: row.sponsor } : {}),
      ...(row.organization ? { organization: row.organization } : {}),
      ...(row.expires_at ? { expires_at: row.expires_at.toISOString() } : {}),
    },
    status: row.status,
    requested_by_id: row.requested_by_id,
    requested_by_name: row.requested_by_name,
    requested_at: row.requested_at.toISOString(),
    approval_expires_at: row.approval_expires_at.toISOString(),
    decided_by_id: row.decided_by_id,
    decided_by_name: row.decided_by_name,
    decided_at: row.decided_at?.toISOString() ?? null,
    result: row.result_json ? JSON.parse(row.result_json) as DirectoryChangeResult : null,
  };
}

export class SqlAccessManagementStore implements AccessManagementStore {
  async listPendingChanges(environment: string): Promise<AccessChangeRecord[]> {
    const request = (await getPool()).request();
    request.input("environment", sql.NVarChar(30), environment);
    const result = await request.query<ChangeRow>(`
      SELECT * FROM AccessManagementChanges
      WHERE environment = @environment AND status IN ('pending', 'applying')
      ORDER BY requested_at ASC
    `);
    return result.recordset.map(changeOf);
  }

  async getChange(id: string, environment: string): Promise<AccessChangeRecord | null> {
    const request = (await getPool()).request();
    request.input("id", sql.UniqueIdentifier, id);
    request.input("environment", sql.NVarChar(30), environment);
    const result = await request.query<ChangeRow>(`
      SELECT * FROM AccessManagementChanges WHERE id = @id AND environment = @environment
    `);
    return result.recordset[0] ? changeOf(result.recordset[0]) : null;
  }

  async createChange(input: Omit<AccessChangeRecord, "id">): Promise<AccessChangeRecord> {
    const request = (await getPool()).request();
    request.input("environment", sql.NVarChar(30), input.environment);
    request.input("action", sql.NVarChar(30), input.change.action);
    request.input("principalId", sql.NVarChar(200), input.change.principal_id);
    request.input("principalType", sql.NVarChar(30), input.change.principal_type);
    request.input("role", sql.NVarChar(100), input.change.role);
    request.input("source", sql.NVarChar(20), input.change.source);
    request.input("sourceId", sql.NVarChar(200), input.change.source_id ?? null);
    request.input("reason", sql.NVarChar(1000), input.change.reason);
    request.input("sponsor", sql.NVarChar(320), input.change.sponsor ?? null);
    request.input("organization", sql.NVarChar(320), input.change.organization ?? null);
    request.input("expiresAt", sql.DateTime2, input.change.expires_at ? new Date(input.change.expires_at) : null);
    request.input("status", sql.NVarChar(30), input.status);
    request.input("requestedById", sql.NVarChar(200), input.requested_by_id);
    request.input("requestedByName", sql.NVarChar(320), input.requested_by_name);
    request.input("requestedAt", sql.DateTime2, new Date(input.requested_at));
    request.input("approvalExpiresAt", sql.DateTime2, new Date(input.approval_expires_at ?? new Date(new Date(input.requested_at).valueOf() + 24 * 60 * 60 * 1000)));
    const result = await request.query<ChangeRow>(`
      INSERT AccessManagementChanges (
        environment, action, principal_id, principal_type, role_value, assignment_source, assignment_source_id,
        reason, sponsor, organization, expires_at, status,
        requested_by_id, requested_by_name, requested_at, approval_expires_at
      )
      OUTPUT INSERTED.*
      VALUES (
        @environment, @action, @principalId, @principalType, @role, @source, @sourceId,
        @reason, @sponsor, @organization, @expiresAt, @status,
        @requestedById, @requestedByName, @requestedAt, @approvalExpiresAt
      )
    `);
    return changeOf(result.recordset[0]);
  }

  async decideChange(
    id: string,
    decision: Exclude<AccessChangeStatus, "pending" | "applying">,
    actor: { id: string; name: string },
    decidedAt: string,
    result: DirectoryChangeResult | null,
  ): Promise<AccessChangeRecord> {
    const request = (await getPool()).request();
    request.input("id", sql.UniqueIdentifier, id);
    request.input("status", sql.NVarChar(30), decision);
    request.input("actorId", sql.NVarChar(200), actor.id);
    request.input("actorName", sql.NVarChar(320), actor.name);
    request.input("decidedAt", sql.DateTime2, new Date(decidedAt));
    request.input("result", sql.NVarChar(sql.MAX), result ? JSON.stringify(result) : null);
    const changed = await request.query<ChangeRow>(`
      UPDATE AccessManagementChanges
      SET status = @status, decided_by_id = @actorId, decided_by_name = @actorName,
          decided_at = @decidedAt, result_json = @result
      OUTPUT INSERTED.*
      WHERE id = @id AND (
        (@status IN ('approved', 'failed') AND status = 'applying')
        OR (@status IN ('rejected', 'cancelled', 'expired') AND status = 'pending')
        OR (@status = 'expired' AND status = 'applying' AND decided_at < DATEADD(minute, -5, @decidedAt))
      )
    `);
    if (!changed.recordset[0]) throw new AccessManagementStateConflictError();
    return changeOf(changed.recordset[0]);
  }

  async claimChange(
    id: string,
    environment: string,
    actor: { id: string; name: string },
    claimedAt: string,
  ): Promise<boolean> {
    const request = (await getPool()).request();
    request.input("id", sql.UniqueIdentifier, id);
    request.input("environment", sql.NVarChar(30), environment);
    request.input("actorId", sql.NVarChar(200), actor.id);
    request.input("actorName", sql.NVarChar(320), actor.name);
    request.input("claimedAt", sql.DateTime2, new Date(claimedAt));
    const result = await request.query<{ id: string }>(`
      SET XACT_ABORT ON;
      SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
      BEGIN TRANSACTION;
      UPDATE target
      SET status = 'applying', decided_by_id = @actorId,
          decided_by_name = @actorName, decided_at = @claimedAt
      OUTPUT INSERTED.id
      FROM AccessManagementChanges AS target WITH (UPDLOCK, HOLDLOCK)
      WHERE target.id = @id AND target.environment = @environment
        AND (
          target.status = 'pending'
          OR (target.status = 'applying' AND target.decided_at < DATEADD(minute, -5, @claimedAt))
        )
        AND (
          target.action <> 'revoke'
          OR target.role_value NOT IN ('OCC.Admin', 'OCC.AccessAdmin')
          OR NOT EXISTS (
            SELECT 1 FROM AccessManagementChanges AS guard WITH (UPDLOCK, HOLDLOCK)
            WHERE guard.environment = @environment AND guard.status = 'applying'
              AND guard.action = 'revoke' AND guard.role_value IN ('OCC.Admin', 'OCC.AccessAdmin')
              AND guard.id <> @id
          )
        );
      COMMIT TRANSACTION;
    `);
    return result.recordset.length === 1;
  }

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

  async recordMetadata(
    change: DirectoryChange,
    environment: string,
    actor: string,
    changedAt: string,
    result: DirectoryChangeResult,
  ): Promise<void> {
    const request = (await getPool()).request();
    const principalId = result.principal_id ?? change.principal_id;
    request.input("environment", sql.NVarChar(30), environment);
    request.input("principalId", sql.NVarChar(200), principalId);
    request.input("principalType", sql.NVarChar(30), change.principal_type);
    request.input("role", sql.NVarChar(100), change.role);
    request.input("source", sql.NVarChar(20), change.source);
    request.input("sourceId", sql.NVarChar(200), change.source_id ?? null);
    request.input("reason", sql.NVarChar(1000), change.reason);
    request.input("sponsor", sql.NVarChar(320), change.sponsor ?? null);
    request.input("organization", sql.NVarChar(320), change.organization ?? null);
    request.input("expiresAt", sql.DateTime2, change.expires_at ? new Date(change.expires_at) : null);
    request.input("status", sql.NVarChar(30), result.status === "pending_verification" ? "pending_verification" : "active");
    request.input("correlationId", sql.NVarChar(200), result.correlation_id);
    request.input("actor", sql.NVarChar(320), actor);
    request.input("changedAt", sql.DateTime2, new Date(changedAt));
    if (change.action === "revoke") {
      await request.query(`
        UPDATE AccessManagementMetadata
        SET status = 'revoked', last_correlation_id = @correlationId,
            updated_by = @actor, updated_at = @changedAt
        WHERE environment = @environment AND principal_id = @principalId
          AND role_value = @role AND assignment_source = @source
          AND (@sourceId IS NULL OR assignment_source_id = @sourceId) AND status <> 'revoked'
      `);
      return;
    }
    await request.query(`
      DECLARE @existing UNIQUEIDENTIFIER = (
        SELECT TOP 1 id FROM AccessManagementMetadata
        WHERE environment = @environment AND principal_id = @principalId
          AND role_value = @role AND assignment_source = @source
          AND (@sourceId IS NULL OR assignment_source_id = @sourceId) AND status <> 'revoked'
        ORDER BY created_at DESC
      );
      IF @existing IS NULL
        INSERT AccessManagementMetadata (
          environment, principal_id, principal_type, role_value, assignment_source, assignment_source_id,
          reason, sponsor, organization, expires_at, status, last_correlation_id,
          created_by, created_at, updated_by, updated_at
        ) VALUES (
          @environment, @principalId, @principalType, @role, @source, @sourceId,
          @reason, @sponsor, @organization, @expiresAt, @status, @correlationId,
          @actor, @changedAt, @actor, @changedAt
        );
      ELSE
        UPDATE AccessManagementMetadata
        SET assignment_source_id = @sourceId, reason = @reason, sponsor = @sponsor, organization = @organization,
            expires_at = @expiresAt, status = @status, last_correlation_id = @correlationId,
            updated_by = @actor, updated_at = @changedAt
        WHERE id = @existing;
    `);
  }

  async listDueExpirations(environment: string, asOf: string): Promise<AccessMetadata[]> {
    const metadata = await this.listMetadata(environment);
    const deadline = new Date(asOf).valueOf();
    return metadata.filter((item) =>
      item.expires_at !== null
      && new Date(item.expires_at).valueOf() <= deadline
      && (
        item.status === "active"
        || item.status === "pending_verification"
        || item.status === "expiry_failed"
        || (item.status === "expiring" && !!item.updated_at && new Date(item.updated_at).valueOf() <= deadline - 5 * 60 * 1000)
      ),
    );
  }

  async claimMetadataExpiry(id: string, environment: string, actor: string, claimedAt: string): Promise<boolean> {
    const request = (await getPool()).request();
    request.input("id", sql.UniqueIdentifier, id);
    request.input("environment", sql.NVarChar(30), environment);
    request.input("actor", sql.NVarChar(320), actor);
    request.input("claimedAt", sql.DateTime2, new Date(claimedAt));
    const result = await request.query<{ id: string }>(`
      UPDATE AccessManagementMetadata
      SET status = 'expiring', updated_by = @actor, updated_at = @claimedAt
      OUTPUT INSERTED.id
      WHERE id = @id AND environment = @environment
        AND (
          status IN ('active', 'pending_verification', 'expiry_failed')
          OR (status = 'expiring' AND updated_at < DATEADD(minute, -5, @claimedAt))
        )
    `);
    return result.recordset.length === 1;
  }

  async markMetadataStatus(
    id: string,
    status: AccessMetadata["status"],
    actor: string,
    changedAt: string,
    correlationId: string | null,
  ): Promise<void> {
    const request = (await getPool()).request();
    request.input("id", sql.UniqueIdentifier, id);
    request.input("status", sql.NVarChar(30), status);
    request.input("actor", sql.NVarChar(320), actor);
    request.input("changedAt", sql.DateTime2, new Date(changedAt));
    request.input("correlationId", sql.NVarChar(200), correlationId);
    await request.query(`
      UPDATE AccessManagementMetadata
      SET status = @status, updated_by = @actor, updated_at = @changedAt,
          last_correlation_id = @correlationId
      WHERE id = @id AND status = 'expiring'
    `);
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
