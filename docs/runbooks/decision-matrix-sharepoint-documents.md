# Decision Matrix SharePoint document access runbook

This runbook authorizes OnBoard to read the approved SOP library in SharePoint. It is a prerequisite for three things that are already written and cannot currently work, for one that has shipped and needs the site grant to do anything, and for one that is still proposed:

| Capability | State |
| --- | --- |
| Document health checks (Check documents, Submit, Approve, and the daily timer) | Read only as the dedicated documents application. With it unconfigured, every check answers "not configured", records nothing, and Submit and Approve are refused |
| Inline rendition preview (QRG images) | Delegated: reads with the viewer's own SharePoint access |
| Browse SharePoint and select a guide | Reads as the sign-in application (`ONBOARD_API_CLIENT_ID`), never the documents application; needs that application's own site grant |
| Keep a Procedure in sync with its source location | Proposed; migration 116 holds the schema, nothing reads or writes it yet |

As with `access-management-entra.md`, application deployment and tenant authorization are deliberately separate. Never place a secret in this repository: client secrets, the SharePoint ones included, live in the environment's Key Vault and are referenced from Bicep. Non-secret identifiers - the Graph site id and drive id of an approved library - belong in the environment's parameters file alongside the application id and the role and group ids already there, because the Bicep app-settings list is the complete desired state and a value set by hand survives only until the next infrastructure deploy. They are addresses, not authorization: reading the library still requires the `Sites.Selected` grant of step 4 and the secret of step 5, and publishing an address grants nothing on its own.

## Two identities, two jobs

OnBoard reads SharePoint as two different applications, and keeping them apart is deliberate (ADR 0025, amended 2026-09-17).

- **The Decision Matrix documents application** is the integrity monitor. It makes every Document Reference Health check - the daily timer, **Check documents**, and the checks Submit and Approve run before they decide - and nothing else. It holds `Sites.Selected` with `read` on the approved site, and reads only an item's version, name and type. There is no fallback: if `DECISION_MATRIX_HEALTH_CLIENT_ID` or `_SECRET` is missing, checks report "not configured" and record nothing.
- **The sign-in application** (`ONBOARD_API_CLIENT_ID`) browses the library for the Draft picker, reads a chosen document when a Draft is saved, and walks the SOP folder each morning for SOPs no Procedure uses. It needs its own `Sites.Selected` grant on the same site. All three list or read what an Admin can already browse, which is why they share an identity rather than borrowing the integrity monitor's.

A check never uses the Admin's own SharePoint rights. It used to: Submit, Approve and Check documents read on behalf of whoever clicked, while the daily timer read as the application, and both wrote the same health record - so whether a revision could be approved depended on who pressed the button, and it rested on a delegated `Sites.FullControl.All` consented to the sign-in application on 2026-09-14. Opening a source document and previewing a Document Rendition still read on the viewer's behalf, which needs only delegated `Files.Read.All`.

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

`scripts/setup-decision-matrix-documents-identity.sh` walks an administrator through steps 1–5 and checks each one landed, including a final app-only read of the library that proves consent and the site grant together. It is the same procedure written out below; run it, or follow the steps by hand.

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

6. **Name the application in the environment's parameters file.** The Bicep is already written: set `decisionMatrixHealthClientId` in `infra-phase1/parameters/phase1-{env}.parameters.json` to the application id from step 1, and the two app settings follow.

   | Setting | Where its value comes from |
   | --- | --- |
   | `DECISION_MATRIX_HEALTH_CLIENT_ID` | The `decisionMatrixHealthClientId` parameter |
   | `DECISION_MATRIX_HEALTH_CLIENT_SECRET` | A Key Vault reference to `decision-matrix-health-client-secret`, the secret stored in step 5 |

   Both are emitted together or not at all, so a client id without its secret cannot reach the app - that half-configured state reads at runtime as a document problem rather than as a missing credential. An empty parameter emits neither, and document checks then report "not configured" rather than reading as any other application.

   The secret never appears in this repository, in an app setting, or in a pipeline variable: the app's managed identity reads it from the vault at runtime, and rotating it is a vault operation with no redeploy.

   `AZURE_TENANT_ID` is already declared and is reused as-is.

7. **Deploy the infrastructure**, then confirm the Function App restarted with both settings present.

## Rollout on an environment that has not had it

Do these in this order. The order is not a preference: the code that pins browsing to the sign-in application and moves every check onto the documents application must be live **before** `decisionMatrixHealthClientId` is set. Set it first, and the previous code's credential preference moves library browsing onto the documents application - the alternate user-access path ADR 0025 rules out for that identity - while Approve keeps checking on the Admin's behalf alongside an application-only daily check, which is the two-writer fault this change exists to remove.

