# MVTA Relay — Admin UI & Role-Based Access Design

Supplement to `Transit_Notification_Architecture.docx`
Covers: Entra ID App Roles, role-to-capability mapping, Admin UI screens, and Microsoft Graph API implementation for role assignment.

---

## 1. Design principle

MVTA Relay uses **Entra ID Easy Auth** for authentication — there is no separate username/password store. "Managing users" therefore means **managing Entra ID App Role assignments** for the MVTA OnBoard app registration (`7e5a35b1-dc1b-473d-987d-6942a7b4fae2`), not building a custom user table.

Two ways to manage assignments:

| Approach | When to use |
|---|---|
| **Azure Portal** (Enterprise App → Users and groups) | Now, through Phase 1–3. Tyre is the only admin; no UX problem to solve yet. |
| **Custom Admin UI backed by Microsoft Graph API** | Phase 4, once IT owns the app and non-technical OCC leads need to grant/revoke access without a Portal login. |

---

## 2. Application roles

The original deployment has four registered roles. The application now also
defines three specialized roles that must be registered in Entra before they
can be assigned. The Admin UI must read the app-role definitions from Entra
rather than hard-code this list, and must show whether each role is registered,
assignable, and currently in use.

| App-role value | Purpose | Deployment status |
|---|---|---|
| **`OCC.Viewer`** | Read-only staff access to operational information. | Registered |
| **`OCC.Publisher`** | Day-to-day operator. Create/edit messages, approve suggested alerts for publication, and retract messages. | Registered |
| **`OCC.Admin`** | Publisher permissions plus configuration, OCC tools, access management, and the full audit log. | Registered |
| **`OCC.Compliance`** | Investigate OTP compliance and missed trips without receiving general administration access. | Pending Entra registration |
| **`OCC.ComplianceManager`** | Compliance-manager actions such as final review and assessment issuance. | Pending Entra registration |
| **`OCC.Detour`** | Read, create, edit, and attach files to detours; cannot delete. | Pending Entra registration |
| **`System.Ingestion`** | Non-human workload identity. Creates reviewable drafts only and can never publish, approve, dismiss, edit, or retract a live message. | Registered |

`System.Ingestion` must be assignable to applications only. The backend must
authorize it through a dedicated ingestion role set; it must not reuse a
publisher role set. This preserves the non-negotiable rule that no
machine-generated alert publishes without explicit staff approval.

### Capability matrix

| Capability | Viewer | Publisher | Admin | Compliance | Compliance Manager | Detour | System Ingestion |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| View general staff information | ✓ | ✓ | ✓ | Limited | Limited | Detours only | — |
| Create/edit draft messages | — | ✓ | ✓ | — | — | — | ✓ (API only) |
| Approve suggested alert for publish | — | ✓ | ✓ | — | — | — | — |
| Retract a live message | — | ✓ | ✓ | — | — | — | — |
| Investigate compliance records | — | — | ✓ | ✓ | ✓ | — | — |
| Perform compliance-manager actions | — | — | ✓ | — | ✓ | — | — |
| Create/edit detours and attachments | — | ✓ | ✓ | — | — | ✓ | — |
| Delete a detour | — | ✓ | ✓ | — | — | — | — |
| Edit ExpirationDefaults | — | — | ✓ | — | — | — | — |
| Manage access | — | — | ✓ | — | — | — | — |
| View audit log | Message history | Message history | All | Relevant module | Relevant module | Detour history | — |
| Sign in to web UI | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |

Human roles are additive because specialized staff may legitimately need more
than one capability. The UI should warn about redundant or unusually broad
combinations, but it must not silently remove an existing role when another is
assigned. `System.Ingestion` can never be combined with a human role.

---

## 3. Admin UI screens (Phase 4)

Add an **Access Management** submodule under the existing Admin area. It owns
login access, Entra imports, role assignments, revocation, and sign-in activity.
It does not store passwords or create a second identity system: Entra ID remains
the identity and authentication source of truth.

### 3.1 Access Management — Users & Roles

The landing screen shows every direct user, group, and workload identity holding
an MVTA Relay app role. For group assignments, it also shows the effective
direct user members. A user can therefore be traced to the direct assignment or
group membership that grants access.

