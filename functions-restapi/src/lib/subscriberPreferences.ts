import type { Transaction } from "mssql";
import { sql } from "./db";
import { isManageKey, makeManageKey } from "./manageKey";
import { VALID_CATEGORIES, type ManageLinkRequestedEvent } from "./types";

// Reading and changing a rider's own subscription, authenticated by the manage
// key from migration 119.
//
// WHY THIS ASSIGNS AND NEVER UNIONS. `unionAudience` in subscriberConfirmation
// is right next door and is the wrong function to reach for. Merging two
// records is a guess about what one person meant across two signups, so
// widening is the safe direction. A rider editing their own preferences has
// said exactly what they want, and being able to narrow is most of the reason
// this page exists: today re-subscribing is the only preference-changing
// gesture a rider has, and it can only ever add.

/** Hops followed through merged_into before giving up. */
const MAX_MERGE_HOPS = 10;

export type Channel = "sms" | "email";

export interface SubscriberRecord {
  subscriber_id: string;
  phone_number: string | null;
  email: string | null;
  categories: string;
  routes: string | null;
  zones: string | null;
  status: string;
  sms_status: string | null;
  email_status: string | null;
  merged_into: string | null;
}

/**
 * The live record a manage key names.
 *
 * Follows `merged_into` to the survivor: a link mailed before a merge is
 * sitting in somebody's inbox, and migration 118 made that reachable. Answering
 * "no such key" to a rider holding a link we sent them is the failure this
 * avoids - and for an unsubscribe link, a failure with a compliance cost.
 *
 * The walk is bounded and cycle-checked even though `CK_Subscribers_MergedInto`
 * and the foreign key should make a loop impossible: this runs inside a
 * transaction, and the cost of being wrong about that is a request that never
 * returns while holding locks.
 */
export async function resolveManageKey(
  tx: Transaction,
  key: string,
): Promise<SubscriberRecord | null> {
  if (!isManageKey(key)) return null;

  const find = new sql.Request(tx);
  find.input("key", sql.NVarChar(64), key);
  let record = (await find.query<SubscriberRecord>(`${SELECT_RECORD} WHERE manage_key = @key`))
    .recordset[0];
  if (!record) return null;

  const seen = new Set<string>([record.subscriber_id]);
  for (let hop = 0; record.merged_into && hop < MAX_MERGE_HOPS; hop++) {
    if (seen.has(record.merged_into)) return null;
    seen.add(record.merged_into);
    const next = new sql.Request(tx);
    next.input("id", sql.UniqueIdentifier, record.merged_into);
    const survivor = (await next.query<SubscriberRecord>(`${SELECT_RECORD} WHERE subscriber_id = @id`))
      .recordset[0];
    if (!survivor) return null;
    record = survivor;
  }
  // Still merged after the bound: the chain is longer than anything a real
  // merge produces, so treat the key as unusable rather than guess.
  return record.merged_into ? null : record;
}

const SELECT_RECORD = `SELECT subscriber_id, phone_number, email, categories, routes, zones,
         status, sms_status, email_status, merged_into
    FROM Subscribers WITH(UPDLOCK, HOLDLOCK)`;

// A found link must not become a way to read somebody's contact details. The
// rider needs only enough to recognise which subscription they are looking at.

/** "+16125550123" -> "(•••) •••-0123" */
export function maskPhone(e164: string | null): string | null {
  if (!e164) return null;
  const last4 = e164.slice(-4);
  return `(•••) •••-${last4}`;
}

/** "rider.one@example.com" -> "r•••••••e@example.com" */
export function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at <= 0) return "•••";
  const local = email.slice(0, at);
  const domain = email.slice(at);
  if (local.length <= 2) return `${local[0]}•••${domain}`;
  return `${local[0]}${"•".repeat(Math.max(3, local.length - 2))}${local[local.length - 1]}${domain}`;
}

export type Audience = string[] | "ALL";

