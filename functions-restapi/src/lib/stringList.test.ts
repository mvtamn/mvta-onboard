import { test } from "node:test";
import assert from "node:assert";
import { parseStringList } from "./stringList";

test("JSON arrays parse as before", () => {
  assert.deepEqual(parseStringList('["web","sms"]'), ["web", "sms"]);
  assert.deepEqual(parseStringList('["442", "477"]'), ["442", "477"]);
  assert.deepEqual(parseStringList("[]"), []);
});

test("legacy comma-separated values no longer throw", () => {
  assert.deepEqual(parseStringList("web,sms"), ["web", "sms"]);
  assert.deepEqual(parseStringList(" web , sms ,"), ["web", "sms"]);
  assert.deepEqual(parseStringList("web"), ["web"]);
});

test("null, empty, and blank values are empty lists", () => {
  assert.deepEqual(parseStringList(null), []);
  assert.deepEqual(parseStringList(undefined), []);
  assert.deepEqual(parseStringList(""), []);
  assert.deepEqual(parseStringList("   "), []);
});

test("malformed JSON degrades to the delimited reading instead of throwing", () => {
  assert.deepEqual(parseStringList('["web","sms"'), ['["web"', 'sms']);
  assert.deepEqual(parseStringList('{"not":"a list"}'), ['{"not":"a list"}']);
});

test("non-string array members are dropped, numbers are kept as text", () => {
  assert.deepEqual(parseStringList('["web", null, 442, {"x":1}, ""]'), ["web", "442"]);
});