| Column | Notes |
|---|---|
| Name / sign-in name | Display name and `userPrincipalName` from Entra; not copied into a local identity table |
| Principal type | Member, B2B guest, group, managed identity, or other service principal |
| Access source | Direct assignment or the Entra group that grants the role |
| Roles | All effective MVTA OnBoard app roles; multiple human roles are allowed |
| Account status | Enabled/disabled in Entra, invitation state for guests, and an explicit warning when a group assignment cannot be resolved |
| Last successful sign-in | Latest successful interactive or non-interactive Entra sign-in; directory-wide, not necessarily OnBoard-specific |
| Last interactive attempt | Latest interactive attempt, successful or failed; never label this field simply “last login” |
| Last OnBoard login | Latest successful sign-in event for the MVTA OnBoard application, when sign-in-log licensing and retention make it available |
| Actions | View access, assign role, request Admin role, revoke direct access, or remove from an OnBoard access group |

Filter/search by name, sign-in name, principal type, role, access source,
enabled/disabled status, guest/member status, and last successful login range.
Workload identities are visually distinguished from people and cannot be
assigned a human role.

Selecting a person opens a sign-in details drawer showing:

- last successful sign-in, last interactive attempt, and last non-interactive
  attempt, with UTC, MVTA local time, and a relative time;
- the most recent OnBoard-specific sign-in events available within Entra's
  retention window, including success/failure, client application, IP address,
  and correlation/request ID;
- a clear `Unavailable` state when licensing, permissions, retention, or a new
  account prevents Graph from returning a value; and
- assignment history from the local audit log, separate from authentication
  history from Entra.

Detailed sign-in events contain sensitive security data. They are visible only
to `OCC.Admin`, are never exported by default, and must not be copied into the
general message audit export.

### 3.2 Import from Entra ID (Azure AD)

“Import” means discovering existing Entra users or groups and granting them
OnBoard access. It does **not** copy passwords, create local login accounts, or
periodically mirror the whole directory into an application user table.

The import workflow supports two sources:

1. **Users** — search Entra by display name, sign-in name, or email; select one
   or more people; review member/guest and enabled/disabled status; then assign
   one or more human app roles.
2. **Groups** — search for an existing OnBoard access group, preview its direct
   user members, then assign the group to an app role. Group assignment is the
   preferred model for ongoing staff and contractor administration.

Before applying an import, show a dry-run summary with new access, existing
access, disabled accounts, unredeemed guests, role conflicts, and principals
that will be skipped. Require explicit confirmation and return per-principal
results so a partial Graph failure can be retried safely. Each successful grant,
revoke, or group-membership change creates an audit record.

Nested groups must not be presented as effective access. Entra application
assignment applies to direct members of the assigned group; if a nested group's
users need access, add those users directly to the designated OnBoard group or
assign an appropriate group directly to the app role.

The screen also provides **Refresh from Entra**, which re-reads assignments,
direct group members, account status, and available sign-in activity. It does
not mutate Entra or the local audit history.

### 3.3 Assign Role modal

1. Admin clicks **Assign Role**.
2. Type-ahead search against the Entra directory (`GET /users` via Graph, `User.Read.All`).
3. Select a user or group and one or more allowed roles. Human roles are additive; `System.Ingestion` is excluded from user/group choices.
4. Submit → backend performs the Graph app-role-assignment call using **app-only credentials**. The OCC Admin's own browser session never needs Graph write permissions — the frontend never talks to Graph directly.
5. Confirmation toast + new row appears in the table.

Prefer a managed identity for the backend's Graph access. If credentials are
unavoidable, store them in Key Vault and include expiry/rotation in the
operational checklist.

### 3.4 Two-person rule for granting OCC Admin

Granting **`OCC.Admin`** requires a second existing Admin to confirm before the
Graph assignment is made. The first Admin creates a pending request; a distinct
Admin approves or rejects it. The backend, not only the UI, enforces the
different-actor rule. Requests expire after 24 hours and are invalidated if the
target, requested role, or requestor's authorization changes. Revoking the last
active Admin is blocked.

### 3.5 Audit Log

Single shared log — role changes and message actions live in the **same table**, not separate ones, matching Section 9 of the architecture doc ("all create/edit/retract actions logged with staff identity and timestamp").

Columns: timestamp, actor, action type (`role_granted`, `role_revoked`, `message_created`, `message_published`, `message_retracted`, `ttl_default_changed`), target (user or message ID), before/after value where applicable.

Filterable by actor, action type, date range. Exportable to CSV for compliance requests.

### 3.6 Session duration and reauthentication

The console should support an OCC work shift without an avoidable interactive
sign-in prompt. MSAL should continue acquiring tokens silently while the Entra
session remains valid; an individual access token's short lifetime must not be
treated as the user's application-session timeout.

