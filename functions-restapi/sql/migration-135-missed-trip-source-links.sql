-- Migration 135: cross-system links between Avail's retrospective missed-trip
-- report and the Missed-trip cases OnBoard holds.
--
-- Avail has been a third missed-trip pipeline since migration 015: its own
-- table, its own page, no contact with a case. CONTEXT.md already names the
-- machinery for joining them - Retrospective reconciliation, Evidence-match
-- confidence, Evidence conflict - and none of it existed. ADR-0036 records the
-- decision: Avail is EVIDENCE ON A CASE, never a case of its own, and never a
-- confirmation.
--
-- 1. MissedTripSourceLinks: one row per Avail incident, carrying where it was
--    placed (trip_id + service_date, or nothing), how sure we are (exact,
--    probable, unmatched), what it says happened, and why it matched that way.
--    A probable link affects nothing until a reviewer confirms it.
-- 2. The row is keyed by the INCIDENT'S NATURAL TUPLE, not by a row id.
--    AvailMissedTripsRouteStopDay is deleted and re-inserted in full on every
--    daily run (it has no per-record key), so anything keyed to its identity
--    column would be destroyed each night.
-- 3. last_seen_at and missing_since: a re-ingest that stops reporting an
--    incident is a fact about the feed, not silence. The link is kept and
--    marked, never deleted.
--
-- Nothing is reconciled by this migration; the table starts empty and no
-- figure moves. Reconciliation is a separate run.
--
-- Re-runnable: the table and its indexes are created only when missing.

IF OBJECT_ID('dbo.MonitoredMissedTrips', 'U') IS NULL OR OBJECT_ID('dbo.AvailMissedTripsRouteStopDay', 'U') IS NULL
  THROW 50135, 'Migration 135 requires MonitoredMissedTrips (migration 011) and AvailMissedTripsRouteStopDay (migration 015).', 1;
GO

IF OBJECT_ID('dbo.MissedTripSourceLinks', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.MissedTripSourceLinks (
    id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_MissedTripSourceLinks PRIMARY KEY,
    source NVARCHAR(20) NOT NULL,
    -- The incident as the source reported it. This tuple is the key.
    incident_service_date CHAR(8) NOT NULL,
    incident_route_id INT NOT NULL,
    incident_departure_stop_id INT NULL,
    incident_arrival_stop_id INT NULL,
    incident_start_at DATETIME2 NULL,
    -- Where it was placed. Null when nothing could be placed.
    trip_id NVARCHAR(100) NULL,
    service_date NVARCHAR(20) NULL,
    match_confidence NVARCHAR(20) NOT NULL,
    finding NVARCHAR(30) NOT NULL,
    match_reason NVARCHAR(500) NOT NULL,
    -- A probable link needs a person to agree before it affects a case.
    confirmation NVARCHAR(20) NULL,
    confirmed_by NVARCHAR(200) NULL,
    confirmed_at DATETIME2 NULL,
    first_seen_at DATETIME2 NOT NULL CONSTRAINT DF_MissedTripSourceLinks_first_seen DEFAULT SYSUTCDATETIME(),
    last_seen_at DATETIME2 NOT NULL CONSTRAINT DF_MissedTripSourceLinks_last_seen DEFAULT SYSUTCDATETIME(),
    -- Set when a re-ingest stops reporting this incident.
    missing_since DATETIME2 NULL,
    CONSTRAINT CK_MissedTripSourceLinks_source CHECK (source IN (N'avail')),
    CONSTRAINT CK_MissedTripSourceLinks_confidence
      CHECK (match_confidence IN (N'exact', N'probable', N'unmatched')),
    CONSTRAINT CK_MissedTripSourceLinks_finding
      CHECK (finding IN (N'missed_trip', N'partial_service')),
    CONSTRAINT CK_MissedTripSourceLinks_confirmation
      CHECK (confirmation IS NULL OR confirmation IN (N'confirmed', N'rejected')),
    -- A link that names no case cannot be placed, so it cannot be confirmed.
    CONSTRAINT CK_MissedTripSourceLinks_placed
      CHECK ((trip_id IS NULL AND service_date IS NULL AND match_confidence = N'unmatched')
          OR (trip_id IS NOT NULL AND service_date IS NOT NULL AND match_confidence <> N'unmatched'))
  );

  CREATE UNIQUE INDEX UX_MissedTripSourceLinks_Incident
    ON dbo.MissedTripSourceLinks
      (source, incident_service_date, incident_route_id, incident_departure_stop_id,
       incident_arrival_stop_id, incident_start_at);

  CREATE INDEX IX_MissedTripSourceLinks_Case
    ON dbo.MissedTripSourceLinks (trip_id, service_date) INCLUDE (match_confidence, finding, confirmation);
END
GO

PRINT 'Migration 135 applied: missed-trip source links (Avail retrospective reconciliation).';
