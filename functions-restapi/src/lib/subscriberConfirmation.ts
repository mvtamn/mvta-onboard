import type { InvocationContext } from "@azure/functions";
import type { Transaction } from "mssql";
import { sql } from "./db";
import { issueConfirmation, type IssuedConfirmation } from "./confirmationTokens";

// The double opt-in state machine: turning a token a rider presents back to us
// into a confirmed channel, and recording an opt-out.
//
// Everything here runs inside the caller's transaction. Confirming touches
// three things - the confirmation row, the channel's status, and the record's
// lifecycle - and a half-applied confirmation is a subscriber who is confirmed
// for a channel whose token is still live, or a spent token on an unconfirmed
// channel. Neither is recoverable without a human reading rows.
//
// WHY TWO ENTRY POINTS rather than one `confirmByToken(channel, token)`.
// The two channels are looked up by different keys, and the difference is not
// incidental:
//
//   An email link carries nothing but the token, so the token is the lookup
//   key. It is 24 random bytes; guessing one is not a threat worth modelling.
//
//   An SMS reply carries the sender's number, and the code is six digits. If a
//   six-digit code were the lookup key, presenting a guessed code would
//   confirm whichever subscription happened to hold it - someone else's. So
//   the SMS path finds the live confirmation FOR THAT NUMBER and compares the
//   code to it. That is also what makes an attempt cap possible: a wrong code
//   still identifies which confirmation was being guessed at, so the guess can
//   be counted. A token-keyed lookup cannot count a miss, because a miss finds
//   nothing to count against.

/** Wrong codes allowed against one live confirmation before it stops accepting any. */
export const MAX_CONFIRM_ATTEMPTS = 5;

export type ConfirmOutcome =
  /** The channel is now confirmed. */
  | "confirmed"
  /** This exact token was already used. Reported as success: a rider who clicks the email link twice has done nothing wrong. */
  | "already_confirmed"
  /** A resend replaced this token. The newer one is the live one. */
  | "superseded"
  /** Past expires_at. */
  | "expired"
  /** Too many wrong codes against this confirmation; a resend issues a fresh one. */
  | "too_many_attempts"
  /** There is a live confirmation for this contact, and this is not its code. */
  | "incorrect_code"
  /** No live confirmation, or no subscriber, for this contact. */
  | "not_found"
  /** The subscriber opted out. Confirming must not resurrect them. */
  | "opted_out";

export interface ConfirmResult {
  outcome: ConfirmOutcome;
  /** Present whenever a confirmation row was identified, whatever the outcome. */
  subscriberId?: string;
  channel?: Channel;
  /** Wrong codes remaining before the cap, on "incorrect_code". */
  attemptsRemaining?: number;
}

export type Channel = "sms" | "email";

/** A confirmation row as the lookups below read it. */
export interface ConfirmationRow {
  confirmation_id: string;
  subscriber_id: string;
  channel: Channel;
  token: string;
  expires_at: Date;
  confirmed_at: Date | null;
  superseded_at: Date | null;
  attempts: number;
  subscriber_status: string;
}

/**
 * What a confirmation row is, before its code has been checked.
 *
 * "eligible" is deliberately not "confirmed": for the email channel finding a
 * live row IS the proof, but for SMS it only means the row is in a state where
 * a code could be accepted, and the code still has to match. Collapsing the
 * two would make the SMS path read as though a live row were sufficient.
 */
export type ConfirmationState = Exclude<ConfirmOutcome, "confirmed" | "incorrect_code"> | "eligible";

// The decision itself, with no database in it. Every state except the two the
// callers add - a matching code, or a wrong one - is decided here, from a row
// and a clock.
//
// ORDER IS THE BEHAVIOUR. A row can be several of these at once - a token that
// was superseded an hour ago may also have expired since - and the one the
// rider is told is the first that matches:
//
//   already_confirmed precedes everything, so a rider who clicks a link twice
//   is told it worked rather than that it expired while they were reading.
//
//   opted_out precedes the rest because no token may revive a record someone
//   asked to be removed from, whatever state the token is in.
//
//   superseded precedes expired: both send the rider to a newer code, but only
//   one of them is true, and "that code expired" is confusing to someone
//   holding the text that replaced it.
//
//   too_many_attempts is last of the refusals, so a locked-out confirmation
//   that has also expired reads as expired - the remedy is the same resend,
//   and the weaker statement gives a guesser less.
export function classifyConfirmation(row: ConfirmationRow | null, now: Date): ConfirmationState {
  if (!row) return "not_found";
  if (row.confirmed_at) return "already_confirmed";
  if (row.subscriber_status === "opted_out") return "opted_out";
  if (row.superseded_at) return "superseded";
  if (row.expires_at.getTime() <= now.getTime()) return "expired";
  if (row.attempts >= MAX_CONFIRM_ATTEMPTS) return "too_many_attempts";
  return "eligible";
}

