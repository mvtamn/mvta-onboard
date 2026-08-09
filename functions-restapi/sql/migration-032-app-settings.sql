-- Migration 032: reusable application settings and timer-poller state.

CREATE TABLE AppSettings (
    id            INT IDENTITY(1,1) PRIMARY KEY,
    module        NVARCHAR(50)  NOT NULL,
    setting_key   NVARCHAR(100) NOT NULL,
    setting_value NVARCHAR(500) NOT NULL,
    value_type    NVARCHAR(20)  NOT NULL DEFAULT 'string',
    min_value     NVARCHAR(50)  NULL,
    max_value     NVARCHAR(50)  NULL,
    description   NVARCHAR(300) NULL,
    updated_by    NVARCHAR(200) NULL,
    updated_at    DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_AppSettings_ModuleKey UNIQUE (module, setting_key),
    CONSTRAINT CK_AppSettings_ValueType CHECK (value_type IN ('int', 'string', 'bool', 'decimal'))
);
GO

INSERT INTO AppSettings
    (module, setting_key, setting_value, value_type, min_value, max_value, description)
VALUES
    ('event', 'poll_interval_seconds', '30', 'int', '15', '300',
     'How often Avail AVL data is fetched for live Event Monitoring.');
GO

-- Runtime cursor is deliberately separate from editable configuration.
-- The conditional update in the poller acts as a database-backed lease so
-- only one scaled Function App instance performs a due poll.
CREATE TABLE AppPollState (
    module      NVARCHAR(50) NOT NULL PRIMARY KEY,
    last_run_at DATETIME2    NULL,
    updated_at  DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

INSERT INTO AppPollState (module, last_run_at) VALUES ('event', NULL);
GO

PRINT 'Migration 032 applied: AppSettings and AppPollState created; event poll interval seeded at 30 seconds.';
