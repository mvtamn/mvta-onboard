import type { Transaction } from "mssql";
import crypto from "node:crypto";
import { sql } from "./db";
import type { Channel } from "./subscriberConfirmation";

// Issuing a confirmation token. Shared by opt-in (subscribersCreate) and
// resend, which both have to draw a token, survive a collision and insert the
// row - and which would otherwise hold two copies of the redraw loop that only
// one of them was ever tested with.

export const CONFIRM_TTL_HOURS = 24;

/** 6-digit numeric code, zero-padded. Short because a rider types it back. */
export function makeSmsCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Opaque URL-safe token for an email link. Long because nothing types it. */
export function makeEmailToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

// A six-digit code has a million values and UX_SubConfirm_Channel_Token
// (migration 117) requires it to be unique among the live SMS confirmations.
// Two riders can draw the same one, and that collision is the second rider's
// request failing for a reason that has nothing to do with them. Drawing again
// is the whole fix.
const CODE_ATTEMPTS = 3;

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
 * An email token is 24 random bytes, so a duplicate there is a signal rather
 * than a draw and is left to surface.
 */
export async function issueConfirmation(
  tx: Transaction,
  subscriberId: string,
  channel: Channel,
  expiresAt: Date,
  onCollision?: (attempt: number) => void,
): Promise<IssuedConfirmation> {
  let token = channel === "sms" ? makeSmsCode() : makeEmailToken();

  for (let attempt = 1; ; attempt++) {
    const insert = new sql.Request(tx);
    insert.input("subscriber_id", sql.UniqueIdentifier, subscriberId);
    insert.input("channel", sql.NVarChar(10), channel);
    insert.input("token", sql.NVarChar(100), token);
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
      onCollision?.(attempt);
      token = makeSmsCode();
    }
  }
}
