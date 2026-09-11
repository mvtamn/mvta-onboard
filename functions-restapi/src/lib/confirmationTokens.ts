// Issuing a confirmation token, and writing the row that holds it.
//
// Two places issue tokens - opting in (`subscribersCreate`) and asking for
// another one (`subscribersConfirm`'s resend) - and they must issue them the
// same way. The collision retry below is the reason this is one module rather
// than two copies: an SMS code is six digits, UX_SubConfirm_Channel_Token
// (migration 117) requires it to be unique among the SMS confirmations that
// are still live, and a copy that forgot to redraw would answer 500 to a rider
// whose only mistake was opting in at the same moment as someone else.
import crypto from "node:crypto";
import type { InvocationContext } from "@azure/functions";
import type { Transaction } from "mssql";
import { sql } from "./db";
import type { Channel } from "./subscriberConfirmation";

/** How long a freshly issued token is good for. */
export const CONFIRM_TTL_HOURS = 24;

/** Redraws allowed when a six-digit code collides with a live one. */
const CODE_ATTEMPTS = 3;

/** 6-digit numeric code, zero-padded. Short because a rider types it back. */
export function makeSmsCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

/** 24 random bytes. Long because nothing stops a link token being guessed at. */
export function makeEmailToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export function makeToken(channel: Channel): string {
  return channel === "sms" ? makeSmsCode() : makeEmailToken();
}

function isDuplicateKey(err: unknown): boolean {
  // 2627 unique constraint, 2601 unique index.
  const number = (err as { number?: number } | null)?.number;
  return number === 2627 || number === 2601;
}

export interface IssuedConfirmation {
  confirmation_id: string;
  channel: Channel;
  token: string;
}

/**
 * Insert one confirmation row, redrawing a colliding SMS code.
 *
 * Only an SMS code can realistically collide. An email token is 24 random
 * bytes, so a duplicate there is a signal rather than a draw - something is
 * repeating tokens - and is left to surface instead of being retried away.
 */
export async function issueConfirmation(
  tx: Transaction,
  subscriberId: string,
  channel: Channel,
  context?: InvocationContext,
  ttlHours: number = CONFIRM_TTL_HOURS,
): Promise<IssuedConfirmation> {
  const expiresAt = new Date(Date.now() + ttlHours * 3600_000);
  let token = makeToken(channel);
  for (let attempt = 1; ; attempt++) {
    const insert = new sql.Request(tx);
    insert.input("subscriber_id", sql.UniqueIdentifier, subscriberId);
    insert.input("channel", sql.NVarChar, channel);
    insert.input("token", sql.NVarChar, token);
    insert.input("expires_at", sql.DateTime2, expiresAt);
    try {
      const result = await insert.query<{ confirmation_id: string }>(`
        INSERT INTO SubscriberConfirmations (subscriber_id, channel, token, expires_at)
        OUTPUT INSERTED.confirmation_id
        VALUES (@subscriber_id, @channel, @token, @expires_at)
      `);
      return { confirmation_id: result.recordset[0].confirmation_id, channel, token };
    } catch (err) {
      if (channel !== "sms" || !isDuplicateKey(err) || attempt >= CODE_ATTEMPTS) throw err;
      context?.warn(`SMS confirmation code collided (attempt ${attempt}); drawing another.`);
      token = makeSmsCode();
    }
  }
}
