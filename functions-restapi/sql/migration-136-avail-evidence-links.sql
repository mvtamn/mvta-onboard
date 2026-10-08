-- Migration 136: the Avail evidence links a reviewer acts on.
--
-- Migration 135 and ADR-0035 let Avail corroborate a case when the link is
-- exact, and deliberately let a probable link change nothing "until a reviewer
-- confirms it". Nothing recorded a probable link, so there was nothing to
-- confirm: each nightly run counted them, warned, and forgot them. The same run
-- also had no way to say that Avail had STOPPED reporting a record it reported
-- yesterday - the evidence copied onto the case simply stayed.
--
-- 1. AvailEvidenceLinks: one row per Avail record in the window, carrying how
--    the match was made (exact, probable, unmatched), how many cases it could
--    have been about, and why - in words a reviewer can act on. A probable link
--    waits here for a person to name the case or reject it.
-- 2. Keyed by the RECORD'S OWN tuple, not a row id.
--    AvailMissedTripsRouteStopDay is deleted and re-inserted in full on every
--    daily run, so anything keyed to its identity column would be destroyed
--    each night.
-- 3. retracted_at: a run that no longer reports a record marks its link instead
--    of deleting it. "Avail no longer says this happened" is a fact about the
--    feed, and it is the only warning that corroboration behind a case has been
--    withdrawn.
--
-- Nothing is corroborated by this migration: the table starts empty, and the
-- links it gathers change no case until a reviewer resolves one.
--
-- Re-runnable: the table and its indexes are created only when missing.

IF OBJECT_ID('dbo.MonitoredMissedTrips', 'U') IS NULL OR OBJECT_ID('dbo.AvailMissedTripsRouteStopDay', 'U') IS NULL
  THROW 50136, 'Migration 136 requires MonitoredMissedTrips (011) and AvailMissedTripsRouteStopDay (015).', 1;
GO

IF OBJECT_ID('dbo.AvailEvidenceLinks', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.AvailEvidenceLinks (
    id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AvailEvidenceLinks PRIMARY KEY,
    -- The Avail record, as Avail reported it. This tuple is the key.
    calendar_date CHAR(8) NOT NULL,
    route_id INT NOT NULL,
    departure_stop_name NVARCHAR(200) NULL,
    arrival_stop_name NVARCHAR(200) NULL,
    departure_trip_start_time DATETIME2 NULL,
    -- What it says happened, kept so a confirmation can build the observation
    -- from the link alone.
    departure_missed BIT NOT NULL,
    arrival_missed BIT NOT NULL,
    entire_trip_missed BIT NOT NULL,
    -- How it was placed.
    match_confidence NVARCHAR(20) NOT NULL,
    candidate_count INT NOT NULL,
    match_reason NVARCHAR(500) NOT NULL,
    -- The case it names: set when exact, or when a reviewer names one.
    trip_id NVARCHAR(100) NULL,
    service_date NVARCHAR(20) NULL,
    -- A reviewer's answer to a probable link.
    resolution NVARCHAR(20) NULL,
    resolution_note NVARCHAR(500) NULL,
    resolved_by NVARCHAR(200) NULL,
    resolved_at DATETIME2 NULL,
    first_seen_at DATETIME2 NOT NULL CONSTRAINT DF_AvailEvidenceLinks_first_seen DEFAULT SYSUTCDATETIME(),
    last_seen_at DATETIME2 NOT NULL CONSTRAINT DF_AvailEvidenceLinks_last_seen DEFAULT SYSUTCDATETIME(),
    -- Set when a later run stops reporting this record.
    retracted_at DATETIME2 NULL,
    CONSTRAINT CK_AvailEvidenceLinks_confidence
      CHECK (match_confidence IN (N'exact', N'probable', N'unmatched')),
    CONSTRAINT CK_AvailEvidenceLinks_resolution
      CHECK (resolution IS NULL OR resolution IN (N'confirmed', N'rejected')),
    -- A confirmation has to name the case it confirms.
    CONSTRAINT CK_AvailEvidenceLinks_confirmed_names_case
      CHECK (resolution <> N'confirmed' OR (trip_id IS NOT NULL AND service_date IS NOT NULL)),
    CONSTRAINT CK_AvailEvidenceLinks_candidates CHECK (candidate_count >= 0)
  );

  CREATE UNIQUE INDEX UX_AvailEvidenceLinks_Record
    ON dbo.AvailEvidenceLinks
      (calendar_date, route_id, departure_stop_name, arrival_stop_name, departure_trip_start_time);

  -- The reviewer's list: probable links nobody has answered yet.
  CREATE INDEX IX_AvailEvidenceLinks_Unresolved
    ON dbo.AvailEvidenceLinks (match_confidence, resolution, calendar_date)
    INCLUDE (route_id, candidate_count, retracted_at);

  CREATE INDEX IX_AvailEvidenceLinks_Case ON dbo.AvailEvidenceLinks (trip_id, service_date);
END
GO

PRINT 'Migration 136 applied: Avail evidence links (probable links a reviewer can resolve, and retractions).';
