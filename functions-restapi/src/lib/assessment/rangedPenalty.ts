// The tier that governs an occurrence's ranged penalty (migration 107), so
// the console can offer amount entry with the bounds in front of the
// reviewer. Resolved the way scoring resolves tiers (schemaScope
// periodTierScopeSql): the occurrence's Agreement - the contractor's active
// agreement covering the service date - and, if that Agreement has any tier
// rows for the standard effective on that date, only those; otherwise the
// catalog defaults. Effective dates are inclusive at both ends, as everywhere
// else. The qualifier's own band is preferred over the unqualified one, and
// the lowest tier first. `alias` is the ComplianceOccurrences alias in the
// enclosing query; `scoped` is false before migration 102, when no tier has
// an agreement.
export function rangedPenaltyBoundsSql(alias: string, scoped: boolean): string {
  const o = alias;
  const agreement = `(SELECT TOP 1 pa.id FROM PerformanceAgreements pa WHERE pa.contractor_id=${o}.contractor_id AND pa.is_active=1 AND CONVERT(date,${o}.service_date,112) BETWEEN pa.starts_on AND pa.ends_on)`;
  const effective = (t: string) => `${t}.effective_start_date<=${o}.service_date AND (${t}.effective_end_date IS NULL OR ${t}.effective_end_date>=${o}.service_date)`;
  const scope = scoped
    ? `AND (t.agreement_id=${agreement} OR (t.agreement_id IS NULL AND NOT EXISTS(SELECT 1 FROM ContractorStandardTiers x WHERE x.standard_id=t.standard_id AND x.agreement_id=${agreement} AND ${effective("x")})))`
    : "";
  return `OUTER APPLY (SELECT TOP 1 t.penalty_amount_min, t.penalty_amount_max FROM ContractorStandardTiers t
    WHERE t.standard_id=${o}.standard_id AND t.penalty_amount_min IS NOT NULL
      AND (t.qualifier_code IS NULL OR t.qualifier_code=${o}.qualifier_code)
      AND ${effective("t")} ${scope}
    ORDER BY CASE WHEN t.qualifier_code IS NOT NULL THEN 0 ELSE 1 END, t.tier_order, t.effective_start_date DESC) bounds`;
}
