-- Migration 167b: the attribution and excusable authorities (plan step 0.8,
-- ADR 0032, ADR 0048).
--
-- MVTA, 2026-11-06: "A transportation specialist reviews, managers decide
-- attribution, the COO decides if it is excusable; all are MVTA staff."
--
--   compliance-review.review    - unchanged holders (Compliance Analyst,
--                                 Compliance Manager); now records the
--                                 outcome only.
--   compliance-review.attribute - contractor error or MVTA-directed:
--                                 Compliance Manager.
--   compliance-review.excuse    - excusable: the new Excusability Authority
--                                 role, and nobody else.
--
-- Same patterns as migrations 159 and 164: the role is inserted only when its
-- key is missing and its actions only for a role this migration just created;
-- attribute is added only while no role holds it yet. An Access
-- Administrator's later edits survive a re-run. seeds.ts carries the same;
-- access.db.contract.test.ts fails if they disagree.
--
-- System Administrator holds both through its all-actions flag (ADR-0032).
--
-- Seeding grants the roles to nobody. Granting Compliance Manager to the
-- managers and Excusability Authority to the COO is a separate, explicit step
-- (PR description; the names are question F7).
--
-- Re-runnable.

SET NOCOUNT ON;
GO

IF OBJECT_ID('dbo.AccessRoles', 'U') IS NULL OR OBJECT_ID('dbo.AccessRoleActions', 'U') IS NULL
  THROW 50167, 'Migration 167b requires AccessRoles and AccessRoleActions (migration 129).', 1;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.AccessRoleActions WHERE action_key = 'compliance-review.attribute')
  INSERT dbo.AccessRoleActions (role_key, action_key)
  SELECT r.role_key, 'compliance-review.attribute'
  FROM dbo.AccessRoles r
  WHERE r.role_key = 'compliance-manager';
GO

INSERT dbo.AccessRoles (role_key, name, purpose, is_locked, all_actions, is_seeded, created_by)
SELECT 'excusability-authority', 'Excusability Authority',
  'Decides whether a confirmed service failure was excusable. MVTA gives this to the COO.', 0, 0, 1, 'migration 167b'
WHERE NOT EXISTS (SELECT 1 FROM dbo.AccessRoles r WHERE r.role_key = 'excusability-authority');

INSERT dbo.AccessRoleActions (role_key, action_key)
SELECT r.role_key, a.action_key
FROM dbo.AccessRoles r
CROSS JOIN (VALUES ('compliance-review.view'), ('performance-assessment.view'), ('compliance-review.excuse')) a(action_key)
WHERE r.role_key = 'excusability-authority' AND r.created_by = 'migration 167b' AND r.updated_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM dbo.AccessRoleActions x WHERE x.role_key = r.role_key AND x.action_key = a.action_key);
GO

PRINT 'Migration 167b: compliance-review.attribute seeded on Compliance Manager; Excusability Authority role seeded (granted to nobody).';
GO