const SELECT_COLUMNS = `c.confirmation_id, c.subscriber_id, c.channel, c.token, c.expires_at,
         c.confirmed_at, c.superseded_at, c.attempts, s.status AS subscriber_status`;

/**
 * Confirm an email channel from the token in the link.
 *
 * The token is the only thing the link carries, so it is the lookup key. Spent
 * and superseded rows are matched too, and rejected by the classifier: the
 * alternative is a filtered lookup that finds nothing, which would report a
 * rider's second click as "no such token" rather than as already done.
 */
export async function confirmEmail(tx: Transaction, token: string): Promise<ConfirmResult> {
  const find = new sql.Request(tx);
  find.input("token", sql.NVarChar(100), token);
  const found = await find.query<ConfirmationRow>(
    `SELECT ${SELECT_COLUMNS}
       FROM SubscriberConfirmations c WITH(UPDLOCK, HOLDLOCK)
       JOIN Subscribers s ON s.subscriber_id = c.subscriber_id
      WHERE c.channel = 'email' AND c.token = @token`,
  );
  const row = found.recordset[0] ?? null;
  const state = classifyConfirmation(row, new Date());
  if (state !== "eligible") {
    return { outcome: state, subscriberId: row?.subscriber_id, channel: row ? "email" : undefined };
  }
  // Holding the link is the proof; there is nothing further to check.
  const survivorId = await markConfirmed(tx, row!);
  // The survivor, not the row that was confirming: a duplicate folded into an
  // older record is no longer the subscriber this contact belongs to.
  return { outcome: "confirmed", subscriberId: survivorId, channel: "email" };
}

/**
 * Confirm an SMS channel from a code the rider sent back.
 *
 * `phoneNumber` must be E.164 - the same normalization the opt-in form applies
 * (`normalizeUsPhone` in @mvta/shared), since that is the shape it was stored
 * in. A number that arrives in any other shape matches nothing and reads as
 * "not_found", which is indistinguishable from never having subscribed.
 *
 * A wrong code is counted against the live confirmation for that number and
 * reported as "incorrect_code" - distinct from "not_found", which says no live
 * confirmation exists at all. The two must NOT be distinguished to an
 * arbitrary caller: over the inbound-SMS path the sender owns the number and
 * can learn nothing they do not already know, but an HTTP endpoint that takes
 * a phone number in its body would be telling anyone who asks whether that
 * number is mid-signup. Collapsing them is the caller's job (increment 3).
 */
export async function confirmSms(
  tx: Transaction,
  phoneNumber: string,
  code: string,
): Promise<ConfirmResult> {
  const find = new sql.Request(tx);
  find.input("phone", sql.NVarChar(20), phoneNumber);
  // The live confirmation for this number. Newest first, so a resend that
  // raced its own supersede still lands on the code the rider is holding.
  const found = await find.query<ConfirmationRow>(
    `SELECT TOP 1 ${SELECT_COLUMNS}
       FROM SubscriberConfirmations c WITH(UPDLOCK, HOLDLOCK)
       JOIN Subscribers s ON s.subscriber_id = c.subscriber_id
      WHERE c.channel = 'sms'
        AND s.phone_number = @phone
        AND c.confirmed_at IS NULL
        AND c.superseded_at IS NULL
      ORDER BY c.created_at DESC`,
  );
  const row = found.recordset[0] ?? null;
  if (!row) {
    // Either no such number, or its confirmation is already spent. A rider who
    // replies with the same code twice lands here; increment 3 answers that
    // the same way it answers success, since from the rider's side it is.
    return { outcome: await spentSmsExists(tx, phoneNumber) ? "already_confirmed" : "not_found" };
  }

  const state = classifyConfirmation(row, new Date());
  if (state !== "eligible") {
    return { outcome: state, subscriberId: row.subscriber_id, channel: "sms" };
  }

  if (row.token !== code) {
    const attempts = await countAttempt(tx, row.confirmation_id);
    return {
      outcome: "incorrect_code",
      subscriberId: row.subscriber_id,
      channel: "sms",
      attemptsRemaining: Math.max(0, MAX_CONFIRM_ATTEMPTS - attempts),
    };
  }

  const survivorId = await markConfirmed(tx, row);
  return { outcome: "confirmed", subscriberId: survivorId, channel: "sms" };
}