export function parseAudience(value: string | null): Audience {
  if (value === "ALL") return "ALL";
  if (!value) return "ALL";
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : "ALL";
  } catch {
    return "ALL";
  }
}

export function serializeAudience(value: Audience): string {
  return value === "ALL" ? "ALL" : JSON.stringify(value);
}

export interface PreferenceUpdate {
  categories: string[];
  routes: Audience;
  zones: Audience;
  /** Channels the rider wants to keep. A channel they have is stopped by omission. */
  channels: Channel[];
}

export interface PreferenceOptions {
  routeIds: string[];
  zoneIds: string[];
}

/**
 * Routes and zones in a body, checked against what is actually offered.
 *
 * Shared by the preference PUT and by opt-in (POST /subscribers), which has had
 * a route picker since 1.5.205. Both take a list from an anonymous caller, and
 * neither should store a value that dispatch will never match.
 */
export function audienceErrors(body: Record<string, unknown>, options: PreferenceOptions): string[] {
  const errors: string[] = [];
  for (const [field, offered] of [
    ["routes", options.routeIds],
    ["zones", options.zoneIds],
  ] as const) {
    const value = body[field];
    if (value === "ALL") continue;
    if (!Array.isArray(value)) {
      errors.push(`${field} must be an array or the string "ALL"`);
      continue;
    }
    if (value.length === 0) {
      // "No routes" and "all routes" are not the same thing, and an empty list
      // that quietly meant everything would be the worst possible reading of a
      // rider unticking every box.
      errors.push(`${field} must name at least one, or be "ALL"`);
      continue;
    }
    const unknown = value.filter((v) => !offered.includes(String(v)));
    if (unknown.length > 0) errors.push(`${field} contains unknown values: ${unknown.join(", ")}`);
  }
  return errors;
}

/**
 * Validate what a rider submitted.
 *
 * Routes and zones are checked against what the GET actually offered, not
 * against a hardcoded list: a route retired from the registry should stop being
 * selectable rather than becoming a stored value nothing will ever match.
 */
export function validatePreferenceUpdate(
  body: Record<string, unknown>,
  options: PreferenceOptions,
): string[] {
  const errors: string[] = [];

  if (!Array.isArray(body.categories) || body.categories.length === 0) {
    // Deliberately not treated as "send me nothing". A rider who wants nothing
    // is unsubscribing, which is its own endpoint, records a reason, and
    // rotates the key - none of which an empty array would do.
    errors.push("categories must name at least one kind of alert; to receive none, unsubscribe");
  } else {
    const bad = body.categories.filter((c) => !VALID_CATEGORIES.includes(c as never));
    if (bad.length > 0) errors.push(`categories contains invalid values: ${bad.join(", ")}`);
  }

  errors.push(...audienceErrors(body, options));

  if (!Array.isArray(body.channels)) {
    errors.push("channels must be an array");
  } else {
    const bad = body.channels.filter((c) => c !== "sms" && c !== "email");
    if (bad.length > 0) errors.push(`channels contains invalid values: ${bad.join(", ")}`);
  }

  return errors;
}

/** What the rider's subscription looks like, for the page and for the audit row. */
export interface PreferenceState {
  categories: string[];
  routes: Audience;
  zones: Audience;
  sms_status: string | null;
  email_status: string | null;
}

export function stateOf(record: SubscriberRecord): PreferenceState {
  let categories: string[] = [];
  try {
    const parsed = JSON.parse(record.categories) as unknown;
    if (Array.isArray(parsed)) categories = parsed as string[];
  } catch {
    /* a malformed row reads as no categories rather than throwing at a rider */
  }
  return {
    categories,
    routes: parseAudience(record.routes),
    zones: parseAudience(record.zones),
    sms_status: record.sms_status,
    email_status: record.email_status,
  };
}

