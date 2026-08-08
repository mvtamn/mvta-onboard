-- Migration 026: Missed Trips detector safety metadata + append-only reviews.
--
-- Existing detector rows predate the agency-timezone and positive-start-
-- evidence investigation. They are retained for audit but must not silently
-- enter compliance totals as if they were trustworthy measurements.

ALTER TABLE MonitoredMissedTrips ADD
    detector_version     NVARCHAR(30) NULL,
    data_quality_status  NVARCHAR(30) NOT NULL
        CONSTRAINT DF_MonitoredMissedTrips_DataQuality DEFAULT 'legacy_unverified';
GO

ALTER TABLE MonitoredMissedTrips ADD CONSTRAINT CK_MonitoredMissedTrips_DataQuality
    CHECK (data_quality_status IN ('legacy_unverified', 'source_verified', 'experimental'));
GO

CREATE TABLE MissedTripReviewHistory (
    review_id                  BIGINT IDENTITY(1,1) PRIMARY KEY,
    trip_id                    NVARCHAR(100) NOT NULL,
    service_date               NVARCHAR(20)  NOT NULL,
    previous_validation_status NVARCHAR(20)  NOT NULL,
    validation_status          NVARCHAR(20)  NOT NULL,
    reason_code                NVARCHAR(30)  NOT NULL,
    notes                      NVARCHAR(1000) NULL,
    reviewed_by                NVARCHAR(200) NOT NULL,
    reviewed_at                DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),

    CONSTRAINT FK_MissedTripReviewHistory_Trip
        FOREIGN KEY (trip_id, service_date)
        REFERENCES MonitoredMissedTrips(trip_id, service_date),
    CONSTRAINT CK_MissedTripReviewHistory_PreviousStatus
        CHECK (previous_validation_status IN ('unreviewed', 'confirmed', 'false_positive')),
    CONSTRAINT CK_MissedTripReviewHistory_Status
        CHECK (validation_status IN ('confirmed', 'false_positive'))
);
GO

CREATE INDEX IX_MissedTripReviewHistory_Trip
    ON MissedTripReviewHistory (trip_id, service_date, reviewed_at DESC);
GO

PRINT 'Migration 026 applied: Missed Trips safety metadata and append-only review history added.';
