import { test } from "node:test";
import assert from "node:assert";
import { parseAudience, routeMatches, zoneMatches } from "./audienceMatch";

// routeMatches had no tests before it was moved here. The route cases are
// pinned first so the extraction is shown to change nothing, then the zone
// cases, then how the two compose.

test("a subscriber with no route preference receives every route alert", () => {
  assert.strictEqual(routeMatches(null, ["470"]), true);
  assert.strictEqual(routeMatches("ALL", ["470"]), true);
});

test("an alert that names no routes is system-wide", () => {
  assert.strictEqual(routeMatches(["470"], null), true);
  assert.strictEqual(routeMatches(["470"], []), true);
  assert.strictEqual(routeMatches(["470"], undefined), true);
});

test("a narrowed subscriber receives only alerts on their routes", () => {
  assert.strictEqual(routeMatches(["470", "472"], ["472"]), true);
  assert.strictEqual(routeMatches(["470"], ["495", "472"]), false);
});

test("zones follow the same rules as routes", () => {
  assert.strictEqual(zoneMatches(null, ["zone-a"]), true);
  assert.strictEqual(zoneMatches("ALL", ["zone-a"]), true);
  assert.strictEqual(zoneMatches(["zone-a"], null), true, "an alert naming no zone is system-wide");
  assert.strictEqual(zoneMatches(["zone-a"], ["zone-a"]), true);
  // The defect this closes: before, this reached the subscriber anyway.
  assert.strictEqual(zoneMatches(["zone-a"], ["zone-b"]), false, "a rider in another zone does not receive it");
});

test("a pickup nobody could place reaches only riders who did not narrow", () => {
  // The monitor writes "Unzoned" when a pickup is outside every zone.
  assert.strictEqual(zoneMatches("ALL", ["Unzoned"]), true);
  assert.strictEqual(zoneMatches(null, ["Unzoned"]), true);
  assert.strictEqual(
    zoneMatches(["zone-a"], ["Unzoned"]),
    false,
    "a rider who narrowed to their zone asked not to hear about pickups not known to be in it",
  );
});

// Composition. dispatchMessageCreated ANDs the two; each alert type names only
// one dimension, and the other must not filter anyone out.
function inAudience(sub: { routes: string | null; zones: string | null }, alert: { routes: string[] | null; zones: string[] | null }) {
  return routeMatches(parseAudience(sub.routes), alert.routes) && zoneMatches(parseAudience(sub.zones), alert.zones);
}

test("a fixed-route alert is filtered by route alone", () => {
  const alert = { routes: ["470"], zones: null };
  assert.strictEqual(inAudience({ routes: '["470"]', zones: '["zone-a"]' }, alert), true, "zone choice does not block a route alert");
  assert.strictEqual(inAudience({ routes: '["472"]', zones: "ALL" }, alert), false);
});

test("an on-demand zone alert is filtered by zone alone", () => {
  const alert = { routes: null, zones: ["zone-a"] };
  assert.strictEqual(inAudience({ routes: '["470"]', zones: '["zone-a"]' }, alert), true, "route choice does not block a zone alert");
  assert.strictEqual(inAudience({ routes: "ALL", zones: '["zone-b"]' }, alert), false);
  assert.strictEqual(inAudience({ routes: "ALL", zones: "ALL" }, alert), true);
});

test("every subscriber on the form's defaults still receives everything", () => {
  // The opt-in form sends routes and zones as "ALL" for everyone, so this is
  // the population that exists today. Closing 7.3 must not change a thing for
  // any of them.
  for (const alert of [
    { routes: ["470"], zones: null },
    { routes: null, zones: ["zone-a"] },
    { routes: null, zones: ["Unzoned"] },
    { routes: null, zones: null },
  ]) {
    assert.strictEqual(inAudience({ routes: "ALL", zones: "ALL" }, alert), true);
    assert.strictEqual(inAudience({ routes: null, zones: null }, alert), true, "rows predating the columns");
  }
});

test("a stored value that is not an array reads as no preference, and does not throw", () => {
  // Before extraction, JSON that parsed to an object came back cast as an
  // array and the matcher's .some() threw - escaping the delivery loop, so one
  // bad row stopped the alert reaching everyone after it.
  assert.strictEqual(parseAudience("{}"), null);
  assert.strictEqual(parseAudience('"470"'), null);
  assert.strictEqual(parseAudience("{not json"), null);
  assert.strictEqual(parseAudience(""), null);
  assert.strictEqual(parseAudience(null), null);
  assert.doesNotThrow(() => zoneMatches(parseAudience("{}"), ["zone-a"]));
  assert.strictEqual(zoneMatches(parseAudience("{}"), ["zone-a"]), true, "unreadable matches broadly rather than silently dropping the rider");
});

test("non-string entries in a stored array are ignored rather than matched", () => {
  assert.deepStrictEqual(parseAudience('["470", 472, null, "495"]'), ["470", "495"]);
});
