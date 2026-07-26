-- Migration 008: future fixed-route departure-risk predictions.
--
-- MVTA measures operational performance using departures. The GTFS-Realtime
-- TripUpdate feed can contain predictions for multiple future stops, so the
-- polling job now preserves the maximum future departure delay and the first
-- stop projected to cross the 15-minute service-risk threshold.
--
-- Run after migration-007.

ALTER TABLE MonitoredTripDelays ADD
    service_date                            NVARCHAR(8)  NULL,
    predicted_max_departure_delay_seconds  INT          NULL,
    first_threshold_stop_id                NVARCHAR(50) NULL,
    first_threshold_departure_at           DATETIME2    NULL,
    departure_predictions                  NVARCHAR(MAX) NULL,
    prediction_confidence                  NVARCHAR(10) NULL,
    prediction_reasons                     NVARCHAR(MAX) NULL,
    prediction_updated_at                  DATETIME2    NULL;
GO

ALTER TABLE MonitoredTripDelays ADD CONSTRAINT CK_MonitoredTripDelays_PredictionConfidence
    CHECK (prediction_confidence IS NULL OR prediction_confidence IN ('high', 'medium', 'low'));
GO

PRINT 'Migration 008 applied: future departure-risk prediction fields added.';