Steps in **bold** are tenant or SharePoint actions and cannot be done from this repository or by CI.

1. Merge and deploy the application change. With no documents application configured, checks report "not configured" and nothing is written.
2. **Run `scripts/setup-decision-matrix-documents-identity.sh` from a network the environment's Key Vault accepts** - the dev vault denies public network access, so the wizard's secret step fails from anywhere else. Run its preflight first: it tells you within seconds whether the account can read `GET /sites/{site-id}/permissions`, and if it cannot, the site-grant stage needs a SharePoint administrator.
3. **When the wizard asks for the site id, enter the site that holds the approved library for this environment** - the value of `decisionMatrixLibrarySiteId` in `infra-phase1/parameters/phase1-{env}.parameters.json`. On dev that is the Transit Operations Hub site, not the Operations site. The wizard grants on whatever it is given.
4. **In the same session, issue the sign-in application's own grant on that site**, with the same call as step 4 below and `application.id` set to `ONBOARD_API_CLIENT_ID`. Browsing needs it, and without browsing no Draft can be given its primary SOP.
5. **Read both grants back** with `GET https://graph.microsoft.com/v1.0/sites/{site-id}/permissions`. Each application should appear by its id with role `read`. Record the two permission ids for revocation.
6. Set `decisionMatrixHealthClientId` in the parameters file through a pull request, then deploy the infrastructure.
7. Verify: **Check documents** on a test Procedure reads Valid, its `document_checked` audit event carries `observed_by: application`, and the picker lists the library.
8. **On the sign-in application, add delegated `Files.Read.All` and grant admin consent.** This keeps Document Rendition preview working once full control is gone.
9. Verify that preview still opens for an Admin who has SharePoint access to the library.
10. **Remove delegated `Sites.FullControl.All` from the sign-in application in both places: its requested API permissions, and the organization-wide consent grant.** Removing only the grant leaves it in the requested permissions, and the next "Grant admin consent" restores it.

Steps 8-10 depend only on step 1 and can run alongside steps 2-7.

**Migration 126** (`health_outcome` on `ProcedureDocumentReferences`) can be applied at any point; the code checks for the column before writing it. Until it is applied, the governance workspace can say whether document checks are configured and whether they have gone stale, but cannot count checks SharePoint refused - and it says nothing about refusals rather than implying there were none.

## Reading the governance workspace notice

Administration › Decision Matrix shows a notice above the review queue when document checks are not working. It is derived from the health record itself, not from a log of timer runs:

| Notice | Means | Look at |
| --- | --- | --- |
| Document checks aren't set up here | `DECISION_MATRIX_HEALTH_CLIENT_ID` or `_SECRET` is missing, so nothing is checked and Submit and Approve are refused. Shown alone: every other symptom follows from it | Steps 2-6 above |
| SharePoint refused N document checks | The latest check of N current references got a 401 or 403 | Each row's Check documents result: a missing site grant names step 4; a rejected credential usually means the client secret expired |
| Some documents haven't been checked since … / have never been checked | A current reference's last check is more than 26 hours old, or was never made | The `decisionMatrixDocumentHealth` timer's runs in Application Insights |

### SOPs no Procedure uses

`decisionMatrixSopFolderWalk` runs at 06:30 UTC. It walks `DECISION_MATRIX_SOP_FOLDER` (dev: `_SOPs`; `/` is the whole library; unset is not configured) as the sign-in application and records what it saw in migration 116's tables. The same workspace then shows one of these:

| Notice | Means | Look at |
| --- | --- | --- |
| N SOPs in _SOPs aren't used by any Procedure | The last walk finished within 26 hours, and N documents have no reference on a Draft, Under review or Approved revision. **Show them** lists each, and **Create Draft from this** opens the Draft form with it chosen | Nothing is wrong; these want a Procedure, or a decision that they don't |
| New SOPs aren't looked for here | No library, no sign-in application credential, or no `DECISION_MATRIX_SOP_FOLDER` | The reason names the setting |
| New SOPs can't be reported yet | Migration 116 (or 076) has not been applied | Apply it |
| _SOPs hasn't been walked yet | Settings are in place and the walk has not run since; it runs every morning | Wait for 06:30 UTC, or trigger `decisionMatrixSopFolderWalk` |
| The last walk of _SOPs didn't finish | SharePoint refused part of the folder, a folder was not there, the folder is over the walk's size limits, or the read failed. Nothing is marked gone by an unfinished walk | The reason; a refusal is the sign-in application's site grant (step 4) |
| _SOPs hasn't been walked since … | The last walk is more than 26 hours old | The `decisionMatrixSopFolderWalk` timer's runs in Application Insights |

Revised or removed SOPs that a Procedure *does* use are Document Reference Health's to report, not this walk's.

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
