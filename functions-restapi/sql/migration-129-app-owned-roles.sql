-- Migration 129: OnBoard owns its roles (ADR-0032, increment 1).
--
-- Entra keeps deciding who may sign in. What a signed-in person may do moves
-- here: a Role is a row, its grid of module actions is a row per action, and a
-- Role Grant names a person by Entra object id. Nothing enforces these tables
-- yet - increment 1 only reads them, through GET /api/me/access - so applying
-- this migration changes no one's access.
--
-- 1. AccessPeople: one row per human OnBoard knows, keyed by Entra object id
--    and tenant id. It is not a login account and holds no credential; Entra
--    still authenticates, and a disabled Entra account cannot sign in whatever
--    this table says.
-- 2. AccessRoles / AccessRoleActions: the nine seeded roles and their actions.
--    `all_actions` is System Administrator's flag: every action outside
--    Access & Identity, including actions added to the catalog later, which a
--    list of rows could not express. `is_locked` marks the two roles that
--    cannot be edited or deleted (System Administrator, Access Administrator).
--    `is_seeded` records that the role shipped with OnBoard; a seeded role is
--    still editable unless it is locked.
-- 3. AccessRoleGrants: a person holds a role until it is revoked or expires.
--    `scope` is reserved for a later agreement- or contractor-limited grant
--    (ADR-0032) and every grant written today leaves it NULL.
--
-- Roles are editable, so the seeds are inserted only when missing. Re-running
-- this migration never overwrites an Access Administrator's edits, and never
-- restores a role they archived.
--
-- Rows written here carry created_by 'migration 129' (see sql/README.md).

