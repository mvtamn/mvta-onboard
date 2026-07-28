-- Migration 011: missed-trip detection (two signals) + Suggested Alerts
-- auto-expiry.
--
-- Signal 1 (cheap): the GTFS-RT TripUpdate feed already carries
-- Trip.schedule_relationship = CANCELED for a trip the agency's own dispatch
-- system explicitly pulled - gtfsMissedTripsPoll.ts reads this every 5
-- minutes, no static schedule needed.
--
-- Signal 2 (the operationally important case): a trip that was scheduled but
-- never dispatched, with nobody flagging it. Detecting this requires knowing
-- what SHOULD have run - something nothing in this schema tracks today
-- (GtfsTripDirections only has direction, no departure time; gtfsStatic.ts
-- never parsed stop_times.txt/calendar.txt/calendar_dates.txt). This
-- migration adds that schedule reference (GtfsCalendar, GtfsCalendarDates,
-- GtfsScheduledTrips), a running log of which trips have actually been
-- observed today (GtfsObservedTrips - deliberately separate from
-- MonitoredTripDelays, which purges rows 15 minutes after a trip goes quiet,
-- including ordinary on-time completions, so it can't answer "was this trip
-- ever seen today" on its own), and the live-tracking table backing the new
-- console module (MonitoredMissedTrips).
--
-- Also widens SuggestedAlerts' status CHECK to add 'expired', for the
-- separate 2-hour auto-expiry timer (suggestedAlertsExpire.ts) - unrelated to
-- missed-trip detection but touches the same constraint, so it travels with
-- this migration rather than its own.
--
-- Run once against the live database (private endpoint - see HANDOFF §5.7 for
-- the temporary-public-access procedure). GO separates batches.

-- SQL Server CHECK constraints can't be altered in place - drop and recreate.
ALTER TABLE SuggestedAlerts DROP CONSTRAINT CK_SuggestedAlerts_Source;
GO
ALTER TABLE SuggestedAlerts ADD CONSTRAINT CK_SuggestedAlerts_Source
    CHECK (source IN ('gtfs_rt', 'zona', 'missed_trip'));
GO

ALTER TABLE SuggestedAlerts DROP CONSTRAINT CK_SuggestedAlerts_Status;
GO
ALTER TABLE SuggestedAlerts ADD CONSTRAINT CK_SuggestedAlerts_Status
    CHECK (status IN ('pending', 'approved', 'dismissed', 'expired'));
GO

-- Static reference: which service_ids run on which days (weekly pattern +
-- date-range validity). Refreshed daily by the same static-GTFS sync that
-- already populates GtfsStops/GtfsTripDirections/GtfsRoutes.
CREATE TABLE GtfsCalendar (
    service_id NVARCHAR(50) NOT NULL PRIMARY KEY,
    monday     BIT          NOT NULL,
    tuesday    BIT          NOT NULL,
    wednesday  BIT          NOT NULL,
    thursday   BIT          NOT NULL,
    friday     BIT          NOT NULL,
    saturday   BIT          NOT NULL,
    sunday     BIT          NOT NULL,
    start_date CHAR(8)      NOT NULL, -- YYYYMMDD, per GTFS
    end_date   CHAR(8)      NOT NULL,
    updated_at DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

-- Static reference: date-specific exceptions to the weekly pattern above
-- (holiday no-service, added extra service, etc.) - GTFS calendar_dates.txt.
CREATE TABLE GtfsCalendarDates (
    service_id     NVARCHAR(50) NOT NULL,
    service_date   CHAR(8)      NOT NULL, -- YYYYMMDD
    exception_type INT          NOT NULL, -- 1 = added, 2 = removed
    updated_at     DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME(),

    CONSTRAINT PK_GtfsCalendarDates PRIMARY KEY (service_id, service_date),
    CONSTRAINT CK_GtfsCalendarDates_ExceptionType CHECK (exception_type IN (1, 2))
);
GO

-- Static reference: each trip's scheduled START time only (first stop's
-- departure) - enough to know "this trip should have begun by X" without
-- importing every intermediate stop_time. Stored as seconds-since-midnight
-- rather than TIME to handle GTFS's >24:00:00 past-midnight convention
-- cleanly (a trip starting at "25:10:00" is 1h10m into the next calendar day
-- of the same service_date, not an invalid time).
CREATE TABLE GtfsScheduledTrips (
    trip_id                  NVARCHAR(100) NOT NULL PRIMARY KEY,
    route_id                 NVARCHAR(50)  NOT NULL,
    service_id               NVARCHAR(50)  NOT NULL,
    first_departure_seconds  INT           NOT NULL,
    updated_at               DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

CREATE INDEX IX_GtfsScheduledTrips_ServiceId ON GtfsScheduledTrips (service_id);
GO

-- Running log of every trip_id actually observed in the realtime TripUpdate
-- feed today, written by gtfsDelaysPoll.ts alongside its existing
-- MonitoredTripDelays upsert. This is the source of truth for "was this trip
-- ever seen at all" - MonitoredTripDelays is NOT reliable for that question
-- once enough time has passed after a normal on-time completion (its rows
-- purge 15 minutes after the last poll, same as a genuine no-show would look
-- once purged).
CREATE TABLE GtfsObservedTrips (
    trip_id        NVARCHAR(100) NOT NULL,
    service_date   NVARCHAR(20)  NOT NULL,
    first_observed_at DATETIME2  NOT NULL DEFAULT SYSUTCDATETIME(),

    CONSTRAINT PK_GtfsObservedTrips PRIMARY KEY (trip_id, service_date)
);
GO

-- Purge old service dates periodically is a housekeeping concern for a later
-- pass (rows are tiny and low-volume); not addressed in this migration.

-- Live-tracking table for the missed-trip console module, mirroring
-- MonitoredTripDelays' role for the delay-risk module. This is a compliance/
-- investigation tool, not a customer-alert queue: detection only flags a
-- trip here for staff to review - it never auto-creates a SuggestedAlerts
-- row (that stays a separate, explicit staff action after validation, using
-- the same prepare/focus flow every other module already uses).
CREATE TABLE MonitoredMissedTrips (
    trip_id                  NVARCHAR(100)    NOT NULL,
    service_date             NVARCHAR(20)     NOT NULL,
    route_id                 NVARCHAR(50)     NOT NULL,
    scheduled_departure_at   DATETIME2        NOT NULL,
    grace_deadline_at        DATETIME2        NOT NULL,
    status                   NVARCHAR(20)     NOT NULL DEFAULT 'escalated', -- watching | escalated | resolved
    detected_late_arrival_at DATETIME2        NULL,
    suggested_alert_id       UNIQUEIDENTIFIER NULL REFERENCES SuggestedAlerts(alert_id),
    first_seen_watching_at   DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
    last_checked_at          DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
    validation_status        NVARCHAR(20)     NOT NULL DEFAULT 'unreviewed', -- unreviewed | confirmed | false_positive
    validated_by             NVARCHAR(200)    NULL,
    validated_at             DATETIME2        NULL,
    notes                    NVARCHAR(1000)   NULL,

    CONSTRAINT PK_MonitoredMissedTrips PRIMARY KEY (trip_id, service_date),
    CONSTRAINT CK_MonitoredMissedTrips_Status CHECK (status IN ('watching', 'escalated', 'resolved')),
    CONSTRAINT CK_MonitoredMissedTrips_ValidationStatus
        CHECK (validation_status IN ('unreviewed', 'confirmed', 'false_positive'))
);
GO

CREATE INDEX IX_MonitoredMissedTrips_Status ON MonitoredMissedTrips (status, grace_deadline_at);
GO

PRINT 'Migration 011 applied: missed-trip detection schema (GtfsCalendar, GtfsCalendarDates, GtfsScheduledTrips, GtfsObservedTrips, MonitoredMissedTrips) created; SuggestedAlerts.source widened for missed_trip and .status widened for expired.';
