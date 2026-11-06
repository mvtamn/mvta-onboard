-- Migration 164: the Count Sheet scan actions (ADR 0032, ADR 0043,
-- plans/count-sheet-scan-upload.md §1 and §5). Goes with migration 163.
--
--   * ridership.scan       - upload scans and assign unreadable pages:
--                            Ridership Printer (the desk), Recorder, Manager.
--                            Uploading shows page outcomes, never images.
--   * ridership.scans.view - open the page images, which show the operator's
--                            name and handwriting (spec §10): Ridership
--                            Recorder, Ridership Manager, Compliance Analyst
--                            and Compliance Manager. Not the desk.
--
-- Unlike migrations 154 and 159, this adds actions to roles that already
-- exist. Each action is added only while no role holds it yet, so an Access
-- Administrator who later takes it away from a role does not see it come back
-- on a re-run. seeds.ts carries the same actions; access.db.contract.test.ts
-- fails if they disagree.
--
-- Seeding grants the roles to nobody. Giving the Burnsville desk staff the
-- Ridership Printer role is a separate step (PR description).
--
-- Re-runnable.

SET NOCOUNT ON;
GO

IF OBJECT_ID('dbo.AccessRoles', 'U') IS NULL OR OBJECT_ID('dbo.AccessRoleActions', 'U') IS NULL
  THROW 50164, 'Migration 164 requires AccessRoles and AccessRoleActions (migration 129).', 1;
GO

-- ridership.scan: the desk, the recorder and the manager.
IF NOT EXISTS (SELECT 1 FROM dbo.AccessRoleActions WHERE action_key = 'ridership.scan')
  INSERT dbo.AccessRoleActions (role_key, action_key)
  SELECT r.role_key, 'ridership.scan'
  FROM dbo.AccessRoles r
  WHERE r.role_key IN ('ridership-printer', 'ridership-recorder', 'ridership-manager');
GO

-- ridership.scans.view: the recorder, the manager and the compliance roles; not the desk.
IF NOT EXISTS (SELECT 1 FROM dbo.AccessRoleActions WHERE action_key = 'ridership.scans.view')
  INSERT dbo.AccessRoleActions (role_key, action_key)
  SELECT r.role_key, 'ridership.scans.view'
  FROM dbo.AccessRoles r
  WHERE r.role_key IN ('ridership-recorder', 'ridership-manager', 'compliance-analyst', 'compliance-manager');
GO

PRINT 'Migration 164: ridership.scan and ridership.scans.view seeded.';
GO
