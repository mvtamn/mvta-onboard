// Where a communication has got to, from the facts the provider reported.
//
// Two apps used to write this. REST set status/outcome when it queued or
// posted, and the dispatch app set them again when the provider answered -
// including flipping status to 'failed' and writing the outcome sentence. The
// two are separate builds, so the rule could not be shared, only copied.
//
// So the writing is split instead: the dispatcher records delivery FACTS
// (delivery_status, error, provider id, receipts) and nothing else, and the
// state is derived here, in one expression with a TypeScript twin. A reader
// that wants "did this actually go out" asks for `counted`, which is what
// `communication_status` counts - a queued or failed send is not a Detour
// audience that has been told.
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function alias(name: string): string {
  if (!IDENTIFIER.test(name)) throw new TypeError("a detour communication alias must be a plain identifier");
  return name;
}

export interface ClassifiableCommunication {
  /** The row's own status: what a person did with it. */
  status: string;
  /** Null where migration 092 has not run, or where nothing was ever sent. */
  delivery_status: string | null;
}

/**
 * `hasDelivery` is false where migration 092 has not been applied: there is no
 * server-side delivery there, so a published row is one a person sent.
 */
export function communicationStateSql(aliasName: string, as = "cst", hasDelivery = true): string {
  const c = alias(aliasName);
  const delivery = hasDelivery ? `${c}.delivery_status` : `CAST(NULL AS NVARCHAR(20))`;
  return `CROSS APPLY (
    SELECT CAST(CASE
      WHEN ${delivery} = N'queued' THEN N'queued'
      WHEN ${delivery} IN (N'sent', N'partially_sent') THEN N'sent'
      WHEN ${delivery} IN (N'failed', N'skipped') THEN N'failed'
      WHEN ${c}.status = N'published' THEN N'recorded'
      WHEN ${c}.status = N'failed' THEN N'failed'
      ELSE N'draft' END AS NVARCHAR(20)) state
  ) ${alias(as)}_raw
  CROSS APPLY (
    SELECT ${alias(as)}_raw.state,
      CONVERT(bit, CASE WHEN ${alias(as)}_raw.state IN (N'sent', N'recorded') THEN 1 ELSE 0 END) counted
  ) ${alias(as)}`;
}

/** The same rule in TypeScript, for a caller that already holds the row. */
export function classifyCommunication(row: ClassifiableCommunication, hasDelivery = true): { state: string; counted: boolean } {
  const delivery = hasDelivery ? row.delivery_status : null;
  const state = delivery === "queued" ? "queued"
    : delivery === "sent" || delivery === "partially_sent" ? "sent"
      : delivery === "failed" || delivery === "skipped" ? "failed"
        : row.status === "published" ? "recorded"
          : row.status === "failed" ? "failed"
            : "draft";
  return { state, counted: state === "sent" || state === "recorded" };
}
