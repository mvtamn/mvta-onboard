import { test } from "node:test";
import assert from "node:assert";
import { validateSubscribe } from "./validation";

const base = {
  phone_number: "+16125550142",
  categories: ["delay", "detour"],
  consent_source: "web_form",
};

test("valid SMS subscription passes", () => {
  assert.deepStrictEqual(validateSubscribe(base), []);
});

test("valid email-only subscription passes", () => {
  const errors = validateSubscribe({
    email: "rider@example.com",
    categories: ["outage"],
    consent_source: "web_form",
  });
  assert.deepStrictEqual(errors, []);
});

test("rejects when neither phone nor email is given", () => {
  const errors = validateSubscribe({ categories: ["delay"], consent_source: "web_form" });
  assert.ok(errors.some((e) => e.includes("phone_number or email")));
});

test("rejects non-E.164 phone", () => {
  const errors = validateSubscribe({ ...base, phone_number: "612-555-0142" });
  assert.ok(errors.some((e) => e.includes("phone_number")));
});

test("rejects malformed email", () => {
  const errors = validateSubscribe({
    email: "not-an-email",
    categories: ["delay"],
    consent_source: "web_form",
  });
  assert.ok(errors.some((e) => e.includes("email")));
});

test("rejects empty categories", () => {
  const errors = validateSubscribe({ ...base, categories: [] });
  assert.ok(errors.some((e) => e.includes("categories")));
});

test("rejects invalid category value", () => {
  const errors = validateSubscribe({ ...base, categories: ["delay", "bogus"] });
  assert.ok(errors.some((e) => e.includes("bogus")));
});

test("rejects invalid consent_source", () => {
  const errors = validateSubscribe({ ...base, consent_source: "carrier_pigeon" });
  assert.ok(errors.some((e) => e.includes("consent_source")));
});

test('accepts "ALL" for routes and zones', () => {
  const errors = validateSubscribe({ ...base, routes: "ALL", zones: "ALL" });
  assert.deepStrictEqual(errors, []);
});

test("rejects a non-array, non-ALL routes value", () => {
  const errors = validateSubscribe({ ...base, routes: "460" });
  assert.ok(errors.some((e) => e.includes("routes")));
});