/** Whether this number has an already-confirmed SMS channel. */
async function spentSmsExists(tx: Transaction, phoneNumber: string): Promise<boolean> {
  const req = new sql.Request(tx);
  req.input("phone", sql.NVarChar(20), phoneNumber);
  const result = await req.query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM Subscribers
      WHERE phone_number = @phone AND sms_status = 'confirmed' AND merged_into IS NULL`,
  );
  return (result.recordset[0]?.n ?? 0) > 0;
}

/** Count one wrong code against a confirmation; returns the new total. */
async function countAttempt(tx: Transaction, confirmationId: string): Promise<number> {
  const req = new sql.Request(tx);
  req.input("id", sql.UniqueIdentifier, confirmationId);
  const result = await req.query<{ attempts: number }>(
    `UPDATE SubscriberConfirmations
        SET attempts = attempts + 1, last_attempt_at = SYSUTCDATETIME()
      OUTPUT INSERTED.attempts
      WHERE confirmation_id = @id`,
  );
  return result.recordset[0]?.attempts ?? 0;
}

// Spend the token and confirm its channel. The channel's own column is set -
// never the record's status alone, which is what migration 117 exists to keep
// apart - and the record is promoted to 'confirmed' at the same time, since a
// record with a confirmed channel is by definition confirmed.
//
// opted_in_at is the FIRST confirmation, not the latest: it is the date the
// consent record rests on, and a second channel confirming months later does
// not change when this person agreed.
async function markConfirmed(tx: Transaction, row: ConfirmationRow): Promise<string> {
  const spend = new sql.Request(tx);
  spend.input("id", sql.UniqueIdentifier, row.confirmation_id);
  await spend.query(
    `UPDATE SubscriberConfirmations
        SET confirmed_at = SYSUTCDATETIME(), last_attempt_at = SYSUTCDATETIME()
      WHERE confirmation_id = @id`,
  );

  const column = row.channel === "sms" ? "sms_status" : "email_status";
  const promote = new sql.Request(tx);
  promote.input("id", sql.UniqueIdentifier, row.subscriber_id);
  await promote.query(
    `UPDATE Subscribers
        SET ${column} = 'confirmed',
            status = 'confirmed',
            opted_in_at = COALESCE(opted_in_at, SYSUTCDATETIME())
      WHERE subscriber_id = @id`,
  );

  // The contact is proven as of this statement, which is the only moment its
  // duplicates can be resolved on a fact rather than on a claim. Inside the
  // same transaction, so a confirmation and its merge are one event.
  const merge = await mergeOnConfirm(tx, row.subscriber_id, row.channel);
  return merge.survivorId;
}

export type OptOutReason = "sms_stop" | "email_link" | "staff";

export interface OptOutResult {
  /** Subscriber rows whose channel this changed. Zero is a normal answer. */
  changed: number;
}

/**
 * Stop one channel for a contact.
 *
 * SCOPE IS THE CHANNEL, NOT THE PERSON. A rider who texts STOP has asked to
 * stop being texted; they have not asked to stop being emailed, and silently
 * cancelling an email subscription they still want is a worse failure than
 * leaving it running. The record is only opted out once no channel is left.
 *
 * EVERY row for the contact is affected, not one. Duplicate subscriber records
 * for the same number are possible until increment 4 merges them, and a STOP
 * that stopped only one of them would keep texting.
 *
 * Idempotent, and a contact that matches nothing is not an error: ACS relays
 * STOP from any number, including numbers that never subscribed.
 */
export async function optOut(
  tx: Transaction,
  channel: Channel,
  contact: string,
  reason: OptOutReason,
): Promise<OptOutResult> {
  const column = channel === "sms" ? "sms_status" : "email_status";
  const matchOn = channel === "sms" ? "phone_number" : "email";
  const other = channel === "sms" ? "email_status" : "sms_status";

  const req = new sql.Request(tx);
  req.input("contact", sql.NVarChar(320), contact);
  req.input("reason", sql.NVarChar(30), reason);
  const result = await req.query<{ changed: number }>(
    `UPDATE Subscribers
        SET ${column} = 'unsubscribed',
            -- Only once nothing is left to send on. A subscriber with a live
            -- email channel is still a subscriber.
            status = CASE WHEN ${other} IS NULL OR ${other} = 'unsubscribed' THEN 'opted_out' ELSE status END,
            opted_out_at = CASE WHEN ${other} IS NULL OR ${other} = 'unsubscribed' THEN SYSUTCDATETIME() ELSE opted_out_at END,
            opted_out_reason = CASE WHEN ${other} IS NULL OR ${other} = 'unsubscribed' THEN @reason ELSE opted_out_reason END
      WHERE ${matchOn} = @contact
        AND merged_into IS NULL
        AND (${column} IS NULL OR ${column} <> 'unsubscribed');
      SELECT @@ROWCOUNT AS changed;`,
  );

  // Any confirmation still outstanding for that channel is pointless now, and
  // leaving it live would let a rider confirm a channel they just stopped.
  const drop = new sql.Request(tx);
  drop.input("contact", sql.NVarChar(320), contact);
  drop.input("channel", sql.NVarChar(10), channel);
  await drop.query(
    `UPDATE c
        SET c.superseded_at = SYSUTCDATETIME()
       FROM SubscriberConfirmations c
       JOIN Subscribers s ON s.subscriber_id = c.subscriber_id
      WHERE s.${matchOn} = @contact
        AND c.channel = @channel
        AND c.confirmed_at IS NULL
        AND c.superseded_at IS NULL`,
  );

  return { changed: result.recordset[0]?.changed ?? 0 };
}

/** A rider may ask for another token this often, per channel. */
export const RESEND_COOLDOWN_MS = 2 * 60 * 1000;

export type ResendOutcome =
  /** A fresh token was written; the caller must publish it after committing. */
  | "issued"
  /** Something was sent to this contact within the cooldown. */
  | "too_soon"
  /** No subscriber with this contact has that channel awaiting confirmation. */
  | "nothing_to_send";

export interface ResendResult {
  outcome: ResendOutcome;
  subscriberId?: string;
  issued?: IssuedConfirmation;
}

/**
 * Issue a replacement token for a contact that is still awaiting confirmation.
 *
 * A rider whose code never arrived, or who let it expire, has no other way
 * back in - the opt-in form would create a second subscriber rather than
 * re-sending to the first. So this path is required. It is also, unbounded, a
 * free SMS-sending oracle pointed at any number its caller likes, so it is
 * capped by time rather than by a counter: the cap has to apply to a caller
 * who never sees the result, and a per-token attempt count does not, since a
 * new token would reset it.
 *
 * The cooldown is measured from the last token ISSUED for that channel,
 * whatever became of it. Measuring from the live one only would let a caller
 * alternate resend and confirm-with-a-wrong-code to keep the queue busy.
 *
 * SUPERSEDE, THEN ISSUE. The old token stops working the moment the new one
 * exists; two live codes for one number would mean the attempt cap could be
 * dodged by guessing against whichever row a lookup happened to find first.
 * The order also matters to UX_SubConfirm_Channel_Token, which is filtered to
 * live rows: issuing first leaves two live rows for the channel, and a redraw
 * that collided with the token being retired would fail against an index entry
 * that was about to disappear.
 *
 * Only a channel in `pending_confirmation` is resent to. An unsubscribed
 * channel must not be revived by asking, and a confirmed one has nothing left
 * to prove.
 */
export async function resendConfirmation(
  tx: Transaction,
  channel: Channel,
  contact: string,
  context?: InvocationContext,
): Promise<ResendResult> {
  const matchOn = channel === "sms" ? "phone_number" : "email";
  const statusColumn = channel === "sms" ? "sms_status" : "email_status";

  // The subscriber to resend to, and when this channel last had a token sent.
  // Duplicate rows for one contact are possible until they are merged on
  // confirmation (increment 4); the newest signup is the one the rider is
  // waiting on, and resending to every duplicate would multiply the send.
  const find = new sql.Request(tx);
  find.input("contact", sql.NVarChar(320), contact);
  find.input("channel", sql.NVarChar(10), channel);
  const found = await find.query<{ subscriber_id: string; last_issued_at: Date | null }>(
    `SELECT TOP 1 s.subscriber_id,
            (SELECT MAX(c.created_at) FROM SubscriberConfirmations c
              WHERE c.subscriber_id = s.subscriber_id AND c.channel = @channel) AS last_issued_at
       FROM Subscribers s WITH(UPDLOCK, HOLDLOCK)
      WHERE s.${matchOn} = @contact
        AND s.${statusColumn} = 'pending_confirmation'
        -- A merged record keeps its channel columns as history; reissuing
        -- against one would send a code that confirms a record no audience
        -- query can see.
        AND s.merged_into IS NULL
      ORDER BY last_issued_at DESC`,
  );
  const row = found.recordset[0];
  if (!row) return { outcome: "nothing_to_send" };

  const lastIssued = row.last_issued_at;
  if (lastIssued && Date.now() - lastIssued.getTime() < RESEND_COOLDOWN_MS) {
    return { outcome: "too_soon", subscriberId: row.subscriber_id };
  }

  const supersede = new sql.Request(tx);
  supersede.input("id", sql.UniqueIdentifier, row.subscriber_id);
  supersede.input("channel", sql.NVarChar(10), channel);
  await supersede.query(
    `UPDATE SubscriberConfirmations
        SET superseded_at = SYSUTCDATETIME()
      WHERE subscriber_id = @id
        AND channel = @channel
        AND confirmed_at IS NULL
        AND superseded_at IS NULL`,
  );

  const issued = await issueConfirmation(tx, row.subscriber_id, channel, context);
  return { outcome: "issued", subscriberId: row.subscriber_id, issued };
}

// --- Merging duplicate records on confirmation (CURRENT_STATE 7.5) -----------
//
// The contact indexes are not unique, so opting in twice with the same number
// creates two records. Nothing could confirm one until increment 3, so the
// duplication was harmless; now it means the same person gets every alert
// twice.
//
// Confirmation is the right moment to resolve it, and the only one. Before it,
// nobody has proved they own the contact: refusing a second opt-in at the form
// would let a stranger who types your number stop you subscribing, and merging
// two unproven records would merge on a claim rather than on a fact. At
// confirmation the contact is proven, so the records that hold it are known to
// belong to one person.

/**
 * Combine two stored audience values.
 *
 * Each is a JSON array, the literal "ALL", or NULL - the three shapes
 * `serializeAudience` writes. "ALL" wins over everything, because a rider who
 * asked for every route on either record has asked for every route. NULL means
 * "not specified" and yields to a value rather than erasing it.
 *
 * The union is deliberate and not "the newer one wins": both records were
 * created by the same proven person, and each list is something they asked
 * for. Dropping either would silently narrow a subscription they chose.
 */
export function unionAudience(a: string | null, b: string | null): string | null {
  if (a === "ALL" || b === "ALL") return "ALL";
  const left = parseList(a);
  const right = parseList(b);
  if (!left && !right) return a ?? b;
  const merged = [...(left ?? [])];
  for (const value of right ?? []) if (!merged.includes(value)) merged.push(value);
  return JSON.stringify(merged);
}

/** A stored JSON array, or null when the value is absent or not one. */
function parseList(value: string | null): string[] | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : null;
  } catch {
    // Not readable as a list. Treated as absent rather than thrown, because
    // the alternative is a confirmation failing on the shape of a column the
    // rider cannot see or fix.
    return null;
  }
}

export interface MergeResult {
  /** The record that now carries this contact. The confirmed one, always. */
  survivorId: string;
  /** Records folded into it. */
  mergedIds: string[];
}

const CONTACT_COLUMN = { sms: "phone_number", email: "email" } as const;
const STATUS_COLUMN = { sms: "sms_status", email: "email_status" } as const;

interface DuplicateRow {
  subscriber_id: string;
  phone_number: string | null;
  email: string | null;
  routes: string | null;
  zones: string | null;
  categories: string;
  status: string;
  sms_status: string | null;
  email_status: string | null;
  opted_in_at: Date | null;
}

/**
 * Fold the duplicates of a just-confirmed contact together.
 *
 * Runs inside the confirming transaction, so a half-merged pair - two records
 * both live, or one pointing at a survivor that was never updated - cannot be
 * committed.
 *
 * THE SURVIVOR IS THE RECORD THAT WAS ALREADY CONFIRMED on this channel, not
 * the one confirming now. It carries `opted_in_at`, the date the consent
 * record rests on, and its delivery history refers to it by id. The record
 * confirming now is the newcomer even though it is the one in hand.
 *
 * An opted-out record is never a survivor. A rider who stopped alerts and
 * later subscribed again has given fresh consent on a new record, and folding
 * that into the stopped one would discard it.
 *
 * Only categories, routes and zones move. A contact moves only into an empty
 * slot - if the survivor has no email and the merged record has one, the
 * address and its unconfirmed state come across and its live confirmation is
 * repointed, so the link already in that rider's inbox still works. Where both
 * hold a value, the survivor's stands: it is the established record, and
 * overwriting a proven contact with an unproven one is the one move here that
 * could send to a stranger.
 */
export async function mergeOnConfirm(
  tx: Transaction,
  subscriberId: string,
  channel: Channel,
): Promise<MergeResult> {
  const contactColumn = CONTACT_COLUMN[channel];
  const statusColumn = STATUS_COLUMN[channel];

  const self = await readSubscriber(tx, subscriberId);
  const contact = channel === "sms" ? self?.phone_number : self?.email;
  if (!self || !contact) return { survivorId: subscriberId, mergedIds: [] };

  // Every other record holding this contact, oldest consent first.
  const find = new sql.Request(tx);
  find.input("self", sql.UniqueIdentifier, subscriberId);
  find.input("contact", sql.NVarChar(320), contact);
  const others = await find.query<DuplicateRow>(
    `SELECT subscriber_id, phone_number, email, routes, zones, categories,
            status, sms_status, email_status, opted_in_at
       FROM Subscribers WITH(UPDLOCK, HOLDLOCK)
      WHERE ${contactColumn} = @contact
        AND subscriber_id <> @self
        AND merged_into IS NULL
      ORDER BY COALESCE(opted_in_at, '9999-12-31') ASC`,
  );

  const survivor =
    others.recordset.find(
      (row) => row[statusColumn] === "confirmed" && row.status !== "opted_out",
    ) ?? null;

  if (survivor) {
    await foldInto(tx, survivor.subscriber_id, self);
    // Anything else holding this contact and never confirmed is retired too,
    // so one confirmation resolves the whole set rather than leaving a third
    // record to be discovered later.
    const alsoMerged = [self.subscriber_id];
    for (const row of others.recordset) {
      if (row.subscriber_id === survivor.subscriber_id) continue;
      if (row.status !== "pending_confirmation") {
        await voidConfirmationsFor(tx, row.subscriber_id, channel);
        continue;
      }
      // Retired WITHOUT its preferences, unlike the record that just
      // confirmed. Nobody ever proved that record, so its category and route
      // choices are a claim rather than a decision, and a stranger who typed
      // this contact into the form could otherwise widen a real subscriber's
      // alerts by picking everything.
      await retire(tx, row.subscriber_id, survivor.subscriber_id);
      alsoMerged.push(row.subscriber_id);
    }
    return { survivorId: survivor.subscriber_id, mergedIds: alsoMerged };
  }

  // Nothing else has confirmed this contact, so the record in hand is the
  // survivor.
  const mergedIds: string[] = [];
  for (const row of others.recordset) {
    if (row.status !== "pending_confirmation") {
      // Confirmed on its OTHER channel, so it is a real subscription and must
      // not be folded away - but this contact now belongs to the record that
      // proved it, and a second record must never confirm it as well. Its
      // outstanding token for this channel is voided; the rider has already
      // confirmed the contact, on the record that kept it.
      await voidConfirmationsFor(tx, row.subscriber_id, channel);
      continue;
    }
    // Entirely unconfirmed, so its preferences do not travel - same rule as
    // the branch above.
    await retire(tx, row.subscriber_id, subscriberId);
    mergedIds.push(row.subscriber_id);
  }
  return { survivorId: subscriberId, mergedIds };
}

async function readSubscriber(tx: Transaction, id: string): Promise<DuplicateRow | null> {
  const req = new sql.Request(tx);
  req.input("id", sql.UniqueIdentifier, id);
  const result = await req.query<DuplicateRow>(
    `SELECT subscriber_id, phone_number, email, routes, zones, categories,
            status, sms_status, email_status, opted_in_at
       FROM Subscribers WITH(UPDLOCK, HOLDLOCK)
      WHERE subscriber_id = @id`,
  );
  return result.recordset[0] ?? null;
}

/**
 * Move `loser`'s preferences and any contact the survivor lacks, then retire it.
 *
 * The survivor is re-read here rather than passed in. Three records holding
 * one contact means this runs twice, and the second call working from the row
 * as it looked before the first would write the second union over the first -
 * silently dropping whichever list the first fold had just brought across.
 */
async function foldInto(tx: Transaction, survivorId: string, loser: DuplicateRow): Promise<void> {
  const survivor = await readSubscriber(tx, survivorId);
  if (!survivor) return;
  const takePhone = !survivor.phone_number && !!loser.phone_number;
  const takeEmail = !survivor.email && !!loser.email;

  const update = new sql.Request(tx);
  update.input("id", sql.UniqueIdentifier, survivor.subscriber_id);
  update.input("routes", sql.NVarChar, unionAudience(survivor.routes, loser.routes));
  update.input("zones", sql.NVarChar, unionAudience(survivor.zones, loser.zones));
  update.input("categories", sql.NVarChar, unionAudience(survivor.categories, loser.categories));
  update.input("phone", sql.NVarChar(20), takePhone ? loser.phone_number : null);
  update.input("sms_status", sql.NVarChar(30), takePhone ? loser.sms_status : null);
  update.input("email", sql.NVarChar(320), takeEmail ? loser.email : null);
  update.input("email_status", sql.NVarChar(30), takeEmail ? loser.email_status : null);
  await update.query(
    `UPDATE Subscribers
        SET routes = @routes,
            zones = @zones,
            categories = @categories,
            phone_number = COALESCE(@phone, phone_number),
            sms_status = COALESCE(@sms_status, sms_status),
            email = COALESCE(@email, email),
            email_status = COALESCE(@email_status, email_status)
      WHERE subscriber_id = @id`,
  );

  // A channel that came across brings its outstanding token with it, so the
  // link already sitting in that rider's inbox confirms the survivor instead
  // of a record that no longer exists to them.
  if (takePhone) await repointConfirmations(tx, loser.subscriber_id, survivor.subscriber_id, "sms");
  if (takeEmail) await repointConfirmations(tx, loser.subscriber_id, survivor.subscriber_id, "email");

  await retire(tx, loser.subscriber_id, survivor.subscriber_id);
}

/** Point a record at its survivor and kill whatever tokens it still had out. */
async function retire(tx: Transaction, id: string, into: string): Promise<void> {
  await markMerged(tx, id, into);
  await voidAllConfirmations(tx, id);
}

async function markMerged(tx: Transaction, id: string, into: string): Promise<void> {
  const req = new sql.Request(tx);
  req.input("id", sql.UniqueIdentifier, id);
  req.input("into", sql.UniqueIdentifier, into);
  await req.query(
    `UPDATE Subscribers
        SET status = 'merged', merged_into = @into, merged_at = SYSUTCDATETIME()
      WHERE subscriber_id = @id`,
  );
}

async function repointConfirmations(
  tx: Transaction,
  from: string,
  to: string,
  channel: Channel,
): Promise<void> {
  const req = new sql.Request(tx);
  req.input("from", sql.UniqueIdentifier, from);
  req.input("to", sql.UniqueIdentifier, to);
  req.input("channel", sql.NVarChar(10), channel);
  await req.query(
    `UPDATE SubscriberConfirmations
        SET subscriber_id = @to
      WHERE subscriber_id = @from
        AND channel = @channel
        AND confirmed_at IS NULL
        AND superseded_at IS NULL`,
  );
}

/** Void whatever tokens a retired record still had out. */
async function voidAllConfirmations(tx: Transaction, id: string): Promise<void> {
  const req = new sql.Request(tx);
  req.input("id", sql.UniqueIdentifier, id);
  await req.query(
    `UPDATE SubscriberConfirmations
        SET superseded_at = SYSUTCDATETIME()
      WHERE subscriber_id = @id
        AND confirmed_at IS NULL
        AND superseded_at IS NULL`,
  );
}

/** Void one channel's outstanding tokens on a record that is staying. */
async function voidConfirmationsFor(tx: Transaction, id: string, channel: Channel): Promise<void> {
  const req = new sql.Request(tx);
  req.input("id", sql.UniqueIdentifier, id);
  req.input("channel", sql.NVarChar(10), channel);
  await req.query(
    `UPDATE SubscriberConfirmations
        SET superseded_at = SYSUTCDATETIME()
      WHERE subscriber_id = @id
        AND channel = @channel
        AND confirmed_at IS NULL
        AND superseded_at IS NULL`,
  );
}
