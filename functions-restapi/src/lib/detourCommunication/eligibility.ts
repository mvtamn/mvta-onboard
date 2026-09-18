// The eligibility rule itself: pure, and the only place that answers "may
// this go out?".
import { isRecordedChannel, needsRecipients, type DetourChannel } from "./channels";
import type {
  CommunicationDetour,
  CommunicationEligibility,
  CommunicationRequest,
  EligibilityRefusal,
  EligibilityRefusalCode,
} from "./types";

const SENTENCES: Record<EligibilityRefusalCode, string> = {
  unknown_channel: "That is not a channel OnBoard knows. Choose email, text message, Teams, digital signage or AVL messaging.",
  detour_closed: "This Detour is closed, so there is nothing left to tell this audience.",
  re_review_outstanding: "The reviewed facts changed and have not been re-reviewed, so what this would say may already be wrong. Complete the re-review first.",
  fulfillment_pending: "This Detour is not fulfilled yet. Confirm the Avail entry, or record a manual fallback, before telling anyone it is in place.",
  fulfillment_failed: "The Avail entry failed and no manual fallback has been recorded, so the Detour is not in place for riders.",
  conflict_unresolved: "A likely duplicate of this Detour is unresolved. Override or resolve it first, or two communications will describe the same closure differently.",
  no_recipients: "Add at least one recipient before sending.",
};

export function eligibilityRefusal(code: EligibilityRefusalCode): EligibilityRefusal {
  return { code, sentence: SENTENCES[code] };
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Whether this audience's communication may be drafted and sent.
 *
 * Order matters: the refusal names the thing to fix first, so a dispatcher
 * told to complete a re-review is not then told about a conflict as well.
 */
export function communicationEligibility(detour: CommunicationDetour, request: CommunicationRequest): CommunicationEligibility {
  const closed = detour.lifecycle_state === "closed";
  const audience_not_required = !detour.required_audiences.some((required) => same(required, request.audience));
  // Recording is not sending. A Detour is closed after it ends, so somebody may
  // well write down on Tuesday the AVL message that went out on Monday, and
  // refusing that would push late entries out of the system altogether. Every
  // other refusal still applies: a record of telling riders about a Detour
  // whose facts are under re-review is as wrong recorded as sent.
  const recorded = request.channel !== null && isRecordedChannel(request.channel);
  const refusal = ((): EligibilityRefusal | null => {
    if (closed && !recorded) return eligibilityRefusal("detour_closed");
    if (detour.re_review_outstanding) return eligibilityRefusal("re_review_outstanding");
    if (detour.lifecycle_state === "fulfillment_failed") return eligibilityRefusal("fulfillment_failed");
    // Fulfillment is the prerequisite CONTEXT names: an Avail entry confirmed,
    // or a manual fallback recorded. Both leave the Detour fulfilled. A closed
    // Detour was fulfilled before it closed, so a recorded channel passes.
    if (detour.lifecycle_state !== "fulfilled" && !(closed && recorded)) return eligibilityRefusal("fulfillment_pending");
    if (detour.conflict_status === "unresolved") return eligibilityRefusal("conflict_unresolved");
    // Only a channel that carries an address needs one: nobody types a
    // recipient for a road sign.
    if (request.channel !== null && needsRecipients(request.channel) && request.recipients.length === 0) return eligibilityRefusal("no_recipients");
    return null;
  })();

  return { may_draft: !closed || recorded, may_send: refusal === null, refusal, audience_not_required };
}

/**
 * Where a Detour stands on telling everyone it must tell. Counting distinct
 * PUBLISHED audiences against the required list was computed inline in the
 * list endpoint, which is why the console grew its own copy.
 */
export function communicationStatus(input: { required: number; published: number; drafts: number }): "published" | "draft" | "needs_communication" {
  if (input.required > 0 && input.published >= input.required) return "published";
  return input.drafts > 0 ? "draft" : "needs_communication";
}
