-- Migration 010: authoritative MVTA route registry from static GTFS.
--
-- GtfsRoutes is populated by the existing daily static-feed synchronization.
-- It preserves the customer-facing short/long names, GTFS mode, display
-- colors, and route order supplied by MVTA's current routes.txt file.
--
-- Run after migration-009. The next gtfsStopsSync timer execution will
-- replace the table contents with the current MVTA route list.

CREATE TABLE GtfsRoutes (
    route_id         NVARCHAR(50)  NOT NULL PRIMARY KEY,
    agency_id        NVARCHAR(50)  NULL,
    route_short_name NVARCHAR(100) NULL,
    route_long_name  NVARCHAR(250) NULL,
    route_desc       NVARCHAR(500) NULL,
    route_type       INT           NOT NULL,
    route_url        NVARCHAR(500) NULL,
    route_color      NVARCHAR(10)  NULL,
    route_text_color NVARCHAR(10)  NULL,
    route_sort_order INT           NULL,
    updated_at       DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),

    CONSTRAINT CK_GtfsRoutes_HasName CHECK (
        route_short_name IS NOT NULL OR route_long_name IS NOT NULL
    )
);
GO

CREATE INDEX IX_GtfsRoutes_SortOrder
    ON GtfsRoutes (route_sort_order, route_short_name);
GO

-- Initial snapshot from MVTA's static GTFS routes.txt on 2026-07-27.
-- The daily sync replaces this snapshot, so the registry follows future
-- service changes without another migration.
INSERT INTO GtfsRoutes (
    route_id, agency_id, route_short_name, route_long_name, route_desc,
    route_type, route_url, route_color, route_text_color, route_sort_order
) VALUES
    ('420', '0', '420', 'Apple Valley-Rosemount-DCTC', 'Rt Rosemount-Apple Valley', 3, NULL, 'c34b18', 'ffffff', 420),
    ('425', '0', 'Orange LINK', 'Orange LINK: Apple Valley-Burnsville-Eag', 'Rt Orange LINK', 3, NULL, 'c34b18', 'ffffff', 400),
    ('436', '0', '436', '46th St Station-MSP-Viking Lakes-Eagan', 'Rt Eagan Hwy 55 Rev Comm', 3, NULL, 'c34b18', 'ffffff', 436),
    ('440', '0', '440', 'Apple Valley-Zoo-Cedar Grove-MOA-VA', 'Rt Apple Valley-Cedar Grove-VA Hospital', 3, NULL, '01543d', 'FFFFFF', 440),
    ('442', '0', '442', 'Burnsville-Apple Valley', 'Rt Burnsville Center-Apple Valley', 3, NULL, 'c34b18', 'FFFFFF', 442),
    ('444', '0', '444', 'Savage-Burnsville-Cedar Grove-MOA', 'Rt Savage-Burnsville-Mall of America', 3, NULL, '01543d', 'FFFFFF', 444),
    ('445', '0', '445', 'Cedar Grove-Eagan-YMCA', 'Rt Eagan-Cedar Grove', 3, NULL, 'c34b18', 'FFFFFF', 445),
    ('446', '0', '446', '46th St Station-Eagan', 'Rt Eagan-46th Street LRT', 3, NULL, '01543d', 'ffffff', 446),
    ('447', '0', '447', 'Apple Valley-Burnsville-Savage-Mystic', 'Rt Apple Valley-Prior Lake', 3, NULL, '01543d', 'ffffff', 447),
    ('460', '0', '460', 'Savage-Burnsville-Mpls', 'Rt Burnsville-Minneapolis', 3, NULL, 'c700c7', 'ffffff', 460),
    ('465', '0', '465', 'Burnsville-Bloomington-Mpls-UMN', 'Rt Burnsville-Minneapolis-U of M', 3, NULL, '7A0019', 'ffffff', 465),
    ('470', '0', '470', 'Rosemount-Eagan-Mpls', 'Rt Eagan-Minneapolis', 3, NULL, 'c700c7', 'FFFFFF', 470),
    ('475', '0', '475', 'Apple Valley-Cedar Grove-Mpls-UMN', 'Rt Apple Valley-Cedar Grove-Mpls/U of M', 3, NULL, '7A0019', 'ffffff', 475),
    ('477', '0', '477', 'Lakeville-Apple Valley-Mpls', 'Rt Lakeville/Apple Valley-Mpls', 3, NULL, 'c700c7', 'ffffff', 477),
    ('480', '0', '480', 'Dakota County-St Paul', 'Rt Apple Valley/Burnsville-St Paul', 3, NULL, 'c700c7', 'ffffff', 480),
    ('490', '0', '490', 'Prior Lake-Shakopee-Mpls-UMN', 'Rt Prior Lake-Shakopee-Minneapolis', 3, NULL, '7A0019', 'ffffff', 490),
    ('493', '0', '493', 'Shakopee-Mpls', 'Rt Shakopee-Minneapolis', 3, NULL, 'c700c7', 'ffffff', 493),
    ('495', '0', '495', '4FUN: Shakopee-Savage-Burnsville-MOA-MSP', 'Rt Shakopee-Burnsville-Mall of America', 3, NULL, '0000ff', 'FFFFFF', 495),
    ('497', '0', '497', 'Shakopee-Gov Center', 'Rt Downtown Shakopee', 3, NULL, 'c34b18', 'ffffff', 497),
    ('499', '0', '499', 'Shakopee-High School-Walmart', 'Rt Shakopee-Southbridge', 3, NULL, '01543d', 'ffffff', 499);
GO

PRINT 'Migration 010 applied: GtfsRoutes created and seeded with 20 current MVTA routes.';