async function recordChange(
  tx: Transaction,
  subscriberId: string,
  source: "rider_page" | "staff",
  before: PreferenceState,
  after: PreferenceState,
): Promise<void> {
  const req = new sql.Request(tx);
  req.input("id", sql.UniqueIdentifier, subscriberId);
  req.input("source", sql.NVarChar(20), source);
  req.input("before", sql.NVarChar(sql.MAX), JSON.stringify(before));
  req.input("after", sql.NVarChar(sql.MAX), JSON.stringify(after));
  await req.query(
    `INSERT INTO SubscriberPreferenceChanges (subscriber_id, source, before_state, after_state)
     VALUES (@id, @source, @before, @after)`,
  );
}

export type WriteOutcome = "updated" | "opted_out" | "channel_stopped" | "not_found";

/**
 * Replace a rider's preferences.
 *
 * A record that opted out is refused rather than updated. Coming back is a new
 * consent, and the record of when someone agreed is the thing a TCPA complaint
 * turns on; quietly reviving them from a link in an old email would replace a
 * consent record with a click.
 *
 * Stopping a channel here does NOT rotate the manage key, unlike unsubscribing:
 * the rider is still subscribed and still needs the link in their next alert
 * to work.
 */
export async function writePreferences(
  tx: Transaction,
  record: SubscriberRecord,
  update: PreferenceUpdate,
): Promise<WriteOutcome> {
  if (record.status === "opted_out") return "opted_out";

  const before = stateOf(record);
  const keep = new Set(update.channels);

  // A stopped channel is refused, not turned back on. This used to put it back
  // to "waiting for confirmation" - and send nothing to confirm it, so the
  // rider waited on a link or code that was never coming. Sending one from
  // here would not be right either: this endpoint is reached from a link, not
  // from a form with a consent statement, and a channel someone stopped - by
  // texting STOP or on this page - needs fresh consent to resume. Signing up
  // again is that path, and it does restore delivery: the new record confirms
  // the contact, and because the old record's channel is no longer confirmed,
  // mergeOnConfirm keeps the new record instead of folding it away.
  if (
    (keep.has("sms") && record.sms_status === "unsubscribed") ||
    (keep.has("email") && record.email_status === "unsubscribed")
  ) {
    return "channel_stopped";
  }

  // A channel the rider does not have stays null: there is nothing to send on,
  // which is not the same as having stopped it.
  const smsStatus = record.sms_status === null
    ? null
    : keep.has("sms")
      ? record.sms_status
      : "unsubscribed";
  const emailStatus = record.email_status === null
    ? null
    : keep.has("email")
      ? record.email_status
      : "unsubscribed";

  const write = new sql.Request(tx);
  write.input("id", sql.UniqueIdentifier, record.subscriber_id);
  write.input("categories", sql.NVarChar(sql.MAX), JSON.stringify(update.categories));
  write.input("routes", sql.NVarChar(sql.MAX), serializeAudience(update.routes));
  write.input("zones", sql.NVarChar(sql.MAX), serializeAudience(update.zones));
  write.input("sms_status", sql.NVarChar(30), smsStatus);
  write.input("email_status", sql.NVarChar(30), emailStatus);
  // If both channels end up stopped the record is opted out, the same rule
  // optOut applies: a subscriber with nothing to send on is not a subscriber.
  const nothingLeft =
    (smsStatus === null || smsStatus === "unsubscribed") &&
    (emailStatus === null || emailStatus === "unsubscribed");
  write.input("status", sql.NVarChar(30), nothingLeft ? "opted_out" : record.status);
  write.input("reason", sql.NVarChar(30), nothingLeft ? "email_link" : null);
  await write.query(
    `UPDATE Subscribers
        SET categories = @categories, routes = @routes, zones = @zones,
            sms_status = @sms_status, email_status = @email_status,
            status = @status,
            opted_out_at = CASE WHEN @status = 'opted_out' THEN SYSUTCDATETIME() ELSE opted_out_at END,
            opted_out_reason = COALESCE(@reason, opted_out_reason)
      WHERE subscriber_id = @id`,
  );

  await recordChange(tx, record.subscriber_id, "rider_page", before, {
    categories: update.categories,
    routes: update.routes,
    zones: update.zones,
    sms_status: smsStatus,
    email_status: emailStatus,
  });
  return "updated";
}