The Access Management submodule displays the effective session policy and a
plain-language explanation of what controls it:

- **Application behavior:** persistent MSAL cache and silent token renewal;
- **Entra behavior:** Conditional Access sign-in frequency, persistent-browser
  session policy, MFA, account disablement, and session revocation; and
- **Proposed operating target:** an uninterrupted normal OCC shift on a trusted
  device, subject to an explicit security/IT decision on the number of hours.

An `OCC.Admin` cannot weaken a tenant Conditional Access policy from inside
OnBoard. If MVTA wants a longer login period, IT must approve and configure the
sign-in-frequency or persistent-browser policy for the OnBoard enterprise app.
The application must still respond immediately to a failed silent renewal with
a clear “Session expired — sign in again” state, preserve unsaved form data when
safe, and never loop interactive redirects.

---

## 4. Microsoft Graph implementation

### 4.1 Required permissions (app registration, not delegated)

| Permission | Type | Purpose |
|---|---|---|
| `AppRoleAssignment.ReadWrite.All` | Application | Grant/revoke app role assignments |
| `User.Read.All` | Application | Search directory for the Assign Role modal |
| `Application.Read.All` | Application | Resolve the service principal object ID for MVTA OnBoard itself |
| `GroupMember.Read.All` | Application | Resolve direct members of assigned OnBoard access groups |
| `GroupMember.ReadWrite.All` | Application, optional | Add/remove users in OnBoard access groups when group management is enabled |
| `AuditLog.Read.All` | Application, optional | Read sign-in activity and OnBoard-specific sign-in events |

These application permissions require **admin consent** in the Entra tenant.
Request only the permissions for enabled features. In particular, omit
`GroupMember.ReadWrite.All` if the UI assigns roles directly and omit
`AuditLog.Read.All` if MVTA does not license or approve sign-in history.

> **Least privilege:** `AppRoleAssignment.ReadWrite.All` is broad — it can
> manage assignments for any app in the tenant. Do not replace it with the
> broader `Directory.ReadWrite.All`. The tighter alternative is a custom Entra
> directory role containing
> `microsoft.directory/servicePrincipals/appRoleAssignedTo/read` and/or
> `microsoft.directory/servicePrincipals/appRoleAssignedTo/update`, assigned to
> the backend identity at the MVTA OnBoard enterprise-application scope. IT must
> validate this option against the chosen app-only implementation before Phase
> 4 approval.

`signInActivity` and downloadable sign-in logs require Microsoft Entra ID P1 or
P2 plus `AuditLog.Read.All`. The UI must degrade gracefully when those
requirements are not met. `signInActivity` is retained with the user object, but
detailed sign-in events are limited by the tenant's sign-in-log retention.

### 4.2 Core Graph calls

**Resolve the service principal for MVTA OnBoard (one-time / cached):**
```http
GET https://graph.microsoft.com/v1.0/servicePrincipals?$filter=appId eq '7e5a35b1-dc1b-473d-987d-6942a7b4fae2'
```
Returns the `id` (object ID) and `appRoles[]` array — each app role has its own GUID, defined in the app registration manifest. Cache these role GUIDs in app config; they don't change unless the manifest is edited.

**Search users for the Assign Role modal:**
```http
GET https://graph.microsoft.com/v1.0/users?$filter=startswith(displayName,'{query}')&$select=id,displayName,userPrincipalName,mail,userType,accountEnabled,externalUserState
```

**Search groups for group-based import:**
```http
GET https://graph.microsoft.com/v1.0/groups?$search="displayName:{query}"&$select=id,displayName,securityEnabled
ConsistencyLevel: eventual
```

**Read expanded directory-wide sign-in activity (optional):**
```http
GET https://graph.microsoft.com/v1.0/users?$select=id,displayName,userPrincipalName,signInActivity&$top=500
```

Use `lastSuccessfulSignInDateTime` for successful access,
`lastSignInDateTime` for the latest interactive attempt, and
`lastNonInteractiveSignInDateTime` for the latest non-interactive attempt.
These fields are directory-wide. Do not describe them as OnBoard-specific.

**Read recent OnBoard-specific sign-ins (optional):**
```http
GET https://graph.microsoft.com/v1.0/auditLogs/signIns?$filter=appId eq '7e5a35b1-dc1b-473d-987d-6942a7b4fae2' and userId eq '{userId}'&$orderby=createdDateTime desc&$top=25
```

