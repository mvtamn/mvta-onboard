-- Migration 018: OTP Compliance completion - persisted exclusions, reason
-- codes, detection-threshold setting.
--
-- Review Queue's stop-exclusion approvals and the Weather page's date
-- exclusions were, until now, ephemeral React state (reset on every page
-- reload) - fine for a preview, not for a real Audit Stream or a durable
-- "Official OTP %". This migration makes both persistent, and moves the two
-- previously-hardcoded reason-code lists (otpData.ts) and the early/late
-- bias threshold (also otpData.ts) into admin-editable settings, per the
-- owner's decisions in detour-and-event-module-implementation-plan.md's
-- sibling OTP-completion plan.

CREATE TABLE OtpReasonCodes (
    id           UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    code         NVARCHAR(30)  NOT NULL,
    label        NVARCHAR(100) NOT NULL,
    applies_to   NVARCHAR(10)  NOT NULL, -- 'stop' | 'date'
    is_active    BIT           NOT NULL DEFAULT 1,
    sort_order   INT           NOT NULL DEFAULT 0,
    updated_by   NVARCHAR(200) NULL,
    updated_at   DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),

    CONSTRAINT UX_OtpReasonCodes_Code_AppliesTo UNIQUE (code, applies_to),
    CONSTRAINT CK_OtpReasonCodes_AppliesTo CHECK (applies_to IN ('stop', 'date'))
);
GO

-- Seeded with the exact codes previously hardcoded in otpData.ts so nothing
-- regresses for existing users of the Review Queue / Weather pages.
INSERT INTO OtpReasonCodes (code, label, applies_to, sort_order) VALUES
    ('SCHED_RECOVERY', 'Scheduled recovery / layover', 'stop', 0),
    ('TERMINAL_HOLD', 'Terminal / station hold', 'stop', 1),
    ('NON_REVENUE', 'Non-revenue stop', 'stop', 2),
    ('SCHEDULE_DESIGN', 'Schedule design issue', 'stop', 3),
    ('DATA_QUALITY', 'Data quality issue', 'stop', 4),
    ('OTHER', 'Other', 'stop', 5),
    ('WEATHER_SNOW', 'Snow event', 'date', 0),
    ('WEATHER_ICE', 'Ice event', 'date', 1),
    ('WEATHER_FLOOD', 'Flooding', 'date', 2),
    ('EMERGENCY_ROAD', 'Emergency road closure', 'date', 3),
    ('DECLARED_EMERGENCY', 'Declared emergency', 'date', 4),
    ('OTHER', 'Other', 'date', 5);
GO

-- No row = still pending review - a candidate is derived live from
-- OtpMonthlyRouteStopDay + OtpSettings.early_late_bias_threshold; a row here
-- only exists once staff actually approve or reject it. computeOfficialPct's
-- exclusion math (Route Summary/Dashboard) reads this table now instead of
-- ephemeral client state, and re-reviewing the same stop/day upserts in place.
CREATE TABLE OtpStopExclusions (
    id            UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    service_month CHAR(6)       NOT NULL,
    route_id      INT           NOT NULL,
    stop_id       INT           NOT NULL,
    day_of_week   NVARCHAR(3)   NOT NULL,
    status        NVARCHAR(10)  NOT NULL, -- 'approved' | 'rejected'
    reason_code   NVARCHAR(30)  NULL,
    reviewed_by   NVARCHAR(200) NOT NULL,
    reviewed_at   DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),

    CONSTRAINT UX_OtpStopExclusions_Key UNIQUE (service_month, route_id, stop_id, day_of_week),
    CONSTRAINT CK_OtpStopExclusions_Status CHECK (status IN ('approved', 'rejected'))
);
GO

CREATE TABLE OtpDateExclusions (
    id           UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    scope        NVARCHAR(10)  NOT NULL, -- 'Agency' | 'Route'
    route_id     INT           NULL,
    service_date CHAR(8)       NOT NULL, -- YYYYMMDD
    reason_code  NVARCHAR(30)  NOT NULL,
    notes        NVARCHAR(500) NULL,
    status       NVARCHAR(10)  NOT NULL DEFAULT 'Proposed', -- 'Proposed' | 'Approved'
    notified     BIT           NOT NULL DEFAULT 0,
    notified_at  DATETIME2     NULL,
    acknowledged BIT           NOT NULL DEFAULT 0,
    created_by   NVARCHAR(200) NOT NULL,
    created_at   DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),

    CONSTRAINT CK_OtpDateExclusions_Scope CHECK (scope IN ('Agency', 'Route'))
);
GO

-- Single-row settings table (same convention intent as ExpirationDefaults,
-- just one row instead of one per category since there's only one detection
-- threshold today). The Threshold Tuner's "Apply" action is the only writer.
CREATE TABLE OtpSettings (
    id                        INT       NOT NULL PRIMARY KEY DEFAULT 1,
    early_late_bias_threshold FLOAT     NOT NULL DEFAULT 0.15,
    updated_by                NVARCHAR(200) NULL,
    updated_at                DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),

    CONSTRAINT CK_OtpSettings_SingleRow CHECK (id = 1)
);
GO

INSERT INTO OtpSettings (id) VALUES (1);
GO

PRINT 'Migration 018 applied: OtpReasonCodes (seeded), OtpStopExclusions, OtpDateExclusions, OtpSettings created.';