IF OBJECT_ID('dbo.AccessPeople', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.AccessPeople (
    person_id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_AccessPeople PRIMARY KEY DEFAULT NEWID(),
    entra_object_id NVARCHAR(64) NOT NULL,
    entra_tenant_id NVARCHAR(64) NULL,
    display_name NVARCHAR(200) NULL,
    email NVARCHAR(320) NULL,
    status NVARCHAR(20) NOT NULL CONSTRAINT DF_AccessPeople_status DEFAULT 'active',
    created_at DATETIME2 NOT NULL CONSTRAINT DF_AccessPeople_created DEFAULT SYSUTCDATETIME(),
    created_by NVARCHAR(200) NULL,
    last_seen_at DATETIME2 NULL,
    CONSTRAINT CK_AccessPeople_status CHECK (status IN ('active', 'suspended')),
    CONSTRAINT UQ_AccessPeople_object UNIQUE (entra_object_id)
  );
END;
GO

IF OBJECT_ID('dbo.AccessRoles', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.AccessRoles (
    role_key NVARCHAR(64) NOT NULL CONSTRAINT PK_AccessRoles PRIMARY KEY,
    name NVARCHAR(100) NOT NULL,
    purpose NVARCHAR(400) NULL,
    is_locked BIT NOT NULL CONSTRAINT DF_AccessRoles_locked DEFAULT 0,
    all_actions BIT NOT NULL CONSTRAINT DF_AccessRoles_all DEFAULT 0,
    is_seeded BIT NOT NULL CONSTRAINT DF_AccessRoles_seeded DEFAULT 0,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_AccessRoles_created DEFAULT SYSUTCDATETIME(),
    created_by NVARCHAR(200) NULL,
    updated_at DATETIME2 NULL,
    updated_by NVARCHAR(200) NULL,
    archived_at DATETIME2 NULL,
    archived_by NVARCHAR(200) NULL,
    CONSTRAINT UQ_AccessRoles_name UNIQUE (name)
  );
END;
GO

IF OBJECT_ID('dbo.AccessRoleActions', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.AccessRoleActions (
    role_key NVARCHAR(64) NOT NULL,
    action_key NVARCHAR(100) NOT NULL,
    CONSTRAINT PK_AccessRoleActions PRIMARY KEY (role_key, action_key),
    CONSTRAINT FK_AccessRoleActions_role FOREIGN KEY (role_key)
      REFERENCES dbo.AccessRoles (role_key) ON DELETE CASCADE
  );
END;
GO

IF OBJECT_ID('dbo.AccessRoleGrants', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.AccessRoleGrants (
    grant_id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_AccessRoleGrants PRIMARY KEY DEFAULT NEWID(),
    person_id UNIQUEIDENTIFIER NOT NULL,
    role_key NVARCHAR(64) NOT NULL,
    scope NVARCHAR(100) NULL,
    granted_at DATETIME2 NOT NULL CONSTRAINT DF_AccessRoleGrants_granted DEFAULT SYSUTCDATETIME(),
    granted_by NVARCHAR(200) NULL,
    approved_by NVARCHAR(200) NULL,
    expires_at DATETIME2 NULL,
    revoked_at DATETIME2 NULL,
    revoked_by NVARCHAR(200) NULL,
    revoke_reason NVARCHAR(400) NULL,
    CONSTRAINT FK_AccessRoleGrants_person FOREIGN KEY (person_id) REFERENCES dbo.AccessPeople (person_id),
    CONSTRAINT FK_AccessRoleGrants_role FOREIGN KEY (role_key) REFERENCES dbo.AccessRoles (role_key)
  );
  -- One live grant of a role to a person. A revoked grant stays as history.
  CREATE UNIQUE INDEX UX_AccessRoleGrants_live
    ON dbo.AccessRoleGrants (person_id, role_key, scope) WHERE revoked_at IS NULL;
  CREATE INDEX IX_AccessRoleGrants_person ON dbo.AccessRoleGrants (person_id) INCLUDE (role_key);
END;
GO

-- The nine seeded roles. Inserted only when the role_key is missing.
DECLARE @seed TABLE (
  role_key NVARCHAR(64),
  name NVARCHAR(100),
  purpose NVARCHAR(400),
  is_locked BIT,
  all_actions BIT
);
INSERT @seed (role_key, name, purpose, is_locked, all_actions) VALUES
 ('viewer', 'Viewer', 'Reads operations without changing anything.', 0, 0),
 ('publisher', 'Publisher', 'Runs day-to-day service communications and detours.', 0, 0),
 ('detour-editor', 'Detour Editor', 'Records and maintains detours, and nothing else.', 0, 0),
 ('event-avl-operator', 'Event AVL Operator', 'Monitors events and sends event messages and notifications.', 0, 0),
 ('compliance-analyst', 'Compliance Analyst', 'Reviews service compliance and prepares performance assessments.', 0, 0),
 ('compliance-manager', 'Compliance Manager', 'Decides assessments: finalizing, reopening, issuing and exceptions.', 0, 0),
 ('trip-start-verifier', 'Trip Start Verifier', 'Reads the Dispatch Log and records trip-start verifications.', 0, 0),
 ('system-administrator', 'System Administrator', 'Operates and configures everything except access itself.', 1, 1),
 ('access-administrator', 'Access Administrator', 'Grants OnBoard access, edits roles and approves privileged changes.', 1, 0);

DECLARE @seedActions TABLE (role_key NVARCHAR(64), action_key NVARCHAR(100));
INSERT @seedActions (role_key, action_key) VALUES
 ('viewer', 'dashboard.view'),
 ('viewer', 'rider-alerts.view'),
 ('viewer', 'service-risk.view'),
 ('viewer', 'dispatch-log.view'),
 ('viewer', 'detours.view'),
 ('viewer', 'decision-matrix.view'),
 ('viewer', 'event-avl.view'),
 ('viewer', 'compliance-review.view'),
 ('viewer', 'performance-assessment.view'),
 ('publisher', 'dashboard.view'),
 ('publisher', 'rider-alerts.view'),
 ('publisher', 'service-risk.view'),
 ('publisher', 'dispatch-log.view'),
 ('publisher', 'detours.view'),
 ('publisher', 'decision-matrix.view'),
 ('publisher', 'event-avl.view'),
 ('publisher', 'compliance-review.view'),
 ('publisher', 'performance-assessment.view'),
 ('publisher', 'rider-alerts.publish'),
 ('publisher', 'service-risk.resolve'),
 ('publisher', 'detours.edit'),
 ('publisher', 'detours.delete'),
 ('publisher', 'event-avl.notify'),
 ('detour-editor', 'detours.view'),
 ('detour-editor', 'detours.edit'),
 ('event-avl-operator', 'dashboard.view'),
 ('event-avl-operator', 'rider-alerts.view'),
 ('event-avl-operator', 'event-avl.view'),
 ('event-avl-operator', 'event-avl.message'),
 ('event-avl-operator', 'event-avl.notify'),
 ('compliance-analyst', 'compliance-review.view'),
 ('compliance-analyst', 'performance-assessment.view'),
 ('compliance-analyst', 'detours.view'),
 ('compliance-analyst', 'dispatch-log.view'),
 ('compliance-analyst', 'compliance-review.review'),
 ('compliance-analyst', 'performance-assessment.work'),
 ('compliance-manager', 'compliance-review.view'),
 ('compliance-manager', 'performance-assessment.view'),
 ('compliance-manager', 'detours.view'),
 ('compliance-manager', 'dispatch-log.view'),
 ('compliance-manager', 'compliance-review.review'),
 ('compliance-manager', 'performance-assessment.work'),
 ('compliance-manager', 'performance-assessment.decide'),
 ('trip-start-verifier', 'dispatch-log.view'),
 ('trip-start-verifier', 'dispatch-log.verify'),
 ('access-administrator', 'access-identity.view'),
 ('access-administrator', 'subscribers.view'),
 ('access-administrator', 'governance-audit.view'),
 ('access-administrator', 'access-identity.manage'),
 ('access-administrator', 'access-identity.approve');

INSERT dbo.AccessRoles (role_key, name, purpose, is_locked, all_actions, is_seeded, created_by)
SELECT s.role_key, s.name, s.purpose, s.is_locked, s.all_actions, 1, 'migration 129'
FROM @seed s
WHERE NOT EXISTS (SELECT 1 FROM dbo.AccessRoles r WHERE r.role_key = s.role_key);

-- Actions are seeded only for a role this migration has just created, so an
-- action an Access Administrator removed does not come back on a re-run.
INSERT dbo.AccessRoleActions (role_key, action_key)
SELECT a.role_key, a.action_key
FROM @seedActions a
JOIN dbo.AccessRoles r ON r.role_key = a.role_key AND r.created_by = 'migration 129' AND r.updated_at IS NULL
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.AccessRoleActions x WHERE x.role_key = a.role_key AND x.action_key = a.action_key
);
GO

-- The first Access Administrator. Paste the Entra object id (and tenant id) of
-- the person who will hold it, then run this batch; it is skipped while the
-- placeholder is in place, and running it twice grants nothing twice.
-- Until this grant exists, ONBOARD_ACCESS_ADMIN_FALLBACK is what lets an
-- OCC.Admin reach Access & Identity.
DECLARE @firstAccessAdminObjectId NVARCHAR(64) = 'PASTE-ENTRA-OBJECT-ID';
DECLARE @firstAccessAdminTenantId NVARCHAR(64) = NULL;
DECLARE @firstAccessAdminName NVARCHAR(200) = NULL;

IF @firstAccessAdminObjectId <> 'PASTE-ENTRA-OBJECT-ID'
BEGIN
  IF NOT EXISTS (SELECT 1 FROM dbo.AccessPeople WHERE entra_object_id = @firstAccessAdminObjectId)
    INSERT dbo.AccessPeople (entra_object_id, entra_tenant_id, display_name, created_by)
    VALUES (@firstAccessAdminObjectId, @firstAccessAdminTenantId, @firstAccessAdminName, 'migration 129');

  DECLARE @personId UNIQUEIDENTIFIER =
    (SELECT person_id FROM dbo.AccessPeople WHERE entra_object_id = @firstAccessAdminObjectId);

  IF NOT EXISTS (
    SELECT 1 FROM dbo.AccessRoleGrants
    WHERE person_id = @personId AND role_key = 'access-administrator' AND revoked_at IS NULL
  )
    INSERT dbo.AccessRoleGrants (person_id, role_key, granted_by)
    VALUES (@personId, 'access-administrator', 'migration 129');

  PRINT 'Migration 129: first Access Administrator granted.';
END
ELSE
  PRINT 'Migration 129: tables and roles are in place. No Access Administrator was granted - edit @firstAccessAdminObjectId and re-run to grant one.';
GO
