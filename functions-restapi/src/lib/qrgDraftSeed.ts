// Seeding a Procedure Draft from a Quick Reference Guide.
//
// An author picks a QRG in the Approved Document Library and the governing SOP
// that the Procedure will cite. OnBoard reads the QRG through Graph, a model
// proposes Criteria and Immediate Actions from it, and the author gets a Draft
// with that guidance in it. Nothing here approves anything: a seeded Draft
// goes through the same review and approval as a hand-typed one, which is why
// ADR 0044 reads this as compatible with ADR 0024 rather than the content
// import ADR 0024 rejects.
//
// Two decisions shape the interface.
//
// The QRG's site and drive are NOT parameters. They belong to the Approved
// Document Library, exactly as for a Supporting Document Reference, so a
// QrgSource resolves an item id against the one configured library and the
// browser never gets to name a site. The author supplies an item, the version
// the picker showed, and the SOP.
//
// A model that cannot produce usable guidance does not fail the seeding. The
// author gets an empty Draft with the QRG already attached - which is the
// manual path, no worse than if this feature did not exist - and the reason is
// recorded. A SharePoint refusal is different and does refuse the whole
// seeding: a Draft citing a QRG that OnBoard cannot read is not a head start,
// and the refusal is the thing the author needs to see.
//
// The module is pure in the part that matters: it reads SharePoint and calls
// the proposer, then RETURNS the Draft to create and the seeding to record.
// It writes nothing. decisionMatrixQrgSeed.ts does both in one transaction.
import { ACTION_KINDS, CRITERION_KINDS, GUIDANCE_LIMITS, SEVERITIES } from "./decisionMatrixGuidance";

/** How much of a QRG the model is shown. A QRG is a summary by definition; a
 *  guide long enough to exceed this is a document the author should be reading
 *  themselves, and an uncapped read on a B1 single-worker app is how the Spare
 *  webhook saturation happened. */
export const MAX_QRG_PAGES = 4;

/** A hard ceiling on the proposal call. Past this the author gets the empty
 *  Draft rather than a request that sits on the one worker. */
export const PROPOSAL_TIMEOUT_MS = 25_000;

/** What a QRG may be. PDF is here because a QRG is commonly a one-page PDF;
 *  it is deliberately NOT in isInlineImageMime, which governs what a Visual
 *  rendition may be and stays PNG/JPEG. */
export const QRG_MIMES: ReadonlySet<string> = new Set(["image/png", "image/jpeg", "application/pdf"]);

export const MAX_PROPOSED_CRITERIA = 40;
export const MAX_PROPOSED_ACTIONS = 40;

export type QrgRead = {
  name: string;
  mime: string;
  /** The eTag, as the picker showed it. */
  seen_version: string;
  bytes: Uint8Array;
};

/** Why a QRG could not be read. The same four outcomes sharepointLibrary
 *  reports, so the refusal statuses match the rest of the feature. */
export type QrgReadFailure = { failure: "forbidden" | "not_found" | "failed" | "unconfigured"; reason: string };

export interface QrgSource {
  /** Resolve an item id against the one configured library and return its bytes. */
  read(itemId: string): Promise<QrgRead | QrgReadFailure>;
}

export interface GuidanceProposer {
  /** Which model, recorded with the proposal - a proposal is only
   *  interpretable against the model that made it. */
  readonly model: string;
  /** Whatever the model returned. Deliberately `unknown`: this module
   *  validates it, so an adapter cannot widen what counts as guidance. */
  propose(qrg: QrgRead, pages: number): Promise<unknown>;
}

export type ProposedCriterion = { kind: string; text: string };
export type ProposedAction = { kind: string; instruction: string };

export type Proposal = {
  condition?: string;
  severity?: string;
  severity_meaning?: string;
  criteria: ProposedCriterion[];
  immediate_actions: ProposedAction[];
};

export type ChosenDocument = {
  item_id: string;
  seen_version: string;
  document_code: string;
};

export type SeedInput = {
  procedure_id: string;
  condition_key: string;
  condition: string;
  /** The QRG the guidance is read from. */
  qrg: ChosenDocument;
  /** The governing SOP or Reference. Required because a QRG can never be the
   *  primary Supporting Document Reference - supportingDocumentReferences
   *  refuses any other type as primary - and a Draft without a primary is
   *  refused at review, minutes after the author thought they had finished. */
  primary: ChosenDocument & { document_type: "SOP" | "Reference" };
};

