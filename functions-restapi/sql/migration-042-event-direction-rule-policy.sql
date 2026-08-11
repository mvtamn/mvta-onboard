-- Make direction-rule precedence explicit and preserve the matched rule on a crossing.
WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY geofence_id, transition ORDER BY sort_order, id) - 1 AS normalized_priority
    FROM EventGeofenceDirectionRules
)
UPDATE rules SET sort_order = ranked.normalized_priority
FROM EventGeofenceDirectionRules rules
JOIN ranked ON ranked.id = rules.id;

ALTER TABLE EventGeofenceDirectionRules
  ADD CONSTRAINT UQ_EventGeofenceDirectionRules_Priority UNIQUE (geofence_id, transition, sort_order);

ALTER TABLE EventGeofenceCrossings
  ADD matched_rule_id UNIQUEIDENTIFIER NULL,
      matched_rule_priority INT NULL,
      matched_destination_location_id UNIQUEIDENTIFIER NULL,
      matched_send_mode NVARCHAR(10) NULL;
GO

ALTER TABLE EventGeofenceCrossings
  ADD CONSTRAINT CK_EventGeofenceCrossings_MatchedSendMode CHECK (matched_send_mode IS NULL OR matched_send_mode IN ('manual','auto'));
GO
PRINT 'Migration 042 applied: direction-rule precedence and crossing snapshots added.';
