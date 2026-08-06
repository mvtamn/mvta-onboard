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

## 2. The four App Roles

| Role | Purpose |
|---|---|
| **OCC Viewer** | Read-only. View live messages, Eventor map, delay queue. |
| **OCC Publisher** | Day-to-day operator. Create/edit drafts, approve AI-parsed alerts for publish, retract messages. |
| **OCC Admin** | Publisher permissions + manage ExpirationDefaults, manage user/role assignments, view full audit log. |
| **SystemIngestion** | Non-human. Assigned to the Power Automate flow's service principal / Function App managed identity. Can create **drafts only** — never flips a message to `active`. Enforces the non-negotiable rule: no AI-generated alert publishes without explicit staff approval. |

### Capability matrix

| Capability | Viewer | Publisher | Admin | SystemIngestion |
|---|:---:|:---:|:---:|:---:|
| View active messages / Eventor map | ✓ | ✓ | ✓ | — |
| Create/edit draft messages | | ✓ | ✓ | ✓ (API only) |
| Approve AI-parsed alert for publish | | ✓ | ✓ | — |
| Retract a live message | | ✓ | ✓ | — |
| Edit ExpirationDefaults | | | ✓ | — |
| Manage user/role assignments | | | ✓ | — |
| View audit log | own actions | own actions | all | — |
| Sign in to web UI | ✓ | ✓ | ✓ | ✗ |

---

## 3. Admin UI screens (Phase 4)

### 3.1 Users & Roles (landing screen)

Table of every principal holding an MVTA Relay app role.

| Column | Notes |
|---|---|
| Name / email | Pulled from Entra via Graph, not stored locally |
| Role | OCC Viewer / Publisher / Admin / SystemIngestion |
| Last login | From Application Insights / sign-in logs |
| Status | Active / Disabled in Entra |
| Actions | Change role, Revoke access |

Filter/search by name, email, or role. SystemIngestion row(s) are visually distinguished (icon or badge) since they represent service principals, not people.

### 3.2 Assign Role modal

1. Admin clicks **Assign Role**.
2. Type-ahead search against the Entra directory (`GET /users` via Graph, `User.Read.All`).
3. Select a user, select exactly one role (roles are mutually exclusive per user in this design — no multi-role stacking, to keep the audit story simple).
4. Submit → backend performs the Graph app-role-assignment call using **app-only credentials**. The OCC Admin's own browser session never needs Graph write permissions — the frontend never talks to Graph directly.
5. Confirmation toast + new row appears in the table.

### 3.3 Two-person rule for granting OCC Admin

Because an OCC Admin can grant the Admin role to others (including themselves, effectively), granting **OCC Admin** specifically requires a second existing Admin to confirm before it takes effect (simple approval step, not full workflow engine — a pending-state row with an "Approve" button visible only to other Admins).

### 3.4 Audit Log

Single shared log — role changes and message actions live in the **same table**, not separate ones, matching Section 9 of the architecture doc ("all create/edit/retract actions logged with staff identity and timestamp").

Columns: timestamp, actor, action type (`role_granted`, `role_revoked`, `message_created`, `message_published`, `message_retracted`, `ttl_default_changed`), target (user or message ID), before/after value where applicable.

Filterable by actor, action type, date range. Exportable to CSV for compliance requests.

---

## 4. Microsoft Graph implementation

### 4.1 Required permissions (app registration, not delegated)

| Permission | Type | Purpose |
|---|---|---|
| `AppRoleAssignment.ReadWrite.All` | Application | Grant/revoke app role assignments |
| `User.Read.All` | Application | Search directory for the Assign Role modal |
| `Application.Read.All` | Application | Resolve the service principal object ID for MVTA OnBoard itself |

All three require **admin consent** in the Entra tenant — this is a one-time IT approval to flag for the handoff, since it's a tenant-wide grant, not per-user.

> **Note:** `AppRoleAssignment.ReadWrite.All` is broad — it can assign roles for *any* app in the tenant, not just MVTA OnBoard. If IT wants tighter scoping, the alternative is `Directory.ReadWrite.All` scoped via a custom Graph permission policy, but that's more setup for marginal benefit at MVTA's scale. Worth a one-line flag in the handoff doc, not a blocker.

### 4.2 Core Graph calls

**Resolve the service principal for MVTA OnBoard (one-time / cached):**
```http
GET https://graph.microsoft.com/v1.0/servicePrincipals?$filter=appId eq '7e5a35b1-dc1b-473d-987d-6942a7b4fae2'
```
Returns the `id` (object ID) and `appRoles[]` array — each app role has its own GUID, defined in the app registration manifest. Cache these role GUIDs in app config; they don't change unless the manifest is edited.

**Search users for the Assign Role modal:**
```http
GET https://graph.microsoft.com/v1.0/users?$filter=startswith(displayName,'{query}')&$select=id,displayName,mail,accountEnabled
```

**Assign a role to a user:**
```http
POST https://graph.microsoft.com/v1.0/users/{userId}/appRoleAssignments
Content-Type: application/json

{
  "principalId": "{userId}",
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
Same `POST .../appRoleAssignments` call, but `principalId` is the service principal's object ID (from `az ad sp show` or the managed identity's object ID) rather than a user ID.

### 4.3 Backend endpoint shape (your own API, wrapping Graph)

| Your endpoint | Wraps | Auth required |
|---|---|---|
| `GET /admin/users` | List app role assignments | OCC Admin role |
| `POST /admin/users/{userId}/role` | Assign/change role | OCC Admin role |
| `DELETE /admin/users/{userId}/role` | Revoke role | OCC Admin role |
| `GET /admin/audit-log` | Query your own audit table | OCC Admin (all) / OCC Publisher (own actions only) |

Every one of these endpoints writes a row to the audit log *in addition to* whatever Graph call it makes — Graph is the source of truth for the actual permission, your audit table is the source of truth for "who did this and when," since Graph's own audit logs (Entra sign-in/audit logs) require a higher Entra license tier than MVTA may have.

---

## 5. Sequencing note

This is Phase 4 (Operational maturity) work per the roadmap in the architecture doc — sequenced after the core Messages pipeline, multi-channel rollout, and SMS/social are live. Until then, role assignment happens directly in the Azure Portal (Enterprise Applications → MVTA OnBoard → Users and groups), which requires zero additional Graph permissions or development effort.
