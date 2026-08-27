import { app, type InvocationContext } from "@azure/functions";
import { getPool } from "../lib/db";
import { loadKpiTrust } from "../lib/kpiTrustStore";

// Existing feed-specific review remains authoritative. This poller only copies
// eligible observations into the governed assessment queue and never confirms
// contractor attribution or creates a penalty.
app.timer("complianceCandidatesPoll", {
  schedule: "0 20 6 * * *",
  handler: async (_timer, context: InvocationContext) => {
    try {
      const pool = await getPool();
      const trust = await loadKpiTrust(pool);
      const allowFixedMissedTrips = trust.fixed_route_missed_trips.state === "current";
      const allowSpareMissedTrips = trust.spare_missed_trips.state === "current";
      const ready = await pool.request().query<{ ready: number }>(`
        SELECT CASE WHEN OBJECT_ID('dbo.ComplianceOccurrences','U') IS NOT NULL
          AND OBJECT_ID('dbo.MonitoredMissedTrips','U') IS NOT NULL
          AND OBJECT_ID('dbo.FixedRouteDepartures','U') IS NOT NULL THEN 1 ELSE 0 END ready
      `);
      if (!ready.recordset[0]?.ready) { context.warn("Compliance candidate tables are not ready; migration 030 may be pending."); return; }
      const candidateRequest = pool.request();
      candidateRequest.input("allow_fixed_missed_trips", allowFixedMissedTrips ? 1 : 0);
      candidateRequest.input("allow_spare_missed_trips", allowSpareMissedTrips ? 1 : 0);
      const result = await candidateRequest.query<{ inserted: number }>(`
        DECLARE @contractor UNIQUEIDENTIFIER=(SELECT TOP 1 id FROM Contractors WHERE is_active=1 ORDER BY updated_at DESC);
        IF @contractor IS NULL THROW 50001,'No active contractor is configured.',1;
        DECLARE @agreement_start DATE,@agreement_end DATE;
        SELECT TOP 1 @agreement_start=starts_on,@agreement_end=ends_on FROM PerformanceAgreements WHERE contractor_id=@contractor AND is_active=1;
        IF @agreement_start IS NULL THROW 50002,'No active Performance Agreement is configured.',1;
        DECLARE @inserted TABLE(id UNIQUEIDENTIFIER);

        MERGE ComplianceOccurrences WITH(HOLDLOCK) target
        USING (
          SELECT standard.id standard_id,@contractor contractor_id,LEFT(m.service_date,8) service_date,
            1 quantity,CAST(NULL AS INT) duration_days,CAST(NULL AS NVARCHAR(50)) qualifier_code,
            CONCAT(N'Missed trip ',m.trip_id,N' on route ',m.route_id) description,
            CONCAT(N'MonitoredMissedTrips:',ISNULL(m.source_system,N'gtfs'),N':',ISNULL(m.source_record_id,m.trip_id),N'|',m.service_date) source_ref
          FROM MonitoredMissedTrips m CROSS JOIN ContractorPerformanceStandards standard
          WHERE standard.code='MISSED_TRIPS_FR' AND m.validation_status='confirmed' AND CONVERT(date,m.service_date,112) BETWEEN @agreement_start AND @agreement_end
            AND ((ISNULL(m.source_system,N'gtfs')=N'spare' AND @allow_spare_missed_trips=1)
              OR (ISNULL(m.source_system,N'gtfs')<>N'spare' AND @allow_fixed_missed_trips=1))
        ) source ON target.source_ref=source.source_ref
        WHEN NOT MATCHED THEN INSERT(standard_id,contractor_id,service_date,quantity,duration_days,qualifier_code,description,source,source_ref,review_status,attribution,created_by)
          VALUES(source.standard_id,source.contractor_id,source.service_date,source.quantity,source.duration_days,source.qualifier_code,source.description,'auto_candidate',source.source_ref,'candidate','undetermined','complianceCandidatesPoll')
        OUTPUT inserted.id INTO @inserted;

        MERGE ComplianceOccurrences WITH(HOLDLOCK) target
        USING (
          SELECT standard.id standard_id,@contractor contractor_id,d.service_date,1 quantity,
            CONCAT(N'Garage departure ',d.pullout_status,N' — block ',d.block,N', run ',d.run) description,
            CONCAT(N'FixedRouteDepartures:',d.service_date,N'|',d.block,N'|',d.run) source_ref
          FROM FixedRouteDepartures d CROSS JOIN ContractorPerformanceStandards standard
          WHERE standard.code='GARAGE_DEPARTURE' AND d.pullout_status IN ('Late Relief','Expired Pullout') AND CONVERT(date,d.service_date,112) BETWEEN @agreement_start AND @agreement_end
        ) source ON target.source_ref=source.source_ref
        WHEN NOT MATCHED THEN INSERT(standard_id,contractor_id,service_date,quantity,description,source,source_ref,review_status,attribution,created_by)
          VALUES(source.standard_id,source.contractor_id,source.service_date,source.quantity,source.description,'auto_candidate',source.source_ref,'candidate','undetermined','complianceCandidatesPoll')
        OUTPUT inserted.id INTO @inserted;

        SELECT COUNT(*) inserted FROM @inserted;
      `);
      context.log(`Compliance candidates: ${result.recordset[0]?.inserted ?? 0} new rows.`);
    } catch (error) { context.error("complianceCandidatesPoll failed", error); }
  },
});
