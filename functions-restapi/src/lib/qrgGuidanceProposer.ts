// The GuidanceProposer that actually reads a QRG: the Anthropic Messages API.
//
// Plain fetch and no SDK, matching anthropic.ts next door - that file already
// calls this API for Compose's rider-summary action, and one codebase calling
// the same API two different ways is worse than either way. If the SDK is
// adopted, both files should move together.
//
// Three things here are the API's rules rather than preferences:
//
//   - A document block carries the PDF and an image block the PNG/JPEG, and
//     the block goes BEFORE the text block in the same user message.
//   - Forced tool use returns a 400 on this model, so the JSON is not coaxed
//     out with a tool at all: output_config.format pins the shape, and the
//     answer comes back as a text block holding a JSON string.
//   - A strict schema cannot express maxLength, minimum, or minItems above 1.
//     So the schema says only what shape the answer takes and qrgDraftSeed.ts
//     enforces every length. The truncation there is load-bearing, not a
//     second line of defence.
import type { GuidanceProposer, QrgRead } from "./qrgDraftSeed";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-opus-5-5";

/** Enough for a few dozen criteria and actions; the schema caps neither, so
 *  this is what stops a runaway, together with the counts qrgDraftSeed checks. */
const MAX_TOKENS = 8000;

export class ProposerNotConfiguredError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY is not configured.");
    this.name = "ProposerNotConfiguredError";
  }
}

const SYSTEM_PROMPT = `You read a Quick Reference Guide (QRG) used by MVTA (Minnesota Valley Transit \
Authority) transit operations staff and restate what it says as structured guidance for \
MVTA's OnBoard Decision Matrix.

A QRG is a one-page summary of a procedure, usually laid out as a table, a flowchart or a \
numbered list. Restate it. Do not improve it, complete it, or add steps that a reader of \
this page would not find on it.

Rules:
- A criterion says when the procedure applies ("applies") or when it explicitly does not \
("excludes"). Only record an "excludes" criterion where the page actually rules something out.
- An immediate action is "required" when the page states it unconditionally, "conditional" \
when the page makes it depend on something, and "informational" when it tells the reader \
what someone else does or what is happening rather than instructing them to act.
- Keep each criterion and each action to the single observable statement the page makes. \
Do not merge two steps into one, and do not split one step into two.
- Use the page's own words wherever they are already clear. Do not introduce vocabulary \
the page does not use.
- severity is "Stop service" when the page says service stops or a vehicle is held, \
"Restrict service" when service continues in a reduced or altered form, and \
"Routine / no escalation" otherwise. Omit it if the page does not indicate one.
- If the page is unreadable, is not a QRG, or contains no procedure, return empty \
criteria and immediate_actions arrays rather than inventing content.
- Never record a vehicle number, an operator name, or anything else specific to one \
incident that happens to appear as an example on the page.`;

// Deliberately shallow: enum members and the object shape, nothing about
// lengths, which the API would reject and qrgDraftSeed enforces anyway.
const GUIDANCE_SCHEMA = {
  type: "object",
  properties: {
    condition: { type: "string", description: "The service condition this procedure responds to, in a short phrase." },
    severity: { type: "string", enum: ["Stop service", "Restrict service", "Routine / no escalation"] },
    severity_meaning: { type: "string", description: "What that severity means for service, as the page puts it." },
    criteria: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["applies", "excludes"] },
          text: { type: "string" },
        },
        required: ["kind", "text"],
        additionalProperties: false,
      },
    },
    immediate_actions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["required", "conditional", "informational"] },
          instruction: { type: "string" },
        },
        required: ["kind", "instruction"],
        additionalProperties: false,
      },
    },
  },
  required: ["criteria", "immediate_actions"],
  additionalProperties: false,
} as const;

/** The QRG itself, as the content block its media type calls for. */
function documentBlock(qrg: QrgRead, pages: number) {
  // Buffer.toString("base64") never inserts newlines, which the API requires.
  const data = Buffer.from(qrg.bytes).toString("base64");
  if (qrg.mime.toLowerCase() === "application/pdf") {
    return {
      block: { type: "document", source: { type: "base64", media_type: "application/pdf", data } },
      // The API has no per-request page limit to set, so the cap is stated to
      // the model instead: a QRG is a summary, and a long one is a document
      // the author should read themselves.
      note: `Read only the first ${pages} page${pages === 1 ? "" : "s"} of this document.`,
    };
  }
  return {
    block: { type: "image", source: { type: "base64", media_type: qrg.mime.toLowerCase(), data } },
    note: "",
  };
}

export function anthropicGuidanceProposer(): GuidanceProposer {
  return {
    model: MODEL,
    async propose(qrg: QrgRead, pages: number): Promise<unknown> {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new ProposerNotConfiguredError();

      const { block, note } = documentBlock(qrg, pages);
      const response = await fetch(ANTHROPIC_API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system: SYSTEM_PROMPT,
          // Effort defaults to medium on this model. Restating one page is not
          // the work that repays more, and a cheap call keeps an author-facing
          // action responsive.
          output_config: { effort: "medium", format: { type: "json_schema", schema: GUIDANCE_SCHEMA } },
          messages: [{
            role: "user",
            content: [
              block,
              { type: "text", text: `${note}\n\nThis QRG is called "${qrg.name}". Restate what it says.`.trim() },
            ],
          }],
        }),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`Anthropic API request failed (${response.status}): ${detail.slice(0, 300)}`);
      }

      const payload = await response.json() as {
        stop_reason?: string;
        stop_details?: { category?: string | null } | null;
        content?: { type: string; text?: string }[];
      };

      // Both of these come back as HTTP 200 with content that does not match
      // the schema, so they have to be checked before the JSON is parsed.
      if (payload.stop_reason === "refusal") {
        throw new Error(`The model declined to read this QRG (${payload.stop_details?.category ?? "unspecified"}).`);
      }
      if (payload.stop_reason === "max_tokens") {
        throw new Error("The QRG's guidance was longer than one answer allows.");
      }

      const text = payload.content?.find((part) => part.type === "text")?.text?.trim();
      if (!text) throw new Error("The model's answer contained no guidance.");
      // Structured outputs returns the JSON as a string in a text block, so
      // parsing it here is the documented shape, not a workaround. A parse
      // failure is an unusable answer like any other.
      return JSON.parse(text) as unknown;
    },
  };
}
