# Least-privilege Entra control plane for OnBoard Access Management

Research date: 2026-08-14

Decision ticket: [Research the least-privilege Entra control plane](https://github.com/mvtamn/mvta-onboard/issues/39)

## Question

Which Microsoft-supported combination of Microsoft Graph permissions, scoped
custom Microsoft Entra roles, managed identity, group-membership operations,
app-role assignments, and B2B invitation APIs can implement OnBoard Access
Management with the smallest practical tenant-wide privilege, and what
licensing or consent constraints apply?

## Decision

Use a **delegated, group-first control plane** for interactive access changes:
the REST API exchanges the signed-in Access Administrator's API token for a
Microsoft Graph token by using OAuth on-behalf-of (OBO), and Microsoft Graph
authorizes both the consented delegated scope and the administrator's narrowly
scoped Entra directory role. OBO is the Microsoft-supported flow for a web API
calling a downstream API while preserving the user's identity and delegated
permissions; it does not use application roles on the middle tier
([OBO flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-on-behalf-of-flow)).

Pre-create ordinary, assigned-membership security groups for each OnBoard human
role and assign those groups to the corresponding OnBoard app roles once.
Day-to-day onboarding and offboarding then changes membership in only those
groups. Direct app-role assignments remain exceptional; workload identities
must receive app roles directly because Microsoft does not emit a `roles` claim
when a service principal inherits an app role through a group
([app roles](https://learn.microsoft.com/en-us/entra/identity-platform/howto-add-app-roles-in-apps)).

Use a **separate user-assigned managed identity** only for unattended reads and
reconciliation. Do not put `AppRoleAssignment.ReadWrite.All`,
`GroupMember.ReadWrite.All`, or `User.Invite.All` application permissions on the
ordinary Function App identity. Those application permissions run without a
human and are tenant-wide; in particular, `AppRoleAssignment.ReadWrite.All` can
manage permission grants and assignments for any app
([permissions reference](https://learn.microsoft.com/en-us/graph/permissions-reference#approleassignmentreadwriteall)).

Guest invitation is an independently approved capability. It cannot be scoped
to the OnBoard enterprise app because an invitation creates a tenant directory
user. The invitation and the later OnBoard access grant are separate operations.

## Supported authorization design

### Interactive reads and writes

| OnBoard operation | Microsoft Graph API | Delegated permission | Entra role constraint |
|---|---|---|---|
| Search directory users | `GET /users` with an explicit `$select` | `User.ReadBasic.All` if only basic profile fields are needed; `User.Read.All` if `accountEnabled`, `userType`, or other non-basic properties are required | Default member permissions can be sufficient for basic reads; do not rely on them for guests |
| Read group membership | `GET /groups/{id}/members` | `GroupMember.Read.All`; add `User.Read.All` when complete user properties are required | Custom group-read role scoped to the OnBoard administrative unit |
| Add a user to an OnBoard access group | `POST /groups/{id}/members/$ref` | `GroupMember.ReadWrite.All` | Custom role scoped to the OnBoard administrative unit |
| Remove a user from an OnBoard access group | `DELETE /groups/{id}/members/{member-id}/$ref` | `GroupMember.ReadWrite.All` | Custom role scoped to the OnBoard administrative unit |
| List assignments made by the OnBoard enterprise app | `GET /servicePrincipals/{onboard-sp-id}/appRoleAssignedTo` | `Application.Read.All` | Custom enterprise-app role scoped to the OnBoard enterprise app |
| Grant an exceptional direct OnBoard app-role assignment | `POST /servicePrincipals/{onboard-sp-id}/appRoleAssignedTo` | `AppRoleAssignment.ReadWrite.All` **and** `Application.Read.All` | Custom enterprise-app role scoped to the OnBoard enterprise app |
| Revoke a direct OnBoard app-role assignment | `DELETE /servicePrincipals/{onboard-sp-id}/appRoleAssignedTo/{assignment-id}` | `AppRoleAssignment.ReadWrite.All` | Custom enterprise-app role scoped to the OnBoard enterprise app |
| Invite a B2B guest | `POST /invitations` | `User.Invite.All` | Tenant Guest Inviter (or a custom role containing `microsoft.directory/users/inviteGuest`); no application-only resource scope exists |

The permission tables above come from the first-party API references for
[listing users](https://learn.microsoft.com/en-us/graph/api/user-list?view=graph-rest-1.0),
[listing group members](https://learn.microsoft.com/en-us/graph/api/group-list-members?view=graph-rest-1.0),
[adding group members](https://learn.microsoft.com/en-us/graph/api/group-post-members?view=graph-rest-1.0),
[removing group members](https://learn.microsoft.com/en-us/graph/api/group-delete-members?view=graph-rest-1.0),
[listing app-role assignments](https://learn.microsoft.com/en-us/graph/api/serviceprincipal-list-approleassignedto?view=graph-rest-1.0),
[granting app-role assignments](https://learn.microsoft.com/en-us/graph/api/serviceprincipal-post-approleassignedto?view=graph-rest-1.0),
[revoking app-role assignments](https://learn.microsoft.com/en-us/graph/api/serviceprincipal-delete-approleassignedto?view=graph-rest-1.0),
and [creating B2B invitations](https://learn.microsoft.com/en-us/graph/api/invitation-post?view=graph-rest-1.0).

The user search must select only fields the UI needs. Microsoft documents
`User.ReadBasic.All` as the least delegated permission for `/users`, while
application access starts at `User.Read.All`; `$search` and some filters require
`ConsistencyLevel: eventual` and `$count=true`
([list users](https://learn.microsoft.com/en-us/graph/api/user-list?view=graph-rest-1.0)).

The group-removal path must include the terminal `/$ref`. Microsoft warns that
omitting it can delete the directory object itself when the caller also has
permission to manage that object
([remove member](https://learn.microsoft.com/en-us/graph/api/group-delete-members?view=graph-rest-1.0)).
Use ordinary security groups, not role-assignable groups: modifying a
role-assignable group additionally requires `RoleManagement.ReadWrite.Directory`
and Privileged Role Administrator authority
([add member](https://learn.microsoft.com/en-us/graph/api/group-post-members?view=graph-rest-1.0)).

### Scoped Entra directory roles

Create an **OnBoard Enterprise App Assignment Administrator** custom role with:

- `microsoft.directory/servicePrincipals/appRoleAssignedTo/read`
- `microsoft.directory/servicePrincipals/appRoleAssignedTo/update`

Assign it to approved Access Administrators at the single OnBoard enterprise
application scope. Microsoft documents that this resource scope limits assignment
management to that enterprise app
([custom enterprise-app role](https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/custom-enterprise-apps),
[available actions](https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/custom-enterprise-app-permissions)).

Create an **OnBoard Access Group Membership Administrator** custom role with:

- `microsoft.directory/groups/standard/read`
- `microsoft.directory/groups/members/read`
- `microsoft.directory/groups.security.assignedMembership/members/update`

Put only the OnBoard access groups in a dedicated administrative unit and assign
the custom role at that administrative-unit scope. Entra supports custom roles
at administrative-unit scope when they contain a group-relevant action, and an
administrator scoped to the unit can manage groups in the unit without every
member of those groups also belonging to the unit
([custom group permissions](https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/custom-group-permissions),
[administrative units](https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/administrative-units),
[role assignment scopes](https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/manage-roles-portal#assign-roles-with-administrative-unit-scope)).

These directory roles constrain the signed-in person in the delegated flow.
They do **not** turn a tenant-wide Graph application permission into a
resource-specific application permission. The Graph write APIs document
`AppRoleAssignment.ReadWrite.All` and `GroupMember.ReadWrite.All` for app-only
calls, so an app-only writer would retain broad tenant authority. Do not treat
`Directory.ReadWrite.All` or a consent policy as a narrower substitute; Microsoft
explicitly recommends resource-specific permissions instead of broad Directory
permissions
([Graph permissions reference](https://learn.microsoft.com/en-us/graph/permissions-reference)).

### Managed identity

Managed identity is supported for app-only Microsoft Graph calls and avoids a
stored client secret. Grant Graph application permissions directly to the
managed identity's service principal during deployment; Microsoft documents
PowerShell/CLI/API setup rather than a normal portal API-permissions blade
([managed identity and Graph](https://learn.microsoft.com/en-us/entra/identity-platform/multi-service-web-app-access-microsoft-graph-as-app),
[grant managed-identity API permissions](https://learn.microsoft.com/en-us/powershell/entra-powershell/grant-api-permissions-managed-identity)).

For unattended reconciliation, the smallest practical read set is:

- `User.Read.All` for directory-user display and status;
- `GroupMember.Read.All` for the designated access groups; and
- `Application.Read.All` for the OnBoard service principal and its assignments.

These remain tenant-wide application permissions. Isolate them on a dedicated
user-assigned identity, restrict which code path can request its token, select
minimal response fields, and never expose Graph tokens to the browser. A
user-assigned identity also has an independent lifecycle and can be replaced or
disabled without changing the Function App's primary Azure resource identity.

Do not use managed-identity group membership as an emergency revocation path.
Microsoft warns that managed-identity authorization changes can take significant
time to appear because tokens are cached, potentially around 24 hours
([managed-identity recommendations](https://learn.microsoft.com/en-us/entra/identity/managed-identities-azure-resources/managed-identity-best-practice-recommendations)).

## B2B guest boundary

`POST /invitations` with delegated `User.Invite.All` is the least-privileged
documented invitation permission. The signed-in actor must also be allowed to
invite guests under the tenant's external-collaboration settings; Guest Inviter
is the least built-in administrative role when default user invitations are
restricted. App-only `User.Invite.All` is supported but fails when B2B invitations
are disabled
([create invitation](https://learn.microsoft.com/en-us/graph/api/invitation-post?view=graph-rest-1.0),
[Guest Inviter](https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/permissions-reference#guest-inviter)).

The invitation creates a `Guest` user and redemption URL; it neither redeems the
invitation nor grants an OnBoard role. OnBoard must record sponsor, employer,
justification, and expiry before inviting, then separately add the redeemed guest
to an OnBoard access group. Redemption-status reset is out of the ordinary flow
because it requires the broader `User.ReadWrite.All` permission
([reset redemption](https://learn.microsoft.com/en-us/entra/external-id/reset-redemption-status)).

## Consent, licensing, and operational constraints

- The delegated Graph scopes in the write path require tenant admin consent.
  Graph **application** permissions always require admin consent. Privileged
  Role Administrator or Global Administrator can grant Microsoft Graph
  application permissions; Cloud/Application Administrator cannot grant consent
  for Microsoft Graph app roles
  ([admin consent](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/grant-admin-consent)).
- Custom Entra roles require Microsoft Entra ID P1 or P2; Microsoft states that
  each human assigned a custom role needs P1
  ([Entra RBAC licensing](https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/custom-overview#license-requirements)).
- Administrative-unit administrators require P1 or P2; unit members can use
  Entra ID Free
  ([assign roles at AU scope](https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/manage-roles-portal#assign-roles-with-administrative-unit-scope)).
- Group-based enterprise-app assignment requires P1 or P2. Only direct group
  members inherit application access; nested-group membership does not cascade
  ([enterprise-app assignment](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/assign-user-or-group-access-portal)).
- P2 is optional for this baseline but enables PIM just-in-time/time-limited
  directory-role activation. Governance access reviews require additional Entra
  Governance/Suite licensing depending on the feature
  ([Entra RBAC options](https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/custom-overview#role-assignment-options)).
- Microsoft Graph and Entra directory writes are eventually consistent. The UI
  needs `pending`, `applied`, `failed`, and `reconciling` states and must verify
  the resulting membership or assignment before reporting success
  ([app-role replication note](https://learn.microsoft.com/en-us/graph/api/serviceprincipal-list-approleassignedto?view=graph-rest-1.0),
  [group replication note](https://learn.microsoft.com/en-us/graph/api/group-post-members?view=graph-rest-1.0)).

## OnBoard implementation implications

The committed RBAC design currently chooses app-only credentials for assignment
writes and proposes `Directory.ReadWrite.All` as a tighter alternative
([current design](../../plans/MVTA_Relay_Admin_UI_RBAC.md)). Replace both choices
with the delegated OBO and scoped-role design above. `Directory.ReadWrite.All`
is broader, and the documented app-only assignment permission is tenant-wide.

The in-app two-person rule is an OnBoard workflow control, not a native guarantee
of the Graph assignment endpoint. The backend must persist a pending request,
reject self-approval, require a fresh privileged authentication from a different
Access Administrator, and only then execute the OBO Graph write as the approver.
Keep the Graph delegated tokens server-side so the browser cannot bypass this
workflow. Retain the IT-controlled Entra/Portal break-glass route outside the app.

Provision separate enterprise applications, access groups, administrative units,
custom-role assignments, and managed identities per environment. No production
principal or group should be shared with development or test.

## Least-privilege boundary that remains

Microsoft Graph does not expose resource-specific application permissions for
these directory operations. Delegated scopes such as
`AppRoleAssignment.ReadWrite.All` and `GroupMember.ReadWrite.All` describe broad
capabilities at the client-consent layer; the signed-in person's scoped Entra
role is what confines each interactive write to the OnBoard app or administrative
unit. B2B invitation and unattended directory reads remain tenant-wide by their
nature. The practical minimum is therefore separation of identities and paths,
scoped human directory roles, group-first assignment, no app-only writer, narrow
response projection, explicit approval controls, and comprehensive audit and
reconciliation.
