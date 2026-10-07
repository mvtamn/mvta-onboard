-- Migration 138: Avail pullout times are agency-local wall clock, not UTC.
--
-- Avail360's Pullout Reports send check-in, login and pullout times as local
-- wall clock carrying no zone. availPullout.parseNullableDate stored those
-- digits unchanged and everything downstream then read them as UTC. Three
-- defects follow, and this migration corrects the stored data for all three;
-- the matching code change lands with it.
--
--   1. Day assignment. pulloutServiceDate ran an already-local time through
--      agencyServiceDate, subtracting the agency offset a second time, so the
--      service day boundary fell at 05:00 local. Every run scheduled between
--      00:00 and 04:59 was filed under the PREVIOUS service date.
--
--   2. Settlement. Those misfiled rows belong to the roster Avail publishes at
--      02:30 local and keeps updating all day, so a service date was not
--      actually frozen until 02:30 local two days later, while
--      settledServiceDateExclusive() called it settled after one.
--      complianceCandidatesPoll only avoided raising candidates against
--      in-flight runs by happening to run a full day behind.
--
--   3. Display. The console's agencyTimeLabel converts the value it is given
--      from UTC into agency time, so every time on Fixed Route Garage
--      Departures read five hours early: a 04:41 pullout showed as 11:41 PM.
--
-- WHAT THIS CHANGES
--
--   * Every Avail timestamp is reinterpreted as agency-local and stored as the
--     instant it always meant, via AT TIME ZONE so each row gets its own DST
--     offset. first_seen_at and updated_at are NOT touched - those are
--     SYSUTCDATETIME() and were always genuinely UTC.
--   * service_date is re-derived from the corrected pullout_scheduled.
--   * Occurrences raised from a moved row have their source_ref, service_date
--     rewritten to match, because source_ref embeds the service date and is how
--     intake dedupes. service_month follows by itself, being a persisted
--     computed column over service_date.
--
-- THE DUPLICATES THIS HAS TO CLEAR FIRST
--
-- PK_FixedRouteDepartures is (service_date, block, run), and re-dating alone
-- violates it: the table already holds the same physical run twice under two
-- service dates - same block, same run, same scheduled time to the minute.
-- They are legacy double-inserts from when the service date came from the poll
-- clock rather than from the run's own garage times, and every one of them is
-- dated 2026-09-04 or earlier; none has appeared since that anchor changed.
--
-- The survivor of each pair is the more complete copy (most non-null evidence
-- fields, then the later updated_at, then the lower service_date so the choice
-- is deterministic). The loser's row is deleted, and its occurrence, if it has
-- one, is re-pointed at the survivor - or deleted when the survivor already
-- carries its own, since one physical departure must not hold two occurrences
-- against one scored standard (ADR 0028).
--
-- Deleting an occurrence is a departure from migration 088a's dismiss-never-
-- delete rule, and is allowed here only because these are unreviewed
-- auto_candidates that a bug raised twice for one departure - there is no
-- human judgement in them to preserve. The migration REFUSES TO APPLY if any
-- affected occurrence carries a review or sits in a finalized or issued
-- period; see the guards below.
--
-- Safe for assessments: PeriodKpiAssessments references occurrences by
-- ComplianceOccurrences:{id}, not by source_ref (see migration 097), so ids are
-- stable and a recompute sees the same occurrences.
--
-- Re-runnable, and it has to be guarded rather than merely idempotent: the
-- correction is a fixed +offset shift, so a second unguarded run would move
-- every time another five hours. Applying writes a marker into AppSettings
-- (avail_pullout / times_are_utc_since) and a later run stops on it.
--
-- PREVIEW FIRST. @apply defaults to 0: the migration prints every count and
-- changes nothing. Read the numbers, then set @apply = 1 and run it again.
--
-- Run once against the live database (private endpoint - see HANDOFF section
-- 5.7 for the temporary-public-access procedure).

SET XACT_ABORT ON;
SET NOCOUNT ON;

-- Set to 1 to apply. Leave at 0 to print the counts without changing anything.
DECLARE @apply BIT = 0;

DECLARE @AGENCY_TZ SYSNAME = N'Central Standard Time';

