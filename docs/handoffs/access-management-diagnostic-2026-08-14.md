# Access Management diagnostic handoff

## Next-session focus

Determine why a signed-in MVTA OnBoard console session remains on “Loading
Access Management…” / reports Access Management unavailable while the live
service, public API, and unsigned route checks are healthy.

## Current status

- The working branch is `main`. Recent relevant commits are `d53ed82` (REST
  Function Service Bus trigger configuration) and `d44581b` (skip Easy Auth
  management for the background dispatch worker). See Git history for the
  exact diff.
- The Phase 1 infrastructure deployment applied successfully, but its
  immediate Front Door smoke test received `504` during the Function App
  restart. The subsequent **Deploy Function Apps (REST API + dispatch)**
  workflow completed successfully.
- After the package deployment, direct and Front Door health checks returned
  `200`. An unsigned request to the Access Management principals endpoint
  returned the expected `401`; it no longer returns a routing `404` or generic
  service `500`.
- Direct and Front Door requests to the public active-messages endpoint return
  `200`.
- Function App Key Vault references for SQL and the OnBoard confidential-client
  credential report `Resolved`. The optional Teams-webhook reference is absent,
  but it is unrelated to this failure.
- The OnBoard app credential has valid, unexpired metadata. The required
  delegated Microsoft Graph consent grant is present. Do not rotate the
  credential or modify permissions without a concrete signed-request error.

## Reproduced browser behavior

- In the signed-in console, the dashboard shows “Console Offline.” Access
  Management remains on “Loading Access Management…” after more than 15
  seconds. The browser showed no console errors before its diagnostic session
  timed out.
- The signed-in account displays Access Administrator and Operations
  Administrator roles. It was signed out and back in, but the behavior
  persisted.
- A direct authenticated reproduction using Azure CLI was not possible because
  the Azure CLI public client has not been consented for the OnBoard API. That
  result concerns the CLI client only and is not proof of a browser consent
  problem.

## Important deployment behavior

- `infra-phase1/modules/functionapp.bicep` now supplies the REST Event AVL
  trigger’s identity-based Service Bus configuration. The REST Function App
  also has Azure Service Bus Data Receiver on the MVTA namespace.
- A Phase 1 Bicep deployment restarts the Function App but does not restore its
  package. Always run the Function Apps deployment workflow immediately after
  Phase 1 and wait for health to return.
- The deployment runbook at
  `docs/runbooks/access-management-entra.md` has been updated with the
  verified checks and recovery sequence.

## Suggested next steps

1. Obtain an error/status from one actual signed-in browser request. Prefer
   browser network telemetry or Application Insights request/dependency traces
   correlated to the current timestamp. Do not inspect browser storage,
   cookies, or tokens.
2. Determine whether the request reaches Front Door and the REST Function App.
   If it does, capture the server exception and dependency target/status.
3. If it does not reach the API, inspect the console’s MSAL
   `acquireTokenSilent` lifecycle and the deployed frontend configuration.
4. Make the smallest corrective change supported by that evidence, then test
   through the signed-in console plus the direct/Front Door smoke checks.

## Suggested skills

- `diagnosing-bugs` — preserve the evidence-first loop and avoid speculative
  Entra changes.
- `browser:control-in-app-browser` — only if needed to observe the signed-in
  console; follow its browser safety rules and do not inspect credentials or
  session storage.
- `code-review` — after any source change that affects authentication,
  deployment, or Access Management.

## Workspace cautions

- The worktree contains unrelated user modifications and untracked artifacts.
  Preserve them; do not stage broadly.
- This handoff intentionally omits secrets, tokens, user identifiers, and
  tenant-specific object IDs. Obtain any required identifiers from the current
  runtime configuration or documented runbook rather than copying them into
  source.
