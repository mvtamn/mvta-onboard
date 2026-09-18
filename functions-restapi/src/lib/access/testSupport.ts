// A stand-in for the access tables, for tests that have no SQL Server.
//
// Since the cutover (increment 6) a token grants nobody anything, so a unit
// test cannot express "this person holds Publisher" by putting an app role in a
// token any more - it has to come from the tables. This answers the three
// queries the resolver asks, and nothing else.
//
// The contract tests (access.db.contract.test.ts, grants.db.contract.test.ts)
// remain the ones that prove the SQL itself.
import type { sql } from "../db";
import { SEEDED_ROLES } from "./seeds";

export interface FakeGrant {
  /** `"*"` grants it to whoever is asking, for a test that does not care who. */
  objectId: string;
  roleKey: string;
  expiresAt?: Date | null;
  scope?: string | null;
}

/**
 * `fakeAccessDb([{ objectId: "oid-1", roleKey: "publisher" }])` reads as the
 * seeded roles with those grants in place. `ready: false` is an environment
 * where the migrations have not been applied.
 */
export function fakeAccessDb(grants: FakeGrant[], options: { ready?: boolean } = {}): sql.ConnectionPool {
  const ready = options.ready !== false;
  const roleRows = SEEDED_ROLES.map((role) => ({
    role_key: role.key,
    name: role.name,
    purpose: role.purpose,
    is_locked: !!role.locked,
    all_actions: !!role.allActions,
  }));
  const actionRows = SEEDED_ROLES.flatMap((role) =>
    role.actions.map((action) => ({ role_key: role.key, action_key: action })),
  );

  const answer = (text: string, inputs: Record<string, unknown>) => {
    if (text.includes("OBJECT_ID('dbo.AccessRoles','U')")) return [{ ready: ready ? 1 : 0 }];
    if (text.includes("FROM AccessRoleActions")) return actionRows;
    if (text.includes("FROM AccessRoles")) return roleRows;
    if (text.includes("FROM AccessRoleGrants")) {
      return grants
        .filter((grant) => grant.objectId === "*" || grant.objectId === inputs.oid)
        .map((grant) => ({
          role_key: grant.roleKey,
          scope: grant.scope ?? null,
          expires_at: grant.expiresAt ?? null,
        }));
    }
    return [];
  };

  return {
    request() {
      const inputs: Record<string, unknown> = {};
      const api = {
        input(name: string, _type: unknown, value: unknown) {
          inputs[name] = value;
          return api;
        },
        async query(text: string) {
          return { recordset: answer(String(text), inputs) };
        },
      };
      return api;
    },
  } as unknown as sql.ConnectionPool;
}
