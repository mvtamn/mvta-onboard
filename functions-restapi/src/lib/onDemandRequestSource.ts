// The only way a Spare request reaches on-demand monitor state.
//
// Three writers feed MonitoredOnDemandWaits: the hourly authoritative
// reconciliation, the Spare webhook (a requestStatus body, or an ETA delivery
// that forces a re-read of the request), and the monitor write that rides along
// on the missed-trip ingest. Each used to normalize the record and decide scope
// its own way - the reconciliation filtered raw rows by hand, the webhook and
// the ingest each called admitsMonitorWrite at their own point - and the store
// re-checked scope at runtime as a backstop, because nothing stopped a writer
// added later from forgetting to ask. PR #304 needed five files for that one
// rule.
//
// Admission now happens here, once, whichever way a record arrives, and what it
// hands back is a MonitoredOnDemandRequest: a normalized request that has been
// shown to belong to the monitored scope. storeOnDemandSpareRequest accepts
// nothing else, so skipping the question is a type error rather than a code
// review catch.
//
// Scope is ADR 0026's: ON_DEMAND_MONITORING_SERVICE_IDS, required with the
// switch and never defaulted to the missed-trip services. Duty vehicle and
// matching updates carry a duty, not a service, and stay outside this module on
// purpose (see onDemandSpareWebhook).
import { admitsMonitorWrite, onDemandActivation, type OnDemandActivation } from "./onDemandMonitoringHealth";
import { normalizeOnDemandSpareRequest, type NormalizedOnDemandRequest } from "./onDemandSpareMonitor";
import {
  fetchSpareRequest,
  fetchSpareUpdatedWindow,
  positiveEnvInteger,
  type SparePageFetcher,
  type SpareRequestRecord,
} from "./spareApi";

declare const admitted: unique symbol;

// Constructed only by admitOnDemandRequest.
export type MonitoredOnDemandRequest = NormalizedOnDemandRequest & { readonly [admitted]: true };

export type OnDemandRequestAdmission =
  | { admit: true; request: MonitoredOnDemandRequest }
  // unusable: no request id, update time or pickup commitment, so there is no
  // wait to monitor. The others are the activation's own answers.
  | { admit: false; reason: "unusable" | "disabled" | "unscoped" | "out_of_scope" };

export function admitOnDemandRequest(
  record: SpareRequestRecord,
  activation: OnDemandActivation = onDemandActivation(),
): OnDemandRequestAdmission {
  const normalized = normalizeOnDemandSpareRequest(record);
  if (!normalized) return { admit: false, reason: "unusable" };
  // A record with no service id is never admitted: an unattributable request
  // cannot be shown to belong to MVTA Connect.
  const decision = admitsMonitorWrite(normalized.serviceId, activation);
  if (!decision.admit) return { admit: false, reason: decision.reason };
  return { admit: true, request: normalized as MonitoredOnDemandRequest };
}

const PAGE_SIZE = 200;
const DEFAULT_MAX_ROWS = 10_000;

// How far back each authoritative read goes. This is a window, not the whole
// history: the read used to page /v1/requests unbounded, which on real data
// reaches the row cap among records years old and throws before it ever sees
// today. Twenty-four hours against an hourly run is heavy overlap by design: a
// request has to go a full day without a single Spare update to fall out of the
// read, and a genuinely live request updates far more often than that. The cost
// of the overlap is re-storing unchanged rows, which the store treats as a
// no-op.
const DEFAULT_LOOKBACK_MINUTES = 24 * 60;

export interface OnDemandRequestWindow {
  // How many records Spare returned, in or out of scope.
  fetched: number;
  requests: MonitoredOnDemandRequest[];
}

// The authoritative read behind the hourly reconciliation. Scope is applied to
// the rows returned rather than as a query filter: Spare's request filters
// include a service filter, but its exact parameter name has never been
// confirmed against the live API, and a filter Spare silently ignores would
// widen the read to every service the key can see - the one outcome the
// activation exists to prevent. Filtering rows we hold is slower and cannot be
// wrong.
export async function readOnDemandRequestWindow(
  activation: OnDemandActivation & { active: true },
  nowSeconds: number,
  fetchPage?: SparePageFetcher,
): Promise<OnDemandRequestWindow> {
  const lookbackMinutes = positiveEnvInteger("ON_DEMAND_RECONCILE_LOOKBACK_MINUTES", DEFAULT_LOOKBACK_MINUTES, 7 * 24 * 60);
  const maxRows = positiveEnvInteger("ON_DEMAND_RECONCILE_MAX_ROWS", DEFAULT_MAX_ROWS, 50_000);
  const rows = await fetchSpareUpdatedWindow<SpareRequestRecord>(
    nowSeconds - lookbackMinutes * 60, nowSeconds, PAGE_SIZE, maxRows, fetchPage,
  );
  const requests = rows.flatMap((row) => {
    const admission = admitOnDemandRequest(row, activation);
    return admission.admit ? [admission.request] : [];
  });
  return { fetched: rows.length, requests };
}

// One request, re-read from Spare. An ETA delivery carries no source ordering
// timestamp and no service, so it is only ever applied through the
// authoritative record: retries cannot reverse a newer status, and scope is
// decided from the record rather than guessed from the delivery.
export async function rereadOnDemandRequest(
  requestId: string,
  activation: OnDemandActivation = onDemandActivation(),
  fetchRequest: (requestId: string) => Promise<SpareRequestRecord> = fetchSpareRequest,
): Promise<OnDemandRequestAdmission> {
  return admitOnDemandRequest(await fetchRequest(requestId), activation);
}
