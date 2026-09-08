// The vocabulary every picker in the standards configurator reads from.
//
// Two classes of domain, because they are not alike:
//
//   OWNED     units, source systems, condition codes, responsible teams,
//             assigned owners, priorities. Lists MVTA maintains. Add, rename,
//             reorder, retire. The engine does not branch on any of them, so
//             none needs the system-row guardrail.
//
//   SYSTEM    penalty_basis, tier_label, measurement_source, standard_type,
//             direction. The scoring engine branches on these values.
//             computePenalty() switches exhaustively over the bases with a
//             `never` check, so every basis provably has arithmetic; one
//             invented in a form would have none, and the month would fail to
//             compute. resolveThreshold routes on measurement_source the same
//             way. So the LABEL is MVTA's - rename "Tier 1 penalty" to
//             whatever the contract calls it - and the VALUE is a contract
//             with the code.
//
// Retiring is is_active = 0, never a delete. A value that already scored a
// month has to keep resolving; inactive only means "keep it out of new
// pickers".
export const OWNED_DOMAINS = ["unit", "source_system", "condition_code", "responsible_team", "assigned_to", "priority"] as const;
export const SYSTEM_DOMAINS = ["penalty_basis", "tier_label", "measurement_source", "standard_type", "direction"] as const;
export const REFERENCE_DOMAINS = [...OWNED_DOMAINS, ...SYSTEM_DOMAINS] as const;

export type ReferenceDomain = (typeof REFERENCE_DOMAINS)[number];

export function isReferenceDomain(value: unknown): value is ReferenceDomain {
  return typeof value === "string" && (REFERENCE_DOMAINS as readonly string[]).includes(value);
}

export function isSystemDomain(domain: string): boolean {
  return (SYSTEM_DOMAINS as readonly string[]).includes(domain);
}

// Ranking used when several bands match one observation: the highest-ranked
// tier wins. Read from the period's own snapshot so a later reordering cannot
// change what an already-issued month scored; the map is the pre-105 fallback,
// for snapshots taken before the column existed.
const LEGACY_SEVERITY: Record<string, number> = { meets: 0, warning: 1, tier1: 2, tier2: 3 };

export function tierSeverity(tierLabel: string, snapshotted: number | null | undefined): number {
  if (typeof snapshotted === "number") return snapshotted;
  // An unrecognised label ranks below everything rather than returning
  // undefined: `undefined > undefined` is false, so the old map let an
  // unknown tier silently never escalate.
  return LEGACY_SEVERITY[tierLabel] ?? -1;
}
