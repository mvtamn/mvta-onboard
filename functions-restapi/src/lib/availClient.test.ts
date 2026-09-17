import assert from "node:assert/strict";
import test from "node:test";
import { availConfig, availUrl, fetchAvail, formatDateMmDdYyyy, probeAvail, type AvailTransport } from "./availClient";

type Call = { url: string; headers: Record<string, string>; signal?: AbortSignal };

// A recorded Avail response: one fake transport, no global fetch stubbing.
function avail(body: unknown, status = 200) {
  const calls: Call[] = [];
  const lines: string[] = [];
  const transport: AvailTransport = {
    fetch: (async (url: string, init?: RequestInit) => {
      calls.push({ url, headers: init?.headers as Record<string, string>, signal: init?.signal ?? undefined });
      return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
      };
    }) as unknown as typeof fetch,
    log: (line) => lines.push(line),
  };
  return { transport, calls, lines };
}

const CONFIG = { baseUrl: "https://example.test/AVLReports/v1", apiKey: "key" };
const ok = (result: Record<string, unknown>) => ({ success: true, errors: [], result });

// --- AVL: the request shape that took three live incidents to get right ---

// CONFIRMED live 2026-08-05: the request 404'd on every run because it sent one
// date-only segment instead of Property plus two full datetime segments.
test("AVL builds Property plus two datetime segments, space escaped, colons literal", async () => {
  const a = avail(ok({ "AVL Reports": [] }));
  await fetchAvail("avl", { start: new Date("2026-08-05T21:30:00Z"), end: new Date("2026-08-05T21:40:00Z") }, CONFIG, a.transport);
  assert.equal(a.calls[0].url, "https://example.test/AVLReports/v1/MVTA/2026-08-05%2016:30:00/2026-08-05%2016:40:00");
});

// CONFIRMED live 2026-08-07: Avail reads the datetimes in agency-local time.
// Both cases are the same UTC wall time in the two Central offsets, so this
// fails on getUTC* and on a hard-coded -5/-6.
for (const c of [
  { label: "CDT (summer, UTC-5)", utc: "2026-08-05T21:30:00Z", local: "2026-08-05%2016:30:00" },
  { label: "CST (winter, UTC-6)", utc: "2026-01-15T21:30:00Z", local: "2026-01-15%2015:30:00" },
]) {
  test(`AVL builds its window in agency-local time - ${c.label}`, () => {
    const at = new Date(c.utc);
    assert.equal(availUrl("avl", CONFIG.baseUrl, { start: at, end: at }), `https://example.test/AVLReports/v1/MVTA/${c.local}/${c.local}`);
  });
}

// ROOT CAUSE, confirmed live 2026-08-06: encodeURIComponent escaped the colons
// and Avail answered success=true with an empty array for 14 days.
test("AVL never percent-encodes the colons", () => {
  const url = availUrl("avl", CONFIG.baseUrl, { start: new Date("2026-08-06T17:00:00Z"), end: new Date("2026-08-06T17:15:00Z") });
  assert.ok(!url.includes("%3A"), url);
  assert.equal(url, "https://example.test/AVLReports/v1/MVTA/2026-08-06%2012:00:00/2026-08-06%2012:15:00");
});

test("AVL appends Property exactly once whether or not the base URL already carries it", () => {
  const window = { start: new Date("2026-08-05T21:30:00Z"), end: new Date("2026-08-05T21:40:00Z") };
  for (const baseUrl of [
    "https://example.test/AVLReports/v1",
    "https://example.test/AVLReports/v1/MVTA",
    "https://example.test/AVLReports/v1/MVTA/",
    "https://example.test/AVLReports/v1/mvta",
  ]) {
    assert.equal(availUrl("avl", baseUrl, window), "https://example.test/AVLReports/v1/MVTA/2026-08-05%2016:30:00/2026-08-05%2016:40:00");
  }
});

