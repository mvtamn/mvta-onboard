-- Migration 009: on-demand customer wait-risk monitoring contract.
--
-- This table is the stable handoff between the future on-demand vendor-feed
-- adapter and the OCC On-Demand Quality UI. The adapter should UPSERT the
-- latest state for each active trip. This repository does not yet contain the
-- vendor-specific producer because no authenticated feed contract or sample
-- payload is available.
--
-- Customer PII is deliberately excluded. Customer communication should use a
-- separate secured identifier-resolution path.

CREATE TABLE MonitoredOnDemandWaits (
    trip_id                    NVARCHAR(100)    NOT NULL PRIMARY KEY,
    external_trip_id           NVARCHAR(100)    NULL,
    zone_id                    NVARCHAR(50)     NOT NULL,
    wait_started_at            DATETIME2        NOT NULL,
    predicted_pickup_at        DATETIME2        NULL,
    current_wait_minutes       INT              NOT NULL,
    predicted_wait_minutes     INT              NULL,
    assigned_vehicle_id        NVARCHAR(50)     NULL,
    stops_ahead                INT              NULL,
    accessible_vehicle_required BIT             NOT NULL DEFAULT 0,
    eligible_vehicles_in_zone  INT              NULL,
    nearest_vehicle_context    NVARCHAR(200)    NULL,
    trend                      NVARCHAR(20)      NOT NULL DEFAULT 'stable',
    prediction_confidence      NVARCHAR(10)      NULL,
    prediction_reasons         NVARCHAR(MAX)     NULL,
    source_updated_at          DATETIME2         NULL,
    last_polled_at             DATETIME2         NOT NULL DEFAULT SYSUTCDATETIME(),
    suggested_alert_id         UNIQUEIDENTIFIER NULL REFERENCES SuggestedAlerts(alert_id),

    CONSTRAINT CK_OnDemandWait_Current CHECK (current_wait_minutes >= 0),
    CONSTRAINT CK_OnDemandWait_Predicted CHECK (
        predicted_wait_minutes IS NULL OR predicted_wait_minutes >= 0
    ),
    CONSTRAINT CK_OnDemandWait_Trend CHECK (
        trend IN ('worsening', 'stable', 'recovering')
    ),
    CONSTRAINT CK_OnDemandWait_Confidence CHECK (
        prediction_confidence IS NULL OR prediction_confidence IN ('high', 'medium', 'low')
    )
);
GO

CREATE INDEX IX_MonitoredOnDemandWaits_Risk
    ON MonitoredOnDemandWaits (predicted_wait_minutes DESC, current_wait_minutes DESC);
GO

CREATE INDEX IX_MonitoredOnDemandWaits_LastPolled
    ON MonitoredOnDemandWaits (last_polled_at);
GO

PRINT 'Migration 009 applied: on-demand wait-risk monitoring contract created.';
