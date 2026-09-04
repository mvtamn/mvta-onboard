import { test } from "node:test";
import assert from "node:assert";
import { findLikelyDuplicates, placeTokens, routeTokens, type DuplicateCandidate, type DuplicateScope } from "./detourDuplicates";

const subject: DuplicateScope = {
  id: "new", place_text: "Cedar Ave bridge closed between 5th St and Main",
  route_texts: ["460 SB, 465 SB"], start_date: "2026-09-10", end_date: "2026-09-20",
};

function candidate(overrides: Partial<DuplicateCandidate>): DuplicateCandidate {
  return { kind: "detour", id: "d1", label: "MVTA-DET-2026-0001", status: "active", place_text: "", route_texts: [], start_date: "2026-09-15", end_date: "2026-09-25", ...overrides };
}

test("route tokens are the numbers, without direction suffixes", () => {
  assert.deepStrictEqual([...routeTokens(["460 SB, 465 SB", "Route 21"])], ["460", "465", "21"]);
});

test("place tokens drop road-type, direction, and closure words", () => {
  assert.deepStrictEqual([...placeTokens("Cedar Ave closed NB near 5th St")], ["cedar", "5th"]);
});

test("a shared route inside an overlapping window is a likely duplicate", () => {
  const [match] = findLikelyDuplicates(subject, [candidate({ route_texts: ["465 NB"] })]);
  assert.ok(match);
  assert.deepStrictEqual(match.reasons, ["routes"]);
  assert.deepStrictEqual(match.shared, ["465"]);
});

test("a shared street name inside an overlapping window is a likely duplicate", () => {
  const [match] = findLikelyDuplicates(subject, [candidate({ place_text: "Cedar Avenue construction", route_texts: ["440"] })]);
  assert.ok(match);
  assert.deepStrictEqual(match.reasons, ["location"]);
  assert.deepStrictEqual(match.shared, ["cedar"]);
});

test("a numbered street alone is not enough", () => {
  assert.deepStrictEqual(findLikelyDuplicates(subject, [candidate({ place_text: "5th St water line repair", route_texts: ["440"] })]), []);
});

test("no overlap in dates means no duplicate however similar the scope", () => {
  assert.deepStrictEqual(findLikelyDuplicates(subject, [candidate({ route_texts: ["460"], place_text: "Cedar Ave", start_date: "2026-10-01", end_date: null })]), []);
});

test("open-ended records overlap everything after their start", () => {
  const [match] = findLikelyDuplicates(subject, [candidate({ route_texts: ["460"], start_date: "2026-01-01", end_date: null })]);
  assert.ok(match);
});

test("the subject never matches itself, and route matches sort first", () => {
  const matches = findLikelyDuplicates(subject, [
    candidate({ id: "new", route_texts: ["460"] }),
    candidate({ id: "loc", place_text: "Cedar Ave Main St", route_texts: ["1"] }),
    candidate({ id: "rt", route_texts: ["460"] }),
  ]);
  assert.deepStrictEqual(matches.map((m) => m.id), ["rt", "loc"]);
});