-- Rows the corrected poller has already written hold true UTC instants and must
-- NOT be shifted again. On dev the code reached main before this migration ran,
-- so 186 rows of the current roster were already correct by the time it did.
--
-- updated_at is the discriminator, because only the poller writes this table and
-- it stamps every MERGE. The boundary below was read off the data, not guessed:
-- there is no write at all between 03:50 and 04:01:40, and the two sides
-- separate cleanly against GTFS. Lining each block's pullout up against its own
-- first trip in TripStartLog (a genuine UTC instant), rows at or after the
-- boundary sit 10-37 minutes ahead of their first trip - the deadhead, so they
-- need no shift - and rows before it sit 310-336 minutes ahead, so they do.
--
-- Set this to a time before the first row this database holds if the corrected
-- poller has never run against it, which makes the whole table eligible.
DECLARE @utc_since DATETIME2 = '2026-09-22T04:00:00';

IF OBJECT_ID(N'dbo.FixedRouteDepartures', N'U') IS NULL
   OR OBJECT_ID(N'dbo.ComplianceOccurrences', N'U') IS NULL
   OR OBJECT_ID(N'dbo.AssessmentPeriods', N'U') IS NULL
   OR OBJECT_ID(N'dbo.AppSettings', N'U') IS NULL
BEGIN
    PRINT 'Migration 138 skipped: the departure, compliance, assessment or settings tables are not present.';
    RETURN;
END;

-- The shift is not idempotent, so a second run must not reach the data.
IF EXISTS (SELECT 1 FROM dbo.AppSettings
           WHERE module = N'avail_pullout' AND setting_key = N'times_are_utc_since')
BEGIN
    DECLARE @applied_on NVARCHAR(100) = (SELECT TOP (1) setting_value FROM dbo.AppSettings
                                         WHERE module = N'avail_pullout' AND setting_key = N'times_are_utc_since');
    PRINT CONCAT('Migration 138 already applied on ', @applied_on,
                 '; nothing to do. Re-running would shift every time a second time.');
    RETURN;
END;

-- ---------------------------------------------------------------------------
-- 1. Every row, as it should be stored.

IF OBJECT_ID(N'tempdb..#corrected') IS NOT NULL DROP TABLE #corrected;

WITH corrected AS (
  -- The wall clock is declared to be agency time, then converted to UTC - but
  -- only for a row the old code wrote. Per row, so a date either side of a DST
  -- boundary gets its own offset.
  SELECT d.*,
    CASE WHEN d.updated_at < @utc_since THEN CAST(d.checkin_scheduled AT TIME ZONE @AGENCY_TZ AT TIME ZONE N'UTC' AS DATETIME2) ELSE d.checkin_scheduled END AS c_checkin_scheduled,
    CASE WHEN d.updated_at < @utc_since THEN CAST(d.checkin_actual    AT TIME ZONE @AGENCY_TZ AT TIME ZONE N'UTC' AS DATETIME2) ELSE d.checkin_actual    END AS c_checkin_actual,
    CASE WHEN d.updated_at < @utc_since THEN CAST(d.login_scheduled   AT TIME ZONE @AGENCY_TZ AT TIME ZONE N'UTC' AS DATETIME2) ELSE d.login_scheduled   END AS c_login_scheduled,
    CASE WHEN d.updated_at < @utc_since THEN CAST(d.login_actual      AT TIME ZONE @AGENCY_TZ AT TIME ZONE N'UTC' AS DATETIME2) ELSE d.login_actual      END AS c_login_actual,
    CASE WHEN d.updated_at < @utc_since THEN CAST(d.pullout_scheduled AT TIME ZONE @AGENCY_TZ AT TIME ZONE N'UTC' AS DATETIME2) ELSE d.pullout_scheduled END AS c_pullout_scheduled,
    CASE WHEN d.updated_at < @utc_since THEN CAST(d.pullout_actual    AT TIME ZONE @AGENCY_TZ AT TIME ZONE N'UTC' AS DATETIME2) ELSE d.pullout_actual    END AS c_pullout_actual
  FROM dbo.FixedRouteDepartures d
)
SELECT
    d.service_date  AS old_service_date,
    d.block,
    d.run,
    d.c_checkin_scheduled AS checkin_scheduled,
    d.c_checkin_actual    AS checkin_actual,
    d.c_login_scheduled   AS login_scheduled,
    d.c_login_actual      AS login_actual,
    d.c_pullout_scheduled AS pullout_scheduled,
    d.c_pullout_actual    AS pullout_actual,
    d.pullout_status, d.operator_name, d.logon_id, d.vehicle_label,
    d.first_seen_at, d.updated_at,
    -- Every row now holds a true UTC instant, so the service date is simply the
    -- agency-local calendar date of the run's own scheduled pullout - the same
    -- anchor order pulloutServiceDate uses, so the backfill and the poller agree
    -- row for row.
    CONVERT(CHAR(8), COALESCE(d.c_pullout_scheduled, d.c_login_scheduled, d.c_checkin_scheduled,
                              d.c_pullout_actual,    d.c_login_actual,    d.c_checkin_actual)
                     AT TIME ZONE N'UTC' AT TIME ZONE @AGENCY_TZ, 112) AS new_service_date,
    -- How complete this copy is, for picking the survivor of a duplicate pair.
    (CASE WHEN d.pullout_actual  IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN d.login_actual    IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN d.checkin_actual  IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN d.pullout_status  IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN d.operator_name   IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN d.vehicle_label   IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN d.logon_id        IS NOT NULL THEN 1 ELSE 0 END) AS completeness
