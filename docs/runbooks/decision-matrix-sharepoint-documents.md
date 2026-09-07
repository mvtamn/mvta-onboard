# Decision Matrix SharePoint document access runbook

This runbook authorizes OnBoard to read the approved SOP library in SharePoint. It is a prerequisite for three things that are already written and cannot currently work, and for two that are proposed:

| Capability | State |
| --- | --- |
| Document health checks on Procedure references | Written; returns `Unavailable` for every document today |
| Inline rendition preview (QRG images) | Written; fails today |
| Daily document-health timer | Written; exits early, no credential configured |
| Browse SharePoint and select a guide | Proposed |
| Keep a Procedure in sync with its source location | Proposed |

As with `access-management-entra.md`, application deployment and tenant authorization are deliberately separate. Do not place tenant secrets, real application identifiers, site identifiers or library paths in this repository.

## Why this is needed, precisely

`createGraphDocumentChecker` exchanges the caller's token for a Microsoft Graph token using `https://graph.microsoft.com/.default`. That scope resolves to **the union of permissions already consented for the application** — it does not request anything new. The OnBoard application's consented delegated scopes are all identity and directory permissions (`User.*`, `GroupMember.*`, `Application.Read.All`, `AppRoleAssignment.ReadWrite.All`, `AuditLog.Read.All`). None of them grant SharePoint or Files access.

Graph therefore answers `403` to every drive-item request, and the checker maps `401`/`403`/`404` alike to:

```
health_status: "Unavailable"
reason: "SharePoint did not make the document available to this Admin."
```

That message describes a permissions problem as a document problem. Nobody has encountered it because no Procedure has been authored yet, so no document reference has ever been checked.

## Which identity, and why not the existing one

Use a **separate application registration** for document access. Do not add SharePoint permissions to the user-facing OnBoard API application.

The API application carries the delegated scopes the console signs in with, and its application ID is the audience Easy Auth validates. An *application* permission added there would let any code path in the API read SharePoint with no user present and no per-user check — a capability that cannot be revoked without disturbing sign-in for every user of the console.

A separate registration also matches what the code already expects: `decisionMatrixProcedureGovernance.ts` reads `DECISION_MATRIX_HEALTH_CLIENT_ID` and `DECISION_MATRIX_HEALTH_CLIENT_SECRET`, which have never existed in any environment. This runbook fills that gap rather than inventing a new one.

## Why `Sites.Selected` rather than `Sites.Read.All`

`Sites.Read.All` grants read access to **every** SharePoint site in the tenant. OnBoard needs one document library.

`Sites.Selected` grants nothing on its own. After consent, an administrator grants the application access to named sites individually, and the application can read those and only those. Adding a site is a deliberate act with its own audit record; removing one revokes access immediately without touching the application.

The scheduled sync settles the delegated-versus-application question on its own: **a timer has no signed-in user, so on-behalf-of cannot work for it.** Browsing could in principle run delegated, but running both halves on one application identity means one credential, one consent, and one trust boundary to reason about — and it constrains the picker to the approved library rather than letting an Admin browse the whole tenant.

## Preconditions

- A tenant administrator who can grant Microsoft Graph application permissions and consent on behalf of the organization.
- A SharePoint administrator who can identify the approved SOP library and confirm it holds approved copies rather than working drafts.
- An existing Key Vault for the environment, and the Function App's managed identity already granted secret read access. Do not put the client secret in an app setting literal.
- Operations has confirmed which library is authoritative. This runbook grants access to a location; it does not decide which location is correct.

## Steps

Perform these in order. Steps 1–5 are tenant actions and cannot be done from this repository or by CI.

1. **Register the application.** Create a new Entra application registration named for its purpose, for example `MVTA OnBoard — Decision Matrix Documents (dev)`. Create one per environment; never reuse a production registration in a lower environment. It needs no redirect URI, no platform configuration and no exposed API — it is never signed into by a person.

