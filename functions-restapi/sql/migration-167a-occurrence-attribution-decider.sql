-- Migration 167a: who decided an occurrence's Service attribution, and when
-- (plan step 0.8, ADR 0048).
--
-- Until now the person who reviewed a missed trip set its attribution in the
-- same act, so reviewed_by answered both questions. MVTA separates them: a
-- transportation specialist records the outcome (reviewed_by), a manager
-- records attribution, and the COO alone decides excusable. attributed_by /
-- attributed_at record that second decision. They are NULL while attribution
-- is 'undetermined'.
--
-- Existing rows already attributed are stamped with whoever set it then: the
-- reviewer (reviewed_by) or, for a hand-entered occurrence, whoever entered it
-- (created_by). That is who decided it, under the old single authority.
--
-- Goes with 167b, which seeds the actions. lib/occurrenceIntake reads these
-- columns and treats their absence as schema_not_ready, so a review still
-- saves before this runs and the assessment hand-off says why it did not land.
--
-- Re-runnable.

SET NOCOUNT ON;
GO

IF OBJECT_ID('dbo.ComplianceOccurrences', 'U') IS NULL
  THROW 50167, 'Migration 167a requires ComplianceOccurrences (migration 030).', 1;
GO

IF COL_LENGTH('dbo.ComplianceOccurrences', 'attributed_by') IS NULL
  ALTER TABLE dbo.ComplianceOccurrences ADD attributed_by NVARCHAR(200) NULL, attributed_at DATETIME2 NULL;
GO

UPDATE dbo.ComplianceOccurrences
SET attributed_by = COALESCE(reviewed_by, created_by),
    attributed_at = COALESCE(reviewed_at, created_at)
WHERE attribution <> N'undetermined' AND attributed_by IS NULL;
GO

PRINT 'Migration 167a: ComplianceOccurrences.attributed_by / attributed_at added and stamped.';
GO