export interface UnsubscribeResult {
  /** The key is rotated, so the link that did this stops working. */
  rotated: boolean;
}

/**
 * Stop everything for this subscriber, and rotate the key.
 *
 * Rotation is the whole reason unsubscribing is its own endpoint rather than a
 * `PUT` with no channels: someone who has left must not be re-enrollable from
 * the link still sitting in their inbox, and that is the one case where a
 * long-lived key would otherwise be a liability.
 */
export async function unsubscribeAll(
  tx: Transaction,
  record: SubscriberRecord,
): Promise<UnsubscribeResult> {
  const before = stateOf(record);
  const smsStatus = record.sms_status === null ? null : "unsubscribed";
  const emailStatus = record.email_status === null ? null : "unsubscribed";

  const write = new sql.Request(tx);
  write.input("id", sql.UniqueIdentifier, record.subscriber_id);
  write.input("sms_status", sql.NVarChar(30), smsStatus);
  write.input("email_status", sql.NVarChar(30), emailStatus);
  write.input("key", sql.NVarChar(64), makeManageKey());
  await write.query(
    `UPDATE Subscribers
        SET sms_status = @sms_status, email_status = @email_status,
            status = 'opted_out',
            opted_out_at = COALESCE(opted_out_at, SYSUTCDATETIME()),
            opted_out_reason = COALESCE(opted_out_reason, 'email_link'),
            manage_key = @key, manage_key_issued_at = SYSUTCDATETIME()
      WHERE subscriber_id = @id`,
  );

  // Any outstanding confirmation is pointless now, and leaving one live would
  // let a rider confirm a channel they just stopped.
  const drop = new sql.Request(tx);
  drop.input("id", sql.UniqueIdentifier, record.subscriber_id);
  await drop.query(
    `UPDATE SubscriberConfirmations SET superseded_at = SYSUTCDATETIME()
      WHERE subscriber_id = @id AND confirmed_at IS NULL AND superseded_at IS NULL`,
  );

  await recordChange(tx, record.subscriber_id, "rider_page", before, {
    categories: before.categories,
    routes: before.routes,
    zones: before.zones,
    sms_status: smsStatus,
    email_status: emailStatus,
  });
  return { rotated: true };
}

/** Routes and zones a rider may choose from. */
export async function readOptions(tx: Transaction): Promise<{
  routes: { id: string; label: string }[];
  zones: { id: string; label: string }[];
}> {
  const routesReq = new sql.Request(tx);
  const routes = await routesReq.query<{ route_id: string; route_short_name: string | null; route_long_name: string | null }>(
    `SELECT route_id, route_short_name, route_long_name
       FROM GtfsRoutes ORDER BY route_sort_order, route_short_name`,
  );

  // Only the active version's zones. An imported-but-not-activated version is
  // not the service area, and offering its zones would let a rider pick one
  // that dispatch will never match.
  const zonesReq = new sql.Request(tx);
  const zones = await zonesReq.query<{ external_location_id: string; name: string }>(
    `SELECT z.external_location_id, z.name
       FROM OnDemandOperationalZones z
       JOIN OnDemandOperationalZoneVersions v ON v.id = z.zone_version_id
      WHERE v.is_active = 1
      ORDER BY z.name`,
  );

  return {
    routes: routes.recordset.map((r) => ({
      id: r.route_id,
      label: [r.route_short_name, r.route_long_name].filter(Boolean).join(" - ") || r.route_id,
    })),
    zones: zones.recordset.map((z) => ({ id: z.external_location_id, label: z.name })),
  };
}

