import assert from "node:assert/strict";
import test from "node:test";
import { summarizeFeedResponse } from "./feedCheckResponse";

test("uses Spare's total instead of treating its data envelope as empty", () => {
  assert.deepEqual(
    summarizeFeedResponse({ total: 7, limit: 1, skip: 0, data: [{ id: "request-1", status: "completed" }] }),
    { records: 7, keys: ["id", "status"] },
  );
});
