-- Migration 153: ridership counting - Count Sheets, counts, unscheduled trips,
-- their change history, Planning's block-to-garage list, and a scheduled end
-- time on the Dispatch Log (ADR 0043, plans/ridership-counting-spec.md).
--
-- MVTA's paper Count Sheet and the Microsoft Access tables behind it are
-- replaced by OnBoard before Keolis takes over on 2027-01-01. Contractor OCC
-- staff key each sheet the day after service; Planning keeps the list of
-- which garage runs which block. Nothing here reads Access, and nothing is
-- imported: December 2026 is keyed in both systems and Access stays the record
-- for it (spec §11).
--
--   * RidershipSheets - one per block per service date: who drove it and on
--     which bus (pre-filled from Avail's pull-out, overridden when the sheet
--     says otherwise), whether it was reconstructed, and when it was entered.
--   * RidershipCounts - one per Dispatch Log trip on a sheet. A trip is
--     counted, not counted, or did not operate (decided 2026-10-30): a trip
--     nobody counted is a visible gap, never a zero.
--   * RidershipAddedTrips - unscheduled trips (trippers, extras) written in the
--     sheet's blank rows. Removed rows are kept, marked removed.
--   * RidershipCountHistory - every change to the three above, with who and
--     when (P6). Append-only.
--   * RidershipBlockGarages - Planning's block -> garage list, dated by the
--     service change it applies from. A block with no row is Unassigned.
--   * TripStartLog.scheduled_end_seconds - the trip's last scheduled arrival,
--     for the printed sheet. Backfilled for logged trips still in the
--     imported schedule; older history stays NULL.
--
-- Keys follow the Dispatch Log: service_date is CHAR(8) YYYYMMDD agency-local,
-- trip_id is the GTFS trip_id, and block is the three-digit workbook form
-- ("001") that workbookBlock() reads out of TripStartLog.block_id, which is
-- also the number printed on the sheet and the block Avail's pull-out carries.
--
-- Re-runnable: every object is created only when missing and the backfill
-- touches only NULLs.

SET NOCOUNT ON;
GO

IF OBJECT_ID('dbo.TripStartLog', 'U') IS NULL
  THROW 50153, 'Migration 153 requires TripStartLog (migration 094).', 1;
GO

-- ---------------------------------------------------------------------------
-- The Dispatch Log's scheduled end, from the GTFS import (migration 125).
-- ---------------------------------------------------------------------------
IF COL_LENGTH('dbo.TripStartLog', 'scheduled_end_seconds') IS NULL
  ALTER TABLE dbo.TripStartLog ADD scheduled_end_seconds INT NULL;  -- GTFS seconds; > 86400 allowed
GO

IF OBJECT_ID('dbo.GtfsScheduledTrips', 'U') IS NOT NULL
   AND COL_LENGTH('dbo.GtfsScheduledTrips', 'last_arrival_seconds') IS NOT NULL
BEGIN
  -- trip_ids are stable within a service change, so a logged trip still in
  -- today's import has the same end time it had when it ran.
  EXEC('UPDATE l SET scheduled_end_seconds = st.last_arrival_seconds
        FROM dbo.TripStartLog l
        JOIN dbo.GtfsScheduledTrips st ON st.trip_id = l.trip_id
        WHERE l.scheduled_end_seconds IS NULL AND st.last_arrival_seconds IS NOT NULL;');
  PRINT CONCAT('Migration 153: scheduled end backfilled on ', @@ROWCOUNT, ' Dispatch Log trips.');
END;
GO

-- ---------------------------------------------------------------------------
-- Count Sheets.
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.RidershipSheets', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.RidershipSheets (
    service_date        CHAR(8)        NOT NULL,
    block               CHAR(3)        NOT NULL,
    operator_name       NVARCHAR(200)  NULL,
    operator_id         NVARCHAR(20)   NULL,       -- Avail logon_id, or as written on the sheet
    bus                 NVARCHAR(20)   NULL,       -- vehicle label
    -- The pull-out run the header was pre-filled from. A block with relief
    -- has several runs; the first is pre-filled and the sheet wins (spec §4).
    prefill_run         INT            NULL,
    operator_overridden BIT            NOT NULL CONSTRAINT DF_RidershipSheets_overridden DEFAULT 0,
    reconstructed       BIT            NOT NULL CONSTRAINT DF_RidershipSheets_reconstructed DEFAULT 0,
    -- First time every required trip had an entry and the sheet was saved:
    -- what lateness is judged on. Later corrections do not move it.
    entered_at          DATETIME2      NULL,
    entered_by          NVARCHAR(200)  NULL,
    created_at          DATETIME2      NOT NULL CONSTRAINT DF_RidershipSheets_created DEFAULT SYSUTCDATETIME(),
    created_by          NVARCHAR(200)  NOT NULL,
    updated_at          DATETIME2      NULL,
    updated_by          NVARCHAR(200)  NULL,
    CONSTRAINT PK_RidershipSheets PRIMARY KEY (service_date, block),
    CONSTRAINT CK_RidershipSheets_Block CHECK (block LIKE '[0-9][0-9][0-9]'),
    CONSTRAINT CK_RidershipSheets_Entered CHECK ((entered_at IS NULL AND entered_by IS NULL) OR (entered_at IS NOT NULL AND entered_by IS NOT NULL))
  );
END;
GO

