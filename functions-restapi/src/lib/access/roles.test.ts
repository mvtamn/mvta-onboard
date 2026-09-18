import assert from "node:assert/strict";
import test from "node:test";
import { refuseAccessIdentityWidening, roleKeyFrom, RoleRuleError, validateRoleInput } from "./roles";

test("a role's key comes from its name and stays readable", () => {
  assert.equal(roleKeyFrom("Weekend Dispatcher"), "weekend-dispatcher");
  assert.equal(roleKeyFrom("  OTP & Exclusions  "), "otp-exclusions");
  assert.throws(() => roleKeyFrom("!!!"), RoleRuleError);
});

test("validating what an Access Administrator typed", async (t) => {
  await t.test("a role needs a name, and one that fits", () => {
    assert.throws(() => validateRoleInput({ name: "  " }), /needs a name/);
    assert.throws(() => validateRoleInput({ name: "x".repeat(101) }), /at most 100/);
    assert.deepEqual(validateRoleInput({ name: " Dispatcher " }), { name: "Dispatcher" });
  });

  await t.test("actions must exist in the catalog", () => {
    assert.throws(() => validateRoleInput({ actions: ["detours.approve"] }), /No such action: detours.approve/);
    assert.throws(() => validateRoleInput({ actions: [7] }), /list of module actions/);
  });

  await t.test("actions are de-duplicated and ordered, so a grid saved twice is one grid", () => {
    assert.deepEqual(validateRoleInput({ actions: ["detours.view", "detours.edit", "detours.view"] }).actions, [
      "detours.edit",
      "detours.view",
    ]);
  });

  await t.test("leaving a field out leaves it alone", () => {
    assert.deepEqual(validateRoleInput({ purpose: "Covers weekends." }), { purpose: "Covers weekends." });
  });
});

test("adding an Access & Identity action is refused as a Privileged Access Change", async (t) => {
  await t.test("refuses the widening", () => {
    assert.throws(
      () => refuseAccessIdentityWidening(["detours.view"], ["detours.view", "access-identity.manage"]),
      (error: unknown) => error instanceof RoleRuleError && error.status === 409,
    );
  });

  await t.test("allows a role that already held it to keep it, and to narrow", () => {
    refuseAccessIdentityWidening(["access-identity.view"], ["access-identity.view", "detours.view"]);
    refuseAccessIdentityWidening(["access-identity.view", "access-identity.manage"], ["access-identity.view"]);
  });
});
