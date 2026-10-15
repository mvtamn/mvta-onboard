// Teams delivery for announcements: a "Teams: <audience>" entry in a
// message's channels posts one Adaptive Card to that audience's channel.
//
// Each audience is its own Teams Workflows webhook ("Post to a channel when a
// webhook request is received"), held in Key Vault and read through an app
// setting. The Office 365 Incoming Webhook connector this pattern started on
// was switched off by Microsoft in May 2026; the Workflows template accepts
// the same { type: "message", attachments: [AdaptiveCard] } body, so only the
// URL differs.
//
// A Workflows webhook answers 202 once it has ACCEPTED the request, before
// the flow has posted. So "sent" here means Teams took it, not that it is
// confirmed in the channel - Teams gives nothing further back.

export const TEAMS_AUDIENCE_WEBHOOK_ENV: Readonly<Record<string, string>> = {
  operations: "TEAMS_OPERATIONS_WEBHOOK_URL",
  "customer service": "TEAMS_CUSTOMER_SERVICE_WEBHOOK_URL",
};

const TIMEOUT_MS = 30_000;

function audienceKey(audience: string): string {
  return audience.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * The webhook for an audience, or null when there is none to post to.
 *
 * functionapp.bicep sets each one as a Key Vault reference. Until the secret
 * exists, App Service hands the app the literal reference string, which is
 * not a URL and must read as "not configured", not as a failed post.
 */
export function teamsWebhookUrlFor(audience: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const name = TEAMS_AUDIENCE_WEBHOOK_ENV[audienceKey(audience)];
  if (!name) return null;
  const value = env[name]?.trim() || null;
  if (!value || value.startsWith("@Microsoft.KeyVault(")) return null;
  return value;
}

export interface AnnouncementForTeams {
  category: string;
  severity: string;
  summary: string;
  routes_affected: string[] | null;
  zones_affected: string[] | null;
  expires_at: string;
}

function label(code: string): string {
  const words = code.replace(/_/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "";
}

// Staff read this on MVTA's clock, wherever the function happens to run.
function centralTime(iso: string): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return `${at.toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })} CT`;
}

export function formatAnnouncementCard(message: AnnouncementForTeams) {
  const facts: { title: string; value: string }[] = [
    { title: "Category", value: label(message.category) },
    { title: "Severity", value: label(message.severity) },
  ];
  if (message.routes_affected?.length) facts.push({ title: "Routes", value: message.routes_affected.join(", ") });
  if (message.zones_affected?.length) facts.push({ title: "Zones", value: message.zones_affected.join(", ") });
  const expires = centralTime(message.expires_at);
  if (expires) facts.push({ title: "Expires", value: expires });
  return {
    type: "message",
    attachments: [{
      contentType: "application/vnd.microsoft.card.adaptive",
      contentUrl: null,
      content: {
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        type: "AdaptiveCard",
        version: "1.2",
        body: [
          { type: "TextBlock", text: "MVTA service announcement", weight: "Bolder", size: "Medium", wrap: true },
          { type: "TextBlock", text: message.summary, wrap: true },
          { type: "FactSet", facts },
        ],
      },
    }],
  };
}

export type TeamsPostOutcome =
  | { status: "sent" }
  | { status: "failed"; error: string }
  | { status: "skipped"; error: string };

export async function postAnnouncementToTeams(
  audience: string,
  message: AnnouncementForTeams,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<TeamsPostOutcome> {
  const url = teamsWebhookUrlFor(audience, env);
  if (!url) {
    const name = TEAMS_AUDIENCE_WEBHOOK_ENV[audienceKey(audience)];
    return {
      status: "skipped",
      error: name ? `No Teams channel is set up for ${audience} (${name})` : `${audience} is not a Teams audience OnBoard knows`,
    };
  }
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(formatAnnouncementCard(message)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    return { status: "failed", error: `Teams webhook unreachable: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (response.ok) return { status: "sent" };
  return { status: "failed", error: `Teams webhook returned ${response.status}` };
}
