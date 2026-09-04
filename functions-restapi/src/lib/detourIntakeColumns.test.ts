import { test } from "node:test";
import assert from "node:assert";
import { detourIntakeSelectColumns } from "./detourIntakeColumns";

const FLAGS = [false, true] as const;

test("every readiness combination yields a valid comma-separated column list", () => {
  for (const duplicateLinksReady of FLAGS) for (const completeFieldsReady of FLAGS) for (const operationalFieldsReady of FLAGS) {
    const columns = detourIntakeSelectColumns({ duplicateLinksReady, completeFieldsReady, operationalFieldsReady });
    assert.doesNotMatch(columns, /,\s*,/, `double comma with ${JSON.stringify({ duplicateLinksReady, completeFieldsReady, operationalFieldsReady })}`);
    assert.doesNotMatch(columns, /^\s*,|,\s*$/, "leading or trailing comma");
    assert.ok(columns.split(", ").every((c) => /^i\.[a-z_]+$/.test(c)), `malformed column in: ${columns}`);
  }
});

test("optional column groups appear only when their migration is present", () => {
  const none = detourIntakeSelectColumns({ duplicateLinksReady: false, completeFieldsReady: false, operationalFieldsReady: false });
  assert.ok(!none.includes("duplicate_of") && !none.includes("service_impact") && !none.includes("proposed_start_time"));
  assert.ok(none.includes("i.created_at") && none.includes("i.updated_at"));
  const all = detourIntakeSelectColumns({ duplicateLinksReady: true, completeFieldsReady: true, operationalFieldsReady: true });
  for (const col of ["i.duplicate_of_detour_id", "i.evidence_reference", "i.confirmation_contact"]) assert.ok(all.includes(col), col);
});