/** The Draft body, in the shape the Draft creation path already parses. */
export type SeededDraft = {
  procedure_id: string;
  condition_key: string;
  condition: string;
  severity?: string;
  severity_meaning?: string;
  criteria: ProposedCriterion[];
  immediate_actions: ProposedAction[];
  document_references: {
    document_type: string;
    is_primary: boolean;
    document_code: string;
    item_id: string;
    seen_version: string;
  }[];
};

export type SeedingRecord = {
  item_id: string;
  seen_version: string;
  qrg_name: string;
  qrg_mime: string;
  pages_read: number;
  outcome: "proposed" | "empty";
  outcome_reason: string | null;
  proposed_json: string | null;
  model: string | null;
};

export type Seeded = { draft: SeededDraft; seeding: SeedingRecord };

/** A refusal of the whole seeding, carrying the status the handler answers
 *  with - the same shape ReferenceRefusal uses so the handlers stay alike. */
export class SeedRefusal extends Error {
  constructor(readonly status: 400 | 409 | 503, message: string) {
    super(message);
    this.name = "SeedRefusal";
  }
}

function refuseRead(failure: QrgReadFailure): never {
  if (failure.failure === "not_found") throw new SeedRefusal(400, failure.reason);
  if (failure.failure === "failed") throw new SeedRefusal(503, failure.reason);
  // forbidden and unconfigured are both "ask an administrator", not "try
  // again": 409 so the console shows the reason rather than a retry.
  throw new SeedRefusal(409, failure.reason);
}

// Structured outputs may return an enum with different capitalization than
// the schema declares - the API documents that explicitly and says to compare
// case-insensitively. So a kind or severity is matched by folded case and
// mapped back to OnBoard's own spelling, which is what the columns hold.
function canonical(value: unknown, allowed: ReadonlySet<string>): string | undefined {
  if (typeof value !== "string") return undefined;
  const folded = value.trim().toLowerCase();
  for (const candidate of allowed) if (candidate.toLowerCase() === folded) return candidate;
  return undefined;
}

function cleanText(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, limit);
}

/**
 * The model's answer, or why it is not usable. Validated against the same
 * vocabulary a hand-typed Draft is held to, so a proposal cannot introduce a
 * Criterion kind or a severity the Draft path would later reject.
 */