2. **Add the Graph application permission.** On the new registration, add Microsoft Graph → **Application permissions** → `Sites.Selected`.

   The application role identifier is `883ea226-0bf2-4a8f-9f9d-92c9162a727d` on the Microsoft Graph service principal (`00000003-0000-0000-c000-000000000000`). Add no other SharePoint permission. In particular do not add `Sites.Read.All`, `Files.Read.All`, or `Sites.FullControl.All` to this registration — step 4 does not require them of *this* application.

3. **Grant admin consent.** A tenant administrator grants consent for the organization. `Sites.Selected` conveys no site access at this point; it only makes step 4 possible.

4. **Grant the application access to each approved site.** For every site holding an approved SOP library, an administrator issues:

   ```
   POST https://graph.microsoft.com/v1.0/sites/{site-id}/permissions
   {
     "roles": ["read"],
     "grantedToIdentities": [
       { "application": { "id": "{application-id-from-step-1}", "displayName": "{registration name}" } }
     ]
   }
   ```

   Use `read`, not `write`. OnBoard reads approved documents; it never writes to SharePoint. The caller performing this grant needs `Sites.FullControl.All` — that permission belongs to the administrator or tooling making the grant, **not** to the application being granted.

   Record the resulting permission id for each site. Revoking access later is a `DELETE` on that permission, and it takes effect without redeploying anything.

5. **Create a client secret and store it.** Create a secret on the registration, note its expiry, and store the value in the environment's Key Vault. Never paste it into an app setting, a pipeline variable, or this repository. Set a calendar reminder before expiry — an expired secret makes every document read fail, and the current failure message will call that a document problem.

6. **Declare the app settings in Bicep.** Add to `infra-phase1`, not the Portal. The Bicep app-settings list is the complete desired state for the Function App, so a value set by hand survives only until the next infrastructure deploy.

   | Setting | Value |
   | --- | --- |
   | `DECISION_MATRIX_HEALTH_CLIENT_ID` | The application ID from step 1 |
   | `DECISION_MATRIX_HEALTH_CLIENT_SECRET` | A Key Vault reference to the secret from step 5 |

   `AZURE_TENANT_ID` is already declared and is reused as-is.

7. **Deploy the infrastructure**, then confirm the Function App restarted with both settings present.

## Verification

Work down this list. Each step distinguishes a different failure, so do not skip ahead.

1. **Consent is in place.** The new registration's Graph application permissions list `Sites.Selected` with a granted state, and no other SharePoint permission.

2. **The site grant exists.** `GET https://graph.microsoft.com/v1.0/sites/{site-id}/permissions` lists the application from step 1 with role `read`.

3. **The application can read the library.** Using the client credentials from steps 1 and 5, request a token for `https://graph.microsoft.com/.default` and call `GET /sites/{site-id}/drive/root/children`. A `200` with the library's contents confirms consent and the site grant together. A `403` means step 3 or step 4 did not take effect.

4. **A site that was never granted is refused.** Repeat step 3 against a different site the application was not granted. This must return `403`. If it returns `200`, the application holds a tenant-wide permission that step 2 was specifically chosen to avoid — stop and re-check what was consented.

5. **OnBoard reports a document as healthy.** This needs migration 076 applied and one Procedure authored with a real document reference, neither of which is true on dev today. Until then, verification stops at step 4.

## What remains blocked after this runbook

This runbook grants document access. It does not by itself make the Decision Matrix usable:

- Migrations 076, 078, 079 and 080 have no run record; only 079's table has been observed present. See `HANDOFF.md`.
- No Procedure has been authored, so no document reference exists to check.
- The browse-and-select and location-sync capabilities are proposed, not built. This authorization is their prerequisite, not their implementation.

## Revocation

To remove OnBoard's access to a site, `DELETE https://graph.microsoft.com/v1.0/sites/{site-id}/permissions/{permission-id}`. This is immediate and needs no deployment. To remove all document access, delete the client secret; the daily timer will exit early and document checks will report `Unavailable` again — which, until the checker distinguishes a configuration fault from a missing document, is the same message either way.
