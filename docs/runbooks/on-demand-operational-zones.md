# Importing and activating On-Demand operational zones

The on-demand service-quality monitor classifies every MVTA Connect request by
its pickup coordinate against a versioned GTFS-Flex service area. Without an
**active** zone version, `loadActiveOperationalZones` returns an empty set,
every monitor write is skipped, and Service Risk & Quality shows no on-demand
risk regardless of what Spare is sending.

This runbook covers importing a zone version and activating it. It is a
deliberate two-step: an import writes an inactive version, and activation is a
separate, explicit act, because activating swaps the geometry that live
monitoring classifies against.

## Who can do this

- **Import and activate**: `OCC.Admin`.
- **List versions**: any staff read role.

No new Entra app role is needed; `OCC.Admin` already exists and is already
assigned.

## What you need

A **GTFS-Flex archive** (`.zip`) containing `locations.geojson` and
`feed_info.txt`, obtained from Spare or from MVTA's GTFS-Flex export. MVTA's
fixed-route `google_transit.zip` is **not** this file — it contains no
`locations.geojson`.

The archive must contain both pilot MVTA Connect areas:

| Location id | Name |
| --- | --- |
| `location_id__b413a052-36eb-43de-97f7-59fe9f99f839` | Central Zone, Apple Valley |
| `location_id__ad56cc1c-48cc-495b-948b-661aae320fd8` | Shakopee – Prior Lake Boundaries |

Anything else in the feed — including the Eagan reference boundary — is
ignored. An archive missing either of these is refused; the expected set is
pinned in `INITIAL_OPERATIONAL_ZONE_IDS`, so adding a third zone is a code
change today.

## Getting an access token

The API reads its caller from the Entra token the console sends. Sign in to the
console as an `OCC.Admin`, then in the browser DevTools console:

```js
const entry = Object.keys(localStorage)
  .filter((key) => key.includes("accesstoken"))
  .map((key) => JSON.parse(localStorage[key]))
  .sort((a, b) => Number(b.expiresOn) - Number(a.expiresOn))[0];
copy(entry.secret);
```

That copies a bearer token to the clipboard. It is short-lived — if a call
returns 401, take a fresh one. Alternatively, open DevTools → Network, click any
`/api/` request the console made, and copy its `Authorization` header value.

Set it in your shell (the token is a credential — do not paste it into a
shared channel or commit it):

```bash
read -rs TOKEN && export TOKEN
```

## 1. Import the archive

```bash
curl -sS -X POST "https://<console-host>/api/manage/on-demand-zones/import" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/zip" --data-binary @mvta-connect-flex.zip
```

A new version returns `201` with its `version_id`, `feed_version`,
`source_sha256`, and the zones it contains. Re-uploading identical bytes
returns `200` with `already_imported: true` and writes nothing — the version
row is keyed on `(feed_version, source_sha256)`.

A `400` names what is wrong with the feed: a missing `locations.geojson` or
`feed_info.txt`, a missing `feed_version`, invalid geometry, duplicate zones, or
a missing expected zone. Nothing is written in that case.

## 2. Review what was imported

```bash
curl -sS "https://<console-host>/api/manage/on-demand-zones" -H "Authorization: Bearer $TOKEN"
```

Check the new version's `feed_version` and `zone_count` before activating, and
note `active_version_id` — that is what the monitor is reading right now
(`null` means no version is active and the monitor is inert).

## 3. Activate it

```bash
curl -sS -X POST "https://<console-host>/api/manage/on-demand-zones/<VERSION_ID>/activate" -H "Authorization: Bearer $TOKEN"
```

This deactivates the previous version and activates the named one in a single
transaction, so there is never a moment with two active versions or none.
A version containing no zones is refused with `409` — activating one would
reproduce the exact failure this import path exists to end.

Other workers pick the change up within a minute (the active-zone set is cached
for 60 seconds); the worker that served the activation refreshes immediately.

## 4. Verify

```bash
curl -sS "https://<console-host>/api/manage/on-demand-zones" -H "Authorization: Bearer $TOKEN"
```

`active_version_id` should now be the version you activated. Within a minute,
the Spare webhook receiver should stop logging "No active on-demand operational
zones are available", and `spareMissedTripsIngest` should stop warning about it
on its next quarter-hour run.

## What activation does not do

Activating a zone version does **not** turn the monitor on. Service Risk &
Quality will still read **Not connected** until:

1. `ON_DEMAND_MONITORING_ENABLED=true` is set on the REST function app. It is
   not currently declared in `infra-phase1/modules/functionapp.bicep`, whose
   app-settings block is complete desired state — setting it with
   `az functionapp config appsettings set` alone will be wiped by the next
   infra deploy, as happened to `ACS_ENDPOINT` on 2026-09-05. Add it to the
   template first.
2. The hourly `onDemandSpareReconcile` timer runs successfully at least once,
   which is what records `spare_on_demand_reconciliation` feed health and moves
   the On-Demand KPI trust banner off `unavailable`.

Zones are a prerequisite for the monitor, not the switch that starts it.

## Notes

- Requests already ingested while no zones were active were recorded without a
  zone and are not retrospectively reclassified. Inventing assignments after the
  fact would fabricate evidence rather than recover it.
- The version row records `imported_by` and `imported_at`. There is no
  `activated_by` column in migration 074, so who activated a version is
  recorded only in the function app's logs.
