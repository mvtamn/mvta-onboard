// POST /subscribers - rider opt-in (architecture doc Section 9).
// Public + unauthenticated: this is the rider-facing opt-in form endpoint.
//
// Double opt-in: the subscriber is created 'pending_confirmation' and a
// short-lived token is issued per contact channel (a 6-digit code for SMS, an
// opaque link token for email). A "confirmation-requested" event is enqueued
// so the dispatch app sends it. NO alerts go to a channel until it's confirmed.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import crypto from "node:crypto";
import { getPool, sql } from "../lib/db";
import { validateSubscribe } from "../lib/validation";
import { publishConfirmationRequested } from "../lib/events";
import type { SubscribeBody } from "../lib/types";

const CONFIRM_TTL_HOURS = 24;

function makeSmsCode(): string {
  // 6-digit numeric code, zero-padded.
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

function makeEmailToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

function serializeAudience(value: string[] | "ALL" | null | undefined): string | null {
  // routes/zones accept an array or the literal "ALL".
  if (value === "ALL") return "ALL";
  if (Array.isArray(value)) return JSON.stringify(value);
  return null;
}

app.http("subscribersCreate", {
  route: "subscribers",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, context: InvocationContext) => {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return { status: 400, jsonBody: { error: "Request body must be valid JSON" } };
    }

    const errors = validateSubscribe(raw as Record<string, unknown>);
    if (errors.length > 0) {
      return { status: 400, jsonBody: { error: "Validation failed", details: errors } };
    }
    // Shape proven by validateSubscribe above.
    const body = raw as SubscribeBody;

    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    try {
      await tx.begin();

      const insertSub = new sql.Request(tx);
      insertSub.input("phone_number", sql.NVarChar, body.phone_number || null);
      insertSub.input("email", sql.NVarChar, body.email || null);
      insertSub.input("routes", sql.NVarChar, serializeAudience(body.routes));
      insertSub.input("zones", sql.NVarChar, serializeAudience(body.zones));
      insertSub.input("categories", sql.NVarChar, JSON.stringify(body.categories));
      insertSub.input("email_status", sql.NVarChar, body.email ? "pending_confirmation" : null);
      insertSub.input("consent_source", sql.NVarChar, body.consent_source);

      const subResult = await insertSub.query<{ subscriber_id: string }>(`
        INSERT INTO Subscribers (
          phone_number, email, routes, zones, categories,
          status, email_status, consent_source
        )
        OUTPUT INSERTED.subscriber_id
        VALUES (
          @phone_number, @email, @routes, @zones, @categories,
          'pending_confirmation', @email_status, @consent_source
        )
      `);
      const subscriberId = subResult.recordset[0].subscriber_id;

      // Issue one confirmation token per provided channel.
      const channels: { channel: "sms" | "email"; token: string }[] = [];
      if (body.phone_number) channels.push({ channel: "sms", token: makeSmsCode() });
      if (body.email) channels.push({ channel: "email", token: makeEmailToken() });

      const expiresAt = new Date(Date.now() + CONFIRM_TTL_HOURS * 3600_000);
      const confirmations: { confirmation_id: string; channel: "sms" | "email"; token: string }[] = [];
      for (const c of channels) {
        const insertConf = new sql.Request(tx);
        insertConf.input("subscriber_id", sql.UniqueIdentifier, subscriberId);
        insertConf.input("channel", sql.NVarChar, c.channel);
        insertConf.input("token", sql.NVarChar, c.token);
        insertConf.input("expires_at", sql.DateTime2, expiresAt);
        const confResult = await insertConf.query<{ confirmation_id: string }>(`
          INSERT INTO SubscriberConfirmations (subscriber_id, channel, token, expires_at)
          OUTPUT INSERTED.confirmation_id
          VALUES (@subscriber_id, @channel, @token, @expires_at)
        `);
        confirmations.push({
          confirmation_id: confResult.recordset[0].confirmation_id,
          channel: c.channel,
          token: c.token,
        });
      }

      await tx.commit();

      // Enqueue confirmation sends (best-effort - the record already exists, so
      // the rider can re-request a code if delivery lags).
      for (const conf of confirmations) {
        await publishConfirmationRequested(
          {
            confirmation_id: conf.confirmation_id,
            subscriber_id: subscriberId,
            channel: conf.channel,
            token: conf.token,
            phone_number: body.phone_number || null,
            email: body.email || null,
          },
          context,
        );
      }

      return {
        status: 201,
        jsonBody: {
          subscriber_id: subscriberId,
          status: "pending_confirmation",
          channels: confirmations.map((c) => c.channel),
        },
      };
    } catch (err) {
      try {
        await tx.rollback();
      } catch {
        /* already rolled back / not begun */
      }
      context.error("POST /subscribers failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
