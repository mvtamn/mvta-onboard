// The tier that governs an occurrence's ranged penalty (migration 107): same
// standard, the band effective on the occurrence's service date, and the
// qualifier's own band ahead of the unqualified one. Joined onto the
// occurrence list so the console can offer amount entry with the bounds in
// front of the reviewer. `alias` is the ComplianceOccurrences alias in the
// enclosing query; the applied columns are penalty_amount_min/max.
export function rangedPenaltyBoundsSql(alias: string): string {
  return `OUTER APPLY (SELECT TOP 1 t.penalty_amount_min, t.penalty_amount_max FROM ContractorStandardTiers t
    WHERE t.standard_id=${alias}.standard_id AND t.penalty_amount_min IS NOT NULL
      AND (t.qualifier_code IS NULL OR t.qualifier_code=${alias}.qualifier_code)
      AND t.effective_start_date<=${alias}.service_date AND (t.effective_end_date IS NULL OR t.effective_end_date>${alias}.service_date)
    ORDER BY CASE WHEN t.qualifier_code=${alias}.qualifier_code THEN 0 ELSE 1 END, t.effective_start_date DESC) bounds`;
}
