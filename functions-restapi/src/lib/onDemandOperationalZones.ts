import { createHash } from "node:crypto";
import AdmZip from "adm-zip";
import { polygonContains, type Point, validatePolygon } from "./geofence";
import { parseCsvLine } from "./gtfsStatic";

// The initial MVTA Connect areas; the Eagan reference boundary is deliberately excluded.
const INITIAL_OPERATIONAL_ZONE_IDS = [
  "location_id__b413a052-36eb-43de-97f7-59fe9f99f839",
  "location_id__ad56cc1c-48cc-495b-948b-661aae320fd8",
] as const;

// Which GTFS-Flex location ids are Operational zones, as opposed to the
// reference boundaries the same feed carries. The import fails closed when the
// feed does not contain exactly this set, which is the right guard - importing
// a feed that silently lost a zone would shrink the monitored service area
// without anyone noticing.
//
// It is read from configuration rather than pinned in code so that adding a
// third zone, or MVTA renaming a location id upstream, is a settings change
// instead of a code change and a deploy. Unset, it is the two-zone pilot set,
// so behaviour is unchanged where the variable is absent.
export function expectedOperationalZoneIds(): ReadonlySet<string> {
  const configured = (process.env.ON_DEMAND_OPERATIONAL_ZONE_IDS ?? "")
    .split(",").map((value) => value.trim()).filter(Boolean);
  return new Set(configured.length ? configured : INITIAL_OPERATIONAL_ZONE_IDS);
}

type PolygonGeometry = { type: "Polygon"; coordinates: Point[][] };
type MultiPolygonGeometry = { type: "MultiPolygon"; coordinates: Point[][][] };
type ZoneGeometry = PolygonGeometry | MultiPolygonGeometry;

export interface OperationalZone {
  externalLocationId: string;
  name: string;
  version: string;
  geometry: ZoneGeometry;
}

export interface OperationalZoneSnapshot {
  version: string;
  zones: OperationalZone[];
}

export type OperationalZoneResolution =
  | { kind: "assigned"; zone: Pick<OperationalZone, "externalLocationId" | "name" | "version"> }
  | { kind: "unzoned"; reason: "missing_pickup_coordinate" | "outside_operational_zones" | "ambiguous_operational_zones" };

type GeoJsonFeature = {
  id?: unknown;
  properties?: { stop_name?: unknown };
  geometry?: unknown;
};

type GeoJsonFeatureCollection = { features?: readonly GeoJsonFeature[] };

function isZoneGeometry(value: unknown): value is ZoneGeometry {
  if (!value || typeof value !== "object") return false;
  const geometry = value as { type?: unknown; coordinates?: unknown };
  const validPolygon = (coordinates: unknown) => Array.isArray(coordinates)
    && validatePolygon(JSON.stringify({ type: "Polygon", coordinates })) === null;
  return geometry.type === "Polygon"
    ? validPolygon(geometry.coordinates)
    : geometry.type === "MultiPolygon"
      && Array.isArray(geometry.coordinates)
      && geometry.coordinates.every(validPolygon);
}

function isOperationalFeature(
  feature: GeoJsonFeature,
  expected: ReadonlySet<string>,
): feature is GeoJsonFeature & {
  id: string;
  properties: { stop_name: string };
  geometry: ZoneGeometry;
} {
  return typeof feature.id === "string"
    && expected.has(feature.id)
    && typeof feature.properties?.stop_name === "string"
    && isZoneGeometry(feature.geometry);
}

export function loadOperationalZones(version: string, feed: GeoJsonFeatureCollection): OperationalZoneSnapshot {
  if (!version.trim()) throw new Error("GTFS-Flex feed version is required");
  const expected = expectedOperationalZoneIds();
  const features = feed.features ?? [];
  if (features.some((feature) => typeof feature.id === "string"
    && expected.has(feature.id)
    && !isZoneGeometry(feature.geometry))) {
    throw new Error("GTFS-Flex feed has invalid Operational-zone geometry");
  }
  const zones = features
    .filter((feature) => isOperationalFeature(feature, expected))
    .map((feature) => ({
      externalLocationId: feature.id,
      name: feature.properties.stop_name,
      version,
      geometry: feature.geometry,
    }));
  const zoneIds = zones.map((zone) => zone.externalLocationId);
  if (new Set(zoneIds).size !== zoneIds.length) {
    throw new Error("GTFS-Flex feed has duplicate Operational zones");
  }
  if (zoneIds.length !== expected.size) {
    // Named in full because this reason is what feed health and the Zone
    // geometry panel show: when Spare renames a zone's location id, the new id
    // is exactly what the person fixing ON_DEMAND_OPERATIONAL_ZONE_IDS needs.
    // Ids and names only, never geometry.
    const found = new Set(zoneIds);
    const missing = [...expected].filter((id) => !found.has(id));
    const published = features.flatMap((feature) => typeof feature.id === "string"
      ? [`${typeof feature.properties?.stop_name === "string" ? feature.properties.stop_name : "(unnamed)"} (${feature.id})`]
      : []);
    throw new Error(
      `GTFS-Flex feed is missing expected Operational zones: ${missing.join(", ")}. ` +
        `Spare published: ${published.length ? published.join("; ") : "no locations"}.`,
    );
  }
  return {
    version,
    zones,
  };
}

