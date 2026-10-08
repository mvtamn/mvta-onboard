-- Migration 130: the history of a Role (ADR-0032, increment 4).
--
-- Roles became editable records in migration 129. Editing what a role grants
-- changes what people holding it may do, so every create, edit and archive is
-- recorded here with the grid before and after it. The Roles page reads it, and
-- it answers the question the old Entra app roles could not: who widened this
-- role, and when.
--
-- It is deliberately its own table rather than a row in AccessManagementAudit:
-- that table belongs to the Graph-era access management flow, keyed by an
-- environment name from a setting increment 6 retires. Grants join this history
-- in increment 5.
--
-- Re-runnable: the table is created only when missing.

IF OBJECT_ID('dbo.AccessRoles', 'U') IS NULL
  THROW 50130, 'Migration 130 requires migration 129 (AccessRoles).', 1;
GO

IF OBJECT_ID('dbo.AccessRoleHistory', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.AccessRoleHistory (
    history_id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_AccessRoleHistory PRIMARY KEY DEFAULT NEWID(),
    role_key NVARCHAR(64) NOT NULL,
    -- 'created', 'updated' or 'archived'. A restore is an 'updated'.
    change NVARCHAR(20) NOT NULL,
    actor_object_id NVARCHAR(64) NULL,
    actor_name NVARCHAR(320) NULL,
    occurred_at DATETIME2 NOT NULL CONSTRAINT DF_AccessRoleHistory_at DEFAULT SYSUTCDATETIME(),
    -- The role as it was and as it became: { name, purpose, actions: [...] }.
    -- Kept as documents because the point is what the grid looked like, not a
    -- queryable shape; NULL before a create and after nothing changed.
    before_json NVARCHAR(MAX) NULL,
    after_json NVARCHAR(MAX) NULL,
    note NVARCHAR(400) NULL,
    CONSTRAINT CK_AccessRoleHistory_change CHECK (change IN ('created', 'updated', 'archived')),
    CONSTRAINT CK_AccessRoleHistory_before CHECK (before_json IS NULL OR ISJSON(before_json) = 1),
    CONSTRAINT CK_AccessRoleHistory_after CHECK (after_json IS NULL OR ISJSON(after_json) = 1)
  );
  CREATE INDEX IX_AccessRoleHistory_role ON dbo.AccessRoleHistory (role_key, occurred_at DESC);
END;
GO
