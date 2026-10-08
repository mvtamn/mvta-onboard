-- Migration 131: granting and revoking OnBoard access (ADR-0032, increment 5).
--
-- Migration 129 stored the grants themselves. This adds the decision in front
-- of a privileged one, and the few facts about a person that only access
-- administration cares about.
--
-- 1. AccessGrantRequests: a grant or revocation waiting on a second Access
--    Administrator. An ordinary grant never lands here - it is written
--    straight to AccessRoleGrants - but a Privileged Access Change (a locked
--    role, or a role holding an Access & Identity action) does, and stays
--    pending until somebody other than the requester decides it or the
--    24-hour window passes.
--
--    It is deliberately not AccessManagementChanges (migration 052): that
--    table is keyed by an environment name and an Entra assignment source,
--    and its handler applies decisions by writing Microsoft Graph. Both
--    retire at increment 6. This one names a person and a Role in OnBoard.
--
-- 2. AccessPeople.kind: 'member' or 'guest'. A guest's OnBoard access is
--    still sponsored and time-limited; the invitation itself remains an Entra
--    act, so sponsor, organization and justification travel with the row.
-- 3. AccessPeople.imported_from: how a person's first grant arrived, so the
--    one-time import from Entra can be told apart from a deliberate grant.
--
-- Re-runnable: the table and each column are added only when missing.

IF OBJECT_ID('dbo.AccessPeople', 'U') IS NULL OR OBJECT_ID('dbo.AccessRoleGrants', 'U') IS NULL
  THROW 50131, 'Migration 131 requires migration 129 (AccessPeople, AccessRoleGrants).', 1;
GO

IF COL_LENGTH('dbo.AccessPeople', 'kind') IS NULL
  ALTER TABLE dbo.AccessPeople ADD kind NVARCHAR(20) NOT NULL CONSTRAINT DF_AccessPeople_kind DEFAULT 'member';
IF COL_LENGTH('dbo.AccessPeople', 'sponsor_name') IS NULL
  ALTER TABLE dbo.AccessPeople ADD sponsor_name NVARCHAR(320) NULL;
IF COL_LENGTH('dbo.AccessPeople', 'organization') IS NULL
  ALTER TABLE dbo.AccessPeople ADD organization NVARCHAR(320) NULL;
IF COL_LENGTH('dbo.AccessPeople', 'justification') IS NULL
  ALTER TABLE dbo.AccessPeople ADD justification NVARCHAR(1000) NULL;
IF COL_LENGTH('dbo.AccessPeople', 'imported_from') IS NULL
  ALTER TABLE dbo.AccessPeople ADD imported_from NVARCHAR(100) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_AccessPeople_kind')
  ALTER TABLE dbo.AccessPeople ADD CONSTRAINT CK_AccessPeople_kind CHECK (kind IN ('member', 'guest'));
GO

IF OBJECT_ID('dbo.AccessGrantRequests', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.AccessGrantRequests (
    request_id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_AccessGrantRequests PRIMARY KEY DEFAULT NEWID(),
    person_id UNIQUEIDENTIFIER NOT NULL,
    role_key NVARCHAR(64) NOT NULL,
    action NVARCHAR(20) NOT NULL,
    reason NVARCHAR(1000) NOT NULL,
    expires_at DATETIME2 NULL,
    status NVARCHAR(20) NOT NULL CONSTRAINT DF_AccessGrantRequests_status DEFAULT 'pending',
    requested_by_object_id NVARCHAR(64) NULL,
    requested_by_name NVARCHAR(320) NULL,
    requested_at DATETIME2 NOT NULL CONSTRAINT DF_AccessGrantRequests_at DEFAULT SYSUTCDATETIME(),
    -- A decision taken later than this is refused: an approval is a judgement
    -- about a situation, and the situation goes stale.
    approval_expires_at DATETIME2 NOT NULL,
    decided_by_object_id NVARCHAR(64) NULL,
    decided_by_name NVARCHAR(320) NULL,
    decided_at DATETIME2 NULL,
    decision_reason NVARCHAR(1000) NULL,
    applied_grant_id UNIQUEIDENTIFIER NULL,
    CONSTRAINT FK_AccessGrantRequests_person FOREIGN KEY (person_id) REFERENCES dbo.AccessPeople (person_id),
    CONSTRAINT FK_AccessGrantRequests_role FOREIGN KEY (role_key) REFERENCES dbo.AccessRoles (role_key),
    CONSTRAINT CK_AccessGrantRequests_action CHECK (action IN ('grant', 'revoke')),
    CONSTRAINT CK_AccessGrantRequests_status
      CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'expired'))
  );
  -- One live request per person and role: a second Approve on the same pair is
  -- the same decision, not another one.
  CREATE UNIQUE INDEX UX_AccessGrantRequests_pending
    ON dbo.AccessGrantRequests (person_id, role_key, action) WHERE status = 'pending';
  CREATE INDEX IX_AccessGrantRequests_status ON dbo.AccessGrantRequests (status, requested_at DESC);
END;
GO
