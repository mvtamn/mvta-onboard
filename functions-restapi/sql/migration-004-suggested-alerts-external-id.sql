-- Migration 004: add external_id to SuggestedAlerts for feed dedup.
--
-- The GTFS-Realtime Alert poller (gtfsAlertsPoll.ts) runs on a timer and
-- re-fetches the same feed repeatedly - without a way to recognize an alert
-- it's already seen, every poll would insert a duplicate pending row for the
-- same ongoing CAD detour notice. external_id holds the feed's own entity ID
-- (source-specific: GTFS-RT Entity.Id today; a future Zona/SpareLabs producer
-- would use its own ID scheme under the same column).
--
-- Run once against the live database (private endpoint - see HANDOFF §5.7 for
-- the temporary-public-access procedure). GO separates batches.

ALTER TABLE SuggestedAlerts ADD external_id NVARCHAR(100) NULL;
GO

-- Filtered so it only constrains rows that actually have an external_id -
-- manually-created suggested alerts (if that ever exists) stay unconstrained.
CREATE UNIQUE INDEX UX_SuggestedAlerts_Source_ExternalId
    ON SuggestedAlerts (source, external_id)
    WHERE external_id IS NOT NULL;
GO

PRINT 'Migration 004 applied: SuggestedAlerts.external_id added.';
