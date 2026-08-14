# Access Management session and sign-in controls

Research for the Wayfinder decision ticket **Research session and sign-in telemetry controls**. Sources were checked on 2026-08-14. This report uses Microsoft documentation and repository source only.

## Decision

OnBoard should treat a 12-hour managed-device shift as a **low-friction service target, not a guaranteed token lifetime**. IT should target the OnBoard enterprise application with Conditional Access that requires the approved managed/compliant device posture and permits a periodic sign-in-frequency window of at least 12 hours. OnBoard should continue acquiring an API token silently for every API call and should perform a best-effort forced silent renewal when the console loads so avoidable interaction occurs before, rather than during, a shift. Microsoft explicitly says silent acquisition is not guaranteed, even when a refresh token has not expired, so the acceptance criterion must allow prompts caused by risk, device noncompliance, tenant policy, revocation, browser privacy behavior, or other interaction-required responses.

Privileged Access Management mutations must use a separate Conditional Access authentication context configured by IT for reauthentication every time and, where MVTA policy supports it, a phishing-resistant authentication strength. The API—not the UI—must inspect the `acrs` claim and return a standards-compliant claims challenge when the context is absent. The SPA must replay that challenge through MSAL and retry only after receiving a conforming token.

The Admin UI should distinguish three kinds of time:

1. directory-wide last activity (`signInActivity`),
2. detailed, time-bounded OnBoard sign-in events queried on demand from `/auditLogs/signIns`, and
3. OnBoard's own access-change audit timestamps.

It must not label directory-wide `signInActivity` as “last OnBoard login,” and it should not persist IP address, location, device, risk, or failure details in the OnBoard database or ordinary exports.

Removing an OnBoard app-role assignment prevents the removed role from appearing in **new** tokens; it does not rewrite an access or ID token already issued. Microsoft Graph's `revokeSignInSessions` operation is tenant-wide for the user, has a delay of a few minutes, and does not revoke external-user sessions. It therefore must not be presented as an OnBoard-only “log out” action. Ordinary OnBoard offboarding should remove the assignment and disclose a bounded propagation period; urgent compromise remains an IT action to block the account and revoke sessions across the tenant. If a future requirement demands immediate OnBoard-only cutoff, the API needs an additional OnBoard-specific server-side revocation check—this cannot be achieved by the Entra role assignment alone.

## What the current implementation already does

