-- Migration 163: Count Sheet scan capture (plans/count-sheet-scan-upload.md,
-- increment S1: the Burnsville capture pilot). Capture only: nothing
-- handwritten is read, and no count is written from a scan.
--
-- The garage check-in desk scans the shift's sheets on the MFP and uploads
-- the PDF in the console. OnBoard keeps the file exactly as received in a
-- write-once container, then a queue worker splits it, straightens each page
-- on its corner marks, decodes the QR code and works out which print run the
-- page came from. OCC sees the page image beside the sheet form.
--
--   * RidershipScanUploads - one per uploaded file: who, which garage, where
--     the original is kept, its SHA-256 and size, and how processing stands.
--   * RidershipScanPages   - one per page of a file: the straightened image,
--     what identified it (QR code, printed text, or a person), the sheet it
--     is (service date, block, page) and the print run, and its state:
--       pending     queued, not processed yet
--       matched     the sheet's page
--       blank       a blank back; no image kept
--       duplicate   the same page again, from the same or an unknown run
--       superseded  the same page from an older print run
--       unreadable  not identified; a person assigns it
--       ignored     a person set it aside (not a Count Sheet)
--   * RidershipScanViews   - every time anyone opens a page image: the image
--     shows the operator's name and handwriting (spec §10), so each open is
--     logged with who and when.
--
-- The two actions that go with it are seeded by migration 164.
--
-- Re-runnable: every object is created only when missing.

SET NOCOUNT ON;
GO

IF OBJECT_ID('dbo.RidershipSheets', 'U') IS NULL OR OBJECT_ID('dbo.RidershipPrintRuns', 'U') IS NULL
  THROW 50163, 'Migration 163 requires the ridership tables (153) and the print log (157).', 1;
GO

