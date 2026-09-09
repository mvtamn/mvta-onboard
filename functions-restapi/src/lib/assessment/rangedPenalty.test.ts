import assert from "node:assert/strict";
import test from "node:test";
import { rangedPenaltyBoundsSql } from "./rangedPenalty";

// The bounds shown must be the bounds scoring will apply: the occurrence's
// Agreement's own ladder if it has one, else the catalog; effective on the
// service date, inclusive at both ends; the qualifier's own band first; the
// lowest tier first.
test("the bounds resolve the tier the way scoring does", () => {
  const sql = rangedPenaltyBoundsSql("o", true);
  assert.match(sql, /OUTER APPLY/);
  assert.match(sql, /penalty_amount_min IS NOT NULL/);
  assert.match(sql, /t\.standard_id=o\.standard_id/);
  assert.match(sql, /pa\.contractor_id=o\.contractor_id AND pa\.is_active=1/);
  assert.match(sql, /t\.agreement_id=\(SELECT TOP 1 pa\.id FROM PerformanceAgreements/);
  assert.match(sql, /t\.agreement_id IS NULL AND NOT EXISTS/);
  assert.match(sql, /effective_end_date IS NULL OR t\.effective_end_date>=o\.service_date/);
  assert.match(sql, /ORDER BY CASE WHEN t\.qualifier_code IS NOT NULL THEN 0 ELSE 1 END, t\.tier_order/);
});

test("before migration 102 there is no agreement to scope by", () => {
  const sql = rangedPenaltyBoundsSql("o", false);
  assert.doesNotMatch(sql, /agreement_id/);
  assert.match(sql, /effective_end_date>=o\.service_date/);
});