INTO #corrected
FROM corrected d;

-- A row with no usable timestamp at all cannot be re-dated from evidence and
-- is left exactly where it is rather than guessed at.
UPDATE #corrected SET new_service_date = old_service_date WHERE new_service_date IS NULL;

ALTER TABLE #corrected ADD keep BIT NOT NULL DEFAULT 0;
ALTER TABLE #corrected ADD old_source_ref NVARCHAR(300) NULL, new_source_ref NVARCHAR(300) NULL;

UPDATE #corrected
SET old_source_ref = CONCAT(N'FixedRouteDepartures:avail_pullout:', old_service_date, N'|', block, N'|', run),
    new_source_ref = CONCAT(N'FixedRouteDepartures:avail_pullout:', new_service_date, N'|', block, N'|', run);

-- ---------------------------------------------------------------------------
-- 2. Pick the survivor of each duplicate key.

WITH ranked AS (
    SELECT keep,
           ROW_NUMBER() OVER (PARTITION BY new_service_date, block, run
                              ORDER BY completeness DESC, updated_at DESC, old_service_date ASC) AS rn
    FROM #corrected
)
UPDATE ranked SET keep = 1 WHERE rn = 1;

DECLARE @rows_total     INT = (SELECT COUNT(*) FROM #corrected);
DECLARE @losers         INT = (SELECT COUNT(*) FROM #corrected WHERE keep = 0);
DECLARE @redated        INT = (SELECT COUNT(*) FROM #corrected WHERE keep = 1 AND new_service_date <> old_service_date);
DECLARE @dup_keys       INT = (SELECT COUNT(*) FROM (SELECT new_service_date, block, run FROM #corrected
                                                     GROUP BY new_service_date, block, run HAVING COUNT(*) > 1) x);
DECLARE @loser_max_date CHAR(8) = (SELECT MAX(old_service_date) FROM #corrected WHERE keep = 0);

DECLARE @already_utc INT = (SELECT COUNT(*) FROM #corrected WHERE updated_at >= @utc_since);

PRINT CONCAT('Migration 138: ', @rows_total, ' departure rows held; ', @already_utc,
             ' already written by the corrected poller and shifted by nothing.');
PRINT CONCAT('Migration 138: ', @dup_keys, ' duplicate keys after correction; ', @losers,
             ' duplicate rows will be deleted (latest is dated ', ISNULL(@loser_max_date, '-'), ').');
PRINT CONCAT('Migration 138: ', @redated, ' surviving rows change service_date.');

-- ---------------------------------------------------------------------------
-- 3. The occurrences riding on those rows.

IF OBJECT_ID(N'tempdb..#occ') IS NOT NULL DROP TABLE #occ;

SELECT o.id, o.review_status, o.source, o.service_month AS old_service_month,
       c.keep, c.new_service_date, c.new_source_ref,
       LEFT(c.new_service_date, 6) AS new_service_month,
       o.contractor_id,
       -- Set when this row is a loser AND the survivor of its pair already
       -- carries an occurrence: re-pointing would collide on UX_CO_SourceRef,
       -- and two occurrences for one departure is what ADR 0028 forbids.
       CASE WHEN c.keep = 0 AND EXISTS (
              SELECT 1 FROM dbo.ComplianceOccurrences s
              JOIN #corrected sc ON sc.old_source_ref = s.source_ref
              WHERE sc.keep = 1 AND sc.new_service_date = c.new_service_date
                AND sc.block = c.block AND sc.run = c.run)
            THEN 1 ELSE 0 END AS superseded
INTO #occ
FROM dbo.ComplianceOccurrences o
JOIN #corrected c ON c.old_source_ref = o.source_ref;

DECLARE @occ_total      INT = (SELECT COUNT(*) FROM #occ);
DECLARE @occ_repointed  INT = (SELECT COUNT(*) FROM #occ WHERE keep = 0 AND superseded = 0);
DECLARE @occ_deleted    INT = (SELECT COUNT(*) FROM #occ WHERE keep = 0 AND superseded = 1);
DECLARE @occ_month_move INT = (SELECT COUNT(*) FROM #occ WHERE keep = 1 AND ISNULL(old_service_month, '') <> new_service_month);
-- Most occurrences sit on a row that does not move: their reference is
-- rewritten to the same string they already hold. Only these actually change.
DECLARE @occ_redated    INT = (SELECT COUNT(*) FROM #occ x
                    JOIN dbo.ComplianceOccurrences o ON o.id = x.id
                    WHERE x.keep = 1 AND o.source_ref <> x.new_source_ref);

PRINT CONCAT('Migration 138: ', @occ_total, ' garage-departure occurrences read; ',
             @occ_redated, ' change service_date and reference, ', @occ_month_move,
             ' of those change assessment month.');
PRINT CONCAT('Migration 138: ', @occ_repointed, ' occurrence(s) re-pointed from a deleted duplicate to its survivor; ',
             @occ_deleted, ' deleted as a second occurrence for one physical departure.');

-- ---------------------------------------------------------------------------
-- 4. Guards. Anything here means a person decides, not this script.

DECLARE @reviewed INT = (SELECT COUNT(*) FROM #occ
                         WHERE keep = 0 AND (review_status <> N'candidate' OR source <> N'auto_candidate'));
DECLARE @frozen INT = (SELECT COUNT(*) FROM #occ o
                       JOIN dbo.AssessmentPeriods p ON p.contractor_id = o.contractor_id
                        AND p.service_month IN (o.old_service_month, o.new_service_month)
                       WHERE p.status IN (N'finalized', N'issued'));

IF @reviewed > 0
BEGIN
    PRINT CONCAT('Migration 138 ABORTED: ', @reviewed, ' occurrence(s) on a duplicate row carry a review. ',
                 'Deleting or re-pointing somebody''s decision is not this migration''s call - resolve them by hand first.');
    RETURN;
END;

IF @frozen > 0
BEGIN
    PRINT CONCAT('Migration 138 ABORTED: ', @frozen, ' occurrence(s) sit in a finalized or issued period, whose inputs are frozen.');
    RETURN;
END;

IF EXISTS (SELECT 1 FROM #corrected WHERE keep = 1
           GROUP BY new_service_date, block, run HAVING COUNT(*) > 1)
BEGIN
    PRINT 'Migration 138 ABORTED: the corrected rows are not unique on (service_date, block, run).';
    RETURN;
END;

-- Every occurrence that still exists afterwards, kept or re-pointed, must
-- land on a source_ref nothing else holds - including occurrences this
-- migration never touches, whose references stay as they are.
IF EXISTS (SELECT 1 FROM #occ WHERE NOT (keep = 0 AND superseded = 1)
           GROUP BY new_source_ref HAVING COUNT(*) > 1)
BEGIN
    PRINT 'Migration 138 ABORTED: the rewritten source_refs are not unique among themselves; UX_CO_SourceRef would be violated.';
    RETURN;
END;

IF EXISTS (SELECT 1 FROM #occ x
           JOIN dbo.ComplianceOccurrences o ON o.source_ref = x.new_source_ref
           WHERE NOT (x.keep = 0 AND x.superseded = 1)
             AND o.id <> x.id
             AND NOT EXISTS (SELECT 1 FROM #occ y WHERE y.id = o.id))
BEGIN
    PRINT 'Migration 138 ABORTED: a rewritten source_ref collides with an occurrence this migration does not touch.';
    RETURN;
END;

IF @apply = 0
BEGIN
    PRINT 'Migration 138: preview only (@apply = 0); nothing was changed. Set @apply = 1 to apply.';
    PRINT 'Migration 138: a sample of what would change, newest first -';
    SELECT TOP (8)
        old_service_date, new_service_date, block, run,
        CONVERT(VARCHAR(19), (SELECT d.pullout_scheduled FROM dbo.FixedRouteDepartures d
                              WHERE d.service_date = c.old_service_date AND d.block = c.block AND d.run = c.run), 120) AS stored_now,
        CONVERT(VARCHAR(19), c.pullout_scheduled, 120) AS stored_after_utc,
        c.pullout_status
    FROM #corrected c
    WHERE c.keep = 1 AND c.new_service_date <> c.old_service_date
    ORDER BY c.new_service_date DESC, c.block;
    RETURN;
END;

-- ---------------------------------------------------------------------------
-- 5. Apply.

BEGIN TRANSACTION;

-- Occurrences first, while source_ref still names the row it was raised from.
DELETE o FROM dbo.ComplianceOccurrences o JOIN #occ x ON x.id = o.id WHERE x.keep = 0 AND x.superseded = 1;

UPDATE o
SET source_ref = x.new_source_ref
FROM dbo.ComplianceOccurrences o
JOIN #occ x ON x.id = o.id
WHERE x.keep = 0 AND x.superseded = 0;

-- service_month is a persisted computed column over service_date
-- (LEFT(service_date, 6)), so it follows on its own and must not be assigned.
UPDATE o
SET source_ref   = x.new_source_ref,
    service_date = x.new_service_date
FROM dbo.ComplianceOccurrences o
JOIN #occ x ON x.id = o.id
WHERE x.keep = 1;

-- A month whose inputs moved is recomputed, exactly as the review endpoint
-- does it. Finalized and issued periods were excluded by the guard above.
UPDATE p
SET input_revision = p.input_revision + 1,
    status = CASE WHEN p.status IN (N'in_review', N'stale') THEN N'stale' ELSE p.status END
FROM dbo.AssessmentPeriods p
WHERE p.status NOT IN (N'finalized', N'issued')
  AND EXISTS (SELECT 1 FROM #occ x
              WHERE x.contractor_id = p.contractor_id
                AND p.service_month IN (x.old_service_month, x.new_service_month));

-- The rows themselves. Rebuilt rather than updated in place: re-dating
-- permutes the primary key, and emptying the table first makes that
-- unambiguous instead of relying on how an UPDATE orders its key changes.
DELETE FROM dbo.FixedRouteDepartures;

INSERT INTO dbo.FixedRouteDepartures
    (service_date, block, run, checkin_scheduled, checkin_actual, login_scheduled, login_actual,
     pullout_scheduled, pullout_actual, pullout_status, operator_name, logon_id, vehicle_label,
     first_seen_at, updated_at)
SELECT new_service_date, block, run, checkin_scheduled, checkin_actual, login_scheduled, login_actual,
       pullout_scheduled, pullout_actual, pullout_status, operator_name, logon_id, vehicle_label,
       first_seen_at, updated_at
FROM #corrected WHERE keep = 1;

-- The marker that stops a second run. Written inside the transaction, so it
-- exists if and only if the shift did.
INSERT INTO dbo.AppSettings (module, setting_key, setting_value, value_type, description, updated_by, updated_at)
VALUES (N'avail_pullout', N'times_are_utc_since',
        CONVERT(NVARCHAR(30), SYSUTCDATETIME(), 126), N'string',
        N'When migration 138 reinterpreted Avail pullout times as agency-local and stored them as UTC. Its presence is what stops that shift being applied twice.',
        N'migration-138', SYSUTCDATETIME());

DECLARE @written INT = (SELECT COUNT(*) FROM dbo.FixedRouteDepartures);
IF @written <> @rows_total - @losers
BEGIN
    ROLLBACK;
    PRINT CONCAT('Migration 138 ROLLED BACK: wrote ', @written, ' rows, expected ', @rows_total - @losers, '.');
    RETURN;
END;

COMMIT;

PRINT CONCAT('Migration 138 applied: ', @written, ' departure rows now hold UTC instants; ',
             @losers, ' duplicates removed; ', @redated, ' re-dated; ',
             @occ_repointed + @occ_deleted + @occ_month_move, ' occurrences adjusted.');
