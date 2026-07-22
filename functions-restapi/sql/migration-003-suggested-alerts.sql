-- Migration 003: SuggestedAlerts - the human-review queue for predictive
-- alerts (HANDOFF §2.3: NOTHING auto-publishes; staff approve or dismiss).
--
-- Detection feeds (GTFS-Realtime fixed-route delays, Zona wait times) arrive
-- in Phase 3 and will INSERT pending rows here. The queue endpoints and the
-- console tab are functional now so the workflow exists before the feeds do.
--
-- Run once against the live database (private endpoint - see HANDOFF §5.7 for
-- the temporary-public-access procedure). GO separates batches.

CREATE TABLE SuggestedAlerts (
    alert_id         UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    source           NVARCHAR(20)     NOT NULL,   -- gtfs_rt | zona
    draft_text       NVARCHAR(MAX)    NOT NULL,   -- proposed rider-facing text
    category         NVARCHAR(50)     NOT NULL,
    severity         NVARCHAR(20)     NOT NULL,
    routes_affected  NVARCHAR(MAX)    NULL,       -- JSON array
    zones_affected   NVARCHAR(MAX)    NULL,       -- JSON array
    detail           NVARCHAR(MAX)    NULL,       -- detection metadata JSON (delay min, confidence, ...)
    status           NVARCHAR(20)     NOT NULL DEFAULT 'pending',  -- pending | approved | dismissed
    created_at       DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
    reviewed_by      NVARCHAR(200)    NULL,
    reviewed_at      DATETIME2        NULL,
    message_id       UNIQUEIDENTIFIER NULL REFERENCES Messages(message_id),  -- set on approval

    CONSTRAINT CK_SuggestedAlerts_Source CHECK (source IN ('gtfs_rt', 'zona')),
    CONSTRAINT CK_SuggestedAlerts_Status CHECK (status IN ('pending', 'approved', 'dismissed')),
    CONSTRAINT CK_SuggestedAlerts_Category CHECK (category IN (
        'delay', 'detour', 'closure', 'outage', 'general', 'emergency', 'demand_response_delay'
    )),
    CONSTRAINT CK_SuggestedAlerts_Severity CHECK (severity IN (
        'informational', 'minor', 'major', 'critical'
    ))
);
GO

CREATE INDEX IX_SuggestedAlerts_Status ON SuggestedAlerts (status, created_at DESC);
GO

PRINT 'Migration 003 applied: SuggestedAlerts table created.';
