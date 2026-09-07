# On-Demand operational zones runbook

This runbook puts GTFS-Flex service-area geometry into force for the on-demand wait monitor. Without an **active** zone version, `loadActiveOperationalZones` returns an empty set, every pickup resolves against nothing, and Service Risk & Quality reports no on-demand risk regardless of what Spare is sending.

The importer has existed since PRs #184/#185. **No zone version has ever been active in dev.** As of 2026-09-07 the receiver is still logging the gap once a minute through every service day, and the daily poller skips every run for want of a source URL.

| Capability | State |
| --- | --- |
| GTFS-Flex parser, geometry validation, point-in-polygon resolver | Written and tested since migration 074 |
| `onDemandZonesSync` daily poller (09:30 UTC) | Written; **skips every run** — `ON_DEMAND_ZONE_FLEX_URL` is unset |
| `scripts/importOnDemandZones.ts` hand-seeding | Written; never run |
| `GET`/`POST /api/on-demand-zone-versions` | Written; never used |
| Activation attribution (migration 098) | Written; **applied state on dev unverified** |

Zones are a prerequisite for the monitor, not the switch that starts it. See [What this does not do](#what-this-does-not-do).

## Which path to take

There are two ways in, and the choice is not preference — it depends on whether a published feed URL exists.

| | Daily poller | Hand-seeding script |
| --- | --- | --- |
| Needs | `ON_DEMAND_ZONE_FLEX_URL` set to a reachable archive | A `.zip` on disk |
| Runs | 09:30 UTC daily, unattended | Once, by a person |
| Records feed health | Yes (`on_demand_zones`) | No |
| Use when | MVTA or Spare publishes a GTFS-Flex URL | Today — no URL is known |

Both share the same parser, the same source hash, the same transactional write, and the same first-import activation rule, so a hand-seeded version is indistinguishable from a polled one. A later poll of identical bytes is recognised as already imported rather than duplicated.

**Prefer the poller the moment a URL exists.** Set `onDemandZoneFlexUrl` in `infra-phase1/parameters/phase1-dev.parameters.json` and deploy; nothing else changes. The script exists because waiting for a URL kept the monitor down indefinitely.

## What you need

A **GTFS-Flex archive** (`.zip`) containing `locations.geojson` and `feed_info.txt` with a `feed_version`, from Spare or from MVTA's GTFS-Flex export.

MVTA's fixed-route `google_transit.zip` is **not** this file. It contains 11 files and no `locations.geojson`; it is the wrong feed entirely.

The archive must contain exactly the expected operational zones — by default the two pilot areas:

| Location id | Name |
| --- | --- |
| `location_id__b413a052-36eb-43de-97f7-59fe9f99f839` | Central Zone, Apple Valley |
| `location_id__ad56cc1c-48cc-495b-948b-661aae320fd8` | Shakopee – Prior Lake Boundaries |

Other features in the feed, including the Eagan reference boundary, are ignored. An archive missing either expected zone is **refused**, deliberately: importing a feed that silently lost a zone would shrink the monitored service area with nothing to show for it.

To adopt a third zone, or to follow an upstream location-id rename, set `ON_DEMAND_OPERATIONAL_ZONE_IDS` (comma-separated) rather than editing code — `expectedOperationalZoneIds()` falls back to the two pilot ids when it is unset.

## Preconditions

- `OCC.Admin` to activate. Any staff read role can list versions.
- Migration 098 applied, for activation to be attributed. It is **not** a hard prerequisite: `activationAuditSupported()` probes for the column on every call, so activation and the listing both work on a database the migration has not reached — the actor is simply not recorded. Apply it first if you want the audit trail, which is the point of having it.
- For the script only: network reach to the database. See the warning below.

> **The dev SQL server has `publicNetworkAccess: Disabled`.** The seeding script connects directly with `SQL_CONNECTION_STRING`, so it **cannot be run from a laptop**. Run it from inside the VNet — the Function App container is the practical place, and the compiled script ships in the deployment package. Do not re-open public network access to work around this; that was closed deliberately.

## Path A — hand-seed from an archive

The REST app is Linux (`NODE|24`), VNet-integrated, and runs from a package (`WEBSITE_RUN_FROM_PACKAGE=1`), so `/home/site/wwwroot` is a read-only mount that already contains `dist/src/scripts/importOnDemandZones.js` and the production `node_modules`. `SQL_CONNECTION_STRING` is already in the container's environment as a Key Vault reference.

1. **Open an SSH session** to the container, from the Azure Portal (Function App → Development Tools → SSH) or:

   ```bash
   az webapp ssh -n func-mvta-restapi-dev -g rg-mvta-onboard-dev
   ```

2. **Get the archive into the container.** `/home/site/wwwroot` is read-only; write to `/tmp`. Either `curl` it from a location the container can reach, or paste it base64-encoded:

   ```bash
   base64 -d > /tmp/mvta-connect-flex.zip
   ```

3. **Run the import:**

   ```bash
   cd /home/site/wwwroot && node dist/src/scripts/importOnDemandZones.js /tmp/mvta-connect-flex.zip
   ```

   It prints the feed version and the zone names it parsed **before** touching the database — a malformed archive, or one missing an expected zone, fails there rather than after a transaction is open. Then one of:

   - `Imported and activated version <id>. The on-demand zone monitor is now live.` — no version was active, so the first import activates itself. Skip to [Verify](#verify).
   - `Imported version <id> as INACTIVE, because another version is already active.` — go to [Path C](#path-c--activate-an-imported-version).
   - `Already imported as version <id>; nothing changed.` — these exact bytes are already stored under this feed version. Check whether that version is the active one before assuming there is nothing to do.

4. **Delete the archive** from `/tmp` when done.

## Path B — the daily poller

Once a GTFS-Flex URL exists:

1. Set `onDemandZoneFlexUrl` in `infra-phase1/parameters/phase1-dev.parameters.json` and merge — it flows to `ON_DEMAND_ZONE_FLEX_URL` through `main-phase1.bicep` and `modules/functionapp.bicep`. Do **not** set it with `az functionapp config appsettings set`: that appSettings block is the complete desired state and a hand-set value is removed by the next infra deploy.
2. The timer runs at **09:30 UTC daily**. To exercise it immediately, trigger it rather than redeploying — from the Portal (Function App → Functions → `onDemandZonesSync` → Test/Run), or:

   ```bash
   curl -sS -X POST "https://func-mvta-restapi-dev.azurewebsites.net/admin/functions/onDemandZonesSync" -H "x-functions-key: $MASTER_KEY" -H "Content-Type: application/json" -d '{}'
   ```

   `/admin/functions/...` here is the **Functions runtime's** own endpoint, not an app route — it is unrelated to the reserved `admin/` route prefix that forced this app's console routes onto `manage/` in #178.
3. Watch for one of these in Application Insights:
   - `imported and activated feed version …` — first import, now live.
   - `feed version … is already imported …; nothing to do` — the normal no-op. Unchanged geometry hashes to the version already stored, so a daily poll does not create a row every morning.
   - **A warning**: `imported feed version … as INACTIVE version <id>` — new geometry is waiting for a human. This is warned rather than logged precisely so a revision sitting unactivated for weeks is visible. Go to Path C.

A fetch failure or a rejected archive records an `on_demand_zones` feed failure, so a broken zone source shows up in KPI trust rather than going quiet.

## Path C — activate an imported version

Activation is separate from import for one reason: it swaps the boundaries a live monitor resolves pickups against, which changes which requests are judged in-zone. That is an Operations decision, not a timer's side effect. The exception is the very first import, which activates itself — there is no live geometry to protect, and a manual step there would only extend an outage.

1. **List what is imported** (any staff read role):

   ```bash
   curl -sS "https://<console-host>/api/on-demand-zone-versions" -H "Authorization: Bearer $TOKEN"
   ```

   Each version carries `id`, `feed_version`, `source_sha256`, `zone_count`, `is_active`, `imported_at`/`imported_by`, and — once migration 098 is applied — `activated_at`/`activated_by`. Check `zone_count` and `feed_version` before activating anything.

2. **Activate one** (`OCC.Admin`):

   ```bash
   curl -sS -X POST "https://<console-host>/api/on-demand-zone-versions" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"version_id":"<VERSION_ID>"}'
   ```

   Responses:

   | Status | Meaning |
   | --- | --- |
   | `200 {"activated": true, …}` | In force. The previous version was deactivated in the same transaction. |
   | `200 {"activated": false, …}` | Already the active version; nothing changed. |
   | `400` | `version_id` is not a GUID. |
   | `404` | No version with that id. |
   | `409` | That version has no zones. Refused — activating it would take the monitor down exactly as having none does, while reporting success. |

The swap clears the previous active row and sets the new one inside one serializable transaction, because the filtered unique index on `is_active = 1` rejects the naive ordering.

### Getting a token

Sign in to the console as an `OCC.Admin`, then in the browser DevTools console:

```js
const entry = Object.keys(localStorage)
  .filter((key) => key.includes("accesstoken"))
  .map((key) => JSON.parse(localStorage[key]))
  .sort((a, b) => Number(b.expiresOn) - Number(a.expiresOn))[0];
copy(entry.secret);
```

Then `read -rs TOKEN && export TOKEN`. The token is short-lived; take a fresh one on a `401`. It is a credential — do not paste it into a shared channel or commit it. Alternatively copy the `Authorization` header from any `/api/` request in the DevTools Network tab.

## Verify

1. `GET /api/on-demand-zone-versions` shows exactly one version with `is_active: true` and the expected `zone_count`.
2. Within about a minute — the active-zone set is cached for 60 seconds — these stop appearing in Application Insights:

   ```
   traces | where timestamp > ago(15m) and message has "operational zones"
   ```

   Both `onDemandSpareWebhook` (once a minute, severity Warning) and `spareMissedTripsIngest` (once per quarter-hour run) report the gap today. Both should fall silent.
3. On the next service day, on-demand requests should resolve to a zone rather than `Unzoned`. Requests ingested while no version was active were recorded without a zone and are **not** retrospectively reclassified — inventing assignments after the fact would fabricate evidence rather than recover it.

## What this does not do

Activating a zone version does not turn the monitor on. Service Risk & Quality will still read **Not connected** until:

1. `ON_DEMAND_MONITORING_ENABLED` is `true`. It is declared in Bicep and currently `false` on dev; flip `onDemandMonitoringEnabled` in the dev parameters file and deploy. **Set `onDemandMonitoringServiceIds` at the same time** — empty means the hourly reconciliation reads every Spare service the API key can see, not just MVTA Connect.
2. `onDemandSpareReconcile` completes successfully at least once, which is what records `spare_on_demand_reconciliation` feed health and moves the On-Demand KPI trust banner off `unavailable`.

The remaining items of the activation gate in `plans/service-risk-quality-trust-implementation-plan.md` — approved source owner and contract, confirmed non-PII field mapping, a live controlled breach — have no recorded evidence in this repository.

## Notes

- `on_demand_zones` is a **supporting** dependency of the On-Demand trust stream with no freshness deadline. A service area unchanged for a year is correct, not stale; only a never-imported feed is a fault. Supporting dependencies do not set `contract_pending`, so this does not put the stream into review.
- The feed-health count is the zones the *imported* version carries, not what is in force. An import that lands and waits for activation leaves the monitor on the previous geometry — that gap is reported by the poller's warning and by the versions endpoint, not by feed health.
- Import is idempotent on `(feed_version, source_sha256)`, the natural key migration 074 already declared. Hashing the raw archive is what distinguishes a genuine republication from a reused `feed_version` whose contents moved underneath it.
- Several code comments in `lib/onDemandZoneImport.ts` and `functions/onDemandZoneVersions.ts` refer to the attribution columns as "migration 097". The migration was renumbered to **098** on merge; 097 is the garage-departure source discriminator.
