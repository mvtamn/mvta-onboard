import assert from "node:assert/strict";
import test from "node:test";
import { rangedPenaltyBoundsSql } from "./rangedPenalty";

// A ranged penalty (migration 107) needs a human to pick the amount; the
// console offers that only when it can see the governed bounds. The list
// handler joins the tier that governs the occurrence: same standard, the
// band effective on the occurrence's service date, the qualifier's own band
// ahead of the unqualified one.
test("the bounds come from the tier effective on the occurrence's service date, qualifier first", () => {
  const sql = rangedPenaltyBoundsSql("o");
  assert.match(sql, /OUTER APPLY/);
  assert.match(sql, /penalty_amount_min IS NOT NULL/);
  assert.match(sql, /t\.standard_id=o\.standard_id/);
  assert.match(sql, /t\.effective_start_date<=o\.service_date/);
  assert.match(sql, /effective_end_date IS NULL OR t\.effective_end_date>o\.service_date/);
  assert.match(sql, /qualifier_code=o\.qualifier_code THEN 0 ELSE 1 END/);
  assert.match(sql, /penalty_amount_min,\s*\w*\.?penalty_amount_max/);
});
