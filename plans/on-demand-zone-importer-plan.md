# On-Demand Operational Zone Importer — Scope

Date: 2026-09-05

Inputs:

- `functions-restapi/sql/migration-074-on-demand-operational-zones.sql`
- `functions-restapi/src/lib/onDemandOperationalZones.ts` and its tests
- `functions-restapi/src/lib/onDemandSpareMonitorStore.ts`
- Live `dev` state on 2026-09-05: `OnDemandOperationalZoneVersions` has **zero rows**

## Why this exists

The on-demand service-quality monitor is down and cannot be brought up by
configuration. `loadActiveOperationalZones` joins zones to an active version:

```sql
FROM dbo.OnDemandOperationalZones z
JOIN dbo.OnDemandOperationalZoneVersions v ON v.id = z.zone_version_id AND v.is_active = 1
```

Both tables are empty in `dev`, so the join returns nothing,
`storeOnDemandSpareRequest` throws `No active on-demand operational zones are
available`, and the monitor is inert. PR #130 decoupled Spare missed-trip
ingestion from this failure — missed-trip ingestion now survives the zone gap —
but the monitor itself still needs zones.

There is nothing to activate. Zones have never been imported, because nothing
imports them.

## What already exists

The hard parts are built and covered by tests. Only the plumbing is missing.

| Capability | Where | State |
| --- | --- | --- |
| GTFS-Flex archive parsing | `loadOperationalZonesFromGtfsFlexArchive` | Done — unzips, reads `locations.geojson` and `feed_info.txt`, extracts `feed_version` |
| GeoJSON to zone mapping | `loadOperationalZones` | Done — rejects invalid geometry, duplicates, and missing expected zones |
| Point-in-polygon resolution | `resolveOperationalZone` | Done — Polygon and MultiPolygon; returns `assigned` or one of three `unzoned` reasons |
| Database read path | `loadActiveOperationalZones` | Done |
| Schema | migration 074 | Done — versions, zones, and non-PII request snapshots |
| Unit tests | `onDemandOperationalZones.test.ts` | Done |

`loadOperationalZonesFromGtfsFlexArchive` is currently referenced **only from
its test file**. It has never run in production.

## What is missing

1. **Fetch.** No GTFS-Flex source is configured anywhere — no environment
   variable, no Bicep parameter, no URL in `infra-phase1`. Nothing knows where
   the archive comes from.
2. **Persist.** Nothing writes `OnDemandOperationalZoneVersions` or
   `OnDemandOperationalZones`. The version row needs `source_sha256` over the
   archive bytes: `UQ_OnDemandOperationalZoneVersions_Source` is
   `(feed_version, source_sha256)`, so hashing the source is what makes a
   re-import idempotent rather than duplicating a version.
3. **Activate.** Setting `is_active = 1` and clearing the previous active row,
   in one transaction. `UX_OnDemandOperationalZoneVersions_Active` is a filtered
   unique index on `is_active = 1`, so two active versions cannot coexist and a
   naive update ordering will violate it.

Estimated at roughly a day including tests — on the order of 150 lines. This is
smaller than it first appears precisely because the parser and geometry already
exist.

## Decisions required before implementation

These are not implementation details; each one changes what gets built.

### 1. Where does the archive come from?

This is the blocker. The options lead to different shapes:

- **A published GTFS-Flex URL** (from Spare or MVTA) — a timer-triggered poller
  in the shape of `gtfsStopsSync`, with `recordFeedHealth` against a new feed
  name so a stale zone feed is visible rather than silent.
- **A file in blob storage** — an upload-triggered or manually invoked import.
  Suits geometry that changes once or twice a year.
- **A one-off manual load** — a script run by an operator. Lowest effort, but
  leaves no path for the next revision.

### 2. Automatic or deliberate activation?

The schema argues for deliberate: `is_active` defaults to `0`, `imported_by`
exists to record who acted, and the filtered unique index enforces a single
active version. That design says import, review, then switch.

Recommendation: import automatically, activate explicitly. An auto-activating
timer would fight the schema's intent and could swap operational geometry
underneath live monitoring with no human in the loop.

### 3. Does the hardcoded zone list stay?

`INITIAL_OPERATIONAL_ZONE_IDS` pins two specific MVTA Connect location ids, and
`loadOperationalZones` throws when the feed does not contain exactly those two:

```ts
if (zoneIds.length !== INITIAL_OPERATIONAL_ZONE_IDS.size) {
  throw new Error("GTFS-Flex feed is missing expected Operational zones");
}
```

Adding a third zone, or MVTA renaming a location id upstream, therefore requires
a code change and a deploy, and every import fails closed until that lands.

That is a reasonable guard for a two-zone pilot and the wrong default for steady
state. Decide now whether the importer keeps it or moves the expected zone set
into configuration, because retrofitting it later means changing a function that
the monitor depends on while the monitor is live.

## Implementation outline, once the decisions are made

1. Configure the source (env var plus Bicep parameter, declared in
   `functions-restapi` app settings — see PR #156 for why a Portal-only value
   does not survive an infra deploy).
2. Fetch the archive; compute `source_sha256` over the raw bytes.
3. Parse via the existing `loadOperationalZonesFromGtfsFlexArchive`.
4. Insert the version row (inactive) and its zones in one transaction, keyed on
   `(feed_version, source_sha256)` so a re-import of identical bytes is a no-op.
5. Record feed health for the new feed so an absent or stale zone feed is
   reported rather than silent.
6. Provide the activation path chosen in decision 2.

## Out of scope

- Changing `resolveOperationalZone` or the geometry handling; both work and are
  tested.
- Migration 074 schema changes; the tables are adequate as they stand.
- Backfilling `OnDemandRequestZoneSnapshots` for requests ingested while no
  zones were active. Those requests were recorded without a zone, and inventing
  retrospective assignments would fabricate evidence rather than recover it.
