-- Phase 1 schema - already deployed and verified against the live database.
-- Includes the summary column fix (was missing in an earlier version).
-- Run against a NEW database only - the live dev database already has this.

CREATE TABLE Messages (
    message_id          UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    raw_text             NVARCHAR(MAX)         NOT NULL,
    summary              NVARCHAR(500)         NULL,  -- Claude's short rider-facing summary, distinct from raw_text
    category             NVARCHAR(50)          NOT NULL,
    severity             NVARCHAR(20)          NOT NULL,
    routes_affected      NVARCHAR(MAX)         NULL,  -- JSON array
    stops_affected       NVARCHAR(MAX)         NULL,  -- JSON array
    zones_affected       NVARCHAR(MAX)         NULL,  -- JSON array, Zona zones
    tags                 NVARCHAR(MAX)         NULL,  -- JSON array, internal-only
    channels             NVARCHAR(MAX)         NULL,  -- JSON array; empty/null = all
    created_by           NVARCHAR(200)         NOT NULL,
    created_at           DATETIME2             NOT NULL DEFAULT SYSUTCDATETIME(),
    expires_at           DATETIME2             NOT NULL,
    expiration_source    NVARCHAR(20)          NOT NULL,  -- explicit, inferred_text, category_default
    status               NVARCHAR(20)          NOT NULL DEFAULT 'active',  -- active, expired, archived, retracted
    updated_at           DATETIME2             NOT NULL DEFAULT SYSUTCDATETIME(),

    CONSTRAINT CK_Messages_Category CHECK (category IN (
        'delay', 'detour', 'closure', 'outage', 'general', 'emergency', 'demand_response_delay'
    )),
    CONSTRAINT CK_Messages_Severity CHECK (severity IN (
        'informational', 'minor', 'major', 'critical'
    )),
    CONSTRAINT CK_Messages_ExpirationSource CHECK (expiration_source IN (
        'explicit', 'inferred_text', 'category_default'
    )),
    CONSTRAINT CK_Messages_Status CHECK (status IN (
        'active', 'expired', 'archived', 'retracted'
    ))
);

CREATE INDEX IX_Messages_Status_Expires ON Messages (status, expires_at);
CREATE INDEX IX_Messages_CreatedAt ON Messages (created_at DESC);

CREATE TABLE ExpirationDefaults (
    category             NVARCHAR(50)          PRIMARY KEY,
    default_ttl_minutes  INT                   NOT NULL,
    updated_by           NVARCHAR(200)         NULL,
    updated_at           DATETIME2             NOT NULL DEFAULT SYSUTCDATETIME(),

    CONSTRAINT CK_ExpirationDefaults_Category CHECK (category IN (
        'delay', 'detour', 'closure', 'outage', 'general', 'emergency', 'demand_response_delay'
    ))
);

INSERT INTO ExpirationDefaults (category, default_ttl_minutes) VALUES
    ('delay', 120),
    ('detour', 480),
    ('closure', 1440),
    ('outage', 480),
    ('general', 1440),
    ('emergency', 240),
    ('demand_response_delay', 120);

CREATE TABLE Subscribers (
    subscriber_id        UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    phone_number         NVARCHAR(20)          NULL,  -- E.164 format
    email                NVARCHAR(320)         NULL,
    routes               NVARCHAR(MAX)         NULL,  -- JSON array, or "ALL"
    zones                NVARCHAR(MAX)         NULL,  -- JSON array, or "ALL"
    categories           NVARCHAR(MAX)         NOT NULL,  -- JSON array
    status               NVARCHAR(30)          NOT NULL DEFAULT 'pending_confirmation',
    email_status         NVARCHAR(30)          NULL,
    opted_in_at          DATETIME2             NULL,
    opted_out_at         DATETIME2             NULL,
    consent_source       NVARCHAR(20)          NOT NULL,  -- web_form, mobile_app

    CONSTRAINT CK_Subscribers_Status CHECK (status IN (
        'pending_confirmation', 'confirmed', 'opted_out'
    )),
    CONSTRAINT CK_Subscribers_EmailStatus CHECK (email_status IS NULL OR email_status IN (
        'pending_confirmation', 'confirmed', 'unsubscribed'
    )),
    CONSTRAINT CK_Subscribers_ConsentSource CHECK (consent_source IN (
        'web_form', 'mobile_app'
    )),
    CONSTRAINT CK_Subscribers_HasContactMethod CHECK (
        phone_number IS NOT NULL OR email IS NOT NULL
    )
);

CREATE INDEX IX_Subscribers_Phone ON Subscribers (phone_number) WHERE phone_number IS NOT NULL;
CREATE INDEX IX_Subscribers_Email ON Subscribers (email) WHERE email IS NOT NULL;

CREATE TABLE SmsDeliveryLog (
    log_id               UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    message_id           UNIQUEIDENTIFIER      NOT NULL REFERENCES Messages(message_id),
    subscriber_id        UNIQUEIDENTIFIER      NOT NULL REFERENCES Subscribers(subscriber_id),
    sent_at              DATETIME2             NOT NULL DEFAULT SYSUTCDATETIME(),
    delivery_status      NVARCHAR(20)          NOT NULL,
    provider_message_id  NVARCHAR(200)         NULL,

    CONSTRAINT CK_SmsDeliveryLog_Status CHECK (delivery_status IN (
        'queued', 'sent', 'delivered', 'failed'
    ))
);

CREATE TABLE EmailDeliveryLog (
    log_id               UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    message_id           UNIQUEIDENTIFIER      NOT NULL REFERENCES Messages(message_id),
    subscriber_id        UNIQUEIDENTIFIER      NOT NULL REFERENCES Subscribers(subscriber_id),
    sent_at              DATETIME2             NOT NULL DEFAULT SYSUTCDATETIME(),
    delivery_status      NVARCHAR(20)          NOT NULL,
    provider_message_id  NVARCHAR(200)         NULL,

    CONSTRAINT CK_EmailDeliveryLog_Status CHECK (delivery_status IN (
        'queued', 'sent', 'bounced', 'failed'
    ))
);

PRINT 'Phase 1 schema created: Messages, ExpirationDefaults (seeded), Subscribers, SmsDeliveryLog, EmailDeliveryLog';
