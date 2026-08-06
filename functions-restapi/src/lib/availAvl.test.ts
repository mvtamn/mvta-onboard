import { test } from "node:test";
import assert from "node:assert";
import { mapAvlReport, fetchAvlReports, type AvailAvlReport } from "./availAvl";

// Fixture shaped like the sample Avail360 AVL Reports payload.
const SAMPLE: AvailAvlReport = {
  Vehicle: 302,
  Timestamp: "2024-08-21T08:00:00Z",
  Route: 40,
  Block: 14002,
  Run: 4002,
  Trip: 742,
  Latitude: 33.557958,
  Longitude: -86.823507,
  Heading: 130,
  Direction: "O",
};

test("maps a well-formed AVL report", () => {
  const mapped = mapAvlReport(SAMPLE);
  assert.ok(mapped);
  assert.strictEqual(mapped!.vehicle_id, 302);
  assert.strictEqual(mapped!.route, 40);
  assert.strictEqual(mapped!.block, 14002);
  assert.strictEqual(mapped!.run, 4002);
  assert.strictEqual(mapped!.trip, 742);
  assert.strictEqual(mapped!.latitude, 33.557958);
  assert.strictEqual(mapped!.longitude, -86.823507);
  assert.strictEqual(mapped!.heading, 130);
  assert.strictEqual(mapped!.direction, "O");
  assert.strictEqual(mapped!.report_timestamp.toISOString(), "2024-08-21T08:00:00.000Z");
});

test("returns null when Vehicle is missing or non-numeric", () => {
  const report = { ...SAMPLE, Vehicle: undefined as unknown as number };
  assert.strictEqual(mapAvlReport(report), null);
});

test("returns null when Latitude/Longitude are missing", () => {
  assert.strictEqual(mapAvlReport({ ...SAMPLE, Latitude: undefined as unknown as number }), null);
  assert.strictEqual(mapAvlReport({ ...SAMPLE, Longitude: undefined as unknown as number }), null);
});

test("returns null for an unparseable Timestamp", () => {
  assert.strictEqual(mapAvlReport({ ...SAMPLE, Timestamp: "not-a-date" }), null);
});

test("treats optional fields as null when absent", () => {
  const mapped = mapAvlReport({ ...SAMPLE, Route: null, Block: null, Run: null, Trip: null, Heading: null, Direction: null });
  assert.ok(mapped);
  assert.strictEqual(mapped!.route, null);
  assert.strictEqual(mapped!.heading, null);
  assert.strictEqual(mapped!.direction, null);
});

// CONFIRMED live 2026-08-05: this request 404'd on every run since
// deployment because it only sent one date-only segment instead of the
// three the real spec needs (Property, then two full-datetime segments).
// This test locks in the fixed URL shape - baseUrl carries NO property
// segment; PROPERTY ("MVTA") is appended explicitly by fetchAvlReports.
test("fetchAvlReports builds the URL with an explicit Property segment plus two encoded full-datetime segments", async () => {
  let requestedUrl = "";
  const original = global.fetch;
  global.fetch = (async (url: string) => {
    requestedUrl = url;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true, errors: [], result: { "AVL Reports": [] } }),
    };
  }) as unknown as typeof fetch;
  try {
    await fetchAvlReports(
      "https://example.test/AVLReports/v1",
      "key",
      new Date("2026-08-05T21:30:00Z"),
      new Date("2026-08-05T21:40:00Z"),
    );
  } finally {
    global.fetch = original;
  }
  assert.strictEqual(
    requestedUrl,
    "https://example.test/AVLReports/v1/MVTA/2026-08-05%2021%3A30%3A00/2026-08-05%2021%3A40%3A00",
  );
});

