import { test } from "node:test";
import assert from "node:assert";
import { conflictStatus, detourConflicts, parseOverrideIds, type DetourConflictScope } from "./detourConflicts";

function scope(id: string, routes: string, start = "2026-09-10", end: string | null = "2026-09-20"): DetourConflictScope {
  return { kind: "detour", id, label: id, status: "fulfilled", place_text: "", route_texts: [routes], start_date: start, end_date: end };
}

test("a detour conflicts with another sharing a route in an overlapping window, never with itself", () => {
  const all = [scope("a", "460 SB"), scope("b", "460 NB"), scope("c", "440"), scope("d", "460", "2026-10-01", null)];
  assert.deepStrictEqual(detourConflicts(all[0], all).map((c) => c.id), ["b"]);
});

test("conflict status: none, unresolved, overridden, and back to unresolved when a new conflict appears", () => {
  const b = detourConflicts(scope("a", "460"), [scope("a", "460"), scope("b", "460")]);
  assert.equal(conflictStatus([], null), "none");
  assert.equal(conflictStatus(b, null), "unresolved");
  assert.equal(conflictStatus(b, { reason: "", by: null, at: null, ids: ["b"] }), "unresolved");
  assert.equal(conflictStatus(b, { reason: "Different stops on the same route", by: "occ", at: null, ids: ["b"] }), "overridden");
  const bc = detourConflicts(scope("a", "460"), [scope("a", "460"), scope("b", "460"), scope("c", "460")]);
  assert.equal(conflictStatus(bc, { reason: "Different stops", by: "occ", at: null, ids: ["b"] }), "unresolved");
});

test("override ids parse leniently", () => {
  assert.deepStrictEqual(parseOverrideIds('["x","y"]'), ["x", "y"]);
  assert.deepStrictEqual(parseOverrideIds("not json"), []);
  assert.deepStrictEqual(parseOverrideIds(null), []);
});
