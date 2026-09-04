// Teams delivery for Detour communications, through the same incoming-
// webhook pattern Event monitoring uses (TEAMS_EVENT_WEBHOOK_URL), on its
// own webhook so the detour channel can differ from the event channel.
// Synchronous at publish time: one HTTPS POST, no queue - a webhook call
// has nothing to retry across processes, and the reviewer is waiting on
// the result.
import { formatTeamsWebhookPayload, isTransientNotificationFailure } from "./eventNotificationPolicy";

export const DETOUR_TEAMS_WEBHOOK_ENV = "TEAMS_DETOUR_WEBHOOK_URL";

export function detourTeamsWebhookUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  return env[DETOUR_TEAMS_WEBHOOK_ENV]?.trim() || null;
}

// Adaptive Card: the subject as a heading, the body as one wrapped block.
// Teams renders line breaks in TextBlock text, so the plain draft is used
// as-is rather than converted to markdown.
export function formatDetourTeamsPayload(subject: string, body: string) {
  const base = formatTeamsWebhookPayload(body);
  const card = base.attachments[0].content as { body: unknown[] };
  card.body = [{ type: "TextBlock", text: subject, weight: "Bolder", size: "Medium", wrap: true }, ...card.body];
  return base;
}

export type TeamsDeliveryOutcome = { status: "sent" } | { status: "failed"; error: string; transient: boolean } | { status: "skipped"; error: string };

export async function deliverDetourToTeams(subject: string, body: string, env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): Promise<TeamsDeliveryOutcome> {
  const url = detourTeamsWebhookUrl(env);
  if (!url) return { status: "skipped", error: `Teams delivery is not configured (${DETOUR_TEAMS_WEBHOOK_ENV}); post it yourself and mark published` };
  let response: Response;
  try {
    response = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(formatDetourTeamsPayload(subject, body)) });
  } catch (err) {
    return { status: "failed", error: `Teams webhook unreachable: ${err instanceof Error ? err.message : String(err)}`, transient: true };
  }
  if (response.ok) return { status: "sent" };
  return { status: "failed", error: `Teams webhook returned ${response.status}`, transient: isTransientNotificationFailure(response.status) };
}
