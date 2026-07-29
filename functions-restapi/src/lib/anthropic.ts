// Thin wrapper around the Anthropic Messages API - powers Compose's optional
// "Draft rider-friendly text" action (messagesDraftSummary.ts). Plain fetch,
// no SDK dependency, consistent with how the GTFS feeds are already fetched
// elsewhere in this codebase.
import { MAX_SUMMARY_LENGTH } from "./validation";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-sonnet-4-5";

export class AnthropicNotConfiguredError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY is not configured.");
    this.name = "AnthropicNotConfiguredError";
  }
}

const SYSTEM_PROMPT = `You rewrite internal MVTA (Minnesota Valley Transit Authority) transit-operations \
incident reports into short, plain-language service alerts for riders.

Rules:
- Write for a rider who just wants to know how this affects their trip - not staff.
- Never include vehicle numbers, internal system/vendor names (e.g. Avail, C-Soft, ECPR), \
operator names, or internal cause jargon (e.g. "remote reset," "swapped out of").
- Focus on the impact (which route/direction, how late or what changed) and, if the \
source text says so, when normal service should resume.
- Calm, professional, factual tone - no blame, no speculation, no exclamation points.
- Do not invent details that are not present in the source text.
- Output ONLY the rider-facing alert text, nothing else (no preamble, no quotes).
- Keep it under ${MAX_SUMMARY_LENGTH} characters.`;

export async function draftRiderSummary(
  rawText: string,
  category: string,
  severity: string,
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new AnthropicNotConfiguredError();
  }

  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Category: ${category}\nSeverity: ${severity}\nInternal report:\n${rawText}`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Anthropic API request failed (${res.status}): ${detail.slice(0, 300)}`);
  }

  const payload = (await res.json()) as {
    content?: { type: string; text?: string }[];
  };
  const text = payload.content?.find((block) => block.type === "text")?.text?.trim();
  if (!text) {
    throw new Error("Anthropic API response contained no text content.");
  }

  // Defense-in-depth: enforce the column limit server-side regardless of what
  // the model returns, same "validate at the boundary" convention as every
  // other user-facing text field in this repo.
  return text.slice(0, MAX_SUMMARY_LENGTH);
}
