# Access cutover runbook

Moving an environment from Entra app roles to OnBoard-owned roles (ADR-0032,
increment 6). After this, the `roles` claim in a token grants nobody anything:
what a person may do comes from their Role Grants in OnBoard. Entra still
decides who may sign in.

The order matters. Deploying the cutover code into an environment that has not
been migrated and imported leaves everybody on the No access page, because that
is the safe direction: OnBoard would rather grant nothing than guess.

`docs/runbooks/access-management-entra.md` describes the Entra-era setup this
replaces. Its Graph write consents and its bootstrap fallback are retired here.

## Before the cutover code is deployed

1. **Apply the migrations** in order: `migration-129-app-owned-roles.sql`,
   `migration-130-access-role-history.sql`,
   `migration-131-onboard-grant-requests.sql`. 129 seeds the nine roles.
2. **Grant the first Access Administrator.** Paste the object id into
   `@firstAccessAdminObjectId` in 129's last batch and run that batch. Get the
   id with `az ad signed-in-user show --query id -o tsv`, signed in as the
   person who will hold it.
3. **Sign in to the console once** as that person. Signing in is what records
   somebody in `AccessPeople`; an Access Administrator can only grant a role to
   a person OnBoard has seen.
4. **Import the existing assignments.** Access & Identity → Overview → Import
   from Entra, once. It reads today's app-role assignments and group
   memberships and writes the matching OnBoard grants, reporting how many
   people and grants it wrote and anything it could not match. It is safe to
   press twice; it grants nothing the second time.
5. **Check the import.** People & guests should list everyone who had access,
   each with the role that replaced their app role. Access health should not be
   reporting people who signed in and hold nothing, unless that is true.

## Deploying the cutover

6. **Deploy the API and console.** From here a token's app roles decide nothing.
   Watch for anybody landing on No access who should not be: the cause is a
   missing grant, and the fix is to grant it, not to redeploy.

## In Entra, after it is confirmed working

7. **Remove the `OCC.*` app roles** from the application registration. Keep
   `System.Ingestion`: a workload identity has no person record and still
   arrives with its app role. The security groups can stay - they are how
   "Assignment required" decides who may sign in.
8. **Set "Assignment required"** on the enterprise application and assign the
   OnBoard Users group, if that has not already been done. This is now the only
   thing standing between the tenant and a sign-in.
9. **Revoke the delegated Graph write consents**: `AppRoleAssignment.ReadWrite.All`
   and `GroupMember.ReadWrite.All`. OnBoard no longer writes either. Keep the
   read permissions used by directory search, guest invitations and sign-in
   activity.
10. **Remove `ONBOARD_ACCESS_ADMIN_FALLBACK`** from the Function App settings.
    The code no longer reads it.

## If something goes wrong

- **Somebody is locked out.** Any Access Administrator can grant them a role on
  People & guests; it takes effect within about thirty seconds.
- **Nobody can manage access.** OnBoard refuses changes that would cause this,
  but if it happens - for instance because the tables were restored from an
  older backup - re-run step 2 with a fresh object id.
- **The console shows a setup notice.** The migrations have not been applied to
  that environment.
