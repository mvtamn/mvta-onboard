-- Missed Trips By Route/Stop/Day - Avail360's MissedTripsByRouteStopDay
-- feed, recommended primary feed in OTP-Feed-Evaluation-and-Recommendation.md
-- for fixed-route missed-trip compliance ingestion. Unlike the OTP feed
-- above, this returns individual incident records, not pre-aggregated
-- percentages. The feed provides no reliable per-record unique key (the
-- doc's own suggested natural key - RouteID/DepartureStopID/ArrivalStopID/
-- CalendarDate - isn't guaranteed unique, and DepartureTripStartTime is
-- nullable even on real incidents per the doc's own sample), so
-- availMissedTripsPoll.ts does a delete-then-reinsert of the current
-- service_month only on every poll rather than an upsert - safe and
-- idempotent regardless of the missing natural key. Already-closed months
-- are never touched again once the month rolls over.
CREATE TABLE AvailMissedTripsRouteStopDay (
    id                          BIGINT        IDENTITY(1,1) PRIMARY KEY,
    service_month                CHAR(6)      NOT NULL,
    calendar_date                 CHAR(8)     NOT NULL, -- YYYYMMDD
    route_id                       INT        NOT NULL,
    route_desc                      NVARCHAR(200) NULL,
    route_internet_name              NVARCHAR(200) NULL,
    departure_stop_id                 INT     NULL,
    departure_stop_name                NVARCHAR(200) NULL,
    arrival_stop_id                     INT    NULL,
    arrival_stop_name                    NVARCHAR(200) NULL,
    departure_missed                      BIT   NOT NULL DEFAULT 0,
    arrival_missed                         BIT  NOT NULL DEFAULT 0,
    entire_trip_missed                      BIT NOT NULL DEFAULT 0,
    departure_trip_start_time         DATETIME2 NULL,
    ingested_at                       DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_AvailMissedTripsRouteStopDay_Month ON AvailMissedTripsRouteStopDay (service_month, route_id);
