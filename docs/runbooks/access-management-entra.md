# Access Management Entra deployment runbook

This runbook enables **Admin > Access Management** after the application code and `migration-052-access-management.sql` are deployed. It deliberately separates application deployment from tenant authorization. Do not place tenant secrets or real group identifiers in this repository.

## Preconditions

- Confirm Microsoft Entra ID P1 or the tenant license required for group-based enterprise-application assignment, Conditional Access, custom roles, and authentication context.
- Confirm sign-in-log retention and permission expectations with MVTA security/privacy owners.
- Create distinct development, test, and production enterprise applications and access groups. Never reuse a production assignment group in a lower environment.
- Confirm the IT-controlled Entra/Portal break-glass path and at least one recoverable human Access Administrator before disabling the bootstrap fallback.
- Apply the database migration before enabling the UI or API configuration.

## Canonical roles

Register these app-role values on each environment's OnBoard application:

- `OCC.Viewer`
- `OCC.Publisher`
- `OCC.Admin`
- `OCC.Compliance`
- `OCC.ComplianceManager`
- `OCC.Detour`
- `OCC.TripStartVerify` (SST OCS desk: reads the Dispatch Log and records trip-start verifications, nothing else; contractor staff, so its security group is separate from MVTA's own)
- `System.Ingestion` (applications only)
- `OCC.AccessAdmin` (access-management control plane)

Create one direct-membership security group for every human role, including `OCC.AccessAdmin`. Do not use nested membership or role-assignable groups. Assign each group directly to its matching enterprise-application role. Assign `System.Ingestion` directly only to approved workload identities.

## Delegated Microsoft Graph access

The REST API exchanges the signed-in administrator's API access token through the OAuth on-behalf-of flow. The browser never receives Graph directory-write authority.

Grant/admin-consent only the delegated Graph permissions needed by the enabled workflows:

- `User.Read.All`
- `GroupMember.Read.All`
- `GroupMember.ReadWrite.All`
- `Application.Read.All`
- `AppRoleAssignment.ReadWrite.All`
- `User.Invite.All`
- `AuditLog.Read.All`

Scope the administrator's Entra authority to the OnBoard service principal and designated groups/administrative unit. The custom application role needs only service-principal assignment read/update actions. The custom group role needs group read, member read, and assigned-security-group membership update actions. Do not grant general tenant user administration, password/MFA management, application creation, or `RoleManagement.ReadWrite.Directory`.

Store the confidential-client credential in Key Vault as `onboard-api-client-secret`. Prefer the organization's approved certificate or workload-federated confidential-client pattern when available; the current deployment wiring consumes the Key Vault secret reference and never checks the value into source control.

## Application configuration

Set `accessManagementConfigJson` during the Phase 1 deployment. Its value is an `AccessEnvironmentConfig` object containing:

- the exact environment name;
- the environment-specific OnBoard application/client ID and enterprise service-principal object ID;
- the approved guest redemption redirect URL; and
- for every role, its app-role ID and (for human roles) direct-membership group ID.

The deployment writes the following REST API settings:

- `AZURE_TENANT_ID`
- `ONBOARD_API_CLIENT_ID`
- `ONBOARD_API_CLIENT_SECRET` as a Key Vault reference
- `ONBOARD_ENVIRONMENT`
- `ONBOARD_ACCESS_CONFIG_JSON`
- `ONBOARD_ACCESS_ADMIN_FALLBACK`
- `ONBOARD_PRIVILEGED_AUTH_CONTEXT`

Set the frontend repository variable `VITE_ACCESS_ADMIN_FALLBACK=true` only during bootstrap, matching the API setting. Once `OCC.AccessAdmin` is assigned and verified, set both fallback values to `false` and redeploy.

## Shift session and privileged step-up

Create a Conditional Access policy targeting the OnBoard user population on compliant or otherwise approved managed devices:

1. Target a best-effort 12-hour sign-in frequency and the tenant-approved persistent-browser setting.
2. Preserve risk, account disablement, explicit revocation, and stronger tenant policies; the application must never promise an uninterrupted 12-hour session.
3. Create the authentication context referenced by `ONBOARD_PRIVILEGED_AUTH_CONTEXT` (default `c1`). Set the console build variable `VITE_PRIVILEGED_AUTH_CONTEXT` to the same value so MSAL requests the context the API validates.
4. Require appropriate fresh authentication for that context.
5. Exclude only the documented break-glass accounts according to MVTA policy, and monitor their use outside OnBoard.

The console uses MSAL silent token acquisition for routine work and requests the authentication-context claim for privileged requests and approvals. A failed/cancelled step-up leaves access unchanged.

Assignment removal is token-bounded: it removes the Entra assignment but does not revoke every tenant session. Existing authorization can remain until token refresh or application-side revalidation; tenant-wide session revocation remains an IT/security operation outside OnBoard.

## Validation smoke test

Run this checklist separately in development, test, and production:

1. An `OCC.AccessAdmin` can open Access Management; an ordinary `OCC.Admin` cannot after fallback removal.
2. Search returns only the minimal supported user/group/workload fields.
3. Group-first onboarding previews, applies, and later appears as group-derived Effective Access.
4. A direct human exception is visibly labeled and audited.
5. A B2B guest invitation records sponsor, organization, reason, and expiry; redemption remains pending until the guest accepts.
6. An ordinary role change applies without second approval.
7. `OCC.Admin` and `OCC.AccessAdmin` changes remain pending until a different freshly authenticated Access Administrator decides them.
8. Self-approval and removal of the last recoverable administrator fail.
9. `System.Ingestion` cannot be assigned to a person and cannot publish, edit, approve, dismiss, or retract a live message.
10. Directory-wide sign-in summary is labeled separately from OnBoard-filtered events; detailed events are not present in database audit rows or CSV export.
11. A due guest/temporary assignment can be removed idempotently without disabling the Entra identity.
12. Reconciliation identifies missing role groups, missing assignments, and human/workload conflicts; every repair receives a dry run before confirmation.

## Failure and rollback

- Microsoft Graph `429` or transient failures are per-item failures. Honor Graph retry guidance, then retry with the same idempotency key or reconcile current state before creating a new operation.
- An accepted change may remain `pending_verification` while Graph converges. Do not treat that as failure or issue a compensating removal of pre-existing access.
- To disable the in-app control plane, remove `accessManagementConfigJson` and redeploy. Existing Entra assignments remain authoritative and unchanged.
- Use the approved Entra/Portal path for emergency recovery. Reconcile afterward so OnBoard reflects the restored assignment and audit the incident through the organization's security process.

## Deployment and troubleshooting notes

- The REST API includes the Event AVL Service Bus trigger. Its Function App
  needs the identity-based `ServiceBusConnection__fullyQualifiedNamespace`
  setting and the **Azure Service Bus Data Receiver** role on the MVTA Service
  Bus namespace. Missing either can prevent the Functions host from starting
  reliably and make Access Management appear unavailable.
- A Phase 1 Bicep deployment updates Function App configuration but does not
  restore the deployed Function package after the restart. Run the **Deploy
  Function Apps (REST API + dispatch)** workflow immediately after a Phase 1
  deployment, then verify `/api/health` through Front Door before treating the
  deployment as complete.
- The generic Access Management unavailable banner should be diagnosed as a
  request-path symptom, not assumed to be an Access Management configuration
  failure. Check these boundaries in order:

  1. `GET /api/health` through Front Door must return `200`.
  2. An unsigned `GET /api/access-management/principals` should return `401`;
     this confirms the route and handler are live without disclosing data.
  3. A public endpoint such as `GET /api/messages/active` should return `200`
     through both the Function App and Front Door.
  4. Confirm `SQL_CONNECTION_STRING` and `ONBOARD_API_CLIENT_SECRET` Key
     Vault references are resolved in the Function App configuration.
  5. If those checks pass but the signed-in console still loads indefinitely,
     inspect browser request telemetry and the MSAL token-acquisition path.
     Do not rotate secrets, change Graph permissions, or alter group
     assignments without an error from that signed-in request.
