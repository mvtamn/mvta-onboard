import { test } from "node:test";
import assert from "node:assert";
import { contractorFromSettings, parseRecipients, requiredAudiences } from "./detourContractor";

test("recipients split on commas, semicolons, or whitespace and must look like addresses", () => {
  assert.deepStrictEqual(parseRecipients("a@sst.com, b@sst.com; ops@sst.com\nnot-an-address"), ["a@sst.com", "b@sst.com", "ops@sst.com"]);
  assert.deepStrictEqual(parseRecipients(""), []);
  assert.deepStrictEqual(parseRecipients(null), []);
});

test("settings rows become a contractor; blank name means none configured", () => {
  assert.deepStrictEqual(contractorFromSettings([{ setting_key: "contractor_name", setting_value: " SST " }, { setting_key: "contractor_recipients", setting_value: "x@sst.com" }]), { name: "SST", recipients: ["x@sst.com"] });
  assert.deepStrictEqual(contractorFromSettings([{ setting_key: "contractor_name", setting_value: "" }]), { name: null, recipients: [] });
  assert.deepStrictEqual(contractorFromSettings([]), { name: null, recipients: [] });
});

test("the contractor is required on fixed-route detours only, without duplicating a named entry", () => {
  const sst = { name: "SST", recipients: [] };
  assert.deepStrictEqual(requiredAudiences({ notification_audiences: ["Operators"], service_impact: "fixed_route" }, sst), ["Operators", "SST"]);
  assert.deepStrictEqual(requiredAudiences({ notification_audiences: ["Operators"], service_impact: null }, sst), ["Operators", "SST"]);
  assert.deepStrictEqual(requiredAudiences({ notification_audiences: ["Operators"], service_impact: "mobility" }, sst), ["Operators"]);
  assert.deepStrictEqual(requiredAudiences({ notification_audiences: ["Operators", "sst"], service_impact: "fixed_route" }, sst), ["Operators", "sst"]);
  assert.deepStrictEqual(requiredAudiences({ notification_audiences: ["Operators"] }, { name: null, recipients: [] }), ["Operators"]);
});