// --- Sending a rider their manage link again --------------------------------

/** How long a rider must wait between requests for their manage link. */
export const MANAGE_LINK_MIN_INTERVAL_MS = 2 * 60 * 1000;

export type ManageLinkOutcome =
  /** A link should be sent; publish `event` once the transaction commits. */
  | "issued"
  /** A link was sent to this record less than two minutes ago. */
  | "too_soon"
  /** No live record has this contact on a CONFIRMED channel. */
  | "nothing_confirmed";

export interface ManageLinkResult {
  outcome: ManageLinkOutcome;
  event?: ManageLinkRequestedEvent;
}

/**
 * Prepare the manage link for a rider who has lost theirs.
 *
 * ONLY A CONFIRMED CHANNEL IS EVER SENT ONE. The manage key opens the whole
 * subscription, which may include a second contact. Sending it to an address
 * nobody has proved would hand that subscription - possibly including someone
 * else's phone number - to whoever owns an inbox a stranger typed into a form.
 * An unconfirmed rider has a confirmation to finish instead.
 *
 * THE CALLER MUST ANSWER THE SAME WAY FOR ALL THREE OUTCOMES. They are
 * distinguished here so the handler knows whether to publish and so the
 * contract tests can tell them apart; distinguishing them over HTTP would make
 * the endpoint a way to ask whether any number or address is subscribed.
 */
export async function requestManageLink(
  tx: Transaction,
  channel: Channel,
  contact: string,
  now: Date = new Date(),
): Promise<ManageLinkResult> {
  const statusColumn = channel === "sms" ? "sms_status" : "email_status";
  const matchOn = channel === "sms" ? "phone_number" : "email";

  const find = new sql.Request(tx);
  find.input("contact", sql.NVarChar(320), contact);
  const found = await find.query<{
    subscriber_id: string;
    phone_number: string | null;
    email: string | null;
    manage_key: string | null;
    manage_link_sent_at: Date | null;
  }>(
    `SELECT TOP 1 subscriber_id, phone_number, email, manage_key, manage_link_sent_at
       FROM Subscribers WITH(UPDLOCK, HOLDLOCK)
      WHERE ${matchOn} = @contact
        AND ${statusColumn} = 'confirmed'
        AND status = 'confirmed'
        AND merged_into IS NULL
      ORDER BY opted_in_at DESC, subscriber_id`,
  );
  const sub = found.recordset[0];
  if (!sub) return { outcome: "nothing_confirmed" };

  if (sub.manage_link_sent_at && now.getTime() - sub.manage_link_sent_at.getTime() < MANAGE_LINK_MIN_INTERVAL_MS) {
    return { outcome: "too_soon" };
  }

  // A record that predates migration 119's backfill, or was written between
  // applying it and deploying the code that issues keys at opt-in, has none.
  // Issue one now rather than send a link to nothing. Every SET below reads the
  // row as it was before this UPDATE, so COALESCE and the CASE agree.
  const key = sub.manage_key ?? makeManageKey();
  const write = new sql.Request(tx);
  write.input("id", sql.UniqueIdentifier, sub.subscriber_id);
  write.input("key", sql.NVarChar(64), key);
  write.input("now", sql.DateTime2, now);
  await write.query(
    `UPDATE Subscribers
        SET manage_link_sent_at = @now,
            manage_key = COALESCE(manage_key, @key),
            manage_key_issued_at = CASE WHEN manage_key IS NULL THEN @now ELSE manage_key_issued_at END
      WHERE subscriber_id = @id`,
  );

  return {
    outcome: "issued",
    event: {
      kind: "manage_link",
      subscriber_id: sub.subscriber_id,
      channel,
      manage_key: key,
      // Only the contact being sent to. The dispatcher needs one, and the
      // other is none of this message's business.
      phone_number: channel === "sms" ? sub.phone_number : null,
      email: channel === "email" ? sub.email : null,
    },
  };
}