IF OBJECT_ID('dbo.RidershipScanUploads', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.RidershipScanUploads (
    upload_id     UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_RidershipScanUploads_id DEFAULT NEWID(),
    garage        NVARCHAR(50)     NULL,          -- as chosen by the uploader; NULL: not said
    source        NVARCHAR(10)     NOT NULL CONSTRAINT DF_RidershipScanUploads_source DEFAULT 'upload',
    file_name     NVARCHAR(260)    NOT NULL,
    blob_path     NVARCHAR(400)    NOT NULL,      -- the original, as received, in count-sheet-originals
    size_bytes    BIGINT           NULL,          -- set when the file is submitted and checked
    sha256        CHAR(64)         NULL,
    page_count    INT              NULL,
    status        NVARCHAR(12)     NOT NULL CONSTRAINT DF_RidershipScanUploads_status DEFAULT 'awaiting',
    status_detail NVARCHAR(400)    NULL,
    upload_day    CHAR(8)          NOT NULL,      -- the Central day it was uploaded, for the date check
    created_at    DATETIME2        NOT NULL CONSTRAINT DF_RidershipScanUploads_created DEFAULT SYSUTCDATETIME(),
    created_by    NVARCHAR(200)    NOT NULL,
    submitted_at  DATETIME2        NULL,
    completed_at  DATETIME2        NULL,
    CONSTRAINT PK_RidershipScanUploads PRIMARY KEY (upload_id),
    CONSTRAINT UQ_RidershipScanUploads_Blob UNIQUE (blob_path),
    CONSTRAINT CK_RidershipScanUploads_Source CHECK (source IN ('upload', 'photo')),
    CONSTRAINT CK_RidershipScanUploads_Status CHECK (status IN ('awaiting', 'queued', 'splitting', 'processing', 'done', 'failed')),
    CONSTRAINT CK_RidershipScanUploads_Sha CHECK (sha256 IS NULL OR sha256 NOT LIKE '%[^0-9a-f]%')
  );
  CREATE INDEX IX_RidershipScanUploads_Created ON dbo.RidershipScanUploads (created_at, garage);
END;
GO

IF OBJECT_ID('dbo.RidershipScanPages', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.RidershipScanPages (
    page_id        UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_RidershipScanPages_id DEFAULT NEWID(),
    upload_id      UNIQUEIDENTIFIER NOT NULL,
    page_index     INT              NOT NULL,     -- 0-based page of the uploaded file
    state          NVARCHAR(12)     NOT NULL CONSTRAINT DF_RidershipScanPages_state DEFAULT 'pending',
    reason         NVARCHAR(40)     NULL,         -- why unreadable: marks_missing, not_identified, ...
    image_path     NVARCHAR(400)    NULL,         -- the straightened page, in count-sheet-pages; derived, rebuildable
    straightened   BIT              NOT NULL CONSTRAINT DF_RidershipScanPages_straight DEFAULT 0,
    qr_text        NVARCHAR(400)    NULL,
    footer_text    NVARCHAR(40)     NULL,         -- the print time as read, "2026-12-11 9:10 PM CT"
    service_date   CHAR(8)          NULL,
    block          CHAR(3)          NULL,
    sheet_page     TINYINT          NULL,
    identified_by  NVARCHAR(12)     NULL,
    assigned_by    NVARCHAR(200)    NULL,         -- the person, when identified_by = 'person' or set aside
    assigned_at    DATETIME2        NULL,
    print_id       UNIQUEIDENTIFIER NULL,         -- the matched print run; NULL: not known
    date_flag      BIT              NOT NULL CONSTRAINT DF_RidershipScanPages_dateflag DEFAULT 0,
    attempts       INT              NOT NULL CONSTRAINT DF_RidershipScanPages_attempts DEFAULT 0,
    processed_at   DATETIME2        NULL,
    CONSTRAINT PK_RidershipScanPages PRIMARY KEY (page_id),
    CONSTRAINT UQ_RidershipScanPages_Page UNIQUE (upload_id, page_index),
    CONSTRAINT FK_RidershipScanPages_Upload FOREIGN KEY (upload_id) REFERENCES dbo.RidershipScanUploads (upload_id),
    CONSTRAINT FK_RidershipScanPages_Print FOREIGN KEY (print_id) REFERENCES dbo.RidershipPrintRuns (print_id),
    CONSTRAINT CK_RidershipScanPages_State CHECK (state IN ('pending', 'matched', 'blank', 'duplicate', 'superseded', 'unreadable', 'ignored')),
    CONSTRAINT CK_RidershipScanPages_IdentifiedBy CHECK (identified_by IS NULL OR identified_by IN ('qr', 'printed_text', 'person')),
    CONSTRAINT CK_RidershipScanPages_Block CHECK (block IS NULL OR block LIKE '[0-9][0-9][0-9]'),
    -- A page that names a sheet names all of it, and says how it was named.
    CONSTRAINT CK_RidershipScanPages_Sheet CHECK (
      (service_date IS NULL AND block IS NULL AND sheet_page IS NULL AND identified_by IS NULL)
      OR (service_date IS NOT NULL AND block IS NOT NULL AND sheet_page IS NOT NULL AND identified_by IS NOT NULL)),
    CONSTRAINT CK_RidershipScanPages_Identified CHECK (state NOT IN ('matched', 'duplicate', 'superseded') OR service_date IS NOT NULL)
  );
  CREATE INDEX IX_RidershipScanPages_Sheet ON dbo.RidershipScanPages (service_date, block, sheet_page) INCLUDE (state, processed_at, print_id);
END;
GO

IF OBJECT_ID('dbo.RidershipScanViews', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.RidershipScanViews (
    view_id    BIGINT IDENTITY(1, 1) NOT NULL,
    page_id    UNIQUEIDENTIFIER      NOT NULL,
    viewed_at  DATETIME2             NOT NULL CONSTRAINT DF_RidershipScanViews_at DEFAULT SYSUTCDATETIME(),
    viewed_by  NVARCHAR(200)         NOT NULL,
    CONSTRAINT PK_RidershipScanViews PRIMARY KEY (view_id),
    CONSTRAINT FK_RidershipScanViews_Page FOREIGN KEY (page_id) REFERENCES dbo.RidershipScanPages (page_id)
  );
  CREATE INDEX IX_RidershipScanViews_Page ON dbo.RidershipScanViews (page_id, viewed_at);
END;
GO

PRINT 'Migration 163: Count Sheet scan tables created.';
GO
