-- Migration 025: Detour reporting fields (Part B6 of
-- detour-module-consolidated-plan.md).
--
-- Adds the ops-reporting layer on top of the day-to-day intake fields from
-- migration-017: a reason category, a severity, who reported/approved it,
-- three more notification-channel flags, and resolution notes.
--
-- IMPORTANT CAVEAT, CARRIED FROM THE PLAN: there is no document describing
-- MVTA's actual internal detour-reporting form. Every column below is a
-- draft built from standard transit-ops practice layered onto the existing
-- Excel tracker, approved as-drafted by the owner on 2026-08-07 with the
-- explicit understanding that it may need correcting against the real form.
-- Nothing here is required by the API, so a column that turns out to be
-- wrong can be dropped without breaking existing rows or the console.
--
-- Every column is NULLABLE (or has a default) because Detours already holds
-- rows - same constraint that forced migration-024's internal_number to be
-- added nullable.

-- Mirrors OtpReasonCodes (migration-018) exactly, minus `applies_to` - this
-- table only ever serves one consumer, so there is nothing to partition by.
CREATE TABLE DetourReasonCodes (
    id          UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    code        NVARCHAR(30)  NOT NULL,
    label       NVARCHAR(100) NOT NULL,
    is_active   BIT           NOT NULL DEFAULT 1,
    sort_order  INT           NOT NULL DEFAULT 0,
    updated_by  NVARCHAR(200) NULL,
    updated_at  DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),

    CONSTRAINT UX_DetourReasonCodes_Code UNIQUE (code)
);
GO

-- Draft seed - CONFIRM AGAINST MVTA'S REAL CATEGORIES. The reviewed Aug 2026
-- notices establish at least special_event (Food Truck Festival) and
-- city_county_project/construction (UofM Washington Ave, Cliff/Diffley ramps)
-- as genuinely active categories; the rest are standard-practice guesses.
-- Codes are admin-editable at runtime (is_active/label/sort_order via
-- PATCH /detour-reason-codes), so correcting this list does not need a
-- migration - only adding or retiring a code does.
INSERT INTO DetourReasonCodes (code, label, sort_order) VALUES
    ('construction',        'Construction',                 0),
    ('accident_crash',      'Accident / crash',             1),
    ('weather',             'Weather',                      2),
    ('special_event',       'Special event',                3),
    ('utility_work',        'Utility work',                 4),
    ('city_county_project', 'City / county project',        5),
    ('parade_race',         'Parade / race',                6),
    ('other',               'Other',                        7);
GO

-- reason_code is a SOFT reference to DetourReasonCodes.code, deliberately
-- not an FK - same convention as OtpStopExclusions.reason_code. Retiring a
-- code (is_active = 0) must not orphan or block the historical detours that
-- already cite it, which a real FK would make awkward.
ALTER TABLE Detours ADD
    reason_code             NVARCHAR(30)   NULL,
    severity                NVARCHAR(10)   NULL,
    reported_by             NVARCHAR(200)  NULL,
    reported_at             DATETIME2      NULL,
    approved_by             NVARCHAR(200)  NULL,
    approved_at             DATETIME2      NULL,
    radio_notified          BIT            NOT NULL DEFAULT 0,
    dispatch_board_notified BIT            NOT NULL DEFAULT 0,
    social_media_notified   BIT            NOT NULL DEFAULT 0,
    resolution_notes        NVARCHAR(1000) NULL;
GO

-- Draft 3-tier scale - confirm whether MVTA uses a different scale, or none.
-- Written as a NULL-tolerant check so "severity not assessed" stays a valid
-- state rather than forcing every historical row into a bucket.
ALTER TABLE Detours ADD CONSTRAINT CK_Detours_Severity
    CHECK (severity IS NULL OR severity IN ('minor', 'moderate', 'major'));
GO

-- Supports the Detour Reports page's (Part B7) reason-category filter. The
-- filtered index skips the large tail of rows with no category assigned,
-- which pre-B6 rows all are.
CREATE INDEX IX_Detours_ReasonCode ON Detours (reason_code)
    WHERE reason_code IS NOT NULL;
GO

PRINT 'Migration 025 applied: DetourReasonCodes created and seeded, Detours reporting columns added.';
