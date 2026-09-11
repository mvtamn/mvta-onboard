import assert from "node:assert/strict";
import test from "node:test";
import { normalizeUsPhone, isE164 } from "./phone";

// The same table as frontend/packages/shared/src/phone.test.ts. The two
// implementations are separate copies by necessity (see phone.ts); running the
// same inputs against both is what keeps them one behaviour. A change here
// that is not made there produces a number the form posts and this endpoint
// cannot match, which shows up as a confirmation that silently does nothing.
const SAME_AS_FRONTEND: [string, string | null][] = [
  ["19523883275", "+19523883275"],
  ["9523883275", "+19523883275"],
  ["952-388-3275", "+19523883275"],
  ["(952) 388-3275", "+19523883275"],
  ["1 (952) 388-3275", "+19523883275"],
  ["+1 612 555 0142", "+16125550142"],
  ["+44 20 7946 0958", "+442079460958"],
  ["", null],
  ["   ", null],
  ["555-0142", null],
  ["952388327", null],
  ["29523883275", null],
  ["not a phone", null],
  ["+0123456789", null],
];

test("normalizeUsPhone agrees with the frontend copy", () => {
  for (const [input, expected] of SAME_AS_FRONTEND) {
    assert.equal(normalizeUsPhone(input), expected, `input ${JSON.stringify(input)}`);
  }
});

test("every normalized number satisfies the rule the database stores", () => {
  for (const [input, expected] of SAME_AS_FRONTEND) {
    if (expected) assert.ok(isE164(normalizeUsPhone(input)!), `input ${JSON.stringify(input)}`);
  }
});