**Preview direct members of an OnBoard access group:**
```http
GET https://graph.microsoft.com/v1.0/groups/{groupId}/members/microsoft.graph.user?$select=id,displayName,userPrincipalName,mail,userType,accountEnabled
```

**Assign a role to a user or group:**
```http
POST https://graph.microsoft.com/v1.0/servicePrincipals/{mvtaOnboardServicePrincipalObjectId}/appRoleAssignedTo
Content-Type: application/json

{
  "principalId": "{userOrGroupObjectId}",
  "resourceId": "{mvtaOnboardServicePrincipalObjectId}",
  "appRoleId": "{roleGuidFromAppRolesArray}"
}
```

**List current assignments (populates the Users & Roles table):**
```http
GET https://graph.microsoft.com/v1.0/servicePrincipals/{mvtaOnboardServicePrincipalObjectId}/appRoleAssignedTo
```

**Revoke a role:**
```http
DELETE https://graph.microsoft.com/v1.0/servicePrincipals/{mvtaOnboardServicePrincipalObjectId}/appRoleAssignedTo/{appRoleAssignmentId}
```

**Assign SystemIngestion role to the Function App's managed identity or the Power Automate service principal:**
Use the same `POST .../appRoleAssignedTo` call, but set `principalId` to the
workload service principal's object ID (from `az ad sp show` or the managed
identity's object ID) rather than a user or group ID.

### 4.3 Backend endpoint shape (your own API, wrapping Graph)

| Your endpoint | Wraps | Auth required |
|---|---|---|
| `GET /admin/access/principals` | List direct assignments, assigned groups, direct group members, and role definitions | `OCC.Admin` |
| `GET /admin/access/principals/{userId}/sign-ins` | Read available directory-wide and OnBoard-specific sign-in activity | `OCC.Admin` |
| `POST /admin/access/import/preview` | Validate selected Entra users/groups and return a no-write import plan | `OCC.Admin` |
| `POST /admin/access/import` | Apply approved non-Admin role or group assignments | `OCC.Admin` |
| `DELETE /admin/access/assignments/{assignmentId}` | Revoke a direct assignment; group-derived access must be removed at its source | `OCC.Admin` |
| `POST /admin/access/admin-requests` | Request an `OCC.Admin` grant or revocation | `OCC.Admin` |
| `POST /admin/access/admin-requests/{requestId}/approve` | Apply a pending request; actor must differ from requestor | Different `OCC.Admin` |
| `POST /admin/access/admin-requests/{requestId}/reject` | Reject a pending request | Different `OCC.Admin` |
| `GET /admin/audit-log` | Query the local access and operational audit records | `OCC.Admin` (all) / other roles (module-appropriate history) |

Every mutating endpoint writes a local audit row in addition to its Graph call.
Graph remains the source of truth for current access; the local audit table is
the source of truth for the OnBoard workflow actor, approval chain, requested
change, result, and correlation ID. Read-only refresh and preview operations do
not create change events, though access to detailed sign-in history may be
security-logged separately.

### 4.4 Microsoft implementation references

- [Add app roles and receive them in tokens](https://learn.microsoft.com/en-us/entra/identity-platform/howto-add-app-roles-in-apps)
- [Grant an app-role assignment through the resource service principal](https://learn.microsoft.com/en-us/graph/api/serviceprincipal-post-approleassignedto?view=graph-rest-1.0)
- [Create a custom role scoped to one enterprise application](https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/custom-enterprise-apps)
- [List users with `signInActivity`](https://learn.microsoft.com/en-us/graph/api/user-list?view=graph-rest-1.0)
- [`signInActivity` field semantics](https://learn.microsoft.com/en-us/graph/api/resources/signinactivity?view=graph-rest-1.0)
- [Read detailed Entra sign-in events](https://learn.microsoft.com/en-us/graph/api/signin-list?view=graph-rest-1.0)
- [List direct group members](https://learn.microsoft.com/en-us/graph/api/group-list-members?view=graph-rest-1.0)
- [Conditional Access session controls and sign-in frequency](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-conditional-access-session)
- [Access-token lifetime and silent renewal](https://learn.microsoft.com/en-us/entra/identity-platform/access-tokens)

---

## 5. Sequencing note

This is Phase 4 (Operational maturity) work per the roadmap in the architecture doc — sequenced after the core Messages pipeline, multi-channel rollout, and SMS/social are live. Until then, role assignment happens directly in the Azure Portal (Enterprise Applications → MVTA OnBoard → Users and groups), which requires zero additional Graph permissions or development effort.
