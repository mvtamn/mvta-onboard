// The Detour communication module: who may be told what, and what happened
// when we told them.
//
//   communicationEligibility  - may this audience's communication be drafted,
//                               and may it be sent (eligibility.ts)
//   sendCommunication         - the one path that sends: it checks
//                               eligibility, snapshots what goes out, asks the
//                               delivery port, and records the outcome
//   recordSentElsewhere       - a person sent it themselves; same check
//   communicationStateSql     - where a communication has got to, from the
//                               facts the provider reported (state.ts)
//
// The dispatch app writes delivery facts only. Nothing else writes a
// communication's state.
import type { InvocationContext } from "@azure/functions";
import { sql } from "../db";
import { parseRecipients, requiredAudiences, type ContractorNotification } from "../detourContractor";
import type { DetourWorkflowView } from "../detourWorkflow";
import { communicationEligibility, eligibilityRefusal } from "./eligibility";
import { classifyCommunication, communicationStateSql } from "./state";
import { deliveryPortFor, EMAIL_CHANNEL } from "./delivery";
import type {
  CommunicationDetour,
  CommunicationEligibility,
  DeliveryOutcome,
  DetourDeliveryPort,
  EligibilityRefusal,
} from "./types";

export * from "./types";
export * from "./eligibility";
export * from "./state";
export * from "./delivery";
export * from "./contractorSettings";

interface CommunicationRow {
  id: string; detour_id: string; audience: string; channel: string; recipients: string | null;
  content: string; status: string; delivery_status: string | null;
  internal_number: string | null; number: string | null; closure: string;
  notification_audiences: string | null; service_impact: string | null;
}

export type SendOutcome =
  | { ok: true; state: string; delivery: DeliveryOutcome }
  | { ok: false; status: number; refusal: EligibilityRefusal | { code: string; sentence: string } };

const refusal = (code: string, sentence: string) => ({ code, sentence });

/** Migration 092's columns; without them there is no server-side delivery. */
export async function deliveryColumnsReady(pool: sql.ConnectionPool): Promise<boolean> {
  return (await pool.request().query<{ ready: number }>(
    `SELECT CASE WHEN COL_LENGTH('dbo.DetourCommunications','delivery_status') IS NULL THEN 0 ELSE 1 END ready`)).recordset[0]?.ready === 1;
}

async function load(pool: sql.ConnectionPool, detourId: string, communicationId: string, hasDelivery: boolean): Promise<CommunicationRow | undefined> {
  return (await pool.request()
    .input("id", sql.UniqueIdentifier, communicationId)
    .input("detour_id", sql.UniqueIdentifier, detourId)
    .query<CommunicationRow>(`
      SELECT c.id, c.detour_id, c.audience, c.channel, c.recipients, c.content, c.status,
        ${hasDelivery ? "c.delivery_status" : "CAST(NULL AS NVARCHAR(20)) delivery_status"},
        d.internal_number, d.number, d.closure,
        d.notification_audiences, d.service_impact
      FROM DetourCommunications c JOIN Detours d ON d.id = c.detour_id
      WHERE c.id=@id AND c.detour_id=@detour_id`)).recordset[0];
}

/**
 * The Detour as eligibility sees it: its Workflow state, Outstanding
 * re-review and Conflict override come from the Detour workflow module
 * (candidate #1), which is what decides them; the audiences come from the
 * record and the configured contractor.
 */
export function detourFrom(row: CommunicationRow, workflow: DetourWorkflowView, contractor: ContractorNotification): CommunicationDetour {
  return {
    lifecycle_state: workflow.lifecycle_state,
    fulfillment_mode: workflow.fulfillment_mode,
    re_review_outstanding: workflow.re_review_outstanding,
    conflict_status: workflow.conflict_status,
    required_audiences: requiredAudiences(
      { notification_audiences: (row.notification_audiences ?? "").split(",").map((a) => a.trim()).filter(Boolean), service_impact: row.service_impact },
      contractor,
    ),
  };
}

export function subjectFor(row: { internal_number: string | null; number: string | null; closure: string }): string {
  const ref = row.internal_number || row.number;
  return `${ref ? `[${ref}] ` : ""}Detour: ${row.closure}`.slice(0, 500);
}

interface SendInput {
  pool: sql.ConnectionPool;
  detourId: string;
  communicationId: string;
  actor: string;
  contractor: ContractorNotification;
  workflow: DetourWorkflowView;
  context: InvocationContext;
  /** Tests pass a fake; production resolves one from the channel. */
  port?: DetourDeliveryPort;
}

/**
 * Sends one communication. Eligibility is checked here, so every caller gets
 * the same answer: the publish endpoint, and anything added later.
 */