- The SPA uses MSAL Browser with an OnBoard tenant authority and SPA redirect, stores the MSAL cache in `localStorage`, and asks for the REST API scope ([`msalConfig.ts`](../../frontend/packages/onboard-console/src/auth/msalConfig.ts)). `localStorage` supports shared auth state across tabs, but the Entra session cookie and MSAL's application-domain cache remain separate mechanisms ([Microsoft: SSO with MSAL.js](https://learn.microsoft.com/en-us/entra/identity-platform/msal-js-sso)).
- The shared API client calls `acquireTokenSilent` for every request and redirects only when MSAL throws `InteractionRequiredAuthError` ([`config.ts`](../../frontend/packages/onboard-console/src/config.ts)). This is the correct basic silent-first pattern; Microsoft recommends attempting cache/silent acquisition before interaction ([Microsoft: acquire and cache tokens with MSAL](https://learn.microsoft.com/en-us/entra/identity-platform/msal-acquire-cache-tokens)).
- The frontend reads roles from the cached account's ID-token claims ([`roles.ts`](../../frontend/packages/onboard-console/src/auth/roles.ts)), while the API reads role claims from the Easy Auth `x-ms-client-principal` header ([`auth.ts`](../../functions-restapi/src/lib/auth.ts)). This can create a temporary split after an assignment change: a newly acquired API access token can reflect the new role while the UI still uses the older ID-token account claims.
- The client currently does not parse an API `WWW-Authenticate` claims challenge, request a token with the returned `claims`, or retry the protected operation. The API currently checks roles only and does not inspect `acrs`. Step-up authentication therefore requires changes on both sides.

## 12-hour managed-device session

### What Entra controls

Conditional Access sign-in frequency specifies how long a user can access a resource before reauthentication. It supports OAuth 2.0 and OIDC applications, and Conditional Access requires Entra ID P1 or P2 ([Microsoft: adaptive session lifetime policies](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-session-lifetime)). A persistent browser session controls whether the Entra browser session survives closing and reopening the browser; it is not the same as access-token lifetime or sign-in frequency ([Microsoft: Conditional Access session controls](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-conditional-access-session)).

For OnBoard, IT should own the policy and scope it to the production enterprise application and intended workforce groups. The policy should:

- require the managed/compliant device posture chosen by IT;
- use a periodic sign-in frequency of **at least 12 hours** for ordinary OnBoard work;
- allow browser persistence only on managed devices if shift recovery after a browser restart is an accepted requirement;
- exclude and separately protect emergency-access identities according to IT policy; and
- be piloted in report-only mode before enforcement.

The application should describe the target as: “After a fresh sign-in at shift start on a compliant managed device, a user can complete a normal 12-hour shift without an avoidable OnBoard-initiated interactive prompt.” It must not promise uninterrupted access when Conditional Access, user risk, device state, consent, token revocation, or browser restrictions require interaction.

### What MSAL controls

Browser access tokens are normally short-lived (typically about one hour), while SPA refresh tokens normally have a non-sliding lifetime of about 24 hours. MSAL's `acquireTokenSilent` uses a cached access token, then a refresh token, and finally a hidden iframe before returning an interaction-required error. Microsoft documents `forceRefresh` plus `refreshTokenExpirationOffsetSeconds` as a best-effort way to front-load interaction for a desired interval up to 24 hours, but explicitly states that silent acquisition is never guaranteed ([Microsoft: MSAL Browser token lifetimes and renewal](https://learn.microsoft.com/en-us/entra/msal/javascript/browser/token-lifetimes); [Microsoft: refresh tokens](https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens)).

On initial console load, after an account is selected, OnBoard should call `acquireTokenSilent` for the API scope with:

- `forceRefresh: true`, and
- `refreshTokenExpirationOffsetSeconds` set to the accepted shift window (12 hours, or a small IT-approved buffer if the acceptance test starts before operational duty).

Subsequent API calls should retain the existing silent-first behavior without force-refresh. Interaction-required handling should preserve the intended destination/action across a redirect and avoid duplicate writes.

### Acceptance tests

- A managed-device test account freshly authenticated at the start can continuously use read and ordinary write operations for 12 hours without an OnBoard-caused prompt.
- Expiring access tokens are renewed silently and API requests continue with a valid bearer token.
- A Conditional Access policy change, device becoming noncompliant, session revocation, or an explicit interaction-required response produces a safe redirect and returns the user to the console.
- Closing and reopening the browser behaves according to the managed-device persistent-session policy; no UI copy equates this behavior with the 12-hour sign-in-frequency window.
- An unmanaged-device test account is denied or receives the stricter IT-defined policy even if it has cached MSAL state.

## Privileged step-up authentication

Conditional Access authentication context lets an API protect a sensitive action rather than raising the authentication bar for the entire application. It requires Entra ID P1, applies to user sign-ins rather than app-only identities, and is conveyed through the access token's `acrs` claim ([Microsoft: authentication-context developer guide](https://learn.microsoft.com/en-us/entra/identity-platform/developer-guide-conditional-access-authentication-context); [Microsoft: access-token claims](https://learn.microsoft.com/en-us/entra/identity-platform/access-token-claims-reference)).

Use one IT-published context for Access Management mutations such as role grant/revoke approval, privileged-role changes, guest invitation approval, and any future session-revocation request. Configure its Conditional Access policy with reauthentication “Every time” and the IT-selected strong authentication requirement. Microsoft applies five minutes of clock skew to “Every time,” so product copy should say “recent step-up required,” not promise a new prompt on every click ([Microsoft: adaptive session lifetime policies](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-session-lifetime)).

Required application behavior:

1. The API maps protected operations to an IT-selected, available authentication-context ID. It checks the access token's `acrs` claim.
2. If the context is missing, the API returns `401` with a `WWW-Authenticate: Bearer ... error="insufficient_claims", claims="..."` challenge.
3. The SPA extracts the challenge, calls MSAL with the returned claims, and retries after successful acquisition. Claims challenges are the protocol mechanism for authentication context and Continuous Access Evaluation-aware clients ([Microsoft: claims challenges](https://learn.microsoft.com/en-us/entra/identity-platform/claims-challenge)).
4. The backend remains the authorization authority: a successful step-up never substitutes for an app-role check, different-actor approval, or last-administrator safeguard.

Do not hard-code a context ID in UI code. The backend/configuration layer should use an environment-specific mapping; if the UI must display the available context, the app-only Graph permission `AuthenticationContext.Read.All` is sufficient to list `/identity/conditionalAccess/authenticationContextClassReferences` ([Microsoft Graph: list authentication contexts](https://learn.microsoft.com/en-us/graph/api/conditionalaccessroot-list-authenticationcontextclassreferences?view=graph-rest-1.0)).

## Role-change propagation

An app-role assignment with a nonempty value is emitted in the `roles` claim of tokens for the assigned principal ([Microsoft Graph: `appRoleAssignment`](https://learn.microsoft.com/en-us/graph/api/resources/approleassignment?view=graph-rest-1.0)). Authorization changes are therefore observed at token issuance, not by mutating tokens already in the browser. Microsoft documents access tokens as normally lasting about one hour and states that authorization is reevaluated when a refresh token is exchanged for a new access token ([Microsoft: revoke user access](https://learn.microsoft.com/en-us/entra/identity/users/users-revoke-access)).

The implementation contract should be:

- After a role grant or removal, show “Directory updated; active sessions may take up to the current token lifetime to reflect this change.” Do not claim immediate logout.
- Force-refresh the **current administrator's** token after changing their own nonprivileged access, or require a fresh sign-in when their own privileged role changes. A user must never approve their own privileged change under the separate two-person rule.
- Refresh UI role state from the resulting authentication response or an API-delivered effective-capabilities endpoint. Do not continue relying indefinitely on the ID-token claims captured at the original login.
- Treat the API's access-token claims as the normal authorization input. For actions where immediate removal is a hard security requirement, additionally verify current effective access server-side against Entra (or adopt a deliberate OnBoard-specific revocation mechanism). This exception must be explicit because it changes latency, availability, and source-of-truth behavior.
- Test direct and group-based assignments. Directory reads can be eventually consistent, so the UI needs “pending propagation” and retry states rather than interpreting a short-lived mismatch as failure ([Microsoft Graph: list users](https://learn.microsoft.com/en-us/graph/api/user-list?view=graph-rest-1.0)).

## Sign-in telemetry

### Summary activity for a user list

`GET /users?$select=id,displayName,userPrincipalName,signInActivity` provides directory-wide timestamps. The property is retained for as long as the user object exists and includes:

- `lastSignInDateTime`: most recent **interactive attempt**, successful or failed;
- `lastNonInteractiveSignInDateTime`: most recent noninteractive attempt, successful or failed; and
- `lastSuccessfulSignInDateTime`: most recent successful interactive or noninteractive sign-in (available since 2023-12-01 and not backfilled).

These fields require Entra ID P1 or P2 plus `AuditLog.Read.All`, must be explicitly selected, and reduce the maximum user-list page size to 500 ([Microsoft Graph: `signInActivity`](https://learn.microsoft.com/en-us/graph/api/resources/signinactivity?view=graph-rest-1.0); [Microsoft Graph: list users, last sign-in example](https://learn.microsoft.com/en-us/graph/api/user-list?view=graph-rest-1.0#example-11-get-users-including-their-last-sign-in-time)).

The Admin UI should label them “Last directory successful sign-in,” “Last directory interactive attempt,” and “Last directory noninteractive attempt.” None is OnBoard-specific. Prefer `lastSuccessfulSignInDateTime` for inactivity decisions; failed attempts can advance the other two values.

### Detailed OnBoard events

Use the v1.0 `GET /auditLogs/signIns` endpoint, filtered server-side by OnBoard application ID, user ID, and a bounded UTC time range. It requires `AuditLog.Read.All` for delegated or application access. The endpoint returns only events still within Entra's default retention window and includes application/resource identity, interactive status, result, correlation ID, client, device, IP, location, risk, and Conditional Access information. Reading applied Conditional Access policy details also needs a supported policy-read permission ([Microsoft Graph: list sign-ins](https://learn.microsoft.com/en-us/graph/api/signin-list?view=graph-rest-1.0); [Microsoft Graph: `signIn` resource](https://learn.microsoft.com/en-us/graph/api/resources/signin?view=graph-rest-1.0)).

Recommended UI behavior:

- Fetch details only when an authorized Access Administrator opens a user's sign-in panel.
- Default to a short time range and paginate; do not fetch tenant-wide logs to populate the primary users table.
- Show UTC converted to the viewer's local zone while retaining the explicit zone/offset.
- Separate interactive and noninteractive events and clearly identify success versus attempt.
- Restrict IP, location, device, failure reason, risk, and Conditional Access details to the protected detail view. Do not include them in ordinary CSV exports or persist them in OnBoard.
- Store at most an OnBoard audit entry saying who viewed sign-in details, when, for which principal, and the Graph correlation/request identifiers needed for troubleshooting—not a copy of the event payload.

Entra's sign-in logs distinguish interactive user, noninteractive user, service-principal, and managed-identity activity; these are not interchangeable “login” events ([Microsoft: sign-in logs](https://learn.microsoft.com/en-us/entra/identity/monitoring-health/concept-sign-ins)).

### Retention and licensing

Entra retains audit and sign-in activity for seven days on Free and 30 days on P1/P2. Retention changes are not retroactive. Longer retention requires routing activity logs through diagnostic settings to Azure Storage, Log Analytics, Event Hub, or another approved destination ([Microsoft: data retention](https://learn.microsoft.com/en-us/entra/identity/monitoring-health/reference-reports-data-retention); [Microsoft: access and archive activity logs](https://learn.microsoft.com/en-us/entra/identity/monitoring-health/howto-access-activity-logs)). Graph access to sign-in logs and `signInActivity`, Conditional Access session controls, and authentication context collectively make P1 the minimum viable license for the proposed experience. P2-only risk detail should be treated as optional; Graph hides some risk detail from non-P2 tenants ([Microsoft Graph: `signIn`](https://learn.microsoft.com/en-us/graph/api/resources/signin?view=graph-rest-1.0)).

If MVTA needs history beyond 30 days, archive it in the tenant's security/logging platform. Do not solve that requirement by duplicating sensitive identity telemetry into the OnBoard operational database.

## Session revocation and offboarding

`POST /users/{id}/revokeSignInSessions` resets the user's sign-in-session-valid-from time, invalidating refresh tokens and browser session cookies issued earlier. Its least-privileged application permission is `User.RevokeSessions.All`. Microsoft notes a delay of a few minutes and states that the operation does not revoke external-user sessions because guests authenticate in their home tenant ([Microsoft Graph: revoke sign-in sessions](https://learn.microsoft.com/en-us/graph/api/user-revokesigninsessions?view=graph-rest-1.0)).

This is a **tenant-wide user response**, not an OnBoard-only capability. It affects sessions for all applications and conflicts with the agreed boundary that OnBoard Access Administrators manage OnBoard access rather than tenant accounts. Therefore:

- Do not grant `User.RevokeSessions.All` to the OnBoard service merely to implement normal role removal.
- Do not expose a button labeled “Log out of OnBoard” backed by `revokeSignInSessions`.
- For normal offboarding, remove the OnBoard app-role/group assignment, mark the change as propagating, and audit it.
- For a compromised or terminated internal account requiring urgent action, route the operator to the IT runbook. IT can disable the account and revoke tenant sessions; Microsoft warns that existing access tokens can remain usable until expiry unless the resource implements its own revocation checks ([Microsoft: revoke user access](https://learn.microsoft.com/en-us/entra/identity/users/users-revoke-access)).
- For a guest, remove OnBoard access and route home-tenant session response to the guest's sponsor/home-tenant administrator.

An immediate OnBoard-only cutoff would require the OnBoard API to consult current assignment state (or an application-specific revocation record) on protected requests and reject otherwise-valid bearer tokens. That is a separate architectural decision; neither Conditional Access sign-in frequency nor Graph session revocation provides this exact scope.

## Required specification changes

The final Access Management specification should include:

1. An environment-specific Conditional Access policy contract for managed-device posture, periodic sign-in frequency, browser persistence, exclusions, and report-only rollout.
2. A best-effort shift-start silent-renewal flow and redirect-safe recovery for interaction-required errors.
3. Authentication-context mapping and end-to-end claims-challenge handling for every privileged mutation.
4. An effective-capabilities refresh path so frontend ID-token role claims do not remain stale after a role change.
5. Explicit propagation language for grants/removals and a separate IT emergency-revocation runbook.
6. A telemetry model that labels directory-wide summary timestamps separately from OnBoard-filtered event history.
7. On-demand detailed-event retrieval, least-data display/export rules, access logging, and no local copy of sensitive sign-in payloads.
8. A licensing/configuration prerequisite check: Entra ID P1 minimum; `AuditLog.Read.All` only if sign-in telemetry is enabled; `AuthenticationContext.Read.All` only if OnBoard must enumerate contexts; no `User.RevokeSessions.All` for ordinary OnBoard access administration.

## Decision gist

Use P1 Conditional Access plus MSAL for a best-effort 12-hour managed-device shift and authentication-context step-up; show directory and OnBoard-filtered sign-in telemetry distinctly, and treat role/session revocation as token-bounded or tenant-wide unless OnBoard deliberately adds its own immediate server-side cutoff.
