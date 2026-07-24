import { test } from "node:test";
import assert from "node:assert";
import { mapAlertEntity, type GtfsRtEntity } from "./gtfsRealtime";

// Fixture shaped like MVTA's live feed (sampled 2026-07-24).
const DETOUR_ENTITY: GtfsRtEntity = {
  Id: "1188",
  TripUpdate: null,
  Vehicle: null,
  Alert: {
    ActivePeriods: [{ Start: 1776056400, End: 1790917140 }],
    InformedEntities: [{ AgencyId: "0", RouteId: "497", Trip: null }],
    cause: 10,
    effect: 4,
    Url: null,
    HeaderText: {
      Translations: [
        { Text: "497 EB riders: Due to construction this route will be on detour. ", Language: "en" },
      ],
    },
    DescriptionText: null,
  },
};

test("maps a detour alert to a suggested-alert shape", () => {
  const mapped = mapAlertEntity(DETOUR_ENTITY);
  assert.ok(mapped);
  assert.strictEqual(mapped!.external_id, "1188");
  assert.strictEqual(mapped!.draft_text, "497 EB riders: Due to construction this route will be on detour.");
  assert.strictEqual(mapped!.category, "detour");
  assert.strictEqual(mapped!.severity, "minor");
  assert.deepStrictEqual(mapped!.routes_affected, ["497"]);
  assert.strictEqual(mapped!.detail.cause, 10);
  assert.strictEqual(mapped!.detail.effect, 4);
});

test("maps significant-delay effect to the delay category", () => {
  const entity: GtfsRtEntity = {
    ...DETOUR_ENTITY,
    Alert: { ...DETOUR_ENTITY.Alert!, effect: 3 },
  };
  const mapped = mapAlertEntity(entity);
  assert.strictEqual(mapped!.category, "delay");
});

test("falls back to general for an unmapped effect code", () => {
  const entity: GtfsRtEntity = {
    ...DETOUR_ENTITY,
    Alert: { ...DETOUR_ENTITY.Alert!, effect: 999 },
  };
  const mapped = mapAlertEntity(entity);
  assert.strictEqual(mapped!.category, "general");
});

test("returns null when the entity has no Alert", () => {
  const entity: GtfsRtEntity = { Id: "999", TripUpdate: {}, Vehicle: null, Alert: null };
  assert.strictEqual(mapAlertEntity(entity), null);
});

test("returns null when HeaderText has no usable translation", () => {
  const entity: GtfsRtEntity = {
    ...DETOUR_ENTITY,
    Alert: { ...DETOUR_ENTITY.Alert!, HeaderText: { Translations: [] } },
  };
  assert.strictEqual(mapAlertEntity(entity), null);
});

test("falls back to the first translation when no English text is present", () => {
  const entity: GtfsRtEntity = {
    ...DETOUR_ENTITY,
    Alert: {
      ...DETOUR_ENTITY.Alert!,
      HeaderText: { Translations: [{ Text: "Desvío en la ruta 497", Language: "es" }] },
    },
  };
  const mapped = mapAlertEntity(entity);
  assert.strictEqual(mapped!.draft_text, "Desvío en la ruta 497");
});

test("filters out informed entities with no RouteId", () => {
  const entity: GtfsRtEntity = {
    ...DETOUR_ENTITY,
    Alert: {
      ...DETOUR_ENTITY.Alert!,
      InformedEntities: [
        { AgencyId: "0", RouteId: "497", Trip: null },
        { AgencyId: "0", RouteId: null, Trip: null },
      ],
    },
  };
  const mapped = mapAlertEntity(entity);
  assert.deepStrictEqual(mapped!.routes_affected, ["497"]);
});
