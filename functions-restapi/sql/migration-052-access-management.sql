SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF OBJECT_ID('dbo.AccessManagementChanges', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.AccessManagementChanges (
        id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
        environment NVARCHAR(30) NOT NULL,
        action NVARCHAR(30) NOT NULL,
        principal_id NVARCHAR(200) NOT NULL,
        principal_type NVARCHAR(30) NOT NULL,
        role_value NVARCHAR(100) NOT NULL,
        assignment_source NVARCHAR(20) NOT NULL,
        assignment_source_id NVARCHAR(200) NULL,
        reason NVARCHAR(1000) NOT NULL,
        sponsor NVARCHAR(320) NULL,
        organization NVARCHAR(320) NULL,
        expires_at DATETIME2 NULL,
        status NVARCHAR(30) NOT NULL,
        requested_by_id NVARCHAR(200) NOT NULL,
        requested_by_name NVARCHAR(320) NOT NULL,
        requested_at DATETIME2 NOT NULL,
        approval_expires_at DATETIME2 NOT NULL,
        decided_by_id NVARCHAR(200) NULL,
        decided_by_name NVARCHAR(320) NULL,
        decided_at DATETIME2 NULL,
        result_json NVARCHAR(MAX) NULL,
        CONSTRAINT CK_AccessManagementChanges_Action CHECK (action IN ('grant', 'revoke', 'invite_guest')),
        CONSTRAINT CK_AccessManagementChanges_PrincipalType CHECK (principal_type IN ('user', 'group', 'service_principal')),
        CONSTRAINT CK_AccessManagementChanges_Source CHECK (assignment_source IN ('group', 'direct')),
        CONSTRAINT CK_AccessManagementChanges_Status CHECK (status IN ('pending', 'applying', 'approved', 'rejected', 'cancelled', 'expired', 'failed')),
        CONSTRAINT CK_AccessManagementChanges_ResultJson CHECK (result_json IS NULL OR ISJSON(result_json) = 1)
    );
    CREATE INDEX IX_AccessManagementChanges_Pending
        ON dbo.AccessManagementChanges(environment, status, requested_at);
END;

IF OBJECT_ID('dbo.AccessManagementAudit', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.AccessManagementAudit (
        id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
        environment NVARCHAR(30) NOT NULL,
        actor_id NVARCHAR(200) NOT NULL,
        actor_name NVARCHAR(320) NOT NULL,
        action NVARCHAR(100) NOT NULL,
        target_id NVARCHAR(200) NULL,
        reason NVARCHAR(1000) NULL,
        outcome NVARCHAR(50) NOT NULL,
        correlation_id NVARCHAR(200) NULL,
        occurred_at DATETIME2 NOT NULL,
        details_json NVARCHAR(MAX) NULL,
        CONSTRAINT CK_AccessManagementAudit_DetailsJson CHECK (details_json IS NULL OR ISJSON(details_json) = 1)
    );
    CREATE INDEX IX_AccessManagementAudit_EnvironmentTime
        ON dbo.AccessManagementAudit(environment, occurred_at DESC);
END;

IF OBJECT_ID('dbo.AccessManagementOperations', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.AccessManagementOperations (
        environment NVARCHAR(30) NOT NULL,
        idempotency_key NVARCHAR(200) NOT NULL,
        request_hash NVARCHAR(64) NOT NULL,
        status NVARCHAR(20) NOT NULL,
        response_json NVARCHAR(MAX) NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_AccessManagementOperations PRIMARY KEY (environment, idempotency_key),
        CONSTRAINT CK_AccessManagementOperations_Status CHECK (status IN ('in_progress', 'completed')),
        CONSTRAINT CK_AccessManagementOperations_ResponseJson CHECK (response_json IS NULL OR ISJSON(response_json) = 1)
    );
END;

IF OBJECT_ID('dbo.AccessManagementMetadata', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.AccessManagementMetadata (
        id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
        environment NVARCHAR(30) NOT NULL,
        principal_id NVARCHAR(200) NOT NULL,
        principal_type NVARCHAR(30) NOT NULL,
        role_value NVARCHAR(100) NOT NULL,
        assignment_source NVARCHAR(20) NOT NULL,
        assignment_source_id NVARCHAR(200) NULL,
        reason NVARCHAR(1000) NOT NULL,
        sponsor NVARCHAR(320) NULL,
        organization NVARCHAR(320) NULL,
        expires_at DATETIME2 NULL,
        status NVARCHAR(30) NOT NULL,
        last_correlation_id NVARCHAR(200) NULL,
        created_by NVARCHAR(320) NOT NULL,
        created_at DATETIME2 NOT NULL,
        updated_by NVARCHAR(320) NOT NULL,
        updated_at DATETIME2 NOT NULL,
        CONSTRAINT CK_AccessManagementMetadata_Status CHECK (status IN ('active', 'pending_verification', 'expiring', 'revoked', 'expiry_failed'))
    );
    CREATE INDEX IX_AccessManagementMetadata_Expiry
        ON dbo.AccessManagementMetadata(environment, status, expires_at);
END;

IF OBJECT_ID('dbo.AccessManagementGuestInvitations', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.AccessManagementGuestInvitations (
        environment NVARCHAR(30) NOT NULL,
        email NVARCHAR(320) NOT NULL,
        principal_id NVARCHAR(200) NULL,
        invitation_correlation_id NVARCHAR(200) NULL,
        status NVARCHAR(30) NOT NULL,
        created_at DATETIME2 NOT NULL,
        updated_at DATETIME2 NOT NULL,
        CONSTRAINT PK_AccessManagementGuestInvitations PRIMARY KEY (environment, email),
        CONSTRAINT CK_AccessManagementGuestInvitations_Status CHECK (status IN ('inviting', 'invited', 'assigned', 'assignment_failed'))
    );
END;

COMMIT TRANSACTION;
