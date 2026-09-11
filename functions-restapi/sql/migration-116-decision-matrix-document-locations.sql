-- Migration 116: the SharePoint locations a Procedure's documents are drawn
-- from, and what was last seen in them.
--
-- Until now a Procedure Revision recorded document references one at a time,
-- each a fixed site/drive/item triple typed in by hand, and OnBoard learned
-- nothing about the folder those documents came from. Two capabilities need
-- that folder to be a first-class thing:
--
--   - Browsing the approved SOP library to pick a guide, rather than typing
--     seven opaque identifiers into the Create Draft form.
--   - Keeping a Procedure in step with its source location, so an SOP added,
--     revised or withdrawn in SharePoint is something an Admin is told about
--     rather than something they have to notice.
--
-- DecisionMatrixDocumentLocations is the watched folder. DecisionMatrixLocationDocuments
-- is what the last sync observed in it - a cache of SharePoint's state, never
-- a source of truth. SharePoint owns the documents; these rows only record
-- what OnBoard saw and when, so a change can be reported as a change.
--
-- Nothing here grants access. The application reads a library only where a
-- SharePoint administrator has granted it under Sites.Selected - see
-- docs/runbooks/decision-matrix-sharepoint-documents.md.
--
-- Re-runnable.
-- Run once against the live database (see HANDOFF section 5.7).

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.DecisionMatrixDocumentLocations', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.DecisionMatrixDocumentLocations (
    location_id       NVARCHAR(100)  NOT NULL,
    -- The Graph triple identifying the folder. folder_path is relative to the
    -- drive root and '' means the root itself, which is why it is NOT NULL
    -- with a '' default rather than nullable: an empty path is a real
    -- location, an unknown one is not a location at all.
    site_id           NVARCHAR(400)  NOT NULL,
    drive_id          NVARCHAR(400)  NOT NULL,
    folder_path       NVARCHAR(1000) NOT NULL CONSTRAINT DF_DecisionMatrixDocumentLocations_Path DEFAULT '',
    -- What an Admin calls this location. SharePoint's own folder names are
    -- not always meaningful out of context ("_OCC Documents").
    label             NVARCHAR(200)  NOT NULL,
    is_active         BIT            NOT NULL CONSTRAINT DF_DecisionMatrixDocumentLocations_Active DEFAULT 1,
    added_by          NVARCHAR(200)  NOT NULL,
    added_at          DATETIME2      NOT NULL CONSTRAINT DF_DecisionMatrixDocumentLocations_Added DEFAULT SYSUTCDATETIME(),
    -- Sync outcome. last_sync_status distinguishes "read it, here is what is
    -- there" from "could not read it", because a location that returns no
    -- documents and a location OnBoard was never granted look identical in
    -- the document table and must not.
    last_synced_at    DATETIME2      NULL,
    last_sync_status  NVARCHAR(20)   NULL,
    last_sync_reason  NVARCHAR(400)  NULL,
    CONSTRAINT PK_DecisionMatrixDocumentLocations PRIMARY KEY (location_id),
    CONSTRAINT CK_DecisionMatrixDocumentLocations_SyncStatus
      CHECK (last_sync_status IS NULL OR last_sync_status IN ('ok', 'forbidden', 'not_found', 'failed'))
  );
END
GO

-- One row per folder. A second row for the same folder would sync it twice and
-- report every change twice; the filtered index leaves inactive rows alone so a
-- location can be retired and a fresh one added for the same folder later.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_DecisionMatrixDocumentLocations_Folder')
  CREATE UNIQUE INDEX UX_DecisionMatrixDocumentLocations_Folder
    ON dbo.DecisionMatrixDocumentLocations (site_id, drive_id, folder_path)
    WHERE is_active = 1;
GO

IF OBJECT_ID(N'dbo.DecisionMatrixLocationDocuments', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.DecisionMatrixLocationDocuments (
    location_id       NVARCHAR(100)  NOT NULL,
    item_id           NVARCHAR(400)  NOT NULL,
    name              NVARCHAR(400)  NOT NULL,
    -- Where inside the location it sits, for a folder tree walked in full.
    -- '' is directly in the location's own folder.
    relative_path     NVARCHAR(1000) NOT NULL CONSTRAINT DF_DecisionMatrixLocationDocuments_Rel DEFAULT '',
    mime_type         NVARCHAR(200)  NULL,
    size_bytes        BIGINT         NULL,
    -- The eTag is what a document reference already compares against to decide
    -- health, so the same value is what tells this table a document changed.
    etag              NVARCHAR(200)  NULL,
    last_modified_at  DATETIME2      NULL,
    first_seen_at     DATETIME2      NOT NULL CONSTRAINT DF_DecisionMatrixLocationDocuments_First DEFAULT SYSUTCDATETIME(),
    last_seen_at      DATETIME2      NOT NULL CONSTRAINT DF_DecisionMatrixLocationDocuments_Last DEFAULT SYSUTCDATETIME(),
    -- Set when a sync that succeeded did not find the document. Rows are kept
    -- rather than deleted: a Procedure may still reference the item, and
    -- "this document is gone" is the fact worth reporting.
    disappeared_at    DATETIME2      NULL,
    CONSTRAINT PK_DecisionMatrixLocationDocuments PRIMARY KEY (location_id, item_id),
    CONSTRAINT FK_DecisionMatrixLocationDocuments_Location
      FOREIGN KEY (location_id) REFERENCES dbo.DecisionMatrixDocumentLocations (location_id) ON DELETE CASCADE
  );
END
GO

-- The reader's question is "what is in this location now", which means the
-- present rows first.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DecisionMatrixLocationDocuments_Present')
  CREATE INDEX IX_DecisionMatrixLocationDocuments_Present
    ON dbo.DecisionMatrixLocationDocuments (location_id, disappeared_at)
    INCLUDE (name, relative_path, mime_type, etag, last_modified_at);
GO

PRINT 'Migration 116 applied: Decision Matrix document locations and observed documents created.';
