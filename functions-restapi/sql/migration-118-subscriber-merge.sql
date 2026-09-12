-- Migration 118: a subscriber record can be merged into another.
--
-- Closes CURRENT_STATE section 7.5. The phone and email indexes are
-- non-unique, so opting in twice with the same contact creates two records.
-- That has been harmless only because nothing could ever confirm one; the
-- moment confirmation works (increment 3), the same person receives every
-- alert twice, once per record.
--
-- WHY NOT A UNIQUE INDEX ON THE CONTACT. It would refuse the second opt-in,
-- and the second opt-in is not a mistake: a rider re-subscribing with a longer
-- category list has said something new. It would also refuse it at a moment
-- when nobody has proved they own the contact, so a stranger typing someone
-- else's number could block that person from ever subscribing. Duplicates are
-- resolved instead at the only moment the contact is proven - confirmation -
-- which is where increment 4 of plans/rider-opt-in-confirmation-loop-spec.md
-- does it.
--
-- WHY A STATUS RATHER THAN A DELETE. The merged record's confirmations, and
-- its delivery history, refer to it by id. Deleting the row breaks that, and
-- an audit that cannot explain where a subscriber went is worse than one extra
-- status value. 'merged' is also what keeps a merged record out of every
-- audience query for free: they all select status = 'confirmed'.
--
-- Re-runnable.
-- Run once against the live database (see HANDOFF section 5.7).

SET XACT_ABORT ON;
SET NOCOUNT ON;

-- Which record this one was folded into. Self-referencing, and nullable for
-- every record that is still its own.
IF COL_LENGTH('dbo.Subscribers', 'merged_into') IS NULL
  ALTER TABLE dbo.Subscribers ADD merged_into UNIQUEIDENTIFIER NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Subscribers_MergedInto')
  ALTER TABLE dbo.Subscribers ADD CONSTRAINT FK_Subscribers_MergedInto
    FOREIGN KEY (merged_into) REFERENCES dbo.Subscribers(subscriber_id);
GO

-- When it happened, so a rider asking why they stopped getting two texts has
-- an answer with a date on it.
IF COL_LENGTH('dbo.Subscribers', 'merged_at') IS NULL
  ALTER TABLE dbo.Subscribers ADD merged_at DATETIME2 NULL;
GO

-- 'merged' joins the lifecycle. The CHECK has to be dropped and recreated
-- rather than added alongside: two CHECK constraints on one column are ANDed,
-- so leaving the old one in place would forbid exactly the value being added.
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Subscribers_Status')
  ALTER TABLE dbo.Subscribers DROP CONSTRAINT CK_Subscribers_Status;
GO

ALTER TABLE dbo.Subscribers ADD CONSTRAINT CK_Subscribers_Status
  CHECK (status IN ('pending_confirmation', 'confirmed', 'opted_out', 'merged'));
GO

-- A merged record names its survivor and a survivor names nobody. Without
-- this, 'merged' with a NULL merged_into is a record that vanished from every
-- audience with nothing saying where it went - which is the audit failure the
-- status exists to prevent.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Subscribers_MergedInto')
  ALTER TABLE dbo.Subscribers ADD CONSTRAINT CK_Subscribers_MergedInto
    CHECK ((status = 'merged' AND merged_into IS NOT NULL)
        OR (status <> 'merged' AND merged_into IS NULL));
GO

-- Finding the duplicates of a contact is the lookup this whole increment
-- makes, and it runs inside the confirmation transaction, where a scan would
-- be holding locks while it ran.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Subscribers_Phone_Live' AND object_id = OBJECT_ID('dbo.Subscribers'))
  CREATE INDEX IX_Subscribers_Phone_Live ON dbo.Subscribers (phone_number)
    INCLUDE (sms_status, email_status, status, email)
    WHERE phone_number IS NOT NULL AND merged_into IS NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Subscribers_Email_Live' AND object_id = OBJECT_ID('dbo.Subscribers'))
  CREATE INDEX IX_Subscribers_Email_Live ON dbo.Subscribers (email)
    INCLUDE (sms_status, email_status, status, phone_number)
    WHERE email IS NOT NULL AND merged_into IS NULL;
GO

PRINT 'Migration 118 applied: Subscribers.merged_into/merged_at, status ''merged'', live-contact indexes.';
