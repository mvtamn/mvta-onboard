import assert from "node:assert/strict";
import test from "node:test";
import { reviewedItemsSha256Sql } from "./reviewedItems";

// The share is bound to the exact set of reviewed items: one hash over every
// item's reviewed_input_sha256 in a fixed order. Finalize recomputes the same
// expression and refuses when it no longer matches the open share's.
test("the reviewed-items hash is order-fixed and computed in SQL", () => {
  const expr = reviewedItemsSha256Sql("period");
  assert.match(expr, /HASHBYTES\('SHA2_256'/);
  assert.match(expr, /STRING_AGG\(/);
  assert.match(expr, /WITHIN GROUP \(ORDER BY standard_id\)/);
  assert.match(expr, /reviewed_input_sha256/);
  assert.match(expr, /period_id=@period/);
});
