import type { Transaction } from "mssql";
import { sql } from "./db";
import { issueConfirmation, CONFIRM_TTL_HOURS } from "./confirmationTokens";
import type { ConfirmationRequestedEvent } from "./types";

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
  await markConfirmed(tx, row!);
  return { outcome: "confirmed", subscriberId: row!.subscriber_id, channel: "email" };
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
    // A rider who was resent a code is holding two texts, and the older one
    // still looks current. Before counting this as a guess, check whether it
    // is a code we really did send to this number - and if so say which state
    // it is in rather than "wrong code", and do not spend an attempt on it.
    //
    // This gives a guesser nothing: reaching it means naming a code that was
    // actually issued to this number, which is exactly as hard as naming the
    // live one.
    const stale = await findSpentSmsToken(tx, phoneNumber, code);
    if (stale) {
      return { outcome: stale, subscriberId: row.subscriber_id, channel: "sms" };
    }

    const attempts = await countAttempt(tx, row.confirmation_id);
    return {
      outcome: "incorrect_code",
      subscriberId: row.subscriber_id,
      channel: "sms",
      attemptsRemaining: Math.max(0, MAX_CONFIRM_ATTEMPTS - attempts),
    };
  }

  await markConfirmed(tx, row);
  return { outcome: "confirmed", subscriberId: row.subscriber_id, channel: "sms" };
}

/**
 * A code this number was genuinely sent, which is no longer the live one.
 * Returns how it was spent, or null if we never sent this code to this number.
 */
async function findSpentSmsToken(
  tx: Transaction,
  phoneNumber: string,
  code: string,
): Promise<"already_confirmed" | "superseded" | null> {
  const req = new sql.Request(tx);
  req.input("phone", sql.NVarChar(20), phoneNumber);
  req.input("token", sql.NVarChar(100), code);
  const found = await req.query<{ confirmed_at: Date | null }>(
    `SELECT TOP 1 c.confirmed_at
       FROM SubscriberConfirmations c
       JOIN Subscribers s ON s.subscriber_id = c.subscriber_id
      WHERE c.channel = 'sms' AND s.phone_number = @phone AND c.token = @token
        AND (c.confirmed_at IS NOT NULL OR c.superseded_at IS NOT NULL)
      ORDER BY c.created_at DESC`,
  );
  const row = found.recordset[0];
  if (!row) return null;
  return row.confirmed_at ? "already_confirmed" : "superseded";
}

/** Whether this number has an already-confirmed SMS channel. */
async function spentSmsExists(tx: Transaction, phoneNumber: string): Promise<boolean> {
  const req = new sql.Request(tx);
  req.input("phone", sql.NVarChar(20), phoneNumber);
  const result = await req.query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM Subscribers WHERE phone_number = @phone AND sms_status = 'confirmed'`,
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
async function markConfirmed(tx: Transaction, row: ConfirmationRow): Promise<void> {
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

// --- Resend -----------------------------------------------------------------

/**
 * How long a rider must wait before a new token is issued for the same channel.
 *
 * A resend endpoint with no floor is a free SMS-sending oracle: anyone who
 * knows a subscribed number can make OnBoard text it as fast as they can post.
 * Two minutes is long enough to make that pointless and short enough that a
 * rider who genuinely did not get the first text is not left waiting.
 */
export const RESEND_MIN_INTERVAL_MS = 2 * 60 * 1000;

export type ResendOutcome =
  /** A new token exists and its event should be published after the commit. */
  | "issued"
  /** A live token was issued less than RESEND_MIN_INTERVAL_MS ago. */
  | "too_soon"
  /** No subscriber, or none with this channel still awaiting confirmation. */
  | "nothing_pending";

export interface ResendResult {
  outcome: ResendOutcome;
  /** Present on "issued", for the caller to publish once the transaction commits. */
  event?: ConfirmationRequestedEvent;
}

/**
 * Issue a fresh token for a channel that is still waiting, superseding the old
 * one.
 *
 * THE CALLER MUST ANSWER THE SAME WAY FOR ALL THREE OUTCOMES. They are
 * distinguished here so the caller knows whether to publish an event and so
 * the contract tests can tell them apart; distinguishing them in an HTTP
 * response would turn this endpoint into a way to ask whether any given phone
 * number or email address is partway through signing up.
 *
 * Superseding rather than adding: two live codes for one channel means a rider
 * holding two texts, either of which looks current, and only one of which
 * works.
 */
export async function requestResend(
  tx: Transaction,
  channel: Channel,
  contact: string,
  now: Date = new Date(),
): Promise<ResendResult> {
  const column = channel === "sms" ? "sms_status" : "email_status";
  const matchOn = channel === "sms" ? "phone_number" : "email";

  const find = new sql.Request(tx);
  find.input("contact", sql.NVarChar(320), contact);
  // A confirmed channel needs nothing, and an opted-out record must not be
  // sent anything at all - re-texting someone who asked us to stop, because
  // they typed their number into a form, is the failure this guards.
  const found = await find.query<{ subscriber_id: string; phone_number: string | null; email: string | null }>(
    `SELECT TOP 1 subscriber_id, phone_number, email
       FROM Subscribers WITH(UPDLOCK, HOLDLOCK)
      WHERE ${matchOn} = @contact
        AND status <> 'opted_out'
        AND ${column} = 'pending_confirmation'
      ORDER BY opted_in_at DESC, subscriber_id`,
  );
  const subscriber = found.recordset[0];
  if (!subscriber) return { outcome: "nothing_pending" };

  const live = new sql.Request(tx);
  live.input("id", sql.UniqueIdentifier, subscriber.subscriber_id);
  live.input("channel", sql.NVarChar(10), channel);
  const existing = await live.query<{ confirmation_id: string; created_at: Date }>(
    `SELECT confirmation_id, created_at
       FROM SubscriberConfirmations WITH(UPDLOCK, HOLDLOCK)
      WHERE subscriber_id = @id AND channel = @channel
        AND confirmed_at IS NULL AND superseded_at IS NULL
      ORDER BY created_at DESC`,
  );
  const newest = existing.recordset[0];
  if (newest && now.getTime() - newest.created_at.getTime() < RESEND_MIN_INTERVAL_MS) {
    return { outcome: "too_soon" };
  }

  for (const row of existing.recordset) {
    const supersede = new sql.Request(tx);
    supersede.input("id", sql.UniqueIdentifier, row.confirmation_id);
    await supersede.query(
      "UPDATE SubscriberConfirmations SET superseded_at = SYSUTCDATETIME() WHERE confirmation_id = @id",
    );
  }

  const issued = await issueConfirmation(
    tx,
    subscriber.subscriber_id,
    channel,
    new Date(now.getTime() + CONFIRM_TTL_HOURS * 3600_000),
  );

  return {
    outcome: "issued",
    event: {
      confirmation_id: issued.confirmation_id,
      subscriber_id: subscriber.subscriber_id,
      channel,
      token: issued.token,
      phone_number: subscriber.phone_number,
      email: subscriber.email,
    },
  };
}
