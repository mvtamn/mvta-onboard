-- Migration 096: the Dispatch Log's verification audit trail
-- (plans/dispatch-log-spec.md §8 step 6; §7.1 decided 2026-09-05 - SST OCS
-- staff record verifications through OnBoard).
--
-- TripStartVerifications (migration 094) holds the current observation per
-- trip, one row, upserted, so the workbook cell can be corrected. This table
-- is the record of every change to it: who set what, from what, when, with
-- what note. Append-only; nothing updates or deletes rows here.

IF OBJECT_ID('dbo.TripStartVerifications', 'U') IS NULL
  THROW 50096, 'Migration 096 requires TripStartVerifications (migration 094).', 1;
GO

IF OBJECT_ID('dbo.TripStartVerificationEvents', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.TripStartVerificationEvents (
    id                   BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_TripStartVerificationEvents PRIMARY KEY,
    service_date         CHAR(8)       NOT NULL,
    trip_id              NVARCHAR(100) NOT NULL,
    previous_observation NVARCHAR(20)  NULL,       -- what the cell said before; NULL = blank
    observation          NVARCHAR(20)  NULL,       -- what it says now; NULL = cleared
    recorded_by          NVARCHAR(200) NOT NULL,   -- Entra identity
    recorded_initials    NVARCHAR(10)  NOT NULL,
    note                 NVARCHAR(500) NULL,
    recorded_at          DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_TripStartVerificationEvents_Observation CHECK (
      observation IS NULL OR observation IN ('observed_on_time', 'observed_left_late', 'not_observed')
    )
  );
  CREATE INDEX IX_TripStartVerificationEvents_Trip ON dbo.TripStartVerificationEvents (service_date, trip_id, recorded_at);
END;
GO

PRINT 'Migration 096 applied: TripStartVerificationEvents is present.';