-- ---------------------------------------------------------------------------
-- One entry per Dispatch Log trip on a sheet.
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.RidershipCounts', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.RidershipCounts (
    service_date  CHAR(8)        NOT NULL,
    trip_id       NVARCHAR(100)  NOT NULL,
    block         CHAR(3)        NOT NULL,
    count_status  NVARCHAR(20)   NOT NULL,
    boardings     INT            NULL,
    created_at    DATETIME2      NOT NULL CONSTRAINT DF_RidershipCounts_created DEFAULT SYSUTCDATETIME(),
    created_by    NVARCHAR(200)  NOT NULL,
    updated_at    DATETIME2      NULL,
    updated_by    NVARCHAR(200)  NULL,
    CONSTRAINT PK_RidershipCounts PRIMARY KEY (service_date, trip_id),
    CONSTRAINT FK_RidershipCounts_Sheet FOREIGN KEY (service_date, block) REFERENCES dbo.RidershipSheets (service_date, block),
    CONSTRAINT CK_RidershipCounts_Status CHECK (count_status IN ('counted', 'not_counted', 'did_not_operate')),
    -- A number only when counted: not counted is a gap, never a zero.
    CONSTRAINT CK_RidershipCounts_Boardings CHECK (
      (count_status = 'counted' AND boardings IS NOT NULL AND boardings >= 0)
      OR (count_status <> 'counted' AND boardings IS NULL)
    )
  );
  CREATE INDEX IX_RidershipCounts_Sheet ON dbo.RidershipCounts (service_date, block);
END;
GO

-- ---------------------------------------------------------------------------
-- Unscheduled trips from the sheet's blank rows.
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.RidershipAddedTrips', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.RidershipAddedTrips (
    id                      UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_RidershipAddedTrips_id DEFAULT NEWID(),
    service_date            CHAR(8)          NOT NULL,
    block                   CHAR(3)          NOT NULL,
    route_short_name        NVARCHAR(100)    NOT NULL,
    direction_label         NVARCHAR(10)     NOT NULL,   -- as the Dispatch Log labels it
    scheduled_start_seconds INT              NOT NULL,
    reason                  NVARCHAR(20)     NOT NULL,
    count_status            NVARCHAR(20)     NOT NULL,
    boardings               INT              NULL,
    created_at              DATETIME2        NOT NULL CONSTRAINT DF_RidershipAddedTrips_created DEFAULT SYSUTCDATETIME(),
    created_by              NVARCHAR(200)    NOT NULL,
    updated_at              DATETIME2        NULL,
    updated_by              NVARCHAR(200)    NULL,
    removed_at              DATETIME2        NULL,
    removed_by              NVARCHAR(200)    NULL,
    CONSTRAINT PK_RidershipAddedTrips PRIMARY KEY (id),
    CONSTRAINT FK_RidershipAddedTrips_Sheet FOREIGN KEY (service_date, block) REFERENCES dbo.RidershipSheets (service_date, block),
    CONSTRAINT CK_RidershipAddedTrips_Reason CHECK (reason IN ('tripper', 'extra_service', 'occ_directed', 'other')),
    CONSTRAINT CK_RidershipAddedTrips_Status CHECK (count_status IN ('counted', 'not_counted')),
    CONSTRAINT CK_RidershipAddedTrips_Boardings CHECK (
      (count_status = 'counted' AND boardings IS NOT NULL AND boardings >= 0)
      OR (count_status <> 'counted' AND boardings IS NULL)
    )
  );
  CREATE INDEX IX_RidershipAddedTrips_Sheet ON dbo.RidershipAddedTrips (service_date, block);
END;
GO

-- ---------------------------------------------------------------------------
-- Every change, with who and when. Values are text so one shape holds the
-- header fields, counts and added trips alike; nothing updates or deletes a
-- row.
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.RidershipCountHistory', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.RidershipCountHistory (
    id             BIGINT IDENTITY(1, 1) NOT NULL,
    service_date   CHAR(8)        NOT NULL,
    block          CHAR(3)        NOT NULL,
    subject        NVARCHAR(20)   NOT NULL,
    subject_ref    NVARCHAR(100)  NULL,         -- trip_id or added-trip id; NULL for the sheet itself
    field          NVARCHAR(40)   NOT NULL,
    previous_value NVARCHAR(400)  NULL,
    new_value      NVARCHAR(400)  NULL,
    changed_at     DATETIME2      NOT NULL CONSTRAINT DF_RidershipCountHistory_changed DEFAULT SYSUTCDATETIME(),
    changed_by     NVARCHAR(200)  NOT NULL,
    CONSTRAINT PK_RidershipCountHistory PRIMARY KEY (id),
    CONSTRAINT CK_RidershipCountHistory_Subject CHECK (subject IN ('sheet', 'trip', 'added_trip'))
  );
  CREATE INDEX IX_RidershipCountHistory_Sheet ON dbo.RidershipCountHistory (service_date, block, changed_at);
END;
GO

-- ---------------------------------------------------------------------------
-- Planning's block -> garage list. A new service change is a new set of rows
-- with a later effective_from; the row in force for a date is the latest one
-- on or before it. Garage is free text because the garages are MVTA's to name
-- and change; the console offers the ones already in use.
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.RidershipBlockGarages', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.RidershipBlockGarages (
    block          CHAR(3)        NOT NULL,
    effective_from DATE           NOT NULL,
    garage         NVARCHAR(50)   NULL,          -- NULL: deliberately Unassigned from this date
    updated_at     DATETIME2      NOT NULL CONSTRAINT DF_RidershipBlockGarages_updated DEFAULT SYSUTCDATETIME(),
    updated_by     NVARCHAR(200)  NOT NULL,
    CONSTRAINT PK_RidershipBlockGarages PRIMARY KEY (block, effective_from),
    CONSTRAINT CK_RidershipBlockGarages_Block CHECK (block LIKE '[0-9][0-9][0-9]')
  );
END;
GO

PRINT 'Migration 153: ridership counting tables are in place.';
GO