// Confirmed 2026-08-06: AVAIL_AVL_REPORTS_URL may be reconfigured to bake
// Property in directly (matching every other Avail feed's convention,
// e.g. ".../AVLReports/v1/MVTA"). Locks in that fetchAvlReports appends
// PROPERTY exactly once either way - never ".../MVTA/MVTA/...".
test("fetchAvlReports does not double up Property when baseUrl already ends in /MVTA", async () => {
  let requestedUrl = "";
  const original = global.fetch;
  global.fetch = (async (url: string) => {
    requestedUrl = url;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true, errors: [], result: { "AVL Reports": [] } }),
    };
  }) as unknown as typeof fetch;
  try {
    await fetchAvlReports(
      "https://example.test/AVLReports/v1/MVTA",
      "key",
      new Date("2026-08-05T21:30:00Z"),
      new Date("2026-08-05T21:40:00Z"),
    );
  } finally {
    global.fetch = original;
  }
  assert.strictEqual(
    requestedUrl,
    "https://example.test/AVLReports/v1/MVTA/2026-08-05%2021%3A30%3A00/2026-08-05%2021%3A40%3A00",
  );
});

test("fetchAvlReports does not double up Property when baseUrl ends in /MVTA/ (trailing slash) or lowercase /mvta", async () => {
  let requestedUrls: string[] = [];
  const original = global.fetch;
  global.fetch = (async (url: string) => {
    requestedUrls.push(url);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true, errors: [], result: { "AVL Reports": [] } }),
    };
  }) as unknown as typeof fetch;
  try {
    for (const baseUrl of ["https://example.test/AVLReports/v1/MVTA/", "https://example.test/AVLReports/v1/mvta"]) {
      await fetchAvlReports(baseUrl, "key", new Date("2026-08-05T21:30:00Z"), new Date("2026-08-05T21:40:00Z"));
    }
  } finally {
    global.fetch = original;
  }
  for (const requestedUrl of requestedUrls) {
    assert.strictEqual(
      requestedUrl,
      "https://example.test/AVLReports/v1/MVTA/2026-08-05%2021%3A30%3A00/2026-08-05%2021%3A40%3A00",
    );
  }
});

// Confirms the raw-response diagnostic (added 2026-08-06) actually logs
// the real HTTP status and body text - not just the parsed/mapped result -
// so App Insights traces can distinguish "Avail sent real vehicles but we
// mis-parsed them" from "Avail itself sent an empty array".
test("fetchAvlReports logs the raw status and body, and still returns the parsed reports", async () => {
  const rawBody = JSON.stringify({
    success: true,
    errors: [],
    result: { "AVL Reports": [SAMPLE] },
  });
  const originalFetch = global.fetch;
  const originalLog = console.log;
  let loggedLine = "";
  global.fetch = (async () => ({ ok: true, status: 200, text: async () => rawBody })) as unknown as typeof fetch;
  console.log = ((msg: string) => {
    loggedLine = msg;
  }) as unknown as typeof console.log;
  let reports: AvailAvlReport[];
  try {
    reports = await fetchAvlReports(
      "https://example.test/AVLReports/v1",
      "key",
      new Date("2026-08-05T21:30:00Z"),
      new Date("2026-08-05T21:40:00Z"),
    );
  } finally {
    global.fetch = originalFetch;
    console.log = originalLog;
  }
  assert.strictEqual(reports.length, 1);
  assert.strictEqual(reports[0].Vehicle, 302);
  assert.match(loggedLine, /status=200/);
  assert.match(loggedLine, /window\(UTC\)=\[2026-08-05 21:30:00 -> 2026-08-05 21:40:00\]/);
  assert.match(loggedLine, /"AVL Reports":\[\{"Vehicle":302/);
});

// success=false or a malformed body should still surface the raw status
// and body in the thrown error (and in the log line above it), not just a
// generic "request failed".
test("fetchAvlReports throws with the raw body when Avail returns success=false", async () => {
  const originalFetch = global.fetch;
  const originalLog = console.log;
  console.log = (() => {}) as unknown as typeof console.log;
  global.fetch = (async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ success: false, errors: ["invalid date range"], result: { "AVL Reports": [] } }),
  })) as unknown as typeof fetch;
  try {
    await assert.rejects(
      () =>
        fetchAvlReports(
          "https://example.test/AVLReports/v1",
          "key",
          new Date("2026-08-05T21:30:00Z"),
          new Date("2026-08-05T21:40:00Z"),
        ),
      /success=false: invalid date range/,
    );
  } finally {
    global.fetch = originalFetch;
    console.log = originalLog;
  }
});
