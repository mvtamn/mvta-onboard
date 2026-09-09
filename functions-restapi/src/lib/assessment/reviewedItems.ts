// One hash over every Assessment Item's reviewed_input_sha256, ordered by
// standard id so the same items always hash the same. The Validation Draft share records it; finalize recomputes it and
// refuses when it differs, so the amounts the contractor validated are the
// amounts finalization binds (ADR 0009). Computed in SQL so the share and the
// check cannot hash different things. `periodParam` is a bound parameter.
export function reviewedItemsSha256Sql(periodParam: string): string {
  return `CONVERT(CHAR(64),HASHBYTES('SHA2_256',(SELECT STRING_AGG(CONVERT(VARCHAR(MAX),ISNULL(reviewed_input_sha256,'')),'|') WITHIN GROUP (ORDER BY standard_id) FROM PeriodKpiAssessments WHERE period_id=@${periodParam})),2)`;
}
