-- Migration 158: what a QRG proposed, and what a person did with it.
--
-- An author may now seed a Procedure Draft from a Quick Reference Guide in
-- the Approved Document Library: OnBoard reads the QRG through Graph, a model
-- proposes Criteria and Immediate Actions from it, and the author gets a
-- Draft with every field marked unreviewed. ADR 0044 sets out why that is a
-- Draft and never approved content: ADR 0024 rejects importing Decision
-- Matrix content from SharePoint, and a seeded Draft does not import it - a
-- person reviews each field and approves, exactly as with a hand-typed Draft.
--
-- This table exists for the question anyone auditing the feature asks first:
-- what did the model propose, and what did the human change? The Draft itself
-- only ever shows the end state, and ProcedureAuditEvents records that a Draft
-- was created, not what it was created from. So the proposal is kept verbatim
-- in proposed_json alongside the Draft it seeded; comparing the two is the
-- whole point, and without the proposal there is nothing to compare against.
--
-- It also stops one QRG quietly seeding five Drafts. The unique index is on
-- the QRG's identity AND the version seen, so a revised QRG - a new eTag -
-- may seed again, while the same unrevised QRG may not. That mirrors how
-- DecisionMatrixLegacyMigrations refuses a legacy candidate already mapped.
--
-- Nothing here grants access. OnBoard reads a library only where a SharePoint
-- administrator has granted it under Sites.Selected - see
-- docs/runbooks/decision-matrix-sharepoint-documents.md.

SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.Procedures', N'U') IS NULL
  THROW 50158, 'Migration 158 requires Procedures (migration 076).', 1;
GO

IF OBJECT_ID(N'dbo.DecisionMatrixQrgSeedings', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.DecisionMatrixQrgSeedings (
    seeding_id        UNIQUEIDENTIFIER NOT NULL,
    -- The Draft this seeded. Not a foreign key to ProcedureRevisions: the
    -- record of what a model proposed must outlive the Draft, including a
    -- Draft discarded precisely because the proposal was wrong.
    procedure_id      NVARCHAR(100)  NOT NULL,
    revision          INT            NOT NULL,
    -- The QRG, as the Graph triple that identifies it, plus the version seen
    -- at the time. seen_version is the eTag the picker showed, the same fact
    -- ProcedureDocumentReferences stores, so a later revision is detectable.
    site_id           NVARCHAR(400)  NOT NULL,
    drive_id          NVARCHAR(400)  NOT NULL,
    item_id           NVARCHAR(200)  NOT NULL,
    seen_version      NVARCHAR(200)  NOT NULL,
    qrg_name          NVARCHAR(500)  NOT NULL,
    qrg_mime          NVARCHAR(200)  NOT NULL,
    -- How much of the QRG was actually read. A capped read is the normal
    -- case, not a failure, and an author reviewing a thin proposal needs to
    -- know the model only saw the first few pages of a long guide.
    pages_read        INT            NOT NULL,
    -- 'proposed' means the model returned guidance that passed validation;
    -- 'empty' means it did not and the author got an empty Draft with the QRG
    -- attached. Both are successful seedings - refusing outright would leave
    -- the author worse off than if the feature did not exist - so the outcome
    -- is recorded rather than inferred from whether proposed_json is null.
    outcome           NVARCHAR(20)   NOT NULL,
    outcome_reason    NVARCHAR(500)  NULL,
    -- Verbatim, as returned, before anything was written to the Draft. NULL
    -- only when outcome is 'empty'.
    proposed_json     NVARCHAR(MAX)  NULL,
    -- Which model produced it. A proposal is only interpretable against the
    -- model that made it, and this will change under us.
    model             NVARCHAR(100)  NULL,
    seeded_by         NVARCHAR(200)  NOT NULL,
    seeded_at         DATETIME2      NOT NULL CONSTRAINT DF_DecisionMatrixQrgSeedings_At DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_DecisionMatrixQrgSeedings PRIMARY KEY (seeding_id),
    CONSTRAINT CK_DecisionMatrixQrgSeedings_Outcome
      CHECK (outcome IN ('proposed', 'empty')),
    CONSTRAINT CK_DecisionMatrixQrgSeedings_Proposal
      CHECK ((outcome = 'proposed' AND proposed_json IS NOT NULL)
          OR (outcome = 'empty'    AND proposed_json IS NULL)),
    CONSTRAINT CK_DecisionMatrixQrgSeedings_Pages
      CHECK (pages_read >= 0)
  );
END
GO

-- One seeding per QRG version. A revised QRG may seed a new Draft; the same
-- unrevised QRG may not seed a second one.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_DecisionMatrixQrgSeedings_Item')
  CREATE UNIQUE INDEX UX_DecisionMatrixQrgSeedings_Item
    ON dbo.DecisionMatrixQrgSeedings (drive_id, item_id, seen_version);
GO

-- Reading back every seeding for a Draft, which is how the console shows an
-- author what was proposed beside what the Draft now says.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DecisionMatrixQrgSeedings_Procedure')
  CREATE INDEX IX_DecisionMatrixQrgSeedings_Procedure
    ON dbo.DecisionMatrixQrgSeedings (procedure_id, revision);
GO

SELECT COUNT(*) AS qrg_seedings FROM dbo.DecisionMatrixQrgSeedings;
GO