test("AVL logs the raw status, window and body, and still returns the rows", async () => {
  const a = avail(ok({ "AVL Reports": [{ Vehicle: 302 }] }));
  const rows = await fetchAvail("avl", { start: new Date("2026-08-05T21:30:00Z"), end: new Date("2026-08-05T21:40:00Z") }, CONFIG, a.transport);
  assert.equal(rows[0].Vehicle, 302);
  assert.match(a.lines[0], /status=200/);
  assert.match(a.lines[0], /window\(America\/Chicago\)=\[2026-08-05 16:30:00 -> 2026-08-05 16:40:00\]/);
  assert.match(a.lines[0], /"AVL Reports":\[\{"Vehicle":302/);
});

// --- every endpoint: auth, timeout, envelope ---

test("every request sends the subscription key and carries a timeout", async () => {
  const a = avail(ok({ Pullout: [] }));
  await fetchAvail("pullout", {}, { baseUrl: "https://example.test/Pullout/v1/MVTA", apiKey: "secret" }, a.transport);
  assert.equal(a.calls[0].headers["Ocp-Apim-Subscription-Key"], "secret");
  assert.ok(a.calls[0].signal, "a hung Avail call must not hold the worker indefinitely");
});

test("Pullout is the property-level path with no date suffix", () => {
  assert.equal(availUrl("pullout", "https://example.test/Pullout/v1/MVTA/", {}), "https://example.test/Pullout/v1/MVTA");
});

test("OTP Daily, OTP Monthly and Missed Trips build their confirmed paths", () => {
  const start = new Date("2026-09-01T00:00:00Z");
  const end = new Date("2026-09-15T00:00:00Z");
  assert.equal(
    availUrl("otp_daily", "https://example.test/OtpByRouteStopDayHour/v1/MVTA/", { start, end }),
    "https://example.test/OtpByRouteStopDayHour/v1/MVTA/09-01-2026/09-15-2026/1/5/15/30/0/1/1",
  );
  assert.equal(
    availUrl("otp_monthly", "https://example.test/OtpByRouteStopDayAgg/v1/MVTA", { month: end }),
    "https://example.test/OtpByRouteStopDayAgg/v1/MVTA/09-15-2026/1/5/15/30/0/1/1",
  );
  assert.equal(
    availUrl("missed_trips", "https://example.test/MissedTripsByRouteStopDay/v1/MVTA", { start, end }),
    "https://example.test/MissedTripsByRouteStopDay/v1/MVTA/09-01-2026/09-15-2026/0/0",
  );
});

test("formatDateMmDdYyyy formats as MM-DD-YYYY", () => {
  assert.equal(formatDateMmDdYyyy(new Date("2026-07-04T00:00:00Z")), "07-04-2026");
});

test("rows come from the lowercase result keys Avail actually returns", async () => {
  const cases = [
    ["otp_daily", { month: new Date(), start: new Date(), end: new Date() }, { otp: [{ RouteFareboxID: 446 }], results: [] }],
    ["otp_monthly", { month: new Date() }, { otp: [{ RouteID: 90 }] }],
    ["missed_trips", { start: new Date(), end: new Date() }, { missed: [{ RouteID: 3 }], results: [] }],
    ["detours", {}, { detours: [{ DetourID: 30 }], results: [] }],
  ] as const;
  for (const [endpoint, request, result] of cases) {
    const a = avail(ok(result));
    const rows = await fetchAvail(endpoint, request as never, CONFIG, a.transport);
    assert.equal(rows.length, 1, endpoint);
  }
});

test("OTP Daily also accepts the documented operation-name key", async () => {
  const a = avail(ok({ OtpByRouteStopDayHour: [{ RouteFareboxID: 446 }] }));
  const rows = await fetchAvail("otp_daily", { start: new Date(), end: new Date() }, CONFIG, a.transport);
  assert.equal(rows.length, 1);
});

// The diagnostic that caught "Detours" -> "detours" (2026-08-05) and the
// PascalCase missed-trips key (2026-08-06): name the keys, never sync zero.
test("a moved result key throws naming the keys that came back", async () => {
  for (const [endpoint, request, wrongKey] of [
    ["otp_daily", { start: new Date(), end: new Date() }, "otpByRouteStopDayHour"],
    ["otp_monthly", { month: new Date() }, "OtpByRouteStopDayAgg"],
    ["missed_trips", { start: new Date(), end: new Date() }, "MissedTripsByRouteStopDay"],
    ["detours", {}, "Detours"],
  ] as const) {
    const a = avail(ok({ [wrongKey]: [{}] }));
    await assert.rejects(fetchAvail(endpoint, request as never, CONFIG, a.transport), new RegExp(wrongKey), endpoint);
  }
});

test("a genuinely empty result is an empty delivery, including one with only its metadata sibling", async () => {
  for (const result of [{}, { results: [{ RefreshTime: "2026-09-16T10:00:00", Property: "MVTA" }] }]) {
    const a = avail(ok(result));
    assert.deepEqual(await fetchAvail("detours", {}, CONFIG, a.transport), []);
  }
});

test("success=false throws with Avail's own error detail", async () => {
  const a = avail({ success: false, errors: ["invalid date range"], result: {} });
  await assert.rejects(
    fetchAvail("avl", { start: new Date(), end: new Date() }, CONFIG, a.transport),
    /Avail AVL API returned success=false: invalid date range/,
  );
});

test("an HTTP failure throws with the status and the start of the body", async () => {
  const a = avail("Access denied due to invalid subscription key.", 401);
  await assert.rejects(fetchAvail("pullout", {}, CONFIG, a.transport), /Avail Pullout request failed: 401 - Access denied/);
});

test("an unparseable body throws rather than reading as empty", async () => {
  const a = avail("<html>gateway</html>");
  await assert.rejects(fetchAvail("detours", {}, CONFIG, a.transport), /unparseable JSON/);
});

// --- settings and the /feed-checks probe ---

test("availConfig names exactly the settings that are missing", () => {
  assert.deepEqual(availConfig("otp_daily", {}).missing, ["AVAIL_OTP_DAILY_URL", "AVAIL_AVL_REPORTS_API_KEY"]);
  assert.deepEqual(availConfig("otp_daily", { AVAIL_OTP_DAILY_URL: "https://x" }).missing, ["AVAIL_AVL_REPORTS_API_KEY"]);
  assert.deepEqual(
    availConfig("otp_daily", { AVAIL_OTP_DAILY_URL: " https://x ", AVAIL_AVL_REPORTS_API_KEY: " k " }).config,
    { baseUrl: "https://x", apiKey: "k" },
  );
});

test("the feed check sends the same request the poll sends", async () => {
  // /feed-checks used to build its own AVL URL without the /MVTA trim, so an
  // AVAIL_AVL_REPORTS_URL ending in /MVTA made the check call .../MVTA/MVTA/...
  // while the poll worked.
  const env = { AVAIL_AVL_REPORTS_URL: "https://example.test/AVLReports/v1/MVTA", AVAIL_AVL_REPORTS_API_KEY: "key" };
  const window = { start: new Date("2026-09-16T15:00:00Z"), end: new Date("2026-09-16T15:10:00Z") };
  const poll = avail(ok({ "AVL Reports": [] }));
  const check = avail(ok({ "AVL Reports": [] }));

  await fetchAvail("avl", window, availConfig("avl", env).config!, poll.transport);
  await probeAvail("avl", window, check.transport, env);

  assert.equal(check.calls[0].url, poll.calls[0].url);
  assert.deepEqual(check.calls[0].headers, poll.calls[0].headers);
});

test("the feed check reports configuration, rows and failures in the page's shape", async () => {
  const env = { AVAIL_PULLOUT_URL: "https://example.test/Pullout/v1/MVTA", AVAIL_AVL_REPORTS_API_KEY: "key" };

  assert.deepEqual(await probeAvail("pullout", {}, {}, {}), { name: "Avail Pullout", configured: false });
  assert.deepEqual(
    await probeAvail("pullout", {}, {}, { AVAIL_PULLOUT_URL: env.AVAIL_PULLOUT_URL }),
    { name: "Avail Pullout", configured: false, error: "Subscription key unavailable" },
  );
  assert.deepEqual(
    await probeAvail("pullout", {}, avail(ok({ Pullout: [{ Block: 1, Run: 2 }] })).transport, env),
    { name: "Avail Pullout", configured: true, status: 200, records: 1, keys: ["Block", "Run"] },
  );
  const failed = await probeAvail("pullout", {}, avail("denied", 401).transport, env);
  assert.equal(failed.configured, true);
  assert.match(failed.error ?? "", /401/);
});
