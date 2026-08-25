import AdmZip from "adm-zip";
import { polygonContains, type Point, validatePolygon } from "./geofence";
import { parseCsvLine } from "./gtfsStatic";

// The initial MVTA Connect areas; the Eagan reference boundary is deliberately excluded.
const INITIAL_OPERATIONAL_ZONE_IDS = new Set([
  "location_id__b413a052-36eb-43de-97f7-59fe9f99f839",
  "location_id__ad56cc1c-48cc-495b-948b-661aae320fd8",
]);

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

function isOperationalFeature(feature: GeoJsonFeature): feature is GeoJsonFeature & {
  id: string;
  properties: { stop_name: string };
  geometry: ZoneGeometry;
} {
  return typeof feature.id === "string"
    && INITIAL_OPERATIONAL_ZONE_IDS.has(feature.id)
    && typeof feature.properties?.stop_name === "string"
    && isZoneGeometry(feature.geometry);
}

export function loadOperationalZones(version: string, feed: GeoJsonFeatureCollection): OperationalZoneSnapshot {
  if (!version.trim()) throw new Error("GTFS-Flex feed version is required");
  const features = feed.features ?? [];
  if (features.some((feature) => typeof feature.id === "string"
    && INITIAL_OPERATIONAL_ZONE_IDS.has(feature.id)
    && !isZoneGeometry(feature.geometry))) {
    throw new Error("GTFS-Flex feed has invalid Operational-zone geometry");
  }
  const zones = features
    .filter(isOperationalFeature)
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
  if (zoneIds.length !== INITIAL_OPERATIONAL_ZONE_IDS.size) {
    throw new Error("GTFS-Flex feed is missing expected Operational zones");
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

export function loadOperationalZonesFromGtfsFlexArchive(archiveBuffer: Buffer): OperationalZoneSnapshot {
  const archive = new AdmZip(archiveBuffer);
  const locations = JSON.parse(archiveText(archive, "locations.geojson")) as GeoJsonFeatureCollection;
  return loadOperationalZones(feedVersion(archiveText(archive, "feed_info.txt")), locations);
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
