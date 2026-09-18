// The eligibility rule itself: pure, and the only place that answers "may
// this go out?".
import type {
  CommunicationDetour,
  CommunicationEligibility,
  CommunicationRequest,
  EligibilityRefusal,
  EligibilityRefusalCode,
} from "./types";

const SENTENCES: Record<EligibilityRefusalCode, string> = {
  detour_closed: "This Detour is closed, so there is nothing left to tell this audience.",
  re_review_outstanding: "The reviewed facts changed and have not been re-reviewed, so what this would say may already be wrong. Complete the re-review first.",
  fulfillment_pending: "This Detour is not fulfilled yet. Confirm the Avail entry, or record a manual fallback, before telling anyone it is in place.",
  fulfillment_failed: "The Avail entry failed and no manual fallback has been recorded, so the Detour is not in place for riders.",
  conflict_unresolved: "A likely duplicate of this Detour is unresolved. Override or resolve it first, or two communications will describe the same closure differently.",
  no_recipients: "Add at least one email recipient before sending.",
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
  const refusal = ((): EligibilityRefusal | null => {
    if (closed) return eligibilityRefusal("detour_closed");
    if (detour.re_review_outstanding) return eligibilityRefusal("re_review_outstanding");
    if (detour.lifecycle_state === "fulfillment_failed") return eligibilityRefusal("fulfillment_failed");
    // Fulfillment is the prerequisite CONTEXT names: an Avail entry confirmed,
    // or a manual fallback recorded. Both leave the Detour fulfilled.
    if (detour.lifecycle_state !== "fulfilled") return eligibilityRefusal("fulfillment_pending");
    if (detour.conflict_status === "unresolved") return eligibilityRefusal("conflict_unresolved");
    // Teams posts to one configured channel; only email carries recipients.
    if (request.channel.trim().toLowerCase() === "email" && request.recipients.length === 0) return eligibilityRefusal("no_recipients");
    return null;
  })();

  return { may_draft: !closed, may_send: refusal === null, refusal, audience_not_required };
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