function archiveText(archive: AdmZip, name: string): string {
  const entry = archive.getEntry(name);
  if (!entry) throw new Error(`GTFS-Flex archive is missing ${name}`);
  return entry.getData().toString("utf8");
}

function feedVersion(feedInfo: string): string {
  const [headerLine, valueLine] = feedInfo.split(/\r?\n/).filter((line) => line.trim());
  const columns = headerLine ? parseCsvLine(headerLine).map((column) => column.trim()) : undefined;
  const values = valueLine ? parseCsvLine(valueLine).map((value) => value.trim()) : undefined;
  const versionIndex = columns?.indexOf("feed_version") ?? -1;
  const version = versionIndex === -1 ? undefined : values?.[versionIndex];
  if (!version) throw new Error("GTFS-Flex feed_info.txt is missing feed_version");
  return version;
}

// A location Spare publishes that MVTA has not chosen as an Operational zone:
// the reference boundary, or a service area added upstream. Only its identity
// and name are kept, never its geometry.
export interface UnmonitoredLocation {
  id: string;
  name: string | null;
}

export interface ZoneFeed {
  snapshot: OperationalZoneSnapshot;
  unmonitoredLocations: UnmonitoredLocation[];
  // What makes this a distinct Zone version: a hash of the monitored zones'
  // identities, names and geometry, and nothing else.
  zoneVersionSha256: string;
}

// JSON with object keys in a fixed order, so the same geometry always hashes
// the same whatever order a publisher happens to write its keys in.
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

// Spare stamps the export time into feed_version, feed_info.txt and the
// archive itself on every call (confirmed 2026-09-17), so neither the archive
// bytes nor feed_version can say whether the zones changed. The zones sorted by
// id can. See ADR 0031.
export function zoneVersionSha256(snapshot: OperationalZoneSnapshot): string {
  const zones = [...snapshot.zones]
    .sort((a, b) => (a.externalLocationId < b.externalLocationId ? -1 : a.externalLocationId > b.externalLocationId ? 1 : 0))
    .map((zone) => ({ id: zone.externalLocationId, name: zone.name, geometry: zone.geometry }));
  return createHash("sha256").update(canonicalJson(zones)).digest("hex");
}

export function loadOperationalZonesFromGtfsFlexArchive(archiveBuffer: Buffer): ZoneFeed {
  const archive = new AdmZip(archiveBuffer);
  const locations = JSON.parse(archiveText(archive, "locations.geojson")) as GeoJsonFeatureCollection;
  const expected = expectedOperationalZoneIds();
  const snapshot = loadOperationalZones(feedVersion(archiveText(archive, "feed_info.txt")), locations);
  return {
    snapshot,
    zoneVersionSha256: zoneVersionSha256(snapshot),
    unmonitoredLocations: (locations.features ?? []).flatMap((feature) =>
      typeof feature.id === "string" && !expected.has(feature.id)
        ? [{ id: feature.id, name: typeof feature.properties?.stop_name === "string" ? feature.properties.stop_name : null }]
        : []),
  };
}

function geometryContains(geometry: ZoneGeometry, point: Point): boolean {
  if (geometry.type === "Polygon") return polygonContains(JSON.stringify(geometry), point);
  return geometry.coordinates.some((coordinates) => polygonContains(JSON.stringify({ type: "Polygon", coordinates }), point));
}

export function resolveOperationalZone(
  snapshot: OperationalZoneSnapshot,
  pickupCoordinate: Point | null,
): OperationalZoneResolution {
  if (!pickupCoordinate) return { kind: "unzoned", reason: "missing_pickup_coordinate" };
  const matches = snapshot.zones.filter((zone) => geometryContains(zone.geometry, pickupCoordinate));
  if (matches.length === 0) return { kind: "unzoned", reason: "outside_operational_zones" };
  if (matches.length > 1) return { kind: "unzoned", reason: "ambiguous_operational_zones" };
  const [zone] = matches;
  return {
    kind: "assigned",
    zone: {
      externalLocationId: zone.externalLocationId,
      name: zone.name,
      version: zone.version,
    },
  };
}
