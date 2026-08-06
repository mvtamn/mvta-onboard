-- Migration 023: Missed Trips - capture WHY a trip was flagged, and let
-- staff record a structured outcome reason (not just free-text notes).
--
-- Two independent gaps closed here, both raised directly by Ty:
--
-- 1. "Is there any way to determine why the flag exists?" - No: neither
--    flagCanceled() nor detectSilentNoShows() (gtfsMissedTripsPoll.ts) ever
--    wrote down which of the two detection signals fired - the information
--    was known at detection time and simply discarded. Adds detection_type
--    so every future row records it. Existing rows stay NULL (the frontend
--    shows "Unknown - flagged before detection tracking was added" for
--    those, honestly, rather than guessing).
--
-- 2. "Drop down menu in addition to investigation notes" - adds reason_code
--    alongside the existing free-text notes column, reusing OtpReasonCodes
--    (Administration already has real CRUD for it) with a third applies_to
--    value instead of standing up a whole separate reason-code table for
--    one more use case.
--
-- NVARCHAR(20) for applies_to, not (10) - "missed_trip" is 11 characters,
-- already wider than the original guess. Same lesson as migration-021/022's
-- day_of_week bug: widen generously instead of guessing tight again.

ALTER TABLE MonitoredMissedTrips ADD detection_type NVARCHAR(30) NULL;
GO
ALTER TABLE MonitoredMissedTrips ADD CONSTRAINT CK_MonitoredMissedTrips_DetectionType
    CHECK (detection_type IN ('explicit_cancellation', 'silent_no_show') OR detection_type IS NULL);
GO
ALTER TABLE MonitoredMissedTrips ADD reason_code NVARCHAR(30) NULL;
GO

ALTER TABLE OtpReasonCodes DROP CONSTRAINT CK_OtpReasonCodes_AppliesTo;
GO
ALTER TABLE OtpReasonCodes ALTER COLUMN applies_to NVARCHAR(20) NOT NULL;
GO
ALTER TABLE OtpReasonCodes ADD CONSTRAINT CK_OtpReasonCodes_AppliesTo
    CHECK (applies_to IN ('stop', 'date', 'missed_trip'));
GO

-- Starter set, editable via Administration like every other reason code -
-- covers both a "confirmed" outcome (an actual cause) and a "false_positive"
-- outcome (a detection-side explanation) with one shared list, since a
-- missed trip only ever gets one reason regardless of which way it resolved.
INSERT INTO OtpReasonCodes (code, label, applies_to, sort_order) VALUES
    ('VEHICLE_BREAKDOWN', 'Vehicle breakdown', 'missed_trip', 1),
    ('OPERATOR_NO_SHOW', 'Operator no-show', 'missed_trip', 2),
    ('DISPATCH_ERROR', 'Dispatch/scheduling error', 'missed_trip', 3),
    ('WEATHER', 'Weather/road conditions', 'missed_trip', 4),
    ('DETECTION_ERROR', 'Detection error (false positive)', 'missed_trip', 5),
    ('OTHER', 'Other', 'missed_trip', 6);
GO

PRINT 'Migration 023 applied: MonitoredMissedTrips.detection_type/reason_code added; OtpReasonCodes widened for missed_trip.';
