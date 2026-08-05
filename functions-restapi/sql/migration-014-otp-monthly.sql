-- OTP Monthly By Route/Stop/Day of Week - Avail360's OtpByRouteStopDayAgg
-- feed, recommended primary feed in OTP-Feed-Evaluation-and-Recommendation.md
-- for continuous OTP compliance ingestion. Auto-aggregates to the whole
-- month containing whatever service date is passed, so this table is polled
-- frequently (see otpMonthlyFeedPoll.ts) and the current month's row simply
-- refines as the month progresses - it settles into its final value once the
-- month closes. Never deleted, so history accumulates permanently for trend
-- analysis, same convention as FixedRouteDepartures (migration-013).
CREATE TABLE OtpMonthlyRouteStopDay (
    service_month      CHAR(6)       NOT NULL, -- YYYYMM, the month containing the pulled service date
    route_id            INT          NOT NULL,
    stop_id              INT         NOT NULL,
    day_of_week          NVARCHAR(3) NOT NULL, -- 'Mon'..'Sun' as returned by Avail
    stop_name            NVARCHAR(200) NULL,
    route_label          NVARCHAR(100) NULL,
    pct_early            FLOAT       NULL,
    pct_ontime           FLOAT       NULL,
    pct_late             FLOAT       NULL,
    pct_not_ontime       FLOAT       NULL,
    pct_missed           FLOAT       NULL,
    early                INT         NULL,
    ontime               INT         NULL,
    late                 INT         NULL,
    missed               INT         NULL,
    actual_departures    INT         NULL,
    total                INT         NULL,
    first_seen_at        DATETIME2   NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at           DATETIME2   NOT NULL DEFAULT SYSUTCDATETIME(),

    CONSTRAINT PK_OtpMonthlyRouteStopDay PRIMARY KEY (service_month, route_id, stop_id, day_of_week)
);
CREATE INDEX IX_OtpMonthlyRouteStopDay_Route ON OtpMonthlyRouteStopDay (route_id, service_month);
