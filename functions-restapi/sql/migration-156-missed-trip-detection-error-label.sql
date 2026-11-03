-- Migration 156: the missed-trip reason "Detection error (false positive)"
-- says what the outcome is called.
--
-- The outcome a reviewer records when the trip ran has been Timely service
-- since migration 125; CONTEXT.md lists "false positive" under Avoid. The
-- reason list (OtpReasonCodes, seeded by migration 023) still offered it under
-- the old name. Only the label changes: the code stays DETECTION_ERROR, so
-- every review that cites it reads the new words.
--
-- Reason codes are editable in Administration, so a label someone has already
-- changed is left alone. Re-runnable.

SET NOCOUNT ON;
GO

IF OBJECT_ID('dbo.OtpReasonCodes', 'U') IS NULL
  THROW 50156, 'Migration 156 requires OtpReasonCodes (migration 023).', 1;
GO

UPDATE dbo.OtpReasonCodes
SET label = N'Detection error — the trip ran'
WHERE code = N'DETECTION_ERROR'
  AND applies_to = N'missed_trip'
  AND label = N'Detection error (false positive)';
GO

PRINT 'Migration 156 applied: missed-trip reason DETECTION_ERROR reads "Detection error — the trip ran".';