export function validateProposal(value: unknown): Proposal | { error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "The model did not return a guidance object." };
  const body = value as Record<string, unknown>;
  if (!Array.isArray(body.criteria) || !Array.isArray(body.immediate_actions)) {
    return { error: "The model's answer had no criteria and immediate_actions arrays." };
  }
  if (body.criteria.length > MAX_PROPOSED_CRITERIA || body.immediate_actions.length > MAX_PROPOSED_ACTIONS) {
    return { error: `The model proposed more than ${MAX_PROPOSED_CRITERIA} criteria or immediate actions.` };
  }

  const criteria: ProposedCriterion[] = [];
  for (const raw of body.criteria) {
    if (!raw || typeof raw !== "object") return { error: "A proposed Criterion was not an object." };
    const { kind, text } = raw as Record<string, unknown>;
    const cleaned = cleanText(text, GUIDANCE_LIMITS.criterion_text);
    const criterionKind = canonical(kind, CRITERION_KINDS);
    if (!criterionKind || !cleaned) {
      return { error: "A proposed Criterion needs an applies/excludes kind and text." };
    }
    criteria.push({ kind: criterionKind, text: cleaned });
  }

  const actions: ProposedAction[] = [];
  for (const raw of body.immediate_actions) {
    if (!raw || typeof raw !== "object") return { error: "A proposed Immediate Action was not an object." };
    const { kind, instruction } = raw as Record<string, unknown>;
    const cleaned = cleanText(instruction, GUIDANCE_LIMITS.action_instruction);
    const actionKind = canonical(kind, ACTION_KINDS);
    if (!actionKind || !cleaned) {
      return { error: "A proposed Immediate Action needs a required, conditional, or informational kind and an instruction." };
    }
    actions.push({ kind: actionKind, instruction: cleaned });
  }

  // Nothing to review is the same as nothing proposed. Saying so here keeps
  // the handler from writing a 'proposed' seeding with empty guidance.
  if (!criteria.length && !actions.length) return { error: "The model proposed no criteria and no immediate actions." };

  const severity = body.severity === undefined || body.severity === null || body.severity === ""
    ? undefined
    : canonical(body.severity, SEVERITIES);
  if (body.severity !== undefined && body.severity !== null && body.severity !== "" && severity === undefined) {
    return { error: "The model proposed a severity OnBoard does not use." };
  }

  return {
    condition: cleanText(body.condition, GUIDANCE_LIMITS.condition),
    severity,
    severity_meaning: cleanText(body.severity_meaning, GUIDANCE_LIMITS.severity_meaning),
    criteria,
    immediate_actions: actions,
  };
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | { timedOut: true }> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<{ timedOut: true }>((resolve) => { timer = setTimeout(() => resolve({ timedOut: true }), ms); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function references(input: SeedInput): SeededDraft["document_references"] {
  return [
    {
      document_type: input.primary.document_type,
      is_primary: true,
      document_code: input.primary.document_code,
      item_id: input.primary.item_id,
      seen_version: input.primary.seen_version,
    },
    {
      document_type: "QRG",
      is_primary: false,
      document_code: input.qrg.document_code,
      item_id: input.qrg.item_id,
      seen_version: input.qrg.seen_version,
    },
  ];
}

/**
 * Read the QRG, ask for guidance, and return the Draft to create together with
 * the seeding to record. Writes nothing.
 *
 * Refuses (SeedRefusal) when the QRG itself cannot be read or is not a format
 * OnBoard can show. Returns an empty Draft - outcome 'empty', with the reason
 * - when the QRG reads fine but the model's answer is unusable.
 */
export async function seedDraftFromQrg(
  input: SeedInput,
  source: QrgSource,
  proposer: GuidanceProposer,
  /** Overridden only by tests, which must not sit out the real timeout. */
  options: { timeoutMs?: number; pages?: number } = {},
): Promise<Seeded> {
  const timeoutMs = options.timeoutMs ?? PROPOSAL_TIMEOUT_MS;
  const pages = options.pages ?? MAX_QRG_PAGES;
  if (input.qrg.item_id === input.primary.item_id) {
    throw new SeedRefusal(400, "The QRG and the governing document must be different documents.");
  }

  const read = await source.read(input.qrg.item_id);
  if ("failure" in read) refuseRead(read);

  if (!QRG_MIMES.has(read.mime.toLowerCase())) {
    throw new SeedRefusal(400, `OnBoard can read a QRG as a PNG, JPEG or PDF; ${read.name} is ${read.mime}.`);
  }
  // The version the picker showed must still be the version in SharePoint,
  // the same check a new Supporting Document Reference makes - otherwise the
  // guidance would be proposed from one revision and the reference frozen
  // against another.
  if (read.seen_version !== input.qrg.seen_version) {
    throw new SeedRefusal(409, `${read.name} changed in SharePoint after you chose it. Open it again and retry.`);
  }

  const base = {
    item_id: input.qrg.item_id,
    seen_version: read.seen_version,
    qrg_name: read.name,
    qrg_mime: read.mime,
    pages_read: pages,
  };
  const empty = (reason: string): Seeded => ({
    draft: {
      procedure_id: input.procedure_id,
      condition_key: input.condition_key,
      condition: input.condition,
      criteria: [],
      immediate_actions: [],
      document_references: references(input),
    },
    seeding: { ...base, outcome: "empty", outcome_reason: reason, proposed_json: null, model: proposer.model },
  });

  let answer: unknown;
  try {
    const raced = await withTimeout(proposer.propose(read, pages), timeoutMs);
    if (raced && typeof raced === "object" && "timedOut" in raced) {
      return empty(`Reading ${read.name} took longer than ${Math.round(timeoutMs / 1000)} seconds.`);
    }
    answer = raced;
  } catch (error) {
    return empty(`Reading ${read.name} failed: ${error instanceof Error ? error.message : "unknown error"}`.slice(0, 500));
  }

  const proposal = validateProposal(answer);
  if ("error" in proposal) return empty(proposal.error);

  return {
    draft: {
      procedure_id: input.procedure_id,
      condition_key: input.condition_key,
      // The author's own words for the condition win; the model's are a
      // fallback for a field they left blank, never an override.
      condition: input.condition || proposal.condition || "",
      severity: proposal.severity,
      severity_meaning: proposal.severity_meaning,
      criteria: proposal.criteria,
      immediate_actions: proposal.immediate_actions,
      document_references: references(input),
    },
    seeding: {
      ...base,
      outcome: "proposed",
      outcome_reason: null,
      proposed_json: JSON.stringify(proposal),
      model: proposer.model,
    },
  };
}