export async function sendCommunication(input: SendInput): Promise<SendOutcome> {
  const hasDelivery = await deliveryColumnsReady(input.pool);
  if (!hasDelivery) return { ok: false, status: 503, refusal: refusal("delivery_not_configured", "Server-side delivery is not configured (migration 092)") };
  const row = await load(input.pool, input.detourId, input.communicationId, hasDelivery);
  if (!row) return { ok: false, status: 404, refusal: refusal("not_found", "Communication not found") };
  const current = classifyCommunication(row, hasDelivery);
  if (current.state !== "draft" && current.state !== "failed") {
    return { ok: false, status: 409, refusal: refusal("not_sendable", "Only a draft or failed communication can be sent") };
  }
  const recipients = parseRecipients(row.recipients);
  const eligibility = communicationEligibility(detourFrom(row, input.workflow, input.contractor), {
    audience: row.audience, channel: row.channel, recipients,
  });
  if (!eligibility.may_send) return { ok: false, status: 409, refusal: eligibility.refusal! };

  const port = input.port ?? deliveryPortFor(row.channel, input.context);
  if (!port) return { ok: false, status: 409, refusal: refusal("channel_not_deliverable", "Server-side delivery is available for email and Teams communications only") };

  const subject = subjectFor(row);
  const isEmail = port.channel === EMAIL_CHANNEL;
  // Snapshot first: what went out is fixed before any delivery is attempted,
  // and the row reads as queued until the provider answers.
  await input.pool.request()
    .input("id", sql.UniqueIdentifier, input.communicationId)
    .input("subject", sql.NVarChar(500), subject)
    .input("body", sql.NVarChar(sql.MAX), row.content)
    .input("recipients", sql.NVarChar(2000), isEmail ? recipients.join(", ") : "Teams channel")
    .input("actor", sql.NVarChar(200), input.actor)
    .query(`
      UPDATE DetourCommunications
      SET status='published', published_by=@actor, published_at=SYSUTCDATETIME(), outcome=NULL,
          delivery_status='queued', delivery_requested_at=SYSUTCDATETIME(), delivery_completed_at=NULL,
          delivery_error=NULL, delivery_provider_id=NULL,
          sent_subject=@subject, sent_body=@body, sent_recipients=@recipients
      WHERE id=@id`);

  const delivery = await port.deliver({
    communicationId: input.communicationId, detourId: input.detourId,
    subject, body: row.content, recipients,
  });

  // Queued means the dispatch app owns the rest: it writes the delivery facts
  // when the provider answers, and nothing here touches them again.
  if (delivery.status !== "queued") {
    await input.pool.request()
      .input("id", sql.UniqueIdentifier, input.communicationId)
      .input("delivery", sql.NVarChar(20), delivery.status)
      .input("error", sql.NVarChar(1000), "error" in delivery ? delivery.error : null)
      .query(`
        UPDATE DetourCommunications
        SET delivery_status=@delivery, delivery_completed_at=SYSUTCDATETIME(), delivery_error=@error,
            outcome=CASE WHEN @delivery='sent' THEN 'Posted to ' + channel ELSE outcome END,
            published_by=CASE WHEN @delivery IN ('failed','skipped') THEN NULL ELSE published_by END,
            published_at=CASE WHEN @delivery IN ('failed','skipped') THEN NULL ELSE published_at END,
            status=CASE WHEN @delivery IN ('failed','skipped') THEN 'draft' ELSE status END
        WHERE id=@id`);
  }
  return { ok: true, state: classifyCommunication({ status: "published", delivery_status: delivery.status }, hasDelivery).state, delivery };
}

/**
 * A person sent it themselves and is recording that. The same eligibility
 * question applies: a closed Detour is not one to tell riders about, however
 * the message went.
 */
export async function recordSentElsewhere(input: Omit<SendInput, "port" | "context"> & { outcome: string }): Promise<SendOutcome> {
  const hasDelivery = await deliveryColumnsReady(input.pool);
  const row = await load(input.pool, input.detourId, input.communicationId, hasDelivery);
  if (!row) return { ok: false, status: 404, refusal: refusal("not_found", "Communication was not found") };
  const current = classifyCommunication(row, hasDelivery);
  if (current.state !== "draft" && current.state !== "failed") {
    return { ok: false, status: 409, refusal: refusal("not_sendable", "Communication was not found or is already published") };
  }
  const eligibility = communicationEligibility(
    detourFrom(row, input.workflow, input.contractor),
    { audience: row.audience, channel: row.channel, recipients: parseRecipients(row.recipients) },
  );
  // Recipients are the sender's business when they sent it themselves.
  const blocking = eligibility.refusal && eligibility.refusal.code !== "no_recipients" ? eligibility.refusal : null;
  if (blocking) return { ok: false, status: 409, refusal: blocking };

  await input.pool.request()
    .input("id", sql.UniqueIdentifier, input.communicationId)
    .input("actor", sql.NVarChar(200), input.actor)
    .input("outcome", sql.NVarChar(500), input.outcome)
    .query(`UPDATE DetourCommunications SET status='published', published_by=@actor, published_at=SYSUTCDATETIME(), outcome=@outcome WHERE id=@id`);
  return { ok: true, state: "recorded", delivery: { status: "sent" } };
}

/** Eligibility for every audience a Detour must reach, for the list endpoint. */
export function audienceEligibility(
  detour: CommunicationDetour,
  channelFor: (audience: string) => { channel: string; recipients: string[] },
): { audience: string; eligibility: CommunicationEligibility }[] {
  return detour.required_audiences.map((audience) => ({
    audience,
    eligibility: communicationEligibility(detour, { audience, ...channelFor(audience) }),
  }));
}

export { eligibilityRefusal, communicationStateSql };
