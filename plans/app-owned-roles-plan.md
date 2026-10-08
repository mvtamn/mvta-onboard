# App-owned Roles — plan

Implements [ADR-0032](../docs/adr/0032-own-roles-in-onboard-and-keep-sign-in-in-entra.md).
Agreed 2026-09-17: roles editable and custom roles allowed (two locked);
View + named actions per module; agency-wide grants with a nullable scope
column; sign-in gated by Entra "Assignment required" + one OnBoard Users group.
Roles are granted to people only, never to an Entra group; Viewer and Publisher
keep the compliance read the API gives them today; the first seeded Access
Administrator is Tyre Fant.

## Module catalog (code)

One catalog file shared by the REST API and the console. Labels are the words
the Access Summary uses.

| Module | Actions beyond `view` |
|---|---|
| Dashboard | — |
| Rider Alerts | `publish` — compose, edit, retract, approve suggested alerts |
| Service Risk & Quality | `resolve` — resolve on-demand risks |
| Dispatch Log | `verify` — record trip-start verifications |
| Detours & Closures | `edit` — create, edit, close, attachments, communications; `delete`; `intake` — Detour Intake |
| Decision Matrix | `manage` — drafts, governance, sync, library |
| Speed Alerts | — |
| Event AVL | `message`; `notify` — notifications and area tests; `configure` — geofences, locations, vehicle assignments |
| Event Planning | `edit` |
| Compliance Review (OTP, Missed Trips, Garage Departures) | `review` — exclusions, missed-trip validation, departure review |
| Performance Assessment | `work` — periods, compute, evidence, disputes, draft reports; `decide` — finalize, reopen, issue, exceptions, dispute and delay decisions, caps |
| Service Configuration (service config, standards, OTP settings, reason codes, event admin) | `edit` |
| Integrations & Data Health | `edit` |
| Contractor Performance setup | `edit` |
| Subscribers | — |
| Governance & Audit | — |
| Access & Identity | `manage` — ordinary grants and role edits; `approve` — second approval of Privileged Access Changes |

## Seeded roles

Seeded from what each role is for, not from today's drifted role sets, so the
known 403s disappear.

| Role | Grants |
|---|---|
| Viewer | View: Dashboard, Rider Alerts, Service Risk, Dispatch Log, Detours, Decision Matrix, Event AVL, Compliance Review, Performance Assessment |
| Publisher | Viewer + Rider Alerts publish, Service Risk resolve, Detours edit + delete, Event AVL notify |
| Detour Editor | Detours view + edit |
| Event AVL Operator | Dashboard, Rider Alerts view; Event AVL view + message + notify |
| Compliance Analyst | Compliance Review view + review; Performance Assessment view + work; Detours, Dispatch Log view |
| Compliance Manager | Compliance Analyst + Performance Assessment decide |
| Trip Start Verifier | Dispatch Log view + verify |
| System Administrator 🔒 | Every action outside Access & Identity, including future ones |
| Access Administrator 🔒 | Access & Identity view + manage + approve; Subscribers, Governance & Audit view |

## Increments

1. **Schema, catalog, resolver.** Migration: `OnBoardPeople` (oid, tid, name,
   email, status, last seen), `Roles` (key, name, purpose, locked, archived),
   `RoleActions`, `RoleGrants` (person, role, nullable scope, expires,
   granted by, approved by). Seed the nine roles. Resolver with a ~30 s
   per-worker cache; during transition it also maps token app roles to the
   seeded roles. `GET /api/me/access`. Contract test: each seeded role
   resolves to the table above.
2. **Backend enforcement.** `requireAccess(request, module, action)` (async)
   replaces `requireRole` across the ~160 call sites in 92 files; role-set
   constants deleted. `System.Ingestion` keeps its token check.
3. **Console gating.** Access context from `/api/me/access`; `RequireAccess`
   on every route including the five ungated legacy routes; nav and inline
   control checks read actions; No access page.
4. **Roles UI.** Access & Identity → Roles: list (name, purpose, generated
   summary, members); role page with the module grid, live summary preview,
   members, create/archive; locked roles read-only; Privileged Access Change
   through the existing approval flow.
5. **People on OnBoard grants.** Person page shows roles and combined Effective
   Access with each action traced to its role; grant/revoke writes
   `RoleGrants` instead of Graph. One-time backfill reads current Entra
   assignments and group memberships into grants. Last-Access-Administrator
   guard.
6. **Cutover.** Remove the token-role mapping from the resolver and the
   `ONBOARD_ACCESS_ADMIN_FALLBACK` setting; update CONTEXT.md and the Entra
   runbook.

## Entra steps (the user's)

1. Create the **OnBoard Users** security group and add everyone who holds any
   OnBoard role today (after increment 5's backfill lists them).
2. On the dev enterprise application, set **Assignment required** = Yes and
   assign the OnBoard Users group (and the `System.Ingestion` workload
   identities, which stay assigned).
3. After increment 6 is live, remove the human app roles (`OCC.*`) from the
   app registration. Keep `System.Ingestion`.
4. Revoke the delegated Graph consents `AppRoleAssignment.ReadWrite.All` and
   `GroupMember.ReadWrite.All`; keep the read permissions people search, guest
   invites and sign-in activity still use.

## Settled 2026-09-17

- **People only.** A Role Grant names a person. Entra groups gate sign-in, not
  authority, so there is no group membership lookup on the request path.
- **Viewer and Publisher keep the compliance read**, so Compliance Review and
  Performance Assessment become visible pages for them rather than API-only
  access. Neither gains `review`, `work` or `decide`. Event AVL Operator drops
  the read it has today through `STAFF_READ`; it is a monitoring role.
- **First Access Administrator: Tyre Fant.** The seeding migration needs his
  Entra object id and tenant id for the dev tenant, supplied when increment 1
  is written. `ONBOARD_ACCESS_ADMIN_FALLBACK` stays on until that grant is
  confirmed on dev, then goes at increment 6.
