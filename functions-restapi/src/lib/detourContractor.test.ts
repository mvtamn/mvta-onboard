import { test } from "node:test";
import assert from "node:assert";
import { contractorFromSettings, defaultAudiencesFromSettings, parseRecipients, requiredAudiences } from "./detourContractor";

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

// The audiences every Detour must reach when its record names none (migration
// 133). Ten of the eleven Detours on dev arrived from the Avail sync with no
// audiences at all, so without this they could never be marked communicated.
test("a Detour that names no audiences takes the configured defaults", () => {
  const defaults = ["Operators", "Operations management"];
  assert.deepEqual(
    requiredAudiences({ notification_audiences: [], service_impact: null }, { name: null, recipients: [] }, defaults),
    defaults,
  );
});

test("a Detour that names its own audiences is taken at its word", () => {
  // A Detour entered for one garage does not acquire the whole default list.
  assert.deepEqual(
    requiredAudiences({ notification_audiences: ["Garage supervisors"], service_impact: null }, { name: null, recipients: [] }, ["Operators"]),
    ["Garage supervisors"],
  );
});

test("the contractor rule is unchanged by the defaults", () => {
  const contractor = { name: "SST", recipients: ["ops@example.com"] };
  // Added to a default list on fixed-route service...
  assert.deepEqual(
    requiredAudiences({ notification_audiences: [], service_impact: null }, contractor, ["Operators"]),
    ["Operators", "SST"],
  );
  // ...and still never on mobility service.
  assert.deepEqual(
    requiredAudiences({ notification_audiences: [], service_impact: "mobility" }, contractor, ["Operators"]),
    ["Operators"],
  );
  // Not duplicated when the default list already names them.
  assert.deepEqual(
    requiredAudiences({ notification_audiences: [], service_impact: null }, contractor, ["Operators", "sst"]),
    ["Operators", "sst"],
  );
});

test("no defaults configured leaves the old behaviour exactly", () => {
  assert.deepEqual(requiredAudiences({ notification_audiences: [], service_impact: null }, { name: null, recipients: [] }), []);
  assert.deepEqual(requiredAudiences({ notification_audiences: [], service_impact: null }, { name: null, recipients: [] }, []), []);
});

test("an administrator's list is read the way they typed it", () => {
  assert.deepEqual(defaultAudiencesFromSettings([
    { setting_key: "default_audiences", setting_value: " Operators, Operations management ;\nGarage supervisors " },
  ]), ["Operators", "Operations management", "Garage supervisors"]);
  assert.deepEqual(defaultAudiencesFromSettings([{ setting_key: "default_audiences", setting_value: "" }]), []);
  assert.deepEqual(defaultAudiencesFromSettings([]), []);
});
