import { test } from "node:test";
import assert from "node:assert";
import { buildAlertEmail, buildManageLinkEmail, buildManageLinkSms, manageLinkFor } from "./alertEmail";

const BASE = "https://endpoint-mvta-onboard-dev.example.azurefd.net";
const KEY = "0123456789abcdef".repeat(4);

test("the manage link carries the key in the fragment, never the query string", () => {
  const link = manageLinkFor(BASE, KEY)!;
  const url = new URL(link);
  assert.strictEqual(url.pathname, "/subscribe/preferences");
  // A query string is sent to the server and lands in access logs; a fragment
  // is not sent anywhere.
  assert.strictEqual(url.search, "");
  assert.strictEqual(url.hash, `#key=${KEY}`);
});

test("a trailing slash on the base does not double up", () => {
  assert.strictEqual(manageLinkFor(`${BASE}/`, KEY), `${BASE}/subscribe/preferences#key=${KEY}`);
});

test("no link at all rather than one that goes nowhere from an inbox", () => {
  // A footer that looks like a working opt-out and is not is worse than none.
  for (const base of [undefined, "", "/relative", "http://plain.example.com", "https://", 'https://evil.example.com/"><script>', "https://a.example.com?x=1"]) {
    assert.strictEqual(manageLinkFor(base, KEY), null, `base ${JSON.stringify(base)}`);
  }
  for (const key of [null, undefined, "", "abc", KEY.toUpperCase(), `${KEY}0`]) {
    assert.strictEqual(manageLinkFor(BASE, key), null, `key ${JSON.stringify(key)}`);
  }
});

test("an alert email puts the summary first and the way out at the bottom", () => {
  const link = manageLinkFor(BASE, KEY)!;
  const mail = buildAlertEmail("Route 470 detoured at Main St", link);
  assert.strictEqual(mail.subject, "MVTA Service Alert");
  assert.ok(mail.text.startsWith("Route 470 detoured at Main St"));
  assert.ok(mail.text.includes(`Manage your alerts or unsubscribe: ${link}`));
  assert.ok(mail.html.includes(`href="${link}"`));
  assert.ok(mail.html.indexOf("Route 470") < mail.html.indexOf("Manage your alerts"));
});

test("the summary is escaped, so an alert cannot inject markup into the email", () => {
  const mail = buildAlertEmail('<img src=x onerror="alert(1)"> & more', manageLinkFor(BASE, KEY));
  assert.ok(!mail.html.includes("<img"));
  assert.ok(mail.html.includes("&lt;img"));
  assert.ok(mail.html.includes("&amp; more"));
});

test("without a link the footer explains itself but offers no opt-out it cannot deliver", () => {
  const mail = buildAlertEmail("Delay on 472", null);
  assert.ok(mail.text.includes("signed up for MVTA service alerts"));
  assert.ok(!/manage|unsubscribe/i.test(mail.text));
  assert.ok(!mail.html.includes("<a "));
});

test("the recovery reply sends the link and says ignoring it changes nothing", () => {
  const link = manageLinkFor(BASE, KEY)!;
  const mail = buildManageLinkEmail(link);
  assert.ok(mail.html.includes(`href="${link}"`));
  assert.ok(mail.text.includes(link));
  assert.match(mail.text, /didn’t ask for this.*haven’t changed/s);
  assert.ok(buildManageLinkSms(link).includes(link));
});
