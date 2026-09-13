import assert from "node:assert/strict";
import test from "node:test";
import {
  maskPhone,
  maskEmail,
  audienceErrors,
  validatePreferenceUpdate,
  parseAudience,
  serializeAudience,
  stateOf,
  type SubscriberRecord,
} from "./subscriberPreferences";

const OPTIONS = { routeIds: ["470", "472", "495"], zoneIds: ["zone-a", "zone-b"] };

function valid(overrides: Record<string, unknown> = {}) {
  return { categories: ["delay"], routes: "ALL", zones: "ALL", channels: ["sms"], ...overrides };
}

// Masking. A found link must let a rider recognise which subscription they are
// looking at and must not let a stranger read the contact off it.
test("a masked phone shows only the last four digits", () => {
  assert.equal(maskPhone("+16125550123"), "(•••) •••-0123");
  assert.equal(maskPhone(null), null);
});

test("a masked email keeps the first and last letter and the domain", () => {
  assert.equal(maskEmail("rider.one@example.com"), "r•••••••e@example.com");
  // Short local parts cannot show both ends without showing the whole thing.
  assert.equal(maskEmail("jo@example.com"), "j•••@example.com");
  assert.equal(maskEmail("a@b.com"), "a•••@b.com");
  assert.equal(maskEmail(null), null);
});

test("a masked email reveals nothing when there is nothing to mask around", () => {
  assert.equal(maskEmail("not-an-address"), "•••");
});

// Validation. The two that matter are about not letting an ambiguous input
// become a silent decision.
test("an empty category list is not 'send me nothing'", () => {
  // It is unsubscribing, which is its own endpoint - it records a reason and
  // rotates the key, neither of which an empty array would do.
  const errors = validatePreferenceUpdate(valid({ categories: [] }), OPTIONS);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /unsubscribe/);
});

test("an empty route list is refused rather than read as 'all'", () => {
  // A rider who unticked every box has not asked for everything, and that is
  // the worst possible reading of the gesture.
  assert.deepEqual(validatePreferenceUpdate(valid({ routes: [] }), OPTIONS), [
    'routes must name at least one, or be "ALL"',
  ]);
  assert.deepEqual(validatePreferenceUpdate(valid({ zones: [] }), OPTIONS), [
    'zones must name at least one, or be "ALL"',
  ]);
});

test("routes are checked against what was offered, not a hardcoded list", () => {
  assert.deepEqual(validatePreferenceUpdate(valid({ routes: ["470", "472"] }), OPTIONS), []);
  // A route that has left the registry must stop being selectable rather than
  // become a stored value nothing will ever match.
  const errors = validatePreferenceUpdate(valid({ routes: ["470", "999"] }), OPTIONS);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /unknown values: 999/);
});

test("zones are refused outright when none are on offer", () => {
  // No zone version is active, so there is nothing a rider could legitimately
  // pick; "ALL" is still fine because it is not a claim about any zone.
  const none = { routeIds: ["470"], zoneIds: [] };
  assert.deepEqual(validatePreferenceUpdate(valid({ zones: "ALL" }), none), []);
  assert.equal(validatePreferenceUpdate(valid({ zones: ["zone-a"] }), none).length, 1);
});

test("invalid categories and channels are named", () => {
  assert.match(validatePreferenceUpdate(valid({ categories: ["delay", "gossip"] }), OPTIONS)[0], /gossip/);
  assert.match(validatePreferenceUpdate(valid({ channels: ["sms", "fax"] }), OPTIONS)[0], /fax/);
  assert.match(validatePreferenceUpdate(valid({ channels: "sms" }), OPTIONS)[0], /channels must be an array/);
});

test("keeping no channels is allowed here, and means the record opts out", () => {
  // Unticking both is a real thing to do on the page; writePreferences turns it
  // into an opt-out rather than into a subscriber with nothing to send on.
  assert.deepEqual(validatePreferenceUpdate(valid({ channels: [] }), OPTIONS), []);
});

// Audience round-tripping. "ALL" is a stored string, not an empty array.
test("an absent or unreadable audience reads as everything, not as nothing", () => {
  // The column is nullable and predates any picker; a null there has always
  // meant "no preference expressed", which dispatch treats as matching.
  assert.equal(parseAudience(null), "ALL");
  assert.equal(parseAudience("ALL"), "ALL");
  assert.equal(parseAudience("{not json"), "ALL");
  assert.deepEqual(parseAudience('["470"]'), ["470"]);
  assert.equal(serializeAudience("ALL"), "ALL");
  assert.equal(serializeAudience(["470"]), '["470"]');
});

test("a malformed categories column reads as none rather than throwing at a rider", () => {
  const record = {
    subscriber_id: "s", phone_number: "+16125550123", email: null,
    categories: "{not json", routes: null, zones: null,
    status: "confirmed", sms_status: "confirmed", email_status: null, merged_into: null,
  } as SubscriberRecord;
  assert.deepEqual(stateOf(record).categories, []);
  assert.equal(stateOf(record).routes, "ALL");
});

// Routes and zones on their own, as opt-in (POST /subscribers) checks them.
test("audienceErrors accepts ALL and offered ids, and refuses an empty or unknown list", () => {
  assert.deepEqual(audienceErrors({ routes: "ALL", zones: "ALL" }, OPTIONS), []);
  assert.deepEqual(audienceErrors({ routes: ["470", "495"], zones: ["zone-a"] }, OPTIONS), []);
  assert.deepEqual(audienceErrors({ routes: [], zones: "ALL" }, OPTIONS), ['routes must name at least one, or be "ALL"']);
  assert.deepEqual(audienceErrors({ routes: ["470", "999"], zones: "ALL" }, OPTIONS), ["routes contains unknown values: 999"]);
});
