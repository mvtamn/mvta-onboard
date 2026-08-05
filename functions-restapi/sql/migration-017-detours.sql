-- Migration 017: Detour & Closure module.
--
-- MVTA currently tracks detours and closures by hand across three places -
-- Avail (when the detour can actually be built there), an email to staff/
-- operators, and an Excel tracker. Many closures are never built as real
-- Avail detours because Avail won't allow two detours to touch the same
-- stop or segment, so those go out as plain operator text messages and
-- rider alerts instead. This is the single source of truth those three
-- places should collapse into. See detour-and-event-module-implementation-
-- plan.md (Part B) for the full design.
--
-- Detours.source/external_detour_id exist from day one (not added later)
-- so a future Avail sync (Part B4) can upsert by external_detour_id without
-- a migration-after-the-fact. The sync must never touch a source='manual'
-- row - those are the operator-message/stop-closure entries that never
-- appear in Avail's own feed at all.
--
-- Status (Active/Upcoming/Monitor/Recently finished/Expired) is deliberately
-- NOT a column here - it's computed from start_date/end_date/is_monitor_only
-- by detourStatus.ts so the API and any future consumer share one definition
-- rather than two drifting ones.

CREATE TABLE Detours (
    id                   UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    number               NVARCHAR(50)  NULL,       -- free text: "951", "Operator Message", "993 & 994"
    closure              NVARCHAR(500) NOT NULL,   -- location/description
    start_date           DATE          NULL,
    end_date             DATE          NULL,        -- nullable - many closures are open-ended
    is_monitor_only      BIT           NOT NULL DEFAULT 0, -- watching a location, no confirmed closure yet
    riders_directed      NVARCHAR(500) NULL,        -- used for stop closures
    email_sent           BIT           NOT NULL DEFAULT 0,
    expired_email_sent   BIT           NOT NULL DEFAULT 0,
    spare_emailed        BIT           NOT NULL DEFAULT 0,
    source               NVARCHAR(10)  NOT NULL DEFAULT 'manual', -- 'manual' | 'avail'
    external_detour_id   NVARCHAR(50)  NULL,        -- Avail's own DetourID, once synced (Part B4)
    last_edited_manually BIT           NOT NULL DEFAULT 0, -- set once a human edits a source='avail' row
    is_deleted           BIT           NOT NULL DEFAULT 0,
    created_by           NVARCHAR(200) NOT NULL,
    created_at           DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_by           NVARCHAR(200) NULL,
    updated_at           DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),

    CONSTRAINT CK_Detours_Source CHECK (source IN ('manual', 'avail'))
);
GO

CREATE UNIQUE INDEX UX_Detours_ExternalDetourId ON Detours (external_detour_id) WHERE external_detour_id IS NOT NULL;
GO

CREATE INDEX IX_Detours_Dates ON Detours (start_date, end_date) WHERE is_deleted = 0;
GO

-- One row per route/direction variation under a Detour - Avail's own Detours
-- feed returns multiple rows sharing one DetourID (one per direction), which
-- maps directly onto this concept.
CREATE TABLE DetourSegments (
    id          UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    detour_id   UNIQUEIDENTIFIER NOT NULL REFERENCES Detours(id),
    routes      NVARCHAR(200) NOT NULL,   -- e.g. "460 SB, 465 SB"
    directions  NVARCHAR(MAX) NULL,        -- turn-by-turn text
    sort_order  INT NOT NULL DEFAULT 0
);
GO

CREATE INDEX IX_DetourSegments_DetourId ON DetourSegments (detour_id);
GO

-- Image attachments (Part B3 - not wired up until Blob Storage is
-- provisioned, but the table ships now alongside the rest of the schema).
-- blob_path is never a public URL - reads/writes both go through short-lived
-- SAS tokens minted by blobStorage.ts.
CREATE TABLE DetourImages (
    id            UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    detour_id     UNIQUEIDENTIFIER NOT NULL REFERENCES Detours(id),
    blob_path     NVARCHAR(500) NOT NULL,
    file_name     NVARCHAR(255) NOT NULL,
    content_type  NVARCHAR(100) NULL,
    size_bytes    INT NULL,
    caption       NVARCHAR(500) NULL,
    sort_order    INT NOT NULL DEFAULT 0,
    uploaded_by   NVARCHAR(200) NOT NULL,
    uploaded_at   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

CREATE INDEX IX_DetourImages_DetourId ON DetourImages (detour_id);
GO

PRINT 'Migration 017 applied: Detours, DetourSegments, DetourImages created.';
