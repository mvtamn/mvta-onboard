# On-Demand operational zones runbook

This runbook covers the GTFS-Flex service-area geometry the on-demand wait monitor resolves pickups against. Without an **active** zone version, `loadActiveOperationalZones` returns an empty set, every pickup resolves against nothing, and Service Risk & Quality reports no on-demand risk regardless of what Spare is sending.

Zones are a prerequisite for the monitor, not the switch that starts it. See [What this does not do](#what-this-does-not-do).

## Where zones come from

Operational zones are pulled daily from the GTFS-Flex feed Spare generates for MVTA ([ADR 0031](../adr/0031-pull-operational-zones-from-spare-and-version-by-geometry.md)):

```
https://api.us.sparelabs.com/v1/gtfs/generate/organization/93f6f01b-286f-4d79-931a-1ef22b848886
```

It is set as `onDemandZoneFlexUrl` in `infra-phase1/parameters/phase1-dev.parameters.json` and flows to `ON_DEMAND_ZONE_FLEX_URL` through `main-phase1.bicep` and `modules/functionapp.bicep`. Do **not** set it with `az functionapp config appsettings set`: that appSettings block is the complete desired state, and a hand-set value is removed by the next infra deploy.

The endpoint answers anonymously; OnBoard sends no Spare key to it. It returns an 11-file GTFS-Flex `.zip` of about 97 KB in 5 to 7 seconds (measured 2026-09-17), of which OnBoard reads `locations.geojson` and `feed_info.txt`.

There is no upload. The console upload and the `importOnDemandZones.ts` hand-seeding script existed only while no URL was known, and were removed in 1.5.236.

| Capability | Where |
| --- | --- |
| Daily pull, 09:30 UTC | `onDemandZonesSync`, recording `on_demand_zones` feed health |
| Parse, identify and import a Zone version | `loadOperationalZonesFromGtfsFlexArchive`, `importOperationalZoneVersion` |
| Review the feed and versions, activate one | Console: **Administration · MVTA Connect → Service Standards → Zone geometry**; API: `GET`/`POST /api/on-demand-zone-versions` |

## Which locations are Operational zones

Spare publishes more locations than MVTA monitors (on 2026-09-17: the two pilot zones and the Eagan reference boundary). Which of them are Operational zones is MVTA's choice, set by `ON_DEMAND_OPERATIONAL_ZONE_IDS` (comma-separated), defaulting to the two pilot areas:

| Location id | Name |
| --- | --- |
| `location_id__b413a052-36eb-43de-97f7-59fe9f99f839` | Central Zone, Apple Valley |
| `location_id__ad56cc1c-48cc-495b-948b-661aae320fd8` | Shakopee – Prior Lake Boundaries |

- **A listed zone missing from the feed fails the pull.** Feed health records the reason, and the active version stays in force. Importing a feed that silently lost a zone would shrink the monitored service area with nothing to show for it.
- **A location Spare publishes that is not listed is ignored**, but its id and name are recorded with the pull and shown on the Zone geometry panel as *Also published by Spare, not monitored*. That is how a new service area upstream becomes visible. To monitor it, add its id to `onDemandOperationalZoneIds` in the dev parameters file.

## What makes a new version

A Zone version is identified by a hash of the monitored zones' ids, names and geometry (`zone_version_sha256`, migration 127). Spare stamps the export time into `feed_version`, `feed_info.txt` and the archive on every call, so neither can say whether anything changed; they are kept on the version only as a record of the export it was first imported from.

Each pull ends in one of:

- **Same zones as an existing version** - the normal case. No row is added; that version's `last_seen_at`, `last_seen_feed_version` and unmonitored locations are updated. Logged as *export … carries the same N zones as an existing version; nothing to do*.
- **First version ever** - imported and activated at once, because there is no live geometry to protect.
- **Changed zones** - imported **inactive**, with a warning: *imported feed version … as INACTIVE version <id>*. Go to [Activate a version](#activate-a-version).

A fetch failure or a rejected archive records an `on_demand_zones` feed failure, so a broken zone source shows up in KPI trust and on the panel rather than going quiet.

## Run a pull now

The timer runs at **09:30 UTC daily**. To run it immediately, trigger it rather than redeploying: from the Portal (Function App → Functions → `onDemandZonesSync` → Test/Run), or

```bash
curl -sS -X POST "https://func-mvta-restapi-dev.azurewebsites.net/admin/functions/onDemandZonesSync" -H "x-functions-key: $MASTER_KEY" -H "Content-Type: application/json" -d '{}'
```

`/admin/functions/...` is the Functions runtime's own endpoint, unrelated to the reserved `admin/` route prefix that put this app's console routes on `manage/` in #178.

## Activate a version

Activation is separate from import because it swaps the boundaries a live monitor resolves pickups against, which changes which requests are judged in-zone and how quality results are split from then on. That is an Operations decision, not a timer's side effect, and it is also the guard against a broken or partial generation upstream.

In the console, **Zone geometry** lists each version with its zone count, when it was imported, when Spare last published it, and who activated it. Press **Activate** on the version to put in force (`OCC.Admin`). Check its zone count and the feed status above the list first.

The API equivalent:

```bash
curl -sS "https://<console-host>/api/on-demand-zone-versions" -H "Authorization: Bearer $TOKEN"
curl -sS -X POST "https://<console-host>/api/on-demand-zone-versions" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"version_id":"<VERSION_ID>"}'
```

| Status | Meaning |
| --- | --- |
| `200 {"activated": true, …}` | In force. The previous version was deactivated in the same transaction. |
| `200 {"activated": false, …}` | Already the active version; nothing changed. |
| `400` | `version_id` is not a GUID. |
| `404` | No version with that id. |
| `409` | That version has no zones. Refused - activating it would take the monitor down exactly as having none does, while reporting success. |

The `GET` also returns `feed`: whether the URL is configured, when it was last checked and whether that check succeeded (with the reason if not), and when the next check is due.

### Getting a token

Sign in to the console as an `OCC.Admin`, then in the browser DevTools console:

```js
const entry = Object.keys(localStorage)
  .filter((key) => key.includes("accesstoken"))
  .map((key) => JSON.parse(localStorage[key]))
  .sort((a, b) => Number(b.expiresOn) - Number(a.expiresOn))[0];
copy(entry.secret);
```

Then `read -rs TOKEN && export TOKEN`. The token is short-lived; take a fresh one on a `401`. It is a credential - do not paste it into a shared channel or commit it.

## Verify

1. `GET /api/on-demand-zone-versions` shows exactly one version with `is_active: true`, the expected `zone_count`, and `feed.last_check_succeeded: true`.
2. A second pull adds no version: the list is unchanged apart from `last_seen_at`.
3. Within about a minute - the active-zone set is cached for 60 seconds - the *No active on-demand operational zones* messages stop in Application Insights:

   ```
   traces | where timestamp > ago(15m) and message has "operational zones"
   ```

4. On the next service day with monitoring on, on-demand requests resolve to a zone rather than `Unzoned`. Requests ingested while no version was active were recorded without a zone and are **not** reclassified - inventing assignments after the fact would fabricate evidence.

## What this does not do

Activating a zone version does not turn the monitor on. Service Risk & Quality still reads **Not connected** until:

1. `ON_DEMAND_MONITORING_ENABLED` is `true`. Flip `onDemandMonitoringEnabled` in the dev parameters file and deploy, and **set `onDemandMonitoringServiceIds` at the same time** - empty is refused outright. The MVTA Connect service id is already stored by missed-trip ingestion: `SELECT DISTINCT service_id, service_name FROM SpareMissedTripSource`.
2. `onDemandSpareReconcile` completes successfully at least once, which records `spare_on_demand_reconciliation` feed health and moves the On-Demand KPI trust state off `unavailable`.

### Clear the pre-activation rows first

Until 1.5.215 the webhook receiver and the missed-trip ingest wrote on-demand monitor state for any Spare service, whether or not monitoring was enabled, so `MonitoredOnDemandWaits` holds requests the monitor is not for. The table has no service column, so which rows are foreign cannot be established after the fact. Clear them **before** setting `onDemandMonitoringEnabled` - afterwards the same statement would delete live monitoring:

```sql
DELETE FROM dbo.OnDemandRequestZoneSnapshots;
DELETE FROM dbo.OnDemandRequestCommitmentAudit;
DELETE FROM dbo.MonitoredOnDemandWaits;
```

The first reconciliation after activation rebuilds the last 24 hours of scoped state.

The remaining items of the activation gate in `plans/service-risk-quality-trust-implementation-plan.md` - approved source owner and contract, confirmed non-PII field mapping, a live controlled breach - have no recorded evidence in this repository.

## Notes

- `on_demand_zones` is a **supporting** dependency of the On-Demand trust stream with no freshness deadline. A service area unchanged for a year is correct, not stale; only a never-imported feed is a fault.
- The feed-health count is the zones the pulled export carries, not what is in force. A changed version waiting for activation leaves the monitor on the previous geometry; that gap is reported by the pull's warning and on the Zone geometry panel, not by feed health.
- Versions imported before migration 127 have no identity and are never matched by a pull. On dev none existed.
