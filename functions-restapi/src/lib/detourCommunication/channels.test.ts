import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  channelKind, channelLabel, channelOptions, detourChannel,
  DETOUR_CHANNELS, isRecordedChannel, needsRecipients,
} from "./channels";
import { communicationEligibility } from "./eligibility";
import type { CommunicationDetour } from "./types";

test("a channel is either sent by OnBoard or recorded by a person", () => {
  assert.deepEqual(DETOUR_CHANNELS.filter((c) => channelKind(c) === "sent"), ["email", "sms", "teams"]);
  assert.deepEqual(DETOUR_CHANNELS.filter(isRecordedChannel), ["digital_signage", "avl_messaging"]);
});

test("only a channel carrying an address needs recipients", () => {
  // Nobody types a recipient for a road sign, and Teams posts to one
  // configured channel.
  assert.deepEqual(DETOUR_CHANNELS.filter(needsRecipients), ["email", "sms"]);
});

test("radio is gone", () => {
  // Dropped in the approved redesign: no Detour has ever used it.
  assert.equal(detourChannel("radio"), null);
  assert.equal(detourChannel("dispatch board"), null);
  assert.ok(!(DETOUR_CHANNELS as readonly string[]).includes("radio"));
});

test("older spellings still name their channel", () => {
  // A stored row or a console tab open across the deploy may say any of these.
  const cases: [string, string][] = [
    ["email", "email"], ["Email", "email"], [" E-Mail ", "email"],
    ["Teams", "teams"], ["Microsoft Teams", "teams"],
    ["text message", "sms"], ["SMS", "sms"],
    ["Digital signage", "digital_signage"], ["digital_signage", "digital_signage"],
    ["AVL messaging", "avl_messaging"], ["avl", "avl_messaging"],
  ];
  for (const [given, expected] of cases) assert.equal(detourChannel(given), expected, given);
  for (const nothing of ["", "   ", null, undefined, "carrier pigeon"]) assert.equal(detourChannel(nothing), null, String(nothing));
});

test("the console is offered every channel, labelled and classified", () => {
  const options = channelOptions();
  assert.equal(options.length, DETOUR_CHANNELS.length);
  assert.deepEqual(options[0], { channel: "email", label: "Email", kind: "sent" });
  assert.equal(channelLabel("avl_messaging"), "AVL messaging");
});

const closed: CommunicationDetour = {
  lifecycle_state: "closed", fulfillment_mode: "avail",
  re_review_outstanding: false, conflict_status: "none", required_audiences: ["Operators"],
};

test("a closed Detour accepts a recorded channel and still refuses a sent one", () => {
  // Recording is not sending: a Detour closes after it ends, so the AVL message
  // that went out on Monday may be written down on Tuesday.
  const record = communicationEligibility(closed, { audience: "Operators", channel: "avl_messaging", recipients: [] });
  assert.deepEqual([record.may_draft, record.may_send, record.refusal], [true, true, null]);
  assert.equal(communicationEligibility(closed, { audience: "Operators", channel: "digital_signage", recipients: [] }).may_send, true);

  const send = communicationEligibility(closed, { audience: "Operators", channel: "email", recipients: ["ops@example.com"] });
  assert.deepEqual([send.may_draft, send.may_send, send.refusal?.code], [false, false, "detour_closed"]);
});

test("every other refusal still applies to a recorded channel", () => {
  // A record of telling people about a Detour whose facts are under re-review
  // is as wrong as sending it.
  const outstanding = { ...closed, lifecycle_state: "fulfilled", re_review_outstanding: true } as CommunicationDetour;
  assert.equal(communicationEligibility(outstanding, { audience: "Operators", channel: "avl_messaging", recipients: [] }).refusal?.code, "re_review_outstanding");
  const pending = { ...closed, lifecycle_state: "awaiting_fulfillment" } as CommunicationDetour;
  assert.equal(communicationEligibility(pending, { audience: "Operators", channel: "avl_messaging", recipients: [] }).refusal?.code, "fulfillment_pending");
  const conflicted = { ...closed, lifecycle_state: "fulfilled", conflict_status: "unresolved" } as CommunicationDetour;
  assert.equal(communicationEligibility(conflicted, { audience: "Operators", channel: "digital_signage", recipients: [] }).refusal?.code, "conflict_unresolved");
});

test("a recorded channel is never refused for having no recipients", () => {
  const fulfilled = { ...closed, lifecycle_state: "fulfilled" } as CommunicationDetour;
  assert.equal(communicationEligibility(fulfilled, { audience: "Operators", channel: "digital_signage", recipients: [] }).may_send, true);
  assert.equal(communicationEligibility(fulfilled, { audience: "Operators", channel: "email", recipients: [] }).refusal?.code, "no_recipients");
  assert.equal(communicationEligibility(fulfilled, { audience: "Operators", channel: "sms", recipients: [] }).refusal?.code, "no_recipients");
  // Teams posts to one configured channel and carries no address.
  assert.equal(communicationEligibility(fulfilled, { audience: "Operators", channel: "teams", recipients: [] }).may_send, true);
});

test("a channel OnBoard does not know is refused, not guessed at", () => {
  const fulfilled = { ...closed, lifecycle_state: "fulfilled" } as CommunicationDetour;
  assert.equal(communicationEligibility(fulfilled, { audience: "Operators", channel: null, recipients: [] }).may_send, true,
    "eligibility itself does not decide the channel; the module refuses an unknown one before asking");
});

test("migration 132 constrains the column to this list", () => {
  const migration = readFileSync(join(process.cwd(), "sql", "migration-132-detour-communication-channels.sql"), "utf8");
  for (const channel of DETOUR_CHANNELS) assert.ok(migration.includes(`'${channel}'`), `${channel} must be in the CHECK`);
  assert.doesNotMatch(migration, /'radio'/);
  assert.match(migration, /occurred_at/);
});

test("a migration never names a column it adds in the same batch", () => {
  // SQL Server compiles a batch before running it, so an ALTER TABLE ADD
  // followed by a CHECK naming that column fails with "Invalid column name"
  // and the whole batch is abandoned - silently enough to look like a clean
  // run. Migration 092 shipped that way and could not be applied to any
  // database that lacked the column, which was all of them. The CHECK goes
  // through EXEC instead.
  const migration = readFileSync(join(process.cwd(), "sql", "migration-092-detour-communication-delivery.sql"), "utf8");
  const batches = migration.split(/^\s*GO\s*$/gim)
    // Text inside EXEC() is compiled when it runs, not with the batch around
    // it - that is the whole point of routing the CHECK through it.
    .map((batch) => batch.replace(/EXEC\s*\(\s*N?'[\s\S]*?'\s*\)/gi, ""));
  for (const batch of batches) {
    const adds = [...batch.matchAll(/ADD\s+(\w+)\s+NVARCHAR|ADD\s+(\w+)\s+DATETIME2/gi)].map((m) => m[1] ?? m[2]);
    for (const column of adds) {
      const named = new RegExp(`CHECK\\s*\\(\\s*${column}\\b`, "i");
      assert.ok(!named.test(batch), `${column} is added and named by a CHECK in one batch; run the CHECK through EXEC`);
    }
  }
});
