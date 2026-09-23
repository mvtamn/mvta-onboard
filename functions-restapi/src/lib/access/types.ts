export interface AccessRole {
  key: string;
  name: string;
  purpose: string;
  locked: boolean;
  /** Every action outside Access & Identity, including ones added later. */
  allActions: boolean;
  actions: string[];
}

export type RoleSource = "onboard" | "entra";

export interface HeldRole {
  key: string;
  name: string;
  purpose: string;
  locked: boolean;
  /** `entra` while a caller still arrives with app roles in the token. */
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
