export interface AccessRole {
  key: string;
  name: string;
  purpose: string;
  locked: boolean;
  /** Every action outside Access & Identity, including ones added later. */
  allActions: boolean;
  actions: string[];
}

/**
 * Where a held Role came from. Only OnBoard grants one since the cutover; the
 * field stays because the People page and the audit read it, and because a
 * later source (an agreement-scoped grant, say) would belong here.
 */
export type RoleSource = "onboard";

export interface HeldRole {
  key: string;
  name: string;
  purpose: string;
  locked: boolean;
  source: RoleSource;
  /** Reserved for a later scoped grant (ADR-0032); always null today. */
  scope: string | null;
  expiresAt: string | null;
}

export interface EffectiveAccess {
  person: {
    objectId: string | null;
    tenantId: string | null;
    name: string | null;
    email: string | null;
  };
  roles: HeldRole[];
  /** Sorted `module.action` keys. The one answer every gate reads. */
  actions: string[];
  /** One line per module, generated from `actions`. */
  summary: string[];
  /** A workload identity: `System.Ingestion` and never a human role. */
  ingestion: boolean;
  /** False until migration 129 is applied; roles then come from the token alone. */
  rolesInOnBoard: boolean;
}
